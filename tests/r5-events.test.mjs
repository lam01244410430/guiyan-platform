// tests/r5-events.test.mjs: R5-1 (rows 36, 37) — event tracking +
// batch aggregation. Spawns server/server.mjs on TEST_PORT (default
// 3116) and talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) 10 view events -> day aggregate counts 10; (2) click /
// search / dwell each recorded once (dwell total_duration_ms exact);
// (3) illegal type -> 400; (4) overlong detail / overlong search /
// out-of-range duration_ms -> 400; (5) aggregation is idempotent
// (run twice, same per-key counts); (6) anonymous can record an
// event; (7) non-admin POST /api/admin/aggregate-events -> 403;
// (8) non-admin GET /api/admin/event-aggregates -> 403.
//
// Aggregation scope: all tests record events dated TODAY (UTC, the
// server's created_at clock), and every assertion filters by type +
// the test's own distinct key — other test files share this DB and
// may have recorded their own events today, so no test ever asserts
// a whole-day total.
//
// i18n key counts (H5 405, miniprogram 218) are asserted by
// tests/r4-tickets.test.mjs, tests/r2-pickup.test.mjs and
// tests/p3bugs.test.mjs — this file adds NO customer-visible string
// (the admin view labels are hardcoded Chinese; the H5/mini sends
// are silent), so the counts stay 405/218.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = Number(process.env.TEST_PORT || 3116);
const BASE = `http://127.0.0.1:${PORT}`;
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
  return r.data.token;
}

async function record(type, detail, extra = {}) {
  return req("/api/events", {
    method: "POST",
    body: { type, detail, ...extra },
  });
}

async function aggregate(adminToken, period = "day") {
  const r = await req("/api/admin/aggregate-events", {
    method: "POST",
    token: adminToken,
    body: { period },
  });
  assert.equal(r.status, 200, `aggregate ${period} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function listAggregates(adminToken, qs) {
  const r = await req(`/api/admin/event-aggregates${qs}`, { token: adminToken });
  assert.equal(r.status, 200, `list aggregates ${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.event_aggregates;
}

// Per-key (type, key, count, total_duration_ms) tuples only: a
// recompute DELETEs + re-INSERTs, so ids change between runs.
function tuples(rows) {
  return rows
    .map((r) => [r.period_key, r.type, r.key, r.count, r.total_duration_ms])
    .sort();
}

const today = () => new Date().toISOString().slice(0, 10);

let adminToken;
let userToken;

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
  userToken = await register("r5eventsuser", "Test1234");
});

after(async () => {
  if (child) child.kill("SIGTERM");
});

test("10 views aggregate to a count of 10", async () => {
  for (let i = 0; i < 10; i++) {
    const r = await record("view", "r5eventsview");
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  await aggregate(adminToken, "day");
  const rows = await listAggregates(adminToken, `?period=day&date=${today()}&type=view`);
  const row = rows.find((x) => x.key === "r5eventsview");
  assert.ok(row, `no aggregate row for r5eventsview in ${JSON.stringify(rows)}`);
  assert.equal(row.count, 10);
  assert.equal(row.total_duration_ms, 0);
  assert.equal(row.period_key, today());
});

test("click, search and dwell are each recorded once", async () => {
  assert.equal((await record("click", "resource:9001")).status, 200);
  assert.equal((await record("search", "r5eventssearch")).status, 200);
  assert.equal((await record("dwell", "resource:9001", { duration_ms: 12345 })).status, 200);
  await aggregate(adminToken, "day");
  const clicks = await listAggregates(adminToken, `?period=day&date=${today()}&type=click`);
  assert.equal(clicks.find((x) => x.key === "resource:9001")?.count, 1);
  const searches = await listAggregates(adminToken, `?period=day&date=${today()}&type=search`);
  assert.equal(searches.find((x) => x.key === "r5eventssearch")?.count, 1);
  const dwells = await listAggregates(adminToken, `?period=day&date=${today()}&type=dwell`);
  const dwell = dwells.find((x) => x.key === "resource:9001");
  assert.ok(dwell, `no dwell row in ${JSON.stringify(dwells)}`);
  assert.equal(dwell.count, 1);
  assert.equal(dwell.total_duration_ms, 12345);
});

test("illegal event type -> 400", async () => {
  assert.equal((await record("purchase", "resource:1")).status, 400);
  assert.equal((await record("VIEW", "resource:1")).status, 400);
  assert.equal((await record("", "resource:1")).status, 400);
});

test("overlong detail / search / out-of-range duration -> 400", async () => {
  assert.equal((await record("click", "x".repeat(501))).status, 400);
  assert.equal((await record("search", "x".repeat(201))).status, 400);
  assert.equal((await record("dwell", "resource:1", { duration_ms: 3600001 })).status, 400);
  assert.equal((await record("dwell", "resource:1", { duration_ms: -1 })).status, 400);
  assert.equal((await record("dwell", "resource:1", { duration_ms: 1.5 })).status, 400);
  // Boundary values are accepted (200-char search, 3600000 ms dwell).
  assert.equal((await record("search", "y".repeat(200))).status, 200);
  assert.equal((await record("dwell", "resource:9002", { duration_ms: 3600000 })).status, 200);
});

test("aggregation is idempotent (run twice, same counts)", async () => {
  await aggregate(adminToken, "day");
  const first = await listAggregates(adminToken, `?period=day&date=${today()}`);
  await aggregate(adminToken, "day");
  const second = await listAggregates(adminToken, `?period=day&date=${today()}`);
  assert.deepEqual(tuples(second), tuples(first));
  // Hour aggregation of the same day is a separate period and must
  // also be stable — and its rows carry hour period_keys.
  await aggregate(adminToken, "hour");
  const hours = await listAggregates(adminToken, `?period=hour&date=${today()}&type=view`);
  assert.ok(hours.length >= 1, "hour aggregates missing");
  assert.ok(hours.every((x) => x.period_key.startsWith(`${today()}T`)));
  assert.equal(hours.find((x) => x.key === "r5eventsview")?.count, 10);
});

test("anonymous can record an event", async () => {
  const r = await fetch(BASE + "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "click", detail: "resource:9003" }),
  });
  assert.equal(r.status, 200, `anonymous record -> ${r.status}`);
  await aggregate(adminToken, "day");
  const clicks = await listAggregates(adminToken, `?period=day&date=${today()}&type=click`);
  assert.equal(clicks.find((x) => x.key === "resource:9003")?.count, 1);
});

test("non-admin POST /api/admin/aggregate-events -> 403", async () => {
  const r = await req("/api/admin/aggregate-events", {
    method: "POST",
    token: userToken,
    body: { period: "day" },
  });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  const anon = await req("/api/admin/aggregate-events", {
    method: "POST",
    body: { period: "day" },
  });
  assert.equal(anon.status, 403, JSON.stringify(anon.data));
  // An invalid period is still a 400 for the admin (validated after
  // the admin check).
  const bad = await req("/api/admin/aggregate-events", {
    method: "POST",
    token: adminToken,
    body: { period: "week" },
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
});

test("non-admin GET /api/admin/event-aggregates -> 403", async () => {
  const r = await req("/api/admin/event-aggregates?period=day", { token: userToken });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  const anon = await req("/api/admin/event-aggregates?period=day");
  assert.equal(anon.status, 403, JSON.stringify(anon.data));
});
