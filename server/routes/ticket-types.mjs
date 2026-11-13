// Price tiers / ticket types (Roadmap 82 Wave R2-2, 2026-11-13) —
// xlsx row 7. One performance has many tiers (regular / early-bird /
// combo), each with its own price + quota + an optional sale deadline.
// Buyers only ever see the tiers of an on-sale performance whose show
// is approved; orders against a tier are validated + priced server-side
// (see routes/orders.mjs).
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, text, int, time } from "../lib/http.mjs";
import { flashSaleForTicketType } from "./flash-sales.mjs";

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertShowAccess(session, show) {
  const scope = scopedShopId(session);
  assert(
    scope === null || show.shop_id === scope,
    "无权管理该店铺的演出",
    403,
  );
}

function tierRow(t) {
  return {
    id: t.id,
    performance_id: t.performance_id,
    name: t.name,
    price_cents: t.price_cents,
    quota: t.quota,
    sale_until: t.sale_until,
    created_at: t.created_at,
  };
}

// sale_until must be a valid ISO datetime when given. No date floor: an
// expired early-bird tier is a legitimate stored row — orders against it
// are refused at order time (400), not at creation time, so the tier
// stays visible as sold-out history instead of being uncreatable.
function isoDateTime(value) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      ),
    "截止时间须为 ISO 日期时间",
    400,
  );
  const d = new Date(value);
  assert(!isNaN(d.valueOf()), "截止时间无效", 400);
  return value;
}

async function getPerfOr404(get, id) {
  const pf = await get("SELECT * FROM performances WHERE id=?", id);
  assert(pf, "场次不存在", 404);
  return pf;
}

async function getShowForPerf(get, perf) {
  const s = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
  assert(s, "演出不存在", 404);
  return s;
}

// Sold count for one tier: SUM(quantity) over orders that still count
// (cancelled/refunded orders free their quota again).
export async function soldForTier(get, tierId) {
  const row = await get(
    "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND status NOT IN ('cancelled','refunded')",
    tierId,
  );
  return row?.n || 0;
}

// Tiers of one performance with live sold/available counts (the shape
// GET /api/resources/:id/availability returns inside each performance).
// R3-3: each tier also carries its performance's live flash sale
// (null when none is live) so the C-end can show the sale price +
// countdown without a second fetch.
export async function ticketTypesForPerformance(all, get, perfId) {
  const rows = await all(
    "SELECT * FROM ticket_types WHERE performance_id=? ORDER BY price_cents ASC, id ASC",
    perfId,
  );
  const out = [];
  for (const t of rows) {
    const sold = await soldForTier(get, t.id);
    out.push({
      ...tierRow(t),
      sold,
      available: Math.max(0, t.quota - sold),
      flash_sale: await flashSaleForTicketType(get, all, perfId, t.price_cents),
    });
  }
  return out;
}

export async function createTicketType(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/performances\/(\d+)\/ticket-types$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const perf = await getPerfOr404(get, Number(m[1]));
  const show = await getShowForPerf(get, perf);
  assertShowAccess(session, show);
  // Validate everything BEFORE any write (OTP lesson).
  const name = text(b.name, "票种名称", 100);
  const priceCents = int(b.price_cents, "票价", 0);
  const quota = int(b.quota, "票数上限", 1);
  let saleUntil = null;
  if (b.sale_until !== undefined && b.sale_until !== null)
    saleUntil = isoDateTime(b.sale_until);
  const result = await run(
    "INSERT INTO ticket_types(performance_id,name,price_cents,quota,sale_until,created_at) VALUES(?,?,?,?,?,?)",
    perf.id,
    name,
    priceCents,
    quota,
    saleUntil,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM ticket_types WHERE id=?", id);
  send({ ok: true, id, ticket_type: tierRow(created) });
  return true;
}

export async function listTicketTypes(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/performances\/(\d+)\/ticket-types$/);
  if (!m || req.method !== "GET") return false;
  const perf = await getPerfOr404(get, Number(m[1]));
  const show = await getShowForPerf(get, perf);
  // Public only when the performance is on sale and its show is
  // approved — anything else reads as "not found", same as the show
  // detail rule in routes/shows.mjs.
  assert(
    perf.status === "on_sale" && show.status === "approved",
    "场次不在售",
    404,
  );
  const rows = await all(
    "SELECT * FROM ticket_types WHERE performance_id=? ORDER BY price_cents ASC, id ASC",
    perf.id,
  );
  send({ ticket_types: rows.map(tierRow) });
  return true;
}

export async function patchTicketType(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/admin\/ticket-types\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const tier = await get("SELECT * FROM ticket_types WHERE id=?", id);
  assert(tier, "票种不存在", 404);
  const perf = await getPerfOr404(get, tier.performance_id);
  const show = await getShowForPerf(get, perf);
  assertShowAccess(session, show);
  // Validate everything BEFORE any write (OTP lesson). sale_until may
  // be set to null to clear the deadline.
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "票种名称", 100);
  if (b.price_cents !== undefined)
    updates.price_cents = int(b.price_cents, "票价", 0);
  if (b.quota !== undefined) updates.quota = int(b.quota, "票数上限", 1);
  if (b.sale_until !== undefined)
    updates.sale_until =
      b.sale_until === null ? null : isoDateTime(b.sale_until);
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE ticket_types SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM ticket_types WHERE id=?", id);
  send({ ok: true, ticket_type: tierRow(fresh) });
  return true;
}
