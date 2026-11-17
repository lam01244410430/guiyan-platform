// tests/p1-rec-weights.test.mjs: P1 G1 — recommendation weights
// configurable in settings (recWeights). Spawns server/server.mjs on
// TEST_PORT (default 3141) and talks to it over HTTP. DATABASE_URL must
// point at a FRESH disposable database (npm test is NOT idempotent on a
// reused DB).
//
// Covered (5 tests): (1) GET returns the Wave 3 defaults
// {browse 2, favorite 5, purchase 8, cap 35} on a fresh DB; (2) PATCH
// merges the provided keys and GET reflects them (restored to defaults
// before the test ends); (3) invalid PATCHes (unknown key, out-of-range
// or non-integer values, empty body) are 400s and the stored weights
// are unchanged; (4) non-admin -> 403, anonymous -> 403; (5) the
// weights take effect on GET /api/recommendations: one view of a show
// resource scores +2 with the default browse weight, +12 after
// PATCHing browse to 12, and the cap binds at 1 — then restored.
//
// Test usernames are hyphen-free. The PATCHes in tests 2 and 5 restore
// the defaults before they finish, so no later test (and no other file)
// sees changed weights. All assertions filter by this file's own
// usernames / resource — other test files share this DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3141);
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
  return r.data.token;
}

async function getWeights(token) {
  const r = await req("/api/admin/rec-weights", { token });
  assert.equal(r.status, 200, `GET rec-weights -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.recWeights;
}

let adminToken;
let userToken;
let userId;
let resourceId;

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
  userToken = await register("p1rwuser", "Test1234");
  const row = await pool.query("SELECT id FROM users WHERE username=$1", ["p1rwuser"]);
  userId = row.rows[0].id;
  // The test user prefers shows and lives in a city no seeded resource
  // has, so the test resource below is the unique top recommendation:
  // preference +20, same city +6, plus the browse signal.
  await pool.query("UPDATE users SET preference='show', city='防城港' WHERE id=$1", [userId]);
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "P1 weights show", category: "show", city: "防城港",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  resourceId = res.data.resource.id;
  const view = await req(`/api/resources/${resourceId}/view`, {
    method: "POST",
    token: userToken,
  });
  assert.equal(view.status, 200, JSON.stringify(view.data));
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

async function scoreOf(token, id) {
  const r = await req("/api/recommendations?limit=20", { token });
  assert.equal(r.status, 200, `recommendations -> ${r.status} ${JSON.stringify(r.data)}`);
  const rec = r.data.recommendations.find((x) => x.resourceId === id);
  assert.ok(rec, `resource ${id} missing from recommendations`);
  return rec.score;
}

test("GET rec-weights returns the Wave 3 defaults on a fresh DB", async () => {
  assert.deepEqual(await getWeights(adminToken), {
    browse: 2,
    favorite: 5,
    purchase: 8,
    cap: 35,
  });
});

test("PATCH merges keys and GET reflects them (restored after)", async () => {
  const r = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: adminToken,
    body: { purchase: 0 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.recWeights, {
    browse: 2,
    favorite: 5,
    purchase: 0,
    cap: 35,
  });
  assert.deepEqual(await getWeights(adminToken), {
    browse: 2,
    favorite: 5,
    purchase: 0,
    cap: 35,
  });
  const back = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: adminToken,
    body: { purchase: 8 },
  });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.deepEqual(await getWeights(adminToken), {
    browse: 2,
    favorite: 5,
    purchase: 8,
    cap: 35,
  });
});

test("invalid PATCHes are 400s and store nothing", async () => {
  const beforeWeights = await getWeights(adminToken);
  for (const body of [
    { unknown: 1 },
    { browse: -1 },
    { browse: 101 },
    { favorite: 2.5 },
    { cap: 0 },
    { cap: 201 },
    {},
    [],
  ]) {
    const r = await req("/api/admin/rec-weights", {
      method: "PATCH",
      token: adminToken,
      body,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.data)}`);
  }
  assert.deepEqual(await getWeights(adminToken), beforeWeights);
});

test("non-admin and anonymous cannot read or write weights", async () => {
  const r1 = await req("/api/admin/rec-weights", { token: userToken });
  assert.equal(r1.status, 403, JSON.stringify(r1.data));
  const r2 = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: userToken,
    body: { browse: 9 },
  });
  assert.equal(r2.status, 403, JSON.stringify(r2.data));
  const r3 = await req("/api/admin/rec-weights");
  assert.equal(r3.status, 403, JSON.stringify(r3.data));
});

test("weights take effect on recommendations immediately, then restored", async () => {
  // 1 view of a show resource: 20 (preference) + 6 (same city) + 2 (browse) = 28.
  assert.equal(await scoreOf(userToken, resourceId), 28);
  const p1 = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: adminToken,
    body: { browse: 12 },
  });
  assert.equal(p1.status, 200, JSON.stringify(p1.data));
  assert.equal(await scoreOf(userToken, resourceId), 38);
  const p2 = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: adminToken,
    body: { cap: 1 },
  });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  // Signal min(1, 12) = 1: 20 + 6 + 1 = 27 — the cap binds.
  assert.equal(await scoreOf(userToken, resourceId), 27);
  const back = await req("/api/admin/rec-weights", {
    method: "PATCH",
    token: adminToken,
    body: { browse: 2, cap: 35 },
  });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(await scoreOf(userToken, resourceId), 28);
  assert.deepEqual(await getWeights(adminToken), {
    browse: 2,
    favorite: 5,
    purchase: 8,
    cap: 35,
  });
});
