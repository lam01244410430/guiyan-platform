// tests/r4-partial-refund.test.mjs: R4-4 (rows 35, 22) — partial
// refund on the existing POST /api/orders/:id/refund transition +
// self-service pickup display (ticket codes ARE the e-ticket).
// Spawns server/server.mjs on TEST_PORT (default 3115) and talks to
// it over HTTP. DATABASE_URL must point at a FRESH disposable
// database (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) unprinted tickets partial refund -> AUTOMATIC: ticket
// void, its sold seat released, card share back first (floor
// formula), order stays paid, refund_quantity/refunded_cents
// correct; (2) printed ticket partial refund -> MANUAL: status
// refund_requested + pending_refund_tickets stored; (3) approve
// partial -> back to paid, amounts per the floor formula, decision
// text "审核通过，已模拟退款（部分退款）"; (4) reject partial ->
// back to paid, no refund, tickets unfrozen (verify works again);
// (5) frozen ticket verify -> 400 refund_pending (the R4-1 case,
// now testable); (6) frozen ticket print -> 400 (the R4-2 case,
// now testable); (7) full refund of the remainder after a partial
// -> exact remainder amounts (amount - refunded_cents; card share =
// stored_value_cents - cardPerTicket x refund_quantity); (8) k >
// remaining -> 400, k = 0 -> 400 (and non-integer -> 400); (9)
// non-owner -> 403 (anonymous -> 401).
//
// i18n key counts (H5 455 + 82 th/ms/id, miniprogram 269 + 82 th/ms/id) are asserted by
// tests/r4-tickets.test.mjs, tests/r2-pickup.test.mjs and
// tests/p3bugs.test.mjs — this file asserts the behaviour only.
// The mini-program quantity picker is H5-only this wave (see
// miniprogram/pages/orders/orders.js): the mini refund stays
// full-order via its modal, and the picker keys are carried there
// for i18n parity with H5.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3115);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

async function req(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id };
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  const pay = await transition(token, orderId, "pay");
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  return pay.data;
}

async function orderById(token, orderId) {
  const r = await req(`/api/orders/${orderId}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.order;
}

async function ticketsOf(token, orderId) {
  const r = await req(`/api/orders/${orderId}/tickets`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.tickets;
}

async function topup(token, planId) {
  const r = await req("/api/account/topup", { method: "POST", token, body: { plan_id: planId } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function planIdFor(amountCents) {
  const plans = await req("/api/shops/1/stored-value-plans");
  assert.equal(plans.status, 200, JSON.stringify(plans.data));
  const plan = (plans.data.stored_value_plans || []).find(
    (p) => p.amount_cents === amountCents,
  );
  assert.ok(plan, `no plan for amount ${amountCents}`);
  return plan.id;
}

async function cardBalance(token) {
  const r = await req("/api/account/stored-value", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function logCount(result, code) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM verify_logs WHERE result=$1 AND ($2::text IS NULL OR code=$2)",
    [result, code || null],
  );
  return r.rows[0].n;
}

let adminToken;
let demoToken;
let plain280Id;
let showResourceId;
let perfId;
let tierId;
let seatA;
let seatB;
// Test 2's manual partial request, approved by test 3.
let manualOrderId;
let manualTicketIds = [];
let manualOwnerToken;

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: "demo123",
      ADMIN_PASSWORD: "admin123",
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  adminToken = await login("admin", "admin123");
  demoToken = await login("demo", "demo123");
  // Deterministic plain resource for old-flow orders.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R4 partial plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plain280Id = plain.data.resource.id;
  // Seat flow (same setup as r4-tickets): venue + 2x2 template, show
  // resource + approved show + on-sale performance + ticket type,
  // seats generated.
  const v = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R4部分退款剧场", address: "南宁测试路4号", capacity: 4 },
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const venueId = v.data.venue.id;
  assert.equal((await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST",
    token: adminToken,
    body: { name: "默认座位图", zones: [{ name: "A区", rows: 2, cols: 2 }] },
  })).status, 200);
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R4 partial show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, venue_id: venueId,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  showResourceId = res.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: showResourceId, title: "R4部分退款专场" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  const showId = show.data.show.id;
  assert.equal((await req(`/api/admin/shows/${showId}`, {
    method: "PATCH", token: adminToken, body: { status: "approved" },
  })).status, 200);
  const perf = await req(`/api/shows/${showId}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: "2026-12-10T19:30:00", price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
  perfId = perf.data.performance.id;
  assert.equal((await req(`/api/admin/performances/${perfId}`, {
    method: "PATCH", token: adminToken, body: { status: "on_sale" },
  })).status, 200);
  const tier = await req(`/api/performances/${perfId}/ticket-types`, {
    method: "POST",
    token: adminToken,
    body: { name: "普通票", price_cents: 28000, quota: 10 },
  });
  assert.equal(tier.status, 200, JSON.stringify(tier.data));
  tierId = tier.data.ticket_type.id;
  const g = await req(`/api/admin/performances/${perfId}/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.generated, 4);
  const seats = await req(`/api/performances/${perfId}/seats`);
  assert.equal(seats.status, 200, JSON.stringify(seats.data));
  seatA = seats.data.seats.find((s) => s.row === 1 && s.col === 1);
  seatB = seats.data.seats.find((s) => s.row === 1 && s.col === 2);
  assert.ok(seatA && seatB, "seat setup failed");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("unprinted partial refund -> automatic: ticket void, seat released, card share back first, order stays paid", async () => {
  const { token } = await register("r4prseat", "Test1234");
  await topup(token, await planIdFor(10000)); // balance 11000 (100 + 10 bonus)
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: showResourceId, quantity: 2,
      performance_id: perfId, ticket_type_id: tierId,
    },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  assert.equal((await req(`/api/orders/${orderId}/seats`, {
    method: "POST", token, body: { seat_ids: [seatA.id, seatB.id] },
  })).status, 200);
  await payThrough(token, orderId);
  const paid = await orderById(token, orderId);
  assert.equal(paid.status, "paid");
  assert.equal(paid.amount, 56000);
  assert.equal(paid.stored_value_cents, 11000);
  const before = await ticketsOf(token, orderId);
  assert.equal(before.length, 2);
  assert.ok(before.every((t) => t.status === "issued" && !t.printed_at));
  assert.deepEqual(before.map((t) => t.seat_id), [seatA.id, seatB.id]);

  // perTicket = floor(56000/2) = 28000; cardPerTicket =
  // floor(11000/2) = 5500; refund k=1 -> 28000, card first 5500.
  const r = await transition(token, orderId, "refund", { quantity: 1, reason: "去不了一个人" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "paid");
  assert.equal(r.data.refund_cents, 28000);
  assert.equal(r.data.refunded_to_card_cents, 5500);
  assert.equal(r.data.refund_quantity, 1);
  assert.equal(r.data.refunded_cents, 28000);

  const after = await orderById(token, orderId);
  assert.equal(after.status, "paid");
  assert.equal(after.refund_quantity, 1);
  assert.equal(after.refunded_cents, 28000);
  assert.equal(after.pending_refund_tickets, "[]");
  const tickets = await ticketsOf(token, orderId);
  assert.equal(tickets.filter((t) => t.status === "void").length, 1);
  assert.equal(tickets.filter((t) => t.status === "issued").length, 1);
  // The voided ticket is the first one (id ASC) — its seat is back.
  assert.equal(tickets[0].status, "void");
  assert.equal(tickets[1].status, "issued");
  const seatRows = await pool.query(
    "SELECT id, status, order_id FROM seats WHERE id IN ($1, $2) ORDER BY id ASC",
    [seatA.id, seatB.id],
  );
  assert.equal(seatRows.rows[0].status, "available");
  assert.equal(seatRows.rows[0].order_id, null);
  assert.equal(seatRows.rows[1].status, "sold");
  assert.equal(seatRows.rows[1].order_id, orderId);
  // Card: 11000 spent at pay, 5500 back -> balance 5500, one
  // refund ledger row (+5500).
  const sv = await cardBalance(token);
  assert.equal(sv.account.balance_cents, 5500);
  const refundRows = sv.ledger.filter((l) => l.kind === "refund");
  assert.equal(refundRows.length, 1);
  assert.equal(refundRows[0].amount_cents, 5500);
  assert.equal(refundRows[0].order_id, orderId);
});

test("printed ticket partial refund -> manual: refund_requested + pending_refund_tickets stored", async () => {
  const { token } = await register("r4prmanual", "Test1234");
  manualOwnerToken = token;
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  manualOrderId = o.data.id;
  await payThrough(token, manualOrderId);
  const tickets = await ticketsOf(token, manualOrderId);
  assert.equal(tickets.length, 2);
  manualTicketIds = tickets.map((t) => t.id);
  // Print BOTH tickets: any k=1 selection then includes a printed one.
  const printed = await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: manualTicketIds },
  });
  assert.equal(printed.status, 200, JSON.stringify(printed.data));
  assert.equal(printed.data.printed, 2);

  const r = await transition(token, manualOrderId, "refund", { quantity: 1, reason: "打印了要人工" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "refund_requested");
  assert.deepEqual(r.data.pending_refund_tickets, [manualTicketIds[0]]);
  const after = await orderById(token, manualOrderId);
  assert.equal(after.status, "refund_requested");
  assert.equal(after.refund_quantity, 0);
  assert.equal(after.refunded_cents, 0);
  assert.deepEqual(JSON.parse(after.pending_refund_tickets), [manualTicketIds[0]]);
  assert.equal(after.refund_decision, "");
  // Nothing voided yet — the frozen ticket stays issued.
  const still = await ticketsOf(token, manualOrderId);
  assert.ok(still.every((t) => t.status === "issued"));
});

test("approve partial refund -> back to paid, floor-formula amounts, partial decision text", async () => {
  assert.ok(manualOrderId, "test 2 must run first");
  const approved = await transition(adminToken, manualOrderId, "approveRefund");
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.status, "paid");
  assert.equal(approved.data.refund_cents, 28000);
  assert.equal(approved.data.refunded_to_card_cents, 0);
  const after = await orderById(manualOwnerToken, manualOrderId);
  assert.equal(after.status, "paid");
  assert.equal(after.refund_quantity, 1);
  assert.equal(after.refunded_cents, 28000);
  assert.equal(after.pending_refund_tickets, "[]");
  assert.equal(after.refund_decision, "审核通过，已模拟退款（部分退款）");
  // Exactly the frozen ticket is void; the other stays issued.
  const tickets = await ticketsOf(manualOwnerToken, manualOrderId);
  assert.equal(tickets.find((t) => t.id === manualTicketIds[0]).status, "void");
  assert.equal(tickets.find((t) => t.id === manualTicketIds[1]).status, "issued");
  // The owner was notified with the partial amounts.
  const inbox = await req("/api/messages", { token: manualOwnerToken });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
  const decision = (inbox.data.messages || []).find(
    (m) => m.title === "订单售后处理结果" && m.content.includes("部分退款"),
  );
  assert.ok(decision, "expected a partial-refund decision message");
  assert.ok(decision.content.includes("¥280"), decision.content);
});

test("reject partial refund -> back to paid, no refund, tickets unfrozen (verify works again)", async () => {
  const { token } = await register("r4prreject", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(token, orderId);
  const tickets = await ticketsOf(token, orderId);
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: tickets.map((t) => t.id) },
  })).status, 200);
  assert.equal((await transition(token, orderId, "refund", { quantity: 1, reason: "改主意了" })).status, 200);
  const pending = JSON.parse((await orderById(token, orderId)).pending_refund_tickets);
  assert.equal(pending.length, 1);
  const frozenCode = tickets.find((t) => t.id === pending[0]).code;

  const rejected = await transition(adminToken, orderId, "rejectRefund", { reason: "不符合退票条件" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(rejected.data.status, "paid");
  const after = await orderById(token, orderId);
  assert.equal(after.status, "paid");
  assert.equal(after.refund_quantity, 0);
  assert.equal(after.refunded_cents, 0);
  assert.equal(after.pending_refund_tickets, "[]");
  assert.equal(after.refund_decision, "不符合退票条件");
  // Unfrozen: the ticket verifies again (used, not refund_pending).
  const v = await req(`/api/verify/${frozenCode}`, { method: "POST", token: adminToken });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.ticket.status, "used");
});

test("frozen ticket verify -> 400 refund_pending (R4-1 case, now testable)", async () => {
  const { token } = await register("r4prfrozenv", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(token, orderId);
  const tickets = await ticketsOf(token, orderId);
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: tickets.map((t) => t.id) },
  })).status, 200);
  assert.equal((await transition(token, orderId, "refund", { quantity: 1, reason: "冻结核销" })).status, 200);
  const pending = JSON.parse((await orderById(token, orderId)).pending_refund_tickets);
  const frozen = tickets.find((t) => t.id === pending[0]);
  const before = await logCount("refund_pending", frozen.code);
  const r = await req(`/api/verify/${frozen.code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "票正在退款审核中");
  assert.equal(r.data.ticket.status, "issued");
  assert.equal(await logCount("refund_pending", frozen.code), before + 1);
  // The OTHER ticket of the same order is not frozen — it verifies.
  const other = tickets.find((t) => t.id !== pending[0]);
  const ok = await req(`/api/verify/${other.code}`, { method: "POST", token: adminToken });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  // Tidy up: reject so the order leaves refund_requested.
  assert.equal((await transition(adminToken, orderId, "rejectRefund", { reason: "测试清理" })).status, 200);
});

test("frozen ticket print -> 400 (R4-2 case, now testable); re-print of a non-frozen ticket still works", async () => {
  const { token } = await register("r4prfrozenp", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(token, orderId);
  const tickets = await ticketsOf(token, orderId);
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: tickets.map((t) => t.id) },
  })).status, 200);
  assert.equal((await transition(token, orderId, "refund", { quantity: 1, reason: "冻结打印" })).status, 200);
  const pending = JSON.parse((await orderById(token, orderId)).pending_refund_tickets);
  assert.equal(pending.length, 1);
  const frozenId = pending[0];
  const otherId = tickets.find((t) => t.id !== frozenId).id;
  const r = await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: [frozenId] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "票正在退款审核中");
  // The non-frozen printed ticket re-prints fine.
  const ok = await req("/api/admin/tickets/print", {
    method: "POST", token: adminToken, body: { ticket_ids: [otherId] },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.printed, 1);
  // Tidy up: reject so the order leaves refund_requested.
  assert.equal((await transition(adminToken, orderId, "rejectRefund", { reason: "测试清理" })).status, 200);
});

test("full refund of the remainder after a partial -> exact remainder amounts", async () => {
  const { token } = await register("r4prremainder", "Test1234");
  await topup(token, await planIdFor(10000)); // balance 11000
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 3, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(token, orderId);
  const paid = await orderById(token, orderId);
  assert.equal(paid.amount, 84000);
  assert.equal(paid.stored_value_cents, 11000);
  // Partial k=1 (auto): perTicket 28000, cardPerTicket
  // floor(11000/3) = 3666 -> refund 28000, card 3666.
  const p = await transition(token, orderId, "refund", { quantity: 1, reason: "先退一张" });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.refunded_to_card_cents, 3666);
  assert.equal((await cardBalance(token)).account.balance_cents, 3666);
  // Full refund of the remainder (no quantity): refund =
  // 84000 - 28000 = 56000; card = 11000 - 3666 x 1 = 7334.
  assert.equal((await transition(token, orderId, "refund", { reason: "全退剩余" })).status, 200);
  const mid = await orderById(token, orderId);
  assert.equal(mid.status, "refund_requested");
  assert.equal(mid.refund_quantity, 1);
  assert.equal(mid.refunded_cents, 28000);
  const approved = await transition(adminToken, orderId, "approveRefund");
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.status, "refunded");
  assert.equal(approved.data.refund_cents, 56000);
  assert.equal(approved.data.refunded_to_card_cents, 7334);
  const after = await orderById(token, orderId);
  assert.equal(after.status, "refunded");
  assert.equal(after.refund_quantity, 3);
  assert.equal(after.refunded_cents, 84000);
  assert.equal(after.refund_decision, "审核通过，已模拟退款");
  // Card whole again: 3666 + 7334 = 11000.
  assert.equal((await cardBalance(token)).account.balance_cents, 11000);
  // All three tickets void (1 partial + 2 full).
  const tickets = await ticketsOf(token, orderId);
  assert.equal(tickets.length, 3);
  assert.ok(tickets.every((t) => t.status === "void"));
});

test("k > remaining -> 400, k = 0 -> 400, non-integer -> 400; order unchanged and still usable", async () => {
  const { token } = await register("r4prbounds", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(token, orderId);
  assert.equal((await transition(token, orderId, "refund", { quantity: 3 })).status, 400);
  assert.equal((await transition(token, orderId, "refund", { quantity: 0 })).status, 400);
  assert.equal((await transition(token, orderId, "refund", { quantity: 1.5 })).status, 400);
  const still = await orderById(token, orderId);
  assert.equal(still.status, "paid");
  assert.equal(still.refund_quantity, 0);
  assert.equal(still.refunded_cents, 0);
  // A valid partial still works afterwards; then remaining is 1,
  // so a k=2 request fails too.
  assert.equal((await transition(token, orderId, "refund", { quantity: 1 })).status, 200);
  assert.equal((await transition(token, orderId, "refund", { quantity: 2 })).status, 400);
  assert.equal((await orderById(token, orderId)).refund_quantity, 1);
});

test("non-owner refund -> 403; anonymous refund -> 401; order still paid", async () => {
  const { token: owner } = await register("r4prowner", "Test1234");
  const { token: other } = await register("r4prother", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token: owner,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const orderId = o.data.id;
  await payThrough(owner, orderId);
  assert.equal((await transition(other, orderId, "refund", { quantity: 1 })).status, 403);
  assert.equal((await transition(demoToken, orderId, "refund", { quantity: 1 })).status, 403);
  assert.equal((await req(`/api/orders/${orderId}/refund`, { method: "POST", body: { quantity: 1 } })).status, 401);
  assert.equal((await orderById(owner, orderId)).status, "paid");
});
