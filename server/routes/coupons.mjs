// Coupons (Roadmap 82 Wave R3-2, 2026-11-13) — xlsx row 15. A coupon
// belongs to one shop; a buyer redeems it by code at order time.
// Payment stays simulated: a coupon is arithmetic on simulated
// amounts, never real money.
//
// Stacking (fixed, never ambiguous): base price first (tier price x
// qty, or resource price x qty — computed by the order route), then
// the R3-1 member discount, then the coupon on the REMAINDER:
// fixed = min(value_cents, remainder), pct = floor(remainder x pct /
// 100). amount = remainder - coupon_cents, never below 0. All integer
// cents, server-side.
//
// Validity at order creation (all 400): the code is normalized (trim
// + uppercase, ^[A-Z0-9]{4,20}$) and looked up in the ORDER's shop
// only — a code that exists only in another shop counts as not found
// here; status must be active; now must be inside [valid_from,
// valid_until] (a null end is open); the minimum spend is checked
// against the AFTER-tier remainder; the total quota must have room
// (live COUNT of redemptions < quota, null quota = unlimited); the
// per-user limit must have room (live COUNT for this user <
// per_user_limit); one coupon per order.
//
// Redemption: the redemption row is inserted in the SAME transaction
// as the order (validate first, write after, never throw after a
// write in the same request — OTP lesson). Quota / per-user counts
// are live COUNT(*) queries, re-checked inside the transaction; write
// requests hold the global advisory lock, so check-then-insert is
// race-safe here with no extra lock (same reasoning as the R2-5 seat
// hold). When an order reaches a terminal cancelled / refunded state,
// its redemption row is DELETED in the same transition transaction —
// quota and per-user count are restored automatically, while the
// order row keeps coupon_id / coupon_cents as history. A
// refund_requested / disputed order does NOT release (still a
// paid-derived status).
//
// Shop scoping follows R1-1 / R3-1: role=admin only (anonymous and
// non-admin -> 403); a shop-scoped admin works only in their own
// shop, cross-shop -> 403 (explicit-403, NOT admin-resources' silent
// re-scoping). The coupon code and shop_id are immutable after
// creation; editing a value does not rewrite past redemptions (their
// amount_cents snapshots stand) — new orders use the new value.
import { assert, text, int, time } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";

const CODE_RE = /^[A-Z0-9]{4,20}$/;

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertCouponAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的优惠券", 403);
}

// Normalize a coupon code the way the order route matches it: trim +
// uppercase. Throws 400 when the result is not a valid code.
export function normalizeCouponCode(raw) {
  assert(
    typeof raw === "string" && raw.trim().length > 0,
    "优惠券码不能为空",
    400,
  );
  const code = raw.trim().toUpperCase();
  assert(CODE_RE.test(code), "优惠券码须为 4–20 位大写字母或数字", 400);
  return code;
}

// Optional ISO datetime (valid_from / valid_until): null/undefined
// stays null (open-ended); anything else must parse as a date and is
// stored normalized to ISO, so string comparison against time() is
// consistent.
function optDateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  assert(typeof value === "string", `${label}格式错误`, 400);
  const d = new Date(value.trim());
  assert(!isNaN(d.valueOf()), `${label}格式错误`, 400);
  return d.toISOString();
}

function couponRow(c) {
  if (!c) return null;
  return {
    id: c.id,
    shop_id: c.shop_id,
    code: c.code,
    kind: c.kind,
    value_cents: c.value_cents,
    discount_pct: c.discount_pct,
    min_spend_cents: c.min_spend_cents,
    valid_from: c.valid_from,
    valid_until: c.valid_until,
    quota: c.quota,
    per_user_limit: c.per_user_limit,
    status: c.status,
    created_at: c.created_at,
    redemption_count:
      c.redemption_count === undefined ? undefined : c.redemption_count,
    total_discount_cents:
      c.total_discount_cents === undefined
        ? undefined
        : c.total_discount_cents,
  };
}

// Live redemption stats for one coupon: how many live redemptions
// exist and how much they took off in total. A released redemption
// (order cancelled / refunded) is deleted, so it stops counting here.
async function couponStats(get, couponId) {
  const row = await get(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS total FROM coupon_redemptions WHERE coupon_id=?",
    couponId,
  );
  return {
    redemption_count: row?.n || 0,
    total_discount_cents: row?.total || 0,
  };
}

async function withStats(get, coupon) {
  if (!coupon) return null;
  const stats = await couponStats(get, coupon.id);
  return couponRow({ ...coupon, ...stats });
}

// The coupon with this normalized code in this shop, or null. A code
// that exists only in another shop is NOT found here (400 at order
// time, never a cross-shop discount leak). Row 77 (R3-6): a platform
// coupon (shop_id NULL) applies in EVERY shop — it is the fallback
// when the order's shop has no coupon of that code; a shop coupon with
// the same code wins over the platform one.
export async function findCoupon(get, shopId, code) {
  const own = await get(
    "SELECT * FROM coupons WHERE shop_id=? AND code=?",
    shopId,
    code,
  );
  if (own) return own;
  return get(
    "SELECT * FROM coupons WHERE shop_id IS NULL AND code=?",
    code,
  );
}

// Validate a coupon for one order: the AFTER-tier remainder is what
// the minimum spend and the discount are computed on. Returns the
// coupon row and the discount in integer cents. Throws 400 on any
// failed check. Pure reads — safe to call before the order
// transaction and again inside it (the in-transaction re-check is
// what makes quota / per-user limits race-safe).
export async function validateCoupon(get, userId, shopId, code, remainderCents) {
  const coupon = await findCoupon(get, shopId, code);
  assert(coupon, "优惠券不存在或不适用", 400);
  assert(coupon.status === "active", "优惠券已停用", 400);
  const now = time();
  assert(
    !coupon.valid_from || coupon.valid_from <= now,
    "优惠券尚未生效",
    400,
  );
  assert(
    !coupon.valid_until || now <= coupon.valid_until,
    "优惠券已过期",
    400,
  );
  assert(
    remainderCents >= (coupon.min_spend_cents || 0),
    "未达到优惠券最低消费",
    400,
  );
  if (coupon.quota !== null && coupon.quota !== undefined) {
    const used = await get(
      "SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=?",
      coupon.id,
    );
    assert((used?.n || 0) < coupon.quota, "优惠券名额已用完", 400);
  }
  const mine = await get(
    "SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=? AND user_id=?",
    coupon.id,
    userId,
  );
  assert(
    (mine?.n || 0) < (coupon.per_user_limit ?? 1),
    "该优惠券每人限用次数已用完",
    400,
  );
  const couponCents =
    coupon.kind === "fixed"
      ? Math.min(coupon.value_cents, remainderCents)
      : Math.floor((remainderCents * coupon.discount_pct) / 100);
  return { coupon, coupon_cents: couponCents };
}

// Release an order's redemption (cancel / refund approval): delete
// the redemption row in the caller's transaction, so quota and
// per-user count are restored. The order row keeps coupon_id /
// coupon_cents as history.
export async function releaseCouponRedemption(run, orderId) {
  await run("DELETE FROM coupon_redemptions WHERE order_id=?", orderId);
  // R3-4: if the released redemption had used a gifted coupon, the
  // gift goes back to 'gifted' so the user can use it again.
  await run(
    "UPDATE coupon_gifts SET status='gifted', redeemed_order_id=NULL WHERE redeemed_order_id=?",
    orderId,
  );
}

async function getShopOr404(get, id) {
  const s = await get("SELECT * FROM shops WHERE id=?", id);
  assert(s, "店铺不存在", 404);
  return s;
}

export async function listAdminCoupons(ctx) {
  const { req, p, send, session, all, get, url } = ctx;
  if (p !== "/api/admin/coupons" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const shopParam = url.searchParams.get("shop");
  let shopId = scope;
  if (shopParam !== null && shopParam !== "") {
    shopId = Number(shopParam);
    assert(Number.isSafeInteger(shopId) && shopId >= 1, "店铺编号错误", 400);
  }
  if (scope !== null) shopId = scope;
  const rows =
    shopId === null
      ? await all("SELECT * FROM coupons ORDER BY shop_id ASC, id ASC")
      : await all(
          // A shop-scoped admin sees their own shop's coupons AND the
          // platform coupons (shop_id NULL, R3-6 row 77) — those apply
          // to their shop's orders too.
          "SELECT * FROM coupons WHERE shop_id=? OR shop_id IS NULL ORDER BY id ASC",
          shopId,
        );
  const coupons = [];
  for (const c of rows) coupons.push(await withStats(get, c));
  send({ coupons });
  return true;
}

export async function getAdminCoupon(ctx) {
  const { req, p, send, session, get, all } = ctx;
  const m = p.match(/^\/api\/admin\/coupons\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  assertAdmin(session);
  const coupon = await get("SELECT * FROM coupons WHERE id=?", Number(m[1]));
  assert(coupon, "优惠券不存在", 404);
  assertCouponAccess(session, coupon.shop_id);
  const stats = await couponStats(get, coupon.id);
  const redemptions = await all(
    `SELECT r.id, r.user_id, u.username, r.order_id, o.code AS order_code,
       r.amount_cents, r.created_at
     FROM coupon_redemptions r
     LEFT JOIN users u ON u.id=r.user_id
     LEFT JOIN orders o ON o.id=r.order_id
     WHERE r.coupon_id=? ORDER BY r.id DESC LIMIT 50`,
    coupon.id,
  );
  send({
    coupon: couponRow({ ...coupon, ...stats }),
    redemptions,
  });
  return true;
}

export async function createCoupon(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/coupons" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson). A shop-scoped
  // admin works only in their own shop — an explicit shop_id naming
  // another shop is a cross-shop write -> 403 (same explicit-403
  // choice as R3-1 member tiers, NOT admin-resources' silent
  // re-scoping). The platform admin creates into the main shop
  // unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的优惠券", 403);
    } else if (b.shop_id === null) {
      // A platform coupon (shop_id NULL, R3-6 row 77) is platform-admin
      // only — a shop-scoped admin naming it is a cross-shop write.
      assert(false, "无权管理该店铺的优惠券", 403);
    }
    shopId = scope;
  } else {
    // An explicit shop_id of null means a PLATFORM coupon (R3-6 row
    // 77, applies in every shop); an omitted shop_id still defaults
    // to the main shop, as before.
    shopId =
      b.shop_id === undefined
        ? MAIN_SHOP_ID
        : b.shop_id === null
          ? null
          : int(b.shop_id, "店铺", 1);
  }
  assertCouponAccess(session, shopId);
  if (shopId !== null) await getShopOr404(get, shopId);
  const code = normalizeCouponCode(b.code);
  const kind = b.kind;
  assert(kind === "fixed" || kind === "pct", "优惠券类型须为 fixed 或 pct", 400);
  let valueCents = null;
  let discountPct = null;
  if (kind === "fixed") {
    assert(
      b.discount_pct === undefined || b.discount_pct === null,
      "固定金额券不应传 discount_pct",
      400,
    );
    valueCents = int(b.value_cents, "减免金额（分）", 1);
  } else {
    assert(
      b.value_cents === undefined || b.value_cents === null,
      "比例券不应传 value_cents",
      400,
    );
    discountPct = int(b.discount_pct, "折扣百分比", 1, 100);
  }
  const minSpend = int(b.min_spend_cents ?? 0, "最低消费（分）", 0);
  const validFrom = optDateTime(b.valid_from, "生效时间");
  const validUntil = optDateTime(b.valid_until, "失效时间");
  assert(
    !validFrom || !validUntil || validFrom <= validUntil,
    "生效时间不能晚于失效时间",
    400,
  );
  const quota =
    b.quota === undefined || b.quota === null
      ? null
      : int(b.quota, "总名额", 1);
  const perUserLimit = int(b.per_user_limit ?? 1, "每人限用次数", 1);
  const status = b.status === undefined || b.status === null ? "active" : b.status;
  assert(status === "active" || status === "disabled", "优惠券状态须为 active 或 disabled", 400);
  // Same-shop duplicate code -> 409 (explicit pre-check for a clear
  // message; UNIQUE(shop_id, code) is the backstop). A platform coupon
  // needs its own pre-check: Postgres UNIQUE treats NULL shop_ids as
  // distinct from each other, so `shop_id=?` with a NULL parameter
  // would never match — the pre-check below is the real guard for the
  // platform scope.
  const dup =
    shopId === null
      ? await get(
          "SELECT id FROM coupons WHERE shop_id IS NULL AND code=?",
          code,
        )
      : await get(
          "SELECT id FROM coupons WHERE shop_id=? AND code=?",
          shopId,
          code,
        );
  assert(!dup, "该店铺已存在相同券码", 409);
  const result = await run(
    "INSERT INTO coupons(shop_id,code,kind,value_cents,discount_pct,min_spend_cents,valid_from,valid_until,quota,per_user_limit,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    shopId,
    code,
    kind,
    valueCents,
    discountPct,
    minSpend,
    validFrom,
    validUntil,
    quota,
    perUserLimit,
    status,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM coupons WHERE id=?", id);
  await audit(session, "新增优惠券", `${created.code}（${shopId === null ? "平台" : `${shopId}号店`}）`);
  send({ ok: true, id, coupon: await withStats(get, created) });
  return true;
}

export async function patchCoupon(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/coupons\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const coupon = await get("SELECT * FROM coupons WHERE id=?", id);
  assert(coupon, "优惠券不存在", 404);
  assertCouponAccess(session, coupon.shop_id);
  // The code and the shop are immutable after creation — a PATCH that
  // names them is a 400, never a silent re-scope or rename.
  assert(
    b.code === undefined && b.shop_id === undefined,
    "优惠券码与店铺不可修改",
    400,
  );
  // Validate everything BEFORE any write (OTP lesson). Editing a
  // value does not rewrite past redemptions — their amount_cents
  // snapshots stand; new orders use the new value.
  const updates = {};
  if (b.kind !== undefined || b.value_cents !== undefined || b.discount_pct !== undefined) {
    const kind = b.kind === undefined ? coupon.kind : b.kind;
    assert(kind === "fixed" || kind === "pct", "优惠券类型须为 fixed 或 pct", 400);
    // Switching kind must supply the new kind's value — the old
    // kind's value is null, so falling back to it would leave a
    // coupon with no discount at all.
    const switchingKind = b.kind !== undefined && b.kind !== coupon.kind;
    if (kind === "fixed") {
      assert(
        b.discount_pct === undefined || b.discount_pct === null,
        "固定金额券不应传 discount_pct",
        400,
      );
      updates.kind = "fixed";
      if (b.value_cents !== undefined)
        updates.value_cents = int(b.value_cents, "减免金额（分）", 1);
      else if (switchingKind)
        assert(false, "改为固定金额券须提供 value_cents", 400);
      else updates.value_cents = coupon.value_cents;
      updates.discount_pct = null;
    } else {
      assert(
        b.value_cents === undefined || b.value_cents === null,
        "比例券不应传 value_cents",
        400,
      );
      updates.kind = "pct";
      if (b.discount_pct !== undefined)
        updates.discount_pct = int(b.discount_pct, "折扣百分比", 1, 100);
      else if (switchingKind)
        assert(false, "改为比例券须提供 discount_pct", 400);
      else updates.discount_pct = coupon.discount_pct;
      updates.value_cents = null;
    }
  }
  if (b.min_spend_cents !== undefined)
    updates.min_spend_cents = int(b.min_spend_cents, "最低消费（分）", 0);
  if (b.valid_from !== undefined)
    updates.valid_from = optDateTime(b.valid_from, "生效时间");
  if (b.valid_until !== undefined)
    updates.valid_until = optDateTime(b.valid_until, "失效时间");
  const validFrom =
    updates.valid_from === undefined ? coupon.valid_from : updates.valid_from;
  const validUntil =
    updates.valid_until === undefined ? coupon.valid_until : updates.valid_until;
  assert(
    !validFrom || !validUntil || validFrom <= validUntil,
    "生效时间不能晚于失效时间",
    400,
  );
  if (b.quota !== undefined)
    updates.quota =
      b.quota === null ? null : int(b.quota, "总名额", 1);
  if (b.per_user_limit !== undefined)
    updates.per_user_limit = int(b.per_user_limit, "每人限用次数", 1);
  if (b.status !== undefined) {
    assert(
      b.status === "active" || b.status === "disabled",
      "优惠券状态须为 active 或 disabled",
      400,
    );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE coupons SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM coupons WHERE id=?", id);
  await audit(session, "修改优惠券", `${fresh.code}（${fresh.shop_id === null ? "平台" : `${fresh.shop_id}号店`}）`);
  send({ ok: true, coupon: await withStats(get, fresh) });
  return true;
}
