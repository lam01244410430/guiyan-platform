// Seat selection (Roadmap 82 Wave R2-5, 2026-11-13) — xlsx rows
// 12/13. A performance's seats are generated from its venue's seat
// template (zone by zone); a buyer holding a pending order picks seats
// and holds them for 10 minutes; paying sells them, cancelling (or a
// refund decision) releases the held ones.
//
// Hold expiry is LAZY — there is no background job and no scheduled
// cleanup: reads treat an expired hold as available, and a write
// re-selecting an expired hold takes it over. (Do not claim a
// scheduled job exists.)
//
// Race safety: write requests hold the global advisory lock
// (`postgres.mjs` `request()` serializes writes), and the hold's
// check-then-update runs inside one transaction — a second concurrent
// request sees the first request's held state. No extra lock.
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, int, time } from "../lib/http.mjs";

const HOLD_MINUTES = 10;

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

function seatRow(s, now) {
  // An expired hold reads as available (lazy expiry); the stored row
  // is left alone until a write touches it. order_id is never exposed
  // on the public list.
  const expired =
    s.status === "held" && s.held_until && new Date(s.held_until).valueOf() <= now;
  return {
    id: s.id,
    performance_id: s.performance_id,
    row: s.row,
    col: s.col,
    zone: s.zone,
    status: expired ? "available" : s.status,
    created_at: s.created_at,
  };
}

async function getPerfOr404(get, id) {
  const pf = await get("SELECT * FROM performances WHERE id=?", id);
  assert(pf, "场次不存在", 404);
  return pf;
}

// The venue's seat template: a venue may hold several templates; the
// generate step uses the first one created (lowest id) — the venue's
// default seating. A performance whose show resource links no venue,
// or whose venue has no template, has no template to generate from.
async function templateForPerformance(get, perf) {
  const show = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
  assert(show, "演出不存在", 404);
  const resource = await get(
    "SELECT * FROM resources WHERE id=?",
    show.resource_id,
  );
  if (!resource || resource.venue_id == null) return { show, template: null };
  const template = await get(
    "SELECT * FROM seat_templates WHERE venue_id=? ORDER BY id ASC LIMIT 1",
    resource.venue_id,
  );
  return { show, template: template || null };
}

function parseZones(template) {
  let zones = [];
  try {
    zones = JSON.parse(template.zones || "[]") || [];
  } catch {
    zones = [];
  }
  return zones;
}

export async function generateSeats(ctx) {
  const { req, p, send, session, get, run, all } = ctx;
  const m = p.match(/^\/api\/admin\/performances\/(\d+)\/seats\/generate$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const perf = await getPerfOr404(get, Number(m[1]));
  const { show, template } = await templateForPerformance(get, perf);
  assertShowAccess(session, show);
  // Validate everything BEFORE any write (OTP lesson).
  assert(template, "该场馆未配置座位模板", 400);
  const zones = parseZones(template);
  assert(zones.length > 0, "该场馆未配置座位模板", 400);
  const existing = await all(
    "SELECT row, col FROM seats WHERE performance_id=?",
    perf.id,
  );
  const taken = new Set(existing.map((s) => `${s.row}:${s.col}`));
  // Idempotent: seats that already exist are skipped, never duplicated
  // (the UNIQUE(performance_id, row, col) constraint backs this up).
  let generated = 0;
  for (const z of zones) {
    for (let r = 1; r <= z.rows; r++) {
      for (let c = 1; c <= z.cols; c++) {
        if (taken.has(`${r}:${c}`)) continue;
        await run(
          "INSERT INTO seats(performance_id,row,col,zone,status,created_at) VALUES(?,?,?,?,?,?)",
          perf.id,
          r,
          c,
          z.name,
          "available",
          time(),
        );
        taken.add(`${r}:${c}`);
        generated++;
      }
    }
  }
  const total = await get(
    "SELECT COUNT(*) AS n FROM seats WHERE performance_id=?",
    perf.id,
  );
  send({
    ok: true,
    performance_id: perf.id,
    generated,
    total: total?.n || 0,
  });
  return true;
}

export async function listSeats(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/performances\/(\d+)\/seats$/);
  if (!m || req.method !== "GET") return false;
  const perf = await getPerfOr404(get, Number(m[1]));
  const show = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
  // Public only when the performance is on sale and its show is
  // approved — anything else reads as "not found", same as the ticket
  // type list in routes/ticket-types.mjs.
  assert(
    perf.status === "on_sale" && show && show.status === "approved",
    "场次不在售",
    404,
  );
  const rows = await all(
    "SELECT * FROM seats WHERE performance_id=? ORDER BY zone ASC, row ASC, col ASC, id ASC",
    perf.id,
  );
  const now = Date.now();
  send({ seats: rows.map((s) => seatRow(s, now)) });
  return true;
}

export async function selectSeats(ctx) {
  const { req, p, b, send, needUser, get, run, all } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/seats$/);
  if (!m || req.method !== "POST") return false;
  const u = needUser();
  const order = await get("SELECT * FROM orders WHERE id=?", Number(m[1]));
  assert(order, "订单不存在", 404);
  assert(order.user_id === u.id, "无权操作此订单", 403);
  // Validate everything BEFORE any write (OTP lesson).
  assert(order.status === "pending", "只有待确认的订单可选座", 400);
  assert(order.performance_id != null, "该订单无场次，不可选座", 400);
  assert(
    Array.isArray(b.seat_ids) && b.seat_ids.length > 0,
    "请选择座位",
    400,
  );
  const seatIds = [...new Set(b.seat_ids.map((v) => int(v, "座位", 1)))];
  const rows = await all(
    `SELECT * FROM seats WHERE id IN (${seatIds.map(() => "?").join(",")})`,
    ...seatIds,
  );
  // Every seat must exist, belong to this order's performance, and be
  // available — or already held by this order (re-select is a no-op),
  // or held past its expiry (lazy expiry: an expired hold is free).
  // Anything else (sold, or validly held by another order) -> 409.
  const now = Date.now();
  const byId = new Map(rows.map((s) => [s.id, s]));
  for (const id of seatIds) {
    const s = byId.get(id);
    assert(
      s && s.performance_id === order.performance_id,
      "座位不属于该订单的场次",
      409,
    );
    const expired =
      s.status === "held" &&
      s.held_until &&
      new Date(s.held_until).valueOf() <= now;
    const mine = s.status === "held" && s.order_id === order.id;
    assert(
      s.status === "available" || expired || mine,
      "座位已被选走，请重新选择",
      409,
    );
  }
  const heldUntil = new Date(now + HOLD_MINUTES * 60 * 1000).toISOString();
  await run(
    `UPDATE seats SET status='held', order_id=?, held_until=? WHERE id IN (${seatIds.map(() => "?").join(",")})`,
    order.id,
    heldUntil,
    ...seatIds,
  );
  const held = await all(
    `SELECT * FROM seats WHERE id IN (${seatIds.map(() => "?").join(",")}) ORDER BY row ASC, col ASC, id ASC`,
    ...seatIds,
  );
  send({
    ok: true,
    order_id: order.id,
    held_until: heldUntil,
    seats: held.map((s) => ({
      id: s.id,
      performance_id: s.performance_id,
      row: s.row,
      col: s.col,
      zone: s.zone,
      status: s.status,
      held_until: s.held_until,
      created_at: s.created_at,
    })),
  });
  return true;
}
