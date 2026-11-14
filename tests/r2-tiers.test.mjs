// tests/r2-tiers.test.mjs: R2-2 (row 7) — price tiers / ticket types.
// Spawns server/server.mjs on TEST_PORT (default 3111) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: early-bird after sale_until -> 400; combo tier total correct
// (price x qty, booking_date + ids stored server-side); quota exhausted
// -> 409 (PATCH quota reopens sales); tier of another performance ->
// 400; tier order does not change resources.stock; non-tier order
// unchanged (resource price + stock decrement, restored by cancel);
// availability returns tiers with correct sold/available; non-admin
// tier create -> 403; i18n key counts (H5 372, miniprogram 181, equal
// sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3111);
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

async function createShow(token, body) {
  return req("/api/shows", { method: "POST", token, body });
}
async function reviewShow(token, id, body) {
  return req(`/api/admin/shows/${id}`, { method: "PATCH", token, body });
}
async function createPerf(token, showId, body) {
  return req(`/api/shows/${showId}/performances`, { method: "POST", token, body });
}
async function patchPerf(token, id, body) {
  return req(`/api/admin/performances/${id}`, { method: "PATCH", token, body });
}
async function createTier(token, perfId, body) {
  return req(`/api/performances/${perfId}/ticket-types`, { method: "POST", token, body });
}
async function patchTier(token, id, body) {
  return req(`/api/admin/ticket-types/${id}`, { method: "PATCH", token, body });
}
async function listTiers(perfId, token) {
  return token
    ? req(`/api/performances/${perfId}/ticket-types`, { token })
    : req(`/api/performances/${perfId}/ticket-types`);
}
async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}
async function getAvailability(resourceId) {
  return req(`/api/resources/${resourceId}/availability`);
}
async function stockOf(resourceId) {
  const r = await pool.query("SELECT stock FROM resources WHERE id=$1", [resourceId]);
  return r.rows[0].stock;
}

let adminToken;
let demoToken;
let freshToken;
let mainShowResourceId;
let plainResourceId;
let showId;
let perf1;
let perf2;
let perf3;
let perf4;
let earlyBirdId;
let comboId;
let smallId;
let perf2TierId;

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
  // R3-1: the demo account holds a member tier by now (its seed
  // spending upgrades it on the first pay in this run), so its orders
  // are discounted — the two tests below that assert exact full-price
  // amounts order as a fresh user (no tier, no discount) instead.
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { username: "r2tiersfresh", password: "Test1234", name: "R2 Tiers Fresh" },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  freshToken = reg.data.token;
  const r = await req("/api/admin/resources", { token: adminToken });
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowResourceId = mainShow.id;
  // A plain (non-show) resource for the old-flow test.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R2 tiers plain", category: "digital", city: "南宁",
      price: 10000, unit: "张", stock: 50, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
  // One approved show with two on-sale performances, one scheduled
  // performance (never on sale) and one on-sale performance with no
  // tiers at all.
  const s = await createShow(adminToken, {
    resource_id: mainShowResourceId, title: "R2 票种专场",
  });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  showId = s.data.show.id;
  assert.equal((await reviewShow(adminToken, showId, { status: "approved" })).status, 200);
  const p1 = await createPerf(adminToken, showId, {
    start_at: "2026-12-05T19:30:00", price_cents: 28000,
  });
  assert.equal(p1.status, 200, JSON.stringify(p1.data));
  perf1 = p1.data.performance.id;
  const p2 = await createPerf(adminToken, showId, {
    start_at: "2026-12-06T19:30:00", price_cents: 30000,
  });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  perf2 = p2.data.performance.id;
  const p3 = await createPerf(adminToken, showId, {
    start_at: "2026-12-07T19:30:00", price_cents: 28000,
  });
  assert.equal(p3.status, 200, JSON.stringify(p3.data));
  perf3 = p3.data.performance.id;
  const p4 = await createPerf(adminToken, showId, {
    start_at: "2026-12-08T19:30:00", price_cents: 28000,
  });
  assert.equal(p4.status, 200, JSON.stringify(p4.data));
  perf4 = p4.data.performance.id;
  for (const id of [perf1, perf2, perf4])
    assert.equal((await patchPerf(adminToken, id, { status: "on_sale" })).status, 200);
  // Tiers on perf1: an expired early-bird, a combo, a quota-2 tier.
  const eb = await createTier(adminToken, perf1, {
    name: "早鸟", price_cents: 20000, quota: 5, sale_until: "2026-11-01T00:00:00Z",
  });
  assert.equal(eb.status, 200, JSON.stringify(eb.data));
  earlyBirdId = eb.data.ticket_type.id;
  const cb = await createTier(adminToken, perf1, {
    name: "套票", price_cents: 50000, quota: 10,
  });
  assert.equal(cb.status, 200, JSON.stringify(cb.data));
  comboId = cb.data.ticket_type.id;
  const sm = await createTier(adminToken, perf1, {
    name: "限量", price_cents: 25000, quota: 2,
  });
  assert.equal(sm.status, 200, JSON.stringify(sm.data));
  smallId = sm.data.ticket_type.id;
  const p2t = await createTier(adminToken, perf2, {
    name: "普通", price_cents: 30000, quota: 5,
  });
  assert.equal(p2t.status, 200, JSON.stringify(p2t.data));
  perf2TierId = p2t.data.ticket_type.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("early-bird after sale_until -> 400; one of performance/tier alone -> 400", async () => {
  // The public tier list works on an on-sale performance.
  const list = await listTiers(perf1);
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.ticket_types.length, 3);
  assert.ok(list.data.ticket_types.some((t) => t.id === earlyBirdId && t.name === "早鸟"));
  // The early-bird deadline (2026-11-01) has passed -> 400.
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf1, ticket_type_id: earlyBirdId,
  })).status, 400);
  // Half a tier order is not an order.
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1, performance_id: perf1,
  })).status, 400);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1, ticket_type_id: comboId,
  })).status, 400);
});

test("combo tier total correct (price x qty); booking_date + ids stored server-side", async () => {
  // A client-sent amount / booking_date must be ignored: the server
  // prices 50000 x 2 and dates the order on the performance day.
  const r = await orderAs(freshToken, {
    resourceId: mainShowResourceId, quantity: 2,
    performance_id: perf1, ticket_type_id: comboId,
    amount: 1, booking_date: "2026-11-11",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, 100000);
  const row = await pool.query(
    "SELECT booking_date, performance_id, ticket_type_id, amount FROM orders WHERE id=$1",
    [r.data.id],
  );
  assert.equal(row.rows[0].booking_date, "2026-12-05");
  assert.equal(row.rows[0].performance_id, perf1);
  assert.equal(row.rows[0].ticket_type_id, comboId);
  assert.equal(row.rows[0].amount, 100000);
});

test("quota exhausted -> 409; PATCH quota reopens sales", async () => {
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 2,
    performance_id: perf1, ticket_type_id: smallId,
  })).status, 200);
  // Quota 2 is now full.
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf1, ticket_type_id: smallId,
  })).status, 409);
  // The admin raises the quota; one more ticket sells.
  const patched = await patchTier(adminToken, smallId, { quota: 3 });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.ticket_type.quota, 3);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf1, ticket_type_id: smallId,
  })).status, 200);
});

test("tier of another performance -> 400; unknown performance -> 400", async () => {
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf1, ticket_type_id: perf2TierId,
  })).status, 400);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf2, ticket_type_id: comboId,
  })).status, 400);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: 99999, ticket_type_id: comboId,
  })).status, 400);
});

test("tier order does not change resources.stock", async () => {
  const before = await stockOf(mainShowResourceId);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perf1, ticket_type_id: comboId,
  })).status, 200);
  assert.equal(await stockOf(mainShowResourceId), before);
});

test("non-tier order unchanged (resource price + stock decrement)", async () => {
  assert.equal(await stockOf(plainResourceId), 50);
  const r = await orderAs(freshToken, {
    resourceId: plainResourceId, quantity: 2, booking_date: "2026-12-05",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, 20000);
  assert.equal(await stockOf(plainResourceId), 48);
  // Cancel restores the stock, so the shared seed is left as found.
  assert.equal((await req(`/api/orders/${r.data.id}/cancel`, {
    method: "POST", token: freshToken, body: {},
  })).status, 200);
  assert.equal(await stockOf(plainResourceId), 50);
});

test("availability returns tiers with correct sold/available", async () => {
  const av = await getAvailability(mainShowResourceId);
  assert.equal(av.status, 200);
  const found = av.data.performances.find((p) => p.id === perf1);
  assert.ok(found, JSON.stringify(av.data.performances));
  // Combo: 2 (combo test) + 1 (stock test) = 3 sold of 10.
  const combo = found.ticket_types.find((t) => t.id === comboId);
  assert.ok(combo, JSON.stringify(found.ticket_types));
  assert.equal(combo.quota, 10);
  assert.equal(combo.sold, 3);
  assert.equal(combo.available, 7);
  // Small tier: 2 + 1 = 3 sold of 3 (after the PATCH).
  const small = found.ticket_types.find((t) => t.id === smallId);
  assert.equal(small.sold, 3);
  assert.equal(small.available, 0);
  // Early-bird: never sold.
  const eb = found.ticket_types.find((t) => t.id === earlyBirdId);
  assert.equal(eb.sold, 0);
  assert.equal(eb.available, 5);
  // Perf2 keeps its own tier; perf4 (on sale, no tiers) gets [].
  const found2 = av.data.performances.find((p) => p.id === perf2);
  assert.equal(found2.ticket_types.length, 1);
  assert.equal(found2.ticket_types[0].id, perf2TierId);
  const found4 = av.data.performances.find((p) => p.id === perf4);
  assert.ok(found4, JSON.stringify(av.data.performances));
  assert.deepEqual(found4.ticket_types, []);
  // The scheduled perf3 is not in availability at all.
  assert.ok(!av.data.performances.some((p) => p.id === perf3));
  // All pre-existing availability fields are unchanged.
  assert.ok("mode" in av.data && "available" in av.data && "dates" in av.data);
});

test("non-admin tier create -> 403; scheduled performance tiers -> 404; i18n 372/181", async () => {
  assert.equal((await createTier(demoToken, perf1, {
    name: "越权票种", price_cents: 100, quota: 1,
  })).status, 403);
  assert.equal((await createTier(undefined, perf1, {
    name: "越权票种", price_cents: 100, quota: 1,
  })).status, 403);
  // A scheduled performance's tiers are not public yet.
  assert.equal((await listTiers(perf3)).status, 404);
  assert.equal((await listTiers(99999)).status, 404);
  // i18n: 5 tier keys + 3 pickup keys + 1 venue key + 2 seat keys on both sides (333 -> 339, 137 -> 143); R3-1 adds 5 member-tier keys (339 -> 344, 143 -> 148); R3-2 adds 3 coupon keys (344 -> 347, 148 -> 151); R3-3 adds 3 flash-sale keys (347 -> 350, 151 -> 154); R3-4 adds 3 gift keys (350 -> 353, 154 -> 157); R3-5 adds 1 socMaoyan key H5-only (353 -> 354); R3-6 adds 6 stored-value keys (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206). R6-3 adds 2 creative keys H5 (397 -> 399), 1 mini (206 -> 207). R6-4 adds 6 match keys (399 -> 405) + 5 filter-bar keys mini-only (207 -> 218).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [405, 405, 405]);
  for (const k of ["tierTitle", "tierEmpty", "tierSoldOut", "tierLeft", "tierPick", "pickupTitle", "pickupEmpty", "pickupPick"]) {
    for (const l of data.LANGS)
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  }
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
    assert.equal(blocks[lang].length, 218, `${lang} key count`);
    for (const k of ["tierTitle", "tierEmpty", "tierSoldOut", "tierLeft", "tierPick"])
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
