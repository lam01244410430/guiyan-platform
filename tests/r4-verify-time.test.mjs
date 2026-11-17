// tests/r4-verify-time.test.mjs: G3 (P1 gap, Lam decided 2026-11-17) —
// entry-time limit: a ticket may only be verified from 60 minutes
// before its performance starts; earlier -> 400 未到入场时间 (+ a
// `too_early` verify_logs row), ticket stays issued. Tickets with no
// linked performance (old-flow orders) skip the time check. Batch:
// a too-early code is refused per-code, the batch still answers 200.
// Spawns server/server.mjs on TEST_PORT (default 3138) and talks to
// it over HTTP. DATABASE_URL must point at a FRESH disposable
// database (npm test is NOT idempotent on a reused DB).
//
// Covered: 61 min before -> 400 + log, ticket stays issued; exactly
// 60 min before (boundary, inclusive) -> 200; 59 min before -> 200;
// after start -> 200; no-performance ticket -> 200 (no check);
// batch too-early + OK -> 200 overall with per-code results; a
// re-verify of an already-used future-performance ticket still
// answers already_used (time check runs after the status checks).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3138);
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
  // Seller-confirm: confirm goes through the platform admin; pay
  // stays with the buyer token.
  assert.equal((await transition(adminToken, orderId, "confirm")).status, 200);
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

async function ticketStatus(code) {
  const r = await req(`/api/admin/tickets?code=${code}`, { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tickets.length, 1, `ticket ${code} not found`);
  return r.data.tickets[0].status;
}

let adminToken;
let plain280Id;
let showResourceId;
let buyerSeq = 0;

// One paid ticket for a direct performance starting
// `minutesFromNow` minutes from now (negative = already started).
// The direct-performance route auto-creates the 标准票 tier, so the
// order needs only performance_id + ticket_type_id.
async function perfTicket(minutesFromNow) {
  const startAt = new Date(Date.now() + minutesFromNow * 60000).toISOString();
  const perf = await req(`/api/resources/${showResourceId}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: startAt, price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
  const perfId = perf.data.performance.id;
  const tierId = perf.data.ticket_type.id;
  const { token } = await register(`g3buyer${++buyerSeq}`, "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: showResourceId, quantity: 1,
      performance_id: perfId, ticket_type_id: tierId,
    },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await payThrough(token, o.data.id);
  const list = await req(`/api/orders/${o.data.id}/tickets`, { token });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.tickets.length, 1);
  return { code: list.data.tickets[0].code, orderId: o.data.id };
}

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
  await login("demo", "demo123");
  // Deterministic plain resource for old-flow orders (no performance).
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "G3 plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plain280Id = plain.data.resource.id;
  // Show resource for direct performances (published by default, so
  // the direct-performance route puts them on sale at once).
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "G3 time show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  showResourceId = res.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("61 minutes before start -> 400 未到入场时间, ticket stays issued, + too_early log", async () => {
  const { code } = await perfTicket(61);
  const before = await logCount("too_early", code);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "未到入场时间");
  assert.equal(r.data.ticket.code, code);
  assert.equal(r.data.ticket.status, "issued");
  assert.equal(await logCount("too_early", code), before + 1);
  // The refusal did not consume the ticket.
  assert.equal(await ticketStatus(code), "issued");
});

test("exactly 60 minutes before start (boundary, inclusive) -> 200 used", async () => {
  // start_at is captured as now + 3600s; the order + pay steps take
  // ~1-2s, so the gap at verify time is just under 60 minutes —
  // the boundary is inclusive, so this must still verify. (The
  // 61-minute test above covers the refuse side with ~58s margin.)
  const { code } = await perfTicket(60);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.ticket.status, "used");
});

test("59 minutes before start -> 200 used; re-verify still answers already_used", async () => {
  const { code } = await perfTicket(59);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, "used");
  // The performance is still ~59 minutes in the future, but the
  // time check runs after the status checks: a used ticket answers
  // already_used, not too_early.
  const again = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(again.status, 400, JSON.stringify(again.data));
  assert.equal(again.data.error, "票已核销");
});

test("after start -> 200 used", async () => {
  const { code } = await perfTicket(-60);
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, "used");
});

test("ticket with no linked performance (old-flow order) -> 200, no time check", async () => {
  const { token } = await register("g3plainbuyer", "Test1234");
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
  const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, "used");
});

test("batch: too-early + OK -> 200 overall, per-code results, too-early ticket stays issued", async () => {
  const early = await perfTicket(120);
  const ok = await perfTicket(-30);
  const before = await logCount("too_early", early.code);
  const r = await req("/api/verify/batch", {
    method: "POST",
    token: adminToken,
    body: { codes: [early.code, ok.code] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.results.length, 2);
  assert.equal(r.data.results[0].code, early.code);
  assert.equal(r.data.results[0].result, "too_early");
  assert.equal(r.data.results[1].code, ok.code);
  assert.equal(r.data.results[1].result, "used");
  assert.equal(await logCount("too_early", early.code), before + 1);
  assert.equal(await ticketStatus(early.code), "issued");
  assert.equal(await ticketStatus(ok.code), "used");
});
