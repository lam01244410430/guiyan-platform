// Flash sales (Roadmap 82 Wave R3-3, 2026-11-14) — xlsx row 16. A
// flash sale belongs to one shop and targets ONE performance (the
// shop-wide sale is a later extension — the R2 prices live on
// performances / ticket types, so a per-performance sale is the
// coherent scope). Payment stays simulated: a flash sale is
// arithmetic on simulated amounts, never real money.
//
// Discount (fixed, per ticket): fixed -> sale unit price =
// max(0, tier price - value_cents); pct -> sale unit price =
// floor(tier price x (100 - discount_pct) / 100). flash_cents =
// (tier price - sale unit price) x quantity.
//
// Stacking (fixed, never ambiguous): the flash sale applies FIRST —
// sale unit price x qty is the base, then the R3-1 member discount
// on that base, then the R3-2 coupon on the remainder. amount =
// remainder - coupon_cents, never below 0. All integer cents,
// server-side (the pricing chain lives in routes/orders.mjs
// computePricing; this module only resolves the live sale).
//
// Live (fixed): status = active AND start_at <= now <= end_at AND
// quota remaining. Outside the window an order proceeds at the
// ORIGINAL price — no error, no discount. An order created inside
// the window snapshots flash_sale_id / flash_cents on its row and
// keeps that price even if it is paid after the window ends.
//
// Quota (fixed): a per-sale TOTAL quantity cap: SUM(quantity) over
// orders carrying this flash_sale_id with status NOT IN
// ('cancelled','refunded') — a cancelled / refunded order frees its
// quota automatically (same pattern as the ticket-type quota). When
// the quota is exhausted the order still succeeds at the ORIGINAL
// price (a flash sale is a bonus, never a gate that blocks a buyer
// — never 409). The quota is a live COUNT, re-checked inside the
// order transaction; writes hold the global advisory lock, so
// check-then-insert is race-safe here with no extra lock (same
// reasoning as the R2-5 seat hold).
//
// Overlap (fixed): at most one ACTIVE sale per performance
// overlapping in time — a create / patch that would overlap another
// active sale on the same performance is a 409. Disabled sales do
// not block. This is what makes "which sale applies" unambiguous:
// resolveFlashSale never has two candidates.
//
// Countdown (fixed): the live sale rides along with availability —
// each ticket type in GET /api/resources/:id/availability carries
// flash_sale: null | {sale_id, name, kind, value_cents,
// discount_pct, sale_price_cents, ends_at, remaining_seconds,
// quota_remaining}. There is NO public flash-sale list (same
// reasoning as coupons: no enumerable list; availability is the
// C-end surface).
//
// Shop scoping follows R1-1 / R3-1 / R3-2: role=admin only
// (anonymous and non-admin -> 403); a shop-scoped admin works only
// in their own shop, cross-shop -> 403 (explicit-403, NOT
// admin-resources' silent re-scoping). The performance and the shop
// are immutable after creation.
import { assert, text, int, time } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertFlashSaleAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的限时抢购", 403);
}

// Optional ISO datetime (start_at / end_at are REQUIRED for a flash
// sale, so this is the strict variant: null/undefined/"" -> 400).
// Stored normalized to ISO, so string comparison against time() is
// consistent (same pattern as coupons' optDateTime).
function reqDateTime(value, label) {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${label}不能为空`,
    400,
  );
  const d = new Date(value.trim());
  assert(!isNaN(d.valueOf()), `${label}格式错误`, 400);
  return d.toISOString();
}

function optDateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return reqDateTime(value, label);
}

// The sale unit price for one ticket at this tier price: fixed takes
// value_cents off (never below 0), pct takes discount_pct off
// (floored, same rounding as the tier discount and the pct coupon).
export function saleUnitPrice(sale, unitPriceCents) {
  if (!sale) return unitPriceCents;
  if (sale.kind === "fixed")
    return Math.max(0, unitPriceCents - sale.value_cents);
  return Math.floor((unitPriceCents * (100 - sale.discount_pct)) / 100);
}

// Sold quantity for one sale: SUM(quantity) over orders carrying
// this sale that still count (cancelled/refunded orders free their
// quota again — same pattern as soldForTier in ticket-types.mjs).
export async function flashSoldCount(get, saleId) {
  const row = await get(
    "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE flash_sale_id=? AND status NOT IN ('cancelled','refunded')",
    saleId,
  );
  return row?.n || 0;
}

// Quota left for one sale: null when the quota is unlimited.
export async function flashQuotaRemaining(get, sale) {
  if (sale.quota === null || sale.quota === undefined) return null;
  const sold = await flashSoldCount(get, sale.id);
  return Math.max(0, sale.quota - sold);
}

// The live flash sale for one performance, or null. Live means:
// status active, now inside [start_at, end_at], and quota remaining.
// The overlap rule (at most one active overlapping sale per
// performance) guarantees at most one candidate; the earliest id
// wins if the data ever disagrees.
export async function resolveFlashSale(get, all, performanceId) {
  const now = time();
  const rows = await all(
    "SELECT * FROM flash_sales WHERE performance_id=? AND status='active' ORDER BY id ASC",
    performanceId,
  );
  for (const s of rows) {
    if (s.start_at <= now && now <= s.end_at) {
      if (s.quota === null || s.quota === undefined) return s;
      const sold = await flashSoldCount(get, s.id);
      if (sold < s.quota) return s;
    }
  }
  return null;
}

// The availability countdown object for one ticket type: null when
// no sale is live for its performance, otherwise the sale with this
// type's sale unit price, the end time and the seconds left.
export async function flashSaleForTicketType(get, all, perfId, unitPriceCents) {
  const sale = await resolveFlashSale(get, all, perfId);
  if (!sale) return null;
  const ends = new Date(sale.end_at).valueOf();
  return {
    sale_id: sale.id,
    name: sale.name,
    kind: sale.kind,
    value_cents: sale.value_cents,
    discount_pct: sale.discount_pct,
    sale_price_cents: saleUnitPrice(sale, unitPriceCents),
    ends_at: sale.end_at,
    remaining_seconds: Math.max(0, Math.floor((ends - Date.now()) / 1000)),
    quota_remaining: await flashQuotaRemaining(get, sale),
  };
}

function flashSaleRow(s) {
  if (!s) return null;
  return {
    id: s.id,
    shop_id: s.shop_id,
    performance_id: s.performance_id,
    name: s.name,
    kind: s.kind,
    value_cents: s.value_cents,
    discount_pct: s.discount_pct,
    start_at: s.start_at,
    end_at: s.end_at,
    quota: s.quota,
    status: s.status,
    created_at: s.created_at,
    sold_count:
      s.sold_count === undefined ? undefined : s.sold_count,
    quota_remaining:
      s.quota_remaining === undefined ? undefined : s.quota_remaining,
  };
}

async function withStats(get, sale) {
  if (!sale) return null;
  const sold = await flashSoldCount(get, sale.id);
  return flashSaleRow({
    ...sale,
    sold_count: sold,
    quota_remaining:
      sale.quota === null || sale.quota === undefined
        ? null
        : Math.max(0, sale.quota - sold),
  });
}

// Overlap guard: does an ACTIVE sale on this performance (other than
// `excludeId`, null on create) overlap [startAt, endAt]? Touching
// endpoints do not overlap (one ends exactly when the other starts).
async function assertNoOverlap(all, performanceId, startAt, endAt, excludeId) {
  const rows = await all(
    "SELECT id, start_at, end_at FROM flash_sales WHERE performance_id=? AND status='active'",
    performanceId,
  );
  for (const r of rows) {
    if (excludeId !== null && r.id === excludeId) continue;
    assert(
      !(r.start_at < endAt && startAt < r.end_at),
      "该场次已有重叠的限时抢购",
      409,
    );
  }
}

async function getShopOr404(get, id) {
  const s = await get("SELECT * FROM shops WHERE id=?", id);
  assert(s, "店铺不存在", 404);
  return s;
}

export async function listAdminFlashSales(ctx) {
  const { req, p, send, session, all, get, url } = ctx;
  if (p !== "/api/admin/flash-sales" || req.method !== "GET") return false;
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
      ? await all("SELECT * FROM flash_sales ORDER BY shop_id ASC, id ASC")
      : await all(
          "SELECT * FROM flash_sales WHERE shop_id=? ORDER BY id ASC",
          shopId,
        );
  const sales = [];
  for (const s of rows) sales.push(await withStats(get, s));
  send({ flash_sales: sales });
  return true;
}

export async function getAdminFlashSale(ctx) {
  const { req, p, send, session, get, all } = ctx;
  const m = p.match(/^\/api\/admin\/flash-sales\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  assertAdmin(session);
  const sale = await get("SELECT * FROM flash_sales WHERE id=?", Number(m[1]));
  assert(sale, "限时抢购不存在", 404);
  assertFlashSaleAccess(session, sale.shop_id);
  const orders = await all(
    `SELECT o.id, o.code, o.user_id, u.username, o.quantity, o.flash_cents,
       o.amount, o.status, o.created_at
     FROM orders o LEFT JOIN users u ON u.id=o.user_id
     WHERE o.flash_sale_id=? ORDER BY o.id DESC LIMIT 50`,
    sale.id,
  );
  send({ flash_sale: await withStats(get, sale), orders });
  return true;
}

export async function createFlashSale(ctx) {
  const { req, p, b, send, session, get, all, run, audit } = ctx;
  if (p !== "/api/admin/flash-sales" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson). A shop-scoped
  // admin works only in their own shop — an explicit shop_id naming
  // another shop is a cross-shop write -> 403 (same explicit-403
  // choice as R3-1 member tiers / R3-2 coupons, NOT admin-resources'
  // silent re-scoping). The platform admin creates into the main shop
  // unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的限时抢购", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertFlashSaleAccess(session, shopId);
  await getShopOr404(get, shopId);
  const performanceId = int(b.performance_id, "场次", 1);
  const perf = await get("SELECT * FROM performances WHERE id=?", performanceId);
  assert(perf, "场次不存在", 404);
  const show = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
  assert(show && show.shop_id === shopId, "场次不属于该店铺", 400);
  const name = text(b.name, "抢购名称", 100);
  const kind = b.kind;
  assert(kind === "fixed" || kind === "pct", "抢购类型须为 fixed 或 pct", 400);
  let valueCents = null;
  let discountPct = null;
  if (kind === "fixed") {
    assert(
      b.discount_pct === undefined || b.discount_pct === null,
      "固定金额抢购不应传 discount_pct",
      400,
    );
    valueCents = int(b.value_cents, "每张减免金额（分）", 1);
  } else {
    assert(
      b.value_cents === undefined || b.value_cents === null,
      "比例抢购不应传 value_cents",
      400,
    );
    discountPct = int(b.discount_pct, "折扣百分比", 1, 100);
  }
  const startAt = reqDateTime(b.start_at, "开始时间");
  const endAt = reqDateTime(b.end_at, "结束时间");
  assert(startAt < endAt, "开始时间须早于结束时间", 400);
  const quota =
    b.quota === undefined || b.quota === null
      ? null
      : int(b.quota, "总名额", 1);
  const status = b.status === undefined || b.status === null ? "active" : b.status;
  assert(status === "active" || status === "disabled", "抢购状态须为 active 或 disabled", 400);
  // Overlap: at most one ACTIVE sale per performance in any window.
  // Disabled sales do not block — only check when creating active.
  if (status === "active")
    await assertNoOverlap(all, performanceId, startAt, endAt, null);
  const result = await run(
    "INSERT INTO flash_sales(shop_id,performance_id,name,kind,value_cents,discount_pct,start_at,end_at,quota,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    shopId,
    performanceId,
    name,
    kind,
    valueCents,
    discountPct,
    startAt,
    endAt,
    quota,
    status,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM flash_sales WHERE id=?", id);
  await audit(session, "新增限时抢购", `${created.name}（${shopId}号店）`);
  send({ ok: true, id, flash_sale: await withStats(get, created) });
  return true;
}

export async function patchFlashSale(ctx) {
  const { req, p, b, send, session, get, all, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/flash-sales\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const sale = await get("SELECT * FROM flash_sales WHERE id=?", id);
  assert(sale, "限时抢购不存在", 404);
  assertFlashSaleAccess(session, sale.shop_id);
  // The performance and the shop are immutable after creation — a
  // PATCH that names them is a 400, never a silent re-scope.
  assert(
    b.performance_id === undefined && b.shop_id === undefined,
    "场次与店铺不可修改",
    400,
  );
  // Validate everything BEFORE any write (OTP lesson). Editing a
  // value or a window does not rewrite past orders — their
  // flash_sale_id / flash_cents snapshots stand; new orders use the
  // new value. A window/status edit that would overlap another
  // ACTIVE sale on the same performance is a 409.
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "抢购名称", 100);
  if (b.kind !== undefined || b.value_cents !== undefined || b.discount_pct !== undefined) {
    const kind = b.kind === undefined ? sale.kind : b.kind;
    assert(kind === "fixed" || kind === "pct", "抢购类型须为 fixed 或 pct", 400);
    // Switching kind must supply the new kind's value — the old
    // kind's value is null, so falling back to it would leave a sale
    // with no discount at all (same rule as coupons).
    const switchingKind = b.kind !== undefined && b.kind !== sale.kind;
    if (kind === "fixed") {
      assert(
        b.discount_pct === undefined || b.discount_pct === null,
        "固定金额抢购不应传 discount_pct",
        400,
      );
      updates.kind = "fixed";
      if (b.value_cents !== undefined)
        updates.value_cents = int(b.value_cents, "每张减免金额（分）", 1);
      else if (switchingKind)
        assert(false, "改为固定金额抢购须提供 value_cents", 400);
      else updates.value_cents = sale.value_cents;
      updates.discount_pct = null;
    } else {
      assert(
        b.value_cents === undefined || b.value_cents === null,
        "比例抢购不应传 value_cents",
        400,
      );
      updates.kind = "pct";
      if (b.discount_pct !== undefined)
        updates.discount_pct = int(b.discount_pct, "折扣百分比", 1, 100);
      else if (switchingKind)
        assert(false, "改为比例抢购须提供 discount_pct", 400);
      else updates.discount_pct = sale.discount_pct;
      updates.value_cents = null;
    }
  }
  if (b.start_at !== undefined)
    updates.start_at = reqDateTime(b.start_at, "开始时间");
  if (b.end_at !== undefined)
    updates.end_at = reqDateTime(b.end_at, "结束时间");
  const startAt =
    updates.start_at === undefined ? sale.start_at : updates.start_at;
  const endAt = updates.end_at === undefined ? sale.end_at : updates.end_at;
  assert(startAt < endAt, "开始时间须早于结束时间", 400);
  if (b.quota !== undefined)
    updates.quota =
      b.quota === null ? null : int(b.quota, "总名额", 1);
  if (b.status !== undefined) {
    assert(
      b.status === "active" || b.status === "disabled",
      "抢购状态须为 active 或 disabled",
      400,
    );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const status =
    updates.status === undefined ? sale.status : updates.status;
  if (status === "active")
    await assertNoOverlap(all, sale.performance_id, startAt, endAt, id);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE flash_sales SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM flash_sales WHERE id=?", id);
  await audit(session, "修改限时抢购", `${fresh.name}（${fresh.shop_id}号店）`);
  send({ ok: true, flash_sale: await withStats(get, fresh) });
  return true;
}
