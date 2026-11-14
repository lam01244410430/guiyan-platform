// tests/r4-tickets.test.mjs: R4-1 (rows 20, 30) — ticket issuance +
// verification: pay issues one ticket per unit (seat orders link
// 1:1 to sold seats); verify once -> used; verify again -> 400
// already used (response still carries ticket + order); unknown code
// -> 404 + not_found log; void ticket (full-refund approval) -> 400;
// non-admin -> 403; anonymous -> 401; seeded paid orders are
// backfilled with tickets. Spawns server/server.mjs on TEST_PORT
// (default 3112) and talks to it over HTTP. DATABASE_URL must point
// at a FRESH disposable database (npm test is NOT idempotent on a
// reused DB).
//
// Covered: pay issues N tickets (codes GY + 8 [A-Z0-9], unique,
// seat 1:1); verify once -> used (+ verify_logs `used` row);
// verify again -> 400 already used (+ log, ticket + order in the
// response); unknown code -> 404 (+ not_found log, ticket_id NULL);
// void ticket -> 400 (+ void log); non-admin verify / admin list ->
// 403; anonymous verify / order tickets -> 401; order tickets:
// owner + admin 200, another user 403; admin list filters
// (?status= / ?code=); backfill: every paid/completed/disputed/
// refund_requested order holds exactly `quantity` tickets,
// cancelled orders hold none; i18n key counts (H5 397,
// miniprogram 206, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3112);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
// Tickets issued by test 1, shared by the verify tests below.
let plainTickets = [];
let seatOrderId;

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
      name: "R4 tickets plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plain280Id = plain.data.resource.id;
  // Seat flow (same setup as r2-seats): venue + 2x2 template, show
  // resource + approved show + on-sale performance + ticket type,
  // seats generated.
  const v = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R4票务剧场", address: "南宁测试路4号", capacity: 4 },
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
      name: "R4 ticket show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, venue_id: venueId,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  showResourceId = res.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: showResourceId, title: "R4票务专场" },
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

test("pay issues N tickets: codes unique, seat tickets link 1:1 to sold seats; non-seat tickets have seat_id NULL", async () => {
  const { token } = await register("r4seatbuyer", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: showResourceId, quantity: 2,
      performance_id: perfId, ticket_type_id: tierId,
    },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  seatOrderId = o.data.id;
  // No tickets before pay.
  const before = await req(`/api/orders/${seatOrderId}/tickets`, { token });
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.deepEqual(before.data.tickets, []);
  const held = await req(`/api/orders/${seatOrderId}/seats`, {
    method: "POST", token, body: { seat_ids: [seatA.id, seatB.id] },
  });
  assert.equal(held.status, 200, JSON.stringify(held.data));
  await payThrough(token, seatOrderId);
  const after = await req(`/api/orders/${seatOrderId}/tickets`, { token });
  assert.equal(after.status, 200, JSON.stringify(after.data));
  assert.equal(after.data.tickets.length, 2);
  const codes = after.data.tickets.map((t) => t.code);
  assert.ok(codes.every((c) => /^GY[A-Z0-9]{8}$/.test(c)), JSON.stringify(codes));
  assert.equal(new Set(codes).size, 2, "ticket codes must be unique");
  // 1:1 to the sold seats, (row, col) ASC: (1,1) then (1,2).
  assert.deepEqual(
    after.data.tickets.map((t) => t.seat_id),
    [seatA.id, seatB.id],
  );
  assert.ok(after.data.tickets.every((t) => t.status === "issued"));
  assert.ok(after.data.tickets.every((t) => t.verified_at === null));

  // Non-seat order: 3 tickets, all seat_id NULL.
  const { token: token2 } = await register("r4plainbuyer", "Test1234");
  const o2 = await req("/api/orders", {
    method: "POST",
    token: token2,
    body: { resourceId: plain280Id, quantity: 3, booking_date: "2026-12-05" },
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  await payThrough(token2, o2.data.id);
  const plain = await req(`/api/orders/${o2.data.id}/tickets`, { token: token2 });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  assert.equal(plain.data.tickets.length, 3);
  assert.ok(plain.data.tickets.every((t) => t.seat_id === null));
  assert.equal(new Set(plain.data.tickets.map((t) => t.code)).size, 3);
  plainTickets = plain.data.tickets.map((t) => t.code);
  // Owner + admin can read; another user -> 403; anonymous -> 401.
  assert.equal((await req(`/api/orders/${o2.data.id}/tickets`, { token: adminToken })).status, 200);
  assert.equal((await req(`/api/orders/${o2.data.id}/tickets`, { token })).status, 403);
  assert.equal((await req(`/api/orders/${o2.data.id}/tickets`)).status, 401);
  assert.equal((await req("/api/orders/99999/tickets", { token: adminToken })).status, 404);
});

test("verify once -> used (+ log); lowercase code normalizes", async () => {
  assert.ok(plainTickets.length === 3, "test 1 must run first");
  const code = plainTickets[0].toLowerCase();
  const before = await logCount("used", plainTickets[0]);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.ticket.code, plainTickets[0]);
  assert.equal(r.data.ticket.status, "used");
  assert.ok(r.data.ticket.verified_at, "verified_at must be set");
  assert.equal(r.data.ticket.verified_by, 1);
  assert.equal(r.data.order.resource_name, "R4 tickets plain");
  assert.equal(r.data.order.quantity, 3);
  assert.equal(await logCount("used", plainTickets[0]), before + 1);
  // The order-tickets read now shows the ticket as used.
  const list = await req(`/api/orders/${seatOrderId}/tickets`, { token: adminToken });
  assert.equal(list.status, 200);
});

test("verify again -> 400 already used; response still carries ticket + order; + log", async () => {
  const code = plainTickets[0];
  const before = await logCount("already_used", code);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "票已核销");
  assert.equal(r.data.ticket.code, code);
  assert.equal(r.data.ticket.status, "used");
  assert.equal(r.data.order.resource_name, "R4 tickets plain");
  assert.equal(r.data.order.booking_date, "2026-12-05");
  assert.equal(await logCount("already_used", code), before + 1);
});

test("unknown code -> 404 + not_found log (ticket_id NULL)", async () => {
  const before = await logCount("not_found", "GY00000000");
  const r = await req("/api/verify/GY00000000", { method: "POST", token: adminToken });
  assert.equal(r.status, 404, JSON.stringify(r.data));
  assert.equal(r.data.error, "票不存在");
  assert.equal(await logCount("not_found", "GY00000000"), before + 1);
  const row = await pool.query(
    "SELECT ticket_id FROM verify_logs WHERE code='GY00000000' AND result='not_found' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].ticket_id, null);
});

test("void ticket (via full-refund approval) -> 400; + void log", async () => {
  const { token } = await register("r4refund", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await payThrough(token, o.data.id);
  const list = await req(`/api/orders/${o.data.id}/tickets`, { token });
  assert.equal(list.data.tickets.length, 1);
  const code = list.data.tickets[0].code;
  assert.equal(list.data.tickets[0].status, "issued");
  assert.equal((await transition(token, o.data.id, "refund", { reason: "不去了" })).status, 200);
  const approved = await transition(adminToken, o.data.id, "approveRefund");
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  // approveRefund voids the issued ticket in the same transaction.
  const after = await req(`/api/orders/${o.data.id}/tickets`, { token });
  assert.equal(after.data.tickets[0].status, "void");
  const before = await logCount("void", code);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "票已作废");
  assert.equal(r.data.ticket.status, "void");
  assert.equal(await logCount("void", code), before + 1);
});

test("non-admin verify -> 403; non-admin admin-tickets list -> 403", async () => {
  const code = plainTickets[1];
  assert.equal((await req(`/api/verify/${code}`, { method: "POST", token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/tickets", { token: demoToken })).status, 403);
  // The failed attempt did not consume the ticket.
  const list = await req("/api/admin/tickets?code=" + code, { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.tickets.length, 1);
  assert.equal(list.data.tickets[0].status, "issued");
});

test("anonymous verify -> 401; anonymous admin-tickets -> 403", async () => {
  const code = plainTickets[1];
  assert.equal((await req(`/api/verify/${code}`, { method: "POST" })).status, 401);
  assert.equal((await req("/api/admin/tickets")).status, 403);
});

test("backfilled seeded paid orders have tickets; admin list + filters; i18n 397/206", async () => {
  // Every paid/completed/disputed/refund_requested order holds
  // exactly `quantity` tickets (backfill on setup + pay issuance);
  // cancelled orders hold none.
  const bad = await pool.query(
    "SELECT o.id, o.quantity, COUNT(t.id)::int AS n FROM orders o " +
    "LEFT JOIN tickets t ON t.order_id=o.id " +
    "WHERE o.status IN ('paid','completed','disputed','refund_requested') " +
    "GROUP BY o.id, o.quantity HAVING COUNT(t.id) <> o.quantity",
  );
  assert.deepEqual(bad.rows, [], "every paid-ish order must hold exactly quantity tickets");
  const cancelled = await pool.query(
    "SELECT COUNT(*)::int AS n FROM tickets t JOIN orders o ON o.id=t.order_id WHERE o.status='cancelled'",
  );
  assert.equal(cancelled.rows[0].n, 0, "cancelled orders must hold no tickets");
  const total = await pool.query("SELECT COUNT(*)::int AS n FROM tickets");
  assert.ok(total.rows[0].n > 0, "backfilled tickets must exist");

  // Admin list: 200, non-empty; ?status= filters; ?code= finds one.
  const all = await req("/api/admin/tickets", { token: adminToken });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.ok(all.data.tickets.length > 0);
  assert.ok(all.data.tickets.every((t) => t.code && t.order_code && t.resource_name));
  const used = await req("/api/admin/tickets?status=used", { token: adminToken });
  assert.equal(used.status, 200, JSON.stringify(used.data));
  assert.ok(used.data.tickets.length >= 1);
  assert.ok(used.data.tickets.every((t) => t.status === "used"));
  const byCode = await req("/api/admin/tickets?code=" + plainTickets[2], { token: adminToken });
  assert.equal(byCode.status, 200, JSON.stringify(byCode.data));
  assert.equal(byCode.data.tickets.length, 1);
  assert.equal(byCode.data.tickets[0].code, plainTickets[2]);
  assert.equal((await req("/api/admin/tickets?status=bogus", { token: adminToken })).status, 400);
  const byOrder = await req(`/api/admin/tickets?order_id=${seatOrderId}`, { token: adminToken });
  assert.equal(byOrder.status, 200, JSON.stringify(byOrder.data));
  assert.equal(byOrder.data.tickets.length, 2);

  // i18n: 6 new ticket keys on both sides (360 -> 366, 163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [397, 397, 397]);
  for (const l of data.LANGS)
    for (const k of ["ticketTitle", "ticketCode", "ticketEmpty", "ticketIssued", "ticketUsed", "ticketVoid"])
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  const text = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"),
    "utf8",
  );
  const blocks = {};
  for (const lang of ["zh", "vi", "en"]) {
    const start = text.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const end = text.indexOf("\n  }", start);
    const block = text.slice(start, end);
    blocks[lang] = [
      ...block.matchAll(/^    ([A-Za-z0-9_]+):/gm),
    ].map((m) => m[1]);
  }
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 206, `${lang} key count`);
    for (const k of ["ticketTitle", "ticketCode", "ticketEmpty", "ticketIssued", "ticketUsed", "ticketVoid"])
      assert.ok(blocks[lang].includes(k), `${k} missing in mini ${lang}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
  const h5sets = data.LANGS.map((l) => new Set(Object.keys(data.I18N[l])));
  assert.ok(
    [...h5sets[0]].every((k) => h5sets[1].has(k) && h5sets[2].has(k)),
    "H5 i18n key sets must be equal across zh/vi/en",
  );
});
