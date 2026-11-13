// Auto coupon gifting (Roadmap 82 Wave R3-4, 2026-11-14) — xlsx row
// 17. A rule belongs to one shop and fires when a user does something:
// first_purchase (their first paid order in that shop) or
// tier_upgraded (their live tier in that shop strictly rises across a
// pay). Payment stays simulated: a gifted coupon is arithmetic on
// simulated amounts, never real money.
//
// Trigger mechanism (fixed, never ambiguous): there is NO background
// worker, NO cron and NO scheduler in this wave — the plan's "worker
// that reacts to events" is NOT built. Evaluation runs synchronously
// inside the order-transition transaction (pay / complete): the
// transition computes the live tier before and after the status
// change, then calls evaluateAutoCoupons in the same transaction, so
// the gift and the status commit or roll back together. Each gift
// also writes one events row (type 'coupon_gift') as the audit trail
// in the events stream — profiles read only type='view' and alerts
// only type LIKE 'alert.%', so the new type pollutes neither.
//
// Birthday is OUT: users has only an age column, no birth-date field
// anywhere, so no birthday trigger can be evaluated in this wave.
//
// Idempotency (fixed): one gift per (rule, user, trigger instance) —
// trigger_ref is `order:<id>` for first_purchase and `tier:<tier_id>`
// for tier_upgraded (a re-upgrade to the same tier never re-gifts).
// Enforced by a pre-check SELECT plus UNIQUE(rule_id, user_id,
// trigger_ref) as the backstop; write requests hold the global
// advisory lock, so check-then-insert is race-safe here with no extra
// lock (same reasoning as the R2-5 seat hold).
//
// Conditions (fixed): conditions is a JSON object; the only known key
// this wave is min_spend_cents (integer cents >= 0, first_purchase
// only: the triggering order's final amount must reach it, default
// 0). Unknown keys -> 400; min_spend_cents on a tier_upgraded rule
// -> 400; a non-object or unparseable value -> 400.
//
// Delivery (fixed): a coupon_gifts row (status 'gifted') plus an
// inbox message through the existing notify() (coupon code + value +
// validity). The coupon itself is usable exactly like an admin-issued
// one — the user types the code at order time and it runs through the
// same validateCoupon path. Quota / per-user limit: gifted coupons
// count under the SAME limits — they consume quota and per-user limit
// when REDEEMED (one counting rule: coupon_redemptions). The gift
// itself does NOT pre-consume quota (first-come at redemption: if
// someone else exhausts the quota first, the gift cannot be redeemed
// and order time fails with the normal 400).
//
// Gift lifecycle (fixed): when the gifted coupon is redeemed on an
// order, the user's oldest 'gifted' gift of that coupon flips to
// 'redeemed' (redeemed_order_id set — see markGiftRedeemed, called
// from createOrder next to the redemption insert). If that order is
// cancelled or refund-approved and its redemption is released, the
// gift flips back to 'gifted' (see restoreGiftForOrder, called from
// releaseCouponRedemption). No retroactive gifts: a rule only fires
// for behaviour after its creation.
//
// Shop scoping follows R1-1 / R3-1: role=admin only (anonymous and
// non-admin -> 403); a shop-scoped admin works only in their own
// shop, cross-shop -> 403 (explicit-403, NOT admin-resources' silent
// re-scoping). The trigger, coupon_id and shop_id are immutable after
// creation.
import { assert, text, int, time } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";
import { PAID_STATUSES } from "../lib/profiles.mjs";

export const AUTO_COUPON_TRIGGERS = ["first_purchase", "tier_upgraded"];

// Validate a rule's conditions value (already-parsed JSON from the
// request body): an object, only known keys, min_spend_cents an
// integer >= 0 — and only meaningful on a first_purchase rule.
// Returns the normalized conditions object ({} when omitted).
function parseConditions(raw, trigger) {
  if (raw === undefined || raw === null) return {};
  assert(
    typeof raw === "object" && !Array.isArray(raw),
    "发券条件须为对象",
    400,
  );
  for (const k of Object.keys(raw))
    assert(k === "min_spend_cents", `未知的发券条件：${k}`, 400);
  const conditions = {};
  if (raw.min_spend_cents !== undefined) {
    assert(
      trigger === "first_purchase",
      "min_spend_cents 仅适用于首次购买规则",
      400,
    );
    conditions.min_spend_cents = int(
      raw.min_spend_cents,
      "最低消费（分）",
      0,
    );
  }
  return conditions;
}

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertRuleAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的自动发券规则", 403);
}

function ruleRow(r) {
  if (!r) return null;
  let conditions = {};
  try {
    conditions = JSON.parse(r.conditions || "{}") || {};
  } catch {
    conditions = {};
  }
  return {
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    trigger: r.trigger,
    coupon_id: r.coupon_id,
    coupon_code: r.coupon_code === undefined ? undefined : r.coupon_code,
    conditions,
    status: r.status,
    created_at: r.created_at,
    gift_count:
      r.gift_count === undefined ? undefined : r.gift_count,
  };
}

// Live gift count for one rule.
async function ruleGiftCount(get, ruleId) {
  const row = await get(
    "SELECT COUNT(*) AS n FROM coupon_gifts WHERE rule_id=?",
    ruleId,
  );
  return row?.n || 0;
}

async function withGiftCount(get, rule) {
  if (!rule) return null;
  const n = await ruleGiftCount(get, rule.id);
  return ruleRow({ ...rule, gift_count: n });
}

async function getRuleWithCode(get, id) {
  return get(
    `SELECT r.*, c.code AS coupon_code FROM coupon_rules r
     LEFT JOIN coupons c ON c.id=r.coupon_id WHERE r.id=?`,
    id,
  );
}

function giftValueText(coupon) {
  if (!coupon) return "";
  if (coupon.kind === "fixed")
    return `立减¥${(coupon.value_cents || 0) / 100}`;
  return `立减${coupon.discount_pct || 0}%`;
}

// Evaluate the active rules of one shop for one order transition and
// issue every gift that fires. Runs inside the caller's transaction —
// the order status change and the gifts commit or roll back together.
// beforeTier / afterTier are the resolveTier() results for the
// order's shop, computed before and after the status UPDATE (for a
// pay, spending excludes this order before and includes it after;
// for a complete they are equal, so no tier gift can re-fire).
// Pure reads + guarded inserts: a gift that already exists for this
// (rule, user, trigger instance) is skipped, never duplicated.
export async function evaluateAutoCoupons(
  { get, all, run, notify },
  { userId, orderId, shopId, amountCents, beforeTier, afterTier },
) {
  const rules = await all(
    "SELECT * FROM coupon_rules WHERE shop_id=? AND status='active' ORDER BY id ASC",
    shopId,
  );
  if (rules.length === 0) return [];
  const gifted = [];
  for (const rule of rules) {
    let triggerRef = null;
    if (rule.trigger === "first_purchase") {
      // First paid order in this shop, and it is this order: after
      // the status UPDATE the paid-order count is 1 exactly when no
      // other paid order exists. An earlier purchase that was fully
      // refunded (status 'refunded', not in PAID_STATUSES) does not
      // count as a first purchase.
      const row = await get(
        `SELECT COUNT(*) AS n FROM orders o
         JOIN resources r ON r.id=o.resource_id
         WHERE o.user_id=? AND r.shop_id=? AND o.status IN ('${PAID_STATUSES.join("','")}')`,
        userId,
        shopId,
      );
      if ((row?.n || 0) !== 1) continue;
      let conditions = {};
      try {
        conditions = JSON.parse(rule.conditions || "{}") || {};
      } catch {
        conditions = {};
      }
      if (amountCents < (conditions.min_spend_cents || 0)) continue;
      triggerRef = `order:${orderId}`;
    } else if (rule.trigger === "tier_upgraded") {
      const before = beforeTier?.tier || null;
      const after = afterTier?.tier || null;
      if (!after) continue;
      if (after.min_spend_cents <= (before?.min_spend_cents ?? -1)) continue;
      triggerRef = `tier:${after.id}`;
    } else {
      continue;
    }
    // The coupon must exist, belong to this shop (or be a platform
    // coupon, shop_id NULL — R3-6 row 77, applies in every shop) and
    // be active — otherwise skip silently: no gift, no error, the
    // order pays on. The validity window and quota are NOT checked
    // here; the redemption-time validateCoupon enforces them when the
    // coupon is actually used.
    const coupon = await get(
      "SELECT * FROM coupons WHERE id=?",
      rule.coupon_id,
    );
    if (
      !coupon ||
      (coupon.shop_id !== null && coupon.shop_id !== shopId) ||
      coupon.status !== "active"
    )
      continue;
    const existing = await get(
      "SELECT id FROM coupon_gifts WHERE rule_id=? AND user_id=? AND trigger_ref=?",
      rule.id,
      userId,
      triggerRef,
    );
    if (existing) continue;
    const result = await run(
      "INSERT INTO coupon_gifts(rule_id,coupon_id,user_id,trigger_ref,status,created_at) VALUES(?,?,?,?,?,?)",
      rule.id,
      coupon.id,
      userId,
      triggerRef,
      "gifted",
      time(),
    );
    const giftId = Number(result.lastInsertRowid);
    await run(
      "INSERT INTO events(user_id,type,detail,created_at) VALUES(?,?,?,?)",
      userId,
      "coupon_gift",
      JSON.stringify({
        rule_id: rule.id,
        coupon_id: coupon.id,
        code: coupon.code,
        trigger: rule.trigger,
        trigger_ref: triggerRef,
      }),
      time(),
    );
    const validPart = coupon.valid_until
      ? `，有效期至${String(coupon.valid_until).slice(0, 10)}`
      : "";
    await notify(
      userId,
      "优惠券到账",
      `恭喜！您获得一张优惠券：${coupon.code}（${giftValueText(coupon)}${validPart}），下单时输入券码即可使用。`,
    );
    gifted.push(giftId);
  }
  return gifted;
}

// Mark the user's oldest still-gifted gift of this coupon as used by
// this order. Called from createOrder next to the redemption insert,
// in the same transaction. A coupon used without ever being gifted
// matches nothing and changes nothing.
export async function markGiftRedeemed(run, userId, couponId, orderId) {
  await run(
    `UPDATE coupon_gifts SET status='redeemed', redeemed_order_id=? WHERE id=(
       SELECT id FROM coupon_gifts
       WHERE user_id=? AND coupon_id=? AND status='gifted'
       ORDER BY id ASC LIMIT 1
     )`,
    orderId,
    userId,
    couponId,
  );
}

// Flip a gift back to 'gifted' when the order that redeemed it is
// cancelled or refund-approved and its redemption is released. Called
// from releaseCouponRedemption in the same transaction.
export async function restoreGiftForOrder(run, orderId) {
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

export async function listAdminCouponRules(ctx) {
  const { req, p, send, session, all, get, url } = ctx;
  if (p !== "/api/admin/coupon-rules" || req.method !== "GET") return false;
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
      ? await all(
          `SELECT r.*, c.code AS coupon_code FROM coupon_rules r
           LEFT JOIN coupons c ON c.id=r.coupon_id
           ORDER BY r.shop_id ASC, r.id ASC`,
        )
      : await all(
          `SELECT r.*, c.code AS coupon_code FROM coupon_rules r
           LEFT JOIN coupons c ON c.id=r.coupon_id
           WHERE r.shop_id=? ORDER BY r.id ASC`,
          shopId,
        );
  const rules = [];
  for (const r of rows) rules.push(await withGiftCount(get, r));
  send({ coupon_rules: rules });
  return true;
}

export async function getAdminCouponRule(ctx) {
  const { req, p, send, session, get, all } = ctx;
  const m = p.match(/^\/api\/admin\/coupon-rules\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  assertAdmin(session);
  const rule = await getRuleWithCode(get, Number(m[1]));
  assert(rule, "自动发券规则不存在", 404);
  assertRuleAccess(session, rule.shop_id);
  const giftCount = await ruleGiftCount(get, rule.id);
  const gifts = await all(
    `SELECT g.id, g.rule_id, g.coupon_id, c.code AS coupon_code,
       g.user_id, u.username, g.trigger_ref, g.status,
       g.redeemed_order_id, g.created_at
     FROM coupon_gifts g
     LEFT JOIN coupons c ON c.id=g.coupon_id
     LEFT JOIN users u ON u.id=g.user_id
     WHERE g.rule_id=? ORDER BY g.id DESC LIMIT 50`,
    rule.id,
  );
  send({
    coupon_rule: ruleRow({ ...rule, gift_count: giftCount }),
    gifts,
  });
  return true;
}

export async function createCouponRule(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/coupon-rules" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson). A shop-scoped
  // admin works only in their own shop — an explicit shop_id naming
  // another shop is a cross-shop write -> 403 (same explicit-403
  // choice as R3-1/R3-2/R3-3, NOT admin-resources' silent
  // re-scoping). The platform admin creates into the main shop
  // unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的自动发券规则", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertRuleAccess(session, shopId);
  await getShopOr404(get, shopId);
  const name = text(b.name, "规则名称", 100);
  const trigger = b.trigger;
  assert(
    AUTO_COUPON_TRIGGERS.includes(trigger),
    "触发条件须为 first_purchase 或 tier_upgraded",
    400,
  );
  const couponId = int(b.coupon_id, "优惠券", 1);
  const coupon = await get("SELECT * FROM coupons WHERE id=?", couponId);
  // A rule may gift a same-shop coupon or a platform coupon (shop_id
  // NULL — R3-6 row 77, applies in every shop); a coupon of another
  // shop is not giftable here.
  assert(
    coupon && (coupon.shop_id === null || coupon.shop_id === shopId),
    "优惠券不存在或不属于该店铺",
    400,
  );
  const conditions = parseConditions(b.conditions, trigger);
  const status =
    b.status === undefined || b.status === null ? "active" : b.status;
  assert(
    status === "active" || status === "disabled",
    "规则状态须为 active 或 disabled",
    400,
  );
  const result = await run(
    "INSERT INTO coupon_rules(shop_id,name,trigger,coupon_id,conditions,status,created_at) VALUES(?,?,?,?,?,?,?)",
    shopId,
    name,
    trigger,
    couponId,
    JSON.stringify(conditions),
    status,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await getRuleWithCode(get, id);
  await audit(session, "新增自动发券规则", `${created.name}（${shopId}号店）`);
  send({ ok: true, id, coupon_rule: await withGiftCount(get, created) });
  return true;
}

export async function patchCouponRule(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/coupon-rules\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const rule = await get("SELECT * FROM coupon_rules WHERE id=?", id);
  assert(rule, "自动发券规则不存在", 404);
  assertRuleAccess(session, rule.shop_id);
  // The trigger, the coupon and the shop are immutable after creation
  // — a PATCH that names them is a 400, never a silent re-scope.
  assert(
    b.trigger === undefined &&
      b.coupon_id === undefined &&
      b.shop_id === undefined,
    "触发条件、优惠券与店铺不可修改",
    400,
  );
  // Validate everything BEFORE any write (OTP lesson).
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "规则名称", 100);
  if (b.conditions !== undefined) {
    const conditions = parseConditions(b.conditions, rule.trigger);
    updates.conditions = JSON.stringify(conditions);
  }
  if (b.status !== undefined) {
    assert(
      b.status === "active" || b.status === "disabled",
      "规则状态须为 active 或 disabled",
      400,
    );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE coupon_rules SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await getRuleWithCode(get, id);
  await audit(session, "修改自动发券规则", `${fresh.name}（${fresh.shop_id}号店）`);
  send({ ok: true, coupon_rule: await withGiftCount(get, fresh) });
  return true;
}

// The logged-in user's own gifted coupons, newest first, with the
// coupon's code and value so the client can render them and the user
// can type the code at checkout.
export async function getAccountCouponGifts(ctx) {
  const { req, p, send, get, all } = ctx;
  if (p !== "/api/account/coupon-gifts" || req.method !== "GET") return false;
  const u = ctx.needUser();
  const gifts = await all(
    `SELECT g.id, g.rule_id, r.name AS rule_name, g.coupon_id,
       c.code AS coupon_code, c.kind, c.value_cents, c.discount_pct,
       c.min_spend_cents, c.valid_from, c.valid_until,
       g.trigger_ref, g.status, g.redeemed_order_id, g.created_at
     FROM coupon_gifts g
     LEFT JOIN coupon_rules r ON r.id=g.rule_id
     LEFT JOIN coupons c ON c.id=g.coupon_id
     WHERE g.user_id=? ORDER BY g.id DESC`,
    u.id,
  );
  send({ coupon_gifts: gifts });
  return true;
}
