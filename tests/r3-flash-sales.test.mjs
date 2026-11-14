// tests/r3-flash-sales.test.mjs: R3-3 (row 16) — flash sales /
// time-limited discounts.
// Spawns server/server.mjs on TEST_PORT (default 3111) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: admin create/list/get + validation (kind/value rules,
// start/end required + ordered, overlap -> 409, cross-shop -> 403);
// outside the window (not started / ended) -> original price;
// disabled -> original price; inside the window -> sale price +
// countdown fields in availability (sale_price_cents, ends_at,
// remaining_seconds, quota_remaining); fixed + pct math; stacking
// exact with tier discount + coupon (¥28000 -> flash 20% -> ¥22400
// -> Silver 5% -> ¥21280 -> coupon 10% -> ¥19152); quota exhausted
// -> original price (200, never 409), cancel frees the quota; an
// order created inside the window keeps its snapshot price when paid
// after the window ends; old-flow orders never get a flash price;
// i18n key counts (H5 418, miniprogram 231, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

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

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
}

async function completeThrough(token, orderId) {
  await payThrough(token, orderId);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

async function createSale(token, body) {
  return req("/api/admin/flash-sales", { method: "POST", token, body });
}

async function createCoupon(token, body) {
  return req("/api/admin/coupons", { method: "POST", token, body });
}

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}
const H = 60 * 60 * 1000;

// One approved show + one on-sale performance with a ¥280 ticket
// type, built fresh per test so a test's live sales never leak into
// another test's performance.
let perfCounter = 0;
async function makePerf() {
  perfCounter += 1;
  const day = String(4 + perfCounter).padStart(2, "0");
  const p = await req(`/api/shows/${showId}/performances`, {
    method: "POST", token: adminToken,
    body: { start_at: `2026-12-${day}T19:30:00`, price_cents: 28000 },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const perfId = p.data.performance.id;
  assert.equal((await req(`/api/admin/performances/${perfId}`, {
    method: "PATCH", token: adminToken, body: { status: "on_sale" },
  })).status, 200);
  const t = await req(`/api/performances/${perfId}/ticket-types`, {
    method: "POST", token: adminToken,
    body: { name: "普通", price_cents: 28000, quota: 100 },
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  return { perfId, tierId: t.data.ticket_type.id };
}

async function tierOrder(token, perfId, tierId, extra = {}) {
  return orderAs(token, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId, ...extra,
  });
}

async function getAvailability(resourceId) {
  return req(`/api/resources/${resourceId}/availability`);
}

function tierFlashOf(avail, perfId, tierId) {
  const perf = (avail.data.performances || []).find((x) => x.id === perfId);
  assert.ok(perf, `performance ${perfId} missing from availability`);
  const tier = (perf.ticket_types || []).find((x) => x.id === tierId);
  assert.ok(tier, `ticket type ${tierId} missing from availability`);
  return tier.flash_sale;
}

let adminToken;
let demoToken;
let user1Token;
let user2Token;
let silverToken;
let plainResourceId;
let mainShowResourceId;
let showId;
let pctLiveSaleId;

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
  user1Token = await register("flashuser1", "Test1234");
  user2Token = await register("flashuser2", "Test1234");
  silverToken = await register("flashsilver", "Test1234");
  // A deterministic ¥280 plain resource for old-flow orders (price
  // 28000 cents, stock 100). Fresh registered users hold no tier, so
  // their orders are full price until they earn one.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R3 flash plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
  // One approved show on a main-shop show resource; each test builds
  // its own performance + ticket type on it.
  const r = await req("/api/admin/resources", { token: adminToken });
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowResourceId = mainShow.id;
  const s = await req("/api/shows", {
    method: "POST", token: adminToken,
    body: { resource_id: mainShowResourceId, title: "R3 限时抢购专场" },
  });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  showId = s.data.show.id;
  assert.equal((await req(`/api/admin/shows/${showId}`, {
    method: "PATCH", token: adminToken, body: { status: "approved" },
  })).status, 200);
  // Earn Silver for flashsilver first: 4 completed ¥280 orders =
  // ¥1120 spending (>= ¥1000 threshold). Plain old-flow orders, so
  // no flash sale can touch them.
  for (let i = 0; i < 4; i++) {
    const o = await orderAs(silverToken, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.amount, 28000);
    await completeThrough(silverToken, o.data.id);
  }
  const tier = await req("/api/account/tier", { token: silverToken });
  assert.equal(tier.data.tier.name, "银卡会员");
  assert.equal(tier.data.discount_pct, 5);
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("admin flash-sale create/list/get: pct + fixed; validation 400; overlap 409; non-admin 403", async () => {
  const { perfId: perfA, tierId: tierA } = await makePerf();
  const { perfId: perfB } = await makePerf();
  // Empty list on a fresh DB; anonymous + demo -> 403 (never 401).
  const empty = await req("/api/admin/flash-sales", { token: adminToken });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.flash_sales, []);
  assert.equal((await req("/api/admin/flash-sales")).status, 403);
  assert.equal((await req("/api/admin/flash-sales", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/flash-sales/99999", { token: adminToken })).status, 404);
  assert.equal((await createSale(demoToken, { performance_id: perfA, name: "NOPE", kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H) })).status, 403);
  assert.equal((await createSale(undefined, { performance_id: perfA, name: "NOPE", kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H) })).status, 403);

  const pct = await createSale(adminToken, {
    performance_id: perfA, name: "T1 PCT", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(pct.status, 200, JSON.stringify(pct.data));
  pctLiveSaleId = pct.data.flash_sale.id;
  assert.equal(pct.data.flash_sale.name, "T1 PCT");
  assert.equal(pct.data.flash_sale.kind, "pct");
  assert.equal(pct.data.flash_sale.discount_pct, 20);
  assert.equal(pct.data.flash_sale.value_cents, null);
  assert.equal(pct.data.flash_sale.sold_count, 0);
  assert.equal(pct.data.flash_sale.quota_remaining, null);
  const fixed = await createSale(adminToken, {
    performance_id: perfB, name: "T1 FIXED", kind: "fixed", value_cents: 5000,
    start_at: iso(-H), end_at: iso(2 * H), quota: 10,
  });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
  assert.equal(fixed.data.flash_sale.value_cents, 5000);
  assert.equal(fixed.data.flash_sale.quota_remaining, 10);

  // Validation -> 400: missing start/end, start >= end, wrong kind,
  // fixed with a pct, pct with a value, pct over 100, quota 0, bad
  // dates, unknown performance -> 404.
  const bad = [
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, end_at: iso(2 * H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, start_at: iso(-H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, start_at: iso(2 * H), end_at: iso(H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, start_at: iso(H), end_at: iso(H) },
    { performance_id: perfA, name: "BAD", kind: "weird", value_cents: 1, start_at: iso(-H), end_at: iso(2 * H) },
    { performance_id: perfA, name: "BAD", kind: "fixed", value_cents: 1, discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, value_cents: 1, start_at: iso(-H), end_at: iso(2 * H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 101, start_at: iso(-H), end_at: iso(2 * H) },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H), quota: 0 },
    { performance_id: perfA, name: "BAD", kind: "pct", discount_pct: 10, start_at: "not-a-date", end_at: iso(2 * H) },
  ];
  for (const body of bad)
    assert.equal((await createSale(adminToken, body)).status, 400, JSON.stringify(body));
  assert.equal((await createSale(adminToken, {
    performance_id: 99999, name: "BAD", kind: "pct", discount_pct: 10,
    start_at: iso(-H), end_at: iso(2 * H),
  })).status, 404);

  // Overlap: another ACTIVE sale overlapping the live one -> 409;
  // a DISABLED overlapping sale is fine; a non-overlapping future
  // window is fine.
  assert.equal((await createSale(adminToken, {
    performance_id: perfA, name: "OVERLAP", kind: "pct", discount_pct: 10,
    start_at: iso(0), end_at: iso(3 * H),
  })).status, 409);
  const disabled = await createSale(adminToken, {
    performance_id: perfA, name: "T1 DISABLED", kind: "pct", discount_pct: 10,
    start_at: iso(0), end_at: iso(3 * H), status: "disabled",
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  const future = await createSale(adminToken, {
    performance_id: perfA, name: "T1 FUTURE", kind: "pct", discount_pct: 10,
    start_at: iso(3 * H), end_at: iso(4 * H),
  });
  assert.equal(future.status, 200, JSON.stringify(future.data));

  // PATCH: performance_id/shop_id are immutable -> 400; kind switch
  // without the new kind's value -> 400; a valid switch round-trips
  // on a throwaway sale (left as pct 30, unused elsewhere).
  const patch1 = await createSale(adminToken, {
    performance_id: perfA, name: "T1 PATCH", kind: "fixed", value_cents: 100,
    start_at: iso(5 * H), end_at: iso(6 * H),
  });
  assert.equal(patch1.status, 200, JSON.stringify(patch1.data));
  const patch1Id = patch1.data.flash_sale.id;
  assert.equal((await req(`/api/admin/flash-sales/${patch1Id}`, { method: "PATCH", token: adminToken, body: { performance_id: perfB } })).status, 400);
  assert.equal((await req(`/api/admin/flash-sales/${patch1Id}`, { method: "PATCH", token: adminToken, body: { shop_id: 2 } })).status, 400);
  assert.equal((await req(`/api/admin/flash-sales/${patch1Id}`, { method: "PATCH", token: adminToken, body: { kind: "pct" } })).status, 400);
  const switched = await req(`/api/admin/flash-sales/${patch1Id}`, { method: "PATCH", token: adminToken, body: { kind: "pct", discount_pct: 30 } });
  assert.equal(switched.status, 200, JSON.stringify(switched.data));
  assert.equal(switched.data.flash_sale.kind, "pct");
  assert.equal(switched.data.flash_sale.discount_pct, 30);
  assert.equal(switched.data.flash_sale.value_cents, null);
  // PATCH into an overlapping window -> 409 (the throwaway sale's
  // new window would collide with the live sale on the same perf).
  assert.equal((await req(`/api/admin/flash-sales/${patch1Id}`, {
    method: "PATCH", token: adminToken, body: { start_at: iso(0), end_at: iso(H) },
  })).status, 409);
  // Disable + re-enable round-trips (restored, so later tests see a
  // live sale on perfA only through this test's own orders).
  const off = await req(`/api/admin/flash-sales/${pctLiveSaleId}`, { method: "PATCH", token: adminToken, body: { status: "disabled" } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.flash_sale.status, "disabled");
  const on = await req(`/api/admin/flash-sales/${pctLiveSaleId}`, { method: "PATCH", token: adminToken, body: { status: "active" } });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.flash_sale.status, "active");
  assert.equal((await req(`/api/admin/flash-sales/${patch1Id}`, { method: "PATCH", token: demoToken, body: { status: "disabled" } })).status, 403);

  // Detail carries live stats + the orders that used the sale.
  const detail = await req(`/api/admin/flash-sales/${pctLiveSaleId}`, { token: adminToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.flash_sale.sold_count, 0);
  assert.deepEqual(detail.data.orders, []);

  const list = await req("/api/admin/flash-sales", { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.flash_sales.length, 5);
  assert.deepEqual(
    list.data.flash_sales.map((s) => s.name),
    ["T1 PCT", "T1 FIXED", "T1 DISABLED", "T1 FUTURE", "T1 PATCH"],
  );
  // The live sale on perfA is untouched by this test's own orders
  // (none were placed here) — its tier still shows no flash sale
  // used, and the availability countdown is live.
  const avail = await getAvailability(mainShowResourceId);
  assert.equal(avail.status, 200, JSON.stringify(avail.data));
  const live = tierFlashOf(avail, perfA, tierA);
  assert.ok(live, "live sale must show in availability");
  assert.equal(live.sale_id, pctLiveSaleId);
  assert.equal(live.sale_price_cents, 22400);
});

test("outside the window (not started / ended) -> original price; disabled -> original price; availability shows no sale", async () => {
  const { perfId, tierId } = await makePerf();
  const notYet = await createSale(adminToken, {
    performance_id: perfId, name: "T2 FUTURE", kind: "pct", discount_pct: 20,
    start_at: iso(H), end_at: iso(3 * H),
  });
  assert.equal(notYet.status, 200, JSON.stringify(notYet.data));
  const ended = await createSale(adminToken, {
    performance_id: perfId, name: "T2 ENDED", kind: "pct", discount_pct: 20,
    start_at: iso(-3 * H), end_at: iso(-H),
  });
  assert.equal(ended.status, 200, JSON.stringify(ended.data));
  const off = await createSale(adminToken, {
    performance_id: perfId, name: "T2 DISABLED", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H), status: "disabled",
  });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  // All three orders pay full price; no flash snapshot is stored.
  for (let i = 0; i < 3; i++) {
    const o = await tierOrder(user1Token, perfId, tierId);
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.amount, 28000);
    assert.equal(o.data.flash_sale_id, null);
    assert.equal(o.data.flash_cents, 0);
  }
  const avail = await getAvailability(mainShowResourceId);
  assert.equal(avail.status, 200, JSON.stringify(avail.data));
  assert.equal(tierFlashOf(avail, perfId, tierId), null);
});

test("inside the window -> sale price + countdown fields; fixed sale with qty 2", async () => {
  const { perfId, tierId } = await makePerf();
  const sale = await createSale(adminToken, {
    performance_id: perfId, name: "T3 PCT20", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H), quota: 10,
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const saleId = sale.data.flash_sale.id;
  const o = await tierOrder(user1Token, perfId, tierId);
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 22400);
  assert.equal(o.data.flash_sale_id, saleId);
  assert.equal(o.data.flash_cents, 5600);
  const row = await pool.query(
    "SELECT amount, flash_sale_id, flash_cents FROM orders WHERE id=$1",
    [o.data.id],
  );
  assert.equal(row.rows[0].amount, 22400);
  assert.equal(row.rows[0].flash_sale_id, saleId);
  assert.equal(row.rows[0].flash_cents, 5600);
  const got = await req(`/api/orders/${o.data.id}`, { token: user1Token });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.order.flash_sale_id, saleId);
  assert.equal(got.data.order.flash_cents, 5600);
  // Availability countdown: sale price on the tier, end time, seconds
  // left inside the 2-hour window, quota left 9 of 10.
  const avail = await getAvailability(mainShowResourceId);
  assert.equal(avail.status, 200, JSON.stringify(avail.data));
  const live = tierFlashOf(avail, perfId, tierId);
  assert.ok(live, "live sale must show in availability");
  assert.equal(live.sale_id, saleId);
  assert.equal(live.name, "T3 PCT20");
  assert.equal(live.kind, "pct");
  assert.equal(live.discount_pct, 20);
  assert.equal(live.sale_price_cents, 22400);
  assert.equal(live.ends_at, sale.data.flash_sale.end_at);
  assert.ok(live.remaining_seconds > 0 && live.remaining_seconds <= 2 * 3600, `remaining_seconds=${live.remaining_seconds}`);
  assert.equal(live.quota_remaining, 9);
  // Admin detail agrees on the sold count.
  const detail = await req(`/api/admin/flash-sales/${saleId}`, { token: adminToken });
  assert.equal(detail.data.flash_sale.sold_count, 1);
  assert.equal(detail.data.flash_sale.quota_remaining, 9);
  assert.equal(detail.data.orders.length, 1);
  assert.equal(detail.data.orders[0].id, o.data.id);

  // Fixed sale, qty 2: ¥28000 - ¥5000 = ¥23000 a ticket, x2 = ¥46000.
  const { perfId: perf2, tierId: tier2 } = await makePerf();
  const fixed = await createSale(adminToken, {
    performance_id: perf2, name: "T3 FIXED", kind: "fixed", value_cents: 5000,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
  const o2 = await tierOrder(user2Token, perf2, tier2, { quantity: 2 });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 46000);
  assert.equal(o2.data.flash_cents, 10000);
  assert.equal(o2.data.flash_sale_id, fixed.data.flash_sale.id);
  const avail2 = await getAvailability(mainShowResourceId);
  const live2 = tierFlashOf(avail2, perf2, tier2);
  assert.equal(live2.sale_price_cents, 23000);
  assert.equal(live2.quota_remaining, null, "unlimited quota reports null");
});

test("stacking exact: flash 20% -> Silver 5% -> coupon 10% = ¥19152", async () => {
  const { perfId, tierId } = await makePerf();
  const sale = await createSale(adminToken, {
    performance_id: perfId, name: "T4 PCT20", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const coupon = await createCoupon(adminToken, { code: "FLASH10", kind: "pct", discount_pct: 10 });
  assert.equal(coupon.status, 200, JSON.stringify(coupon.data));
  // ¥28000 -> flash 20% -> ¥22400 -> Silver 5% (-¥1120) -> ¥21280
  // -> coupon 10% (-¥2128) -> ¥19152.
  const o = await tierOrder(silverToken, perfId, tierId, { coupon_code: "FLASH10" });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 19152);
  assert.equal(o.data.flash_cents, 5600);
  assert.equal(o.data.flash_sale_id, sale.data.flash_sale.id);
  assert.equal(o.data.discount_cents, 1120);
  assert.equal(o.data.coupon_cents, 2128);
  assert.equal(o.data.coupon_id, coupon.data.coupon.id);
  const row = await pool.query(
    "SELECT amount, discount_cents, tier_id, coupon_id, coupon_cents, flash_sale_id, flash_cents FROM orders WHERE id=$1",
    [o.data.id],
  );
  assert.equal(row.rows[0].amount, 19152);
  assert.equal(row.rows[0].discount_cents, 1120);
  assert.equal(row.rows[0].coupon_cents, 2128);
  assert.equal(row.rows[0].flash_sale_id, sale.data.flash_sale.id);
  assert.equal(row.rows[0].flash_cents, 5600);
  const tier = await req("/api/account/tier", { token: silverToken });
  assert.equal(row.rows[0].tier_id, tier.data.tier.id);
});

test("quota exhausted -> original price (200, never 409); cancel frees the quota", async () => {
  const { perfId, tierId } = await makePerf();
  const sale = await createSale(adminToken, {
    performance_id: perfId, name: "T5 QUOTA1", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H), quota: 1,
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const saleId = sale.data.flash_sale.id;
  const o1 = await tierOrder(user1Token, perfId, tierId);
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.amount, 22400);
  assert.equal(o1.data.flash_sale_id, saleId);
  // Quota gone: the next order still succeeds, at the original price.
  const o2 = await tierOrder(user2Token, perfId, tierId);
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 28000);
  assert.equal(o2.data.flash_sale_id, null);
  assert.equal(o2.data.flash_cents, 0);
  // Availability stops showing the sale once it is sold out.
  const avail = await getAvailability(mainShowResourceId);
  assert.equal(tierFlashOf(avail, perfId, tierId), null);
  // Cancel the first order: the quota is freed and the sale applies
  // again to a new order.
  assert.equal((await transition(user1Token, o1.data.id, "cancel")).status, 200);
  const o3 = await tierOrder(user2Token, perfId, tierId);
  assert.equal(o3.status, 200, JSON.stringify(o3.data));
  assert.equal(o3.data.amount, 22400);
  assert.equal(o3.data.flash_sale_id, saleId);
  assert.equal(o3.data.flash_cents, 5600);
  const detail = await req(`/api/admin/flash-sales/${saleId}`, { token: adminToken });
  assert.equal(detail.data.flash_sale.sold_count, 1, "only the live order counts");
  assert.equal(detail.data.flash_sale.quota_remaining, 0);
});

test("order created inside the window keeps its snapshot price when paid after the window ends", async () => {
  const { perfId, tierId } = await makePerf();
  const sale = await createSale(adminToken, {
    performance_id: perfId, name: "T6 PCT20", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const saleId = sale.data.flash_sale.id;
  const o = await tierOrder(user1Token, perfId, tierId);
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 22400);
  // End the window now (the sale's own row is excluded from its
  // overlap check, and the new window still starts before it ends).
  const patched = await req(`/api/admin/flash-sales/${saleId}`, {
    method: "PATCH", token: adminToken, body: { end_at: iso(-30 * 60 * 1000) },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  const avail = await getAvailability(mainShowResourceId);
  assert.equal(tierFlashOf(avail, perfId, tierId), null);
  // Pay after the window: the snapshot price stands.
  await payThrough(user1Token, o.data.id);
  const got = await req(`/api/orders/${o.data.id}`, { token: user1Token });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.order.amount, 22400);
  assert.equal(got.data.order.flash_sale_id, saleId);
  assert.equal(got.data.order.flash_cents, 5600);
  assert.equal(got.data.order.status, "paid");
});

test("cross-shop: create/patch in shop 1 -> 403; shop-B performance in shop 1 -> 400; shop-B sale prices shop-B orders", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3flashadmin", pw, "R3 限时抢购子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 限时抢购分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  const shopBId = shop.data.shop.id;
  const shopAdminToken = await login("r3flashadmin", "Admin1234");
  // Shop admin cannot create a sale in shop 1 or patch / read a
  // shop-1 sale (cross-shop -> 403).
  assert.equal((await createSale(shopAdminToken, { shop_id: 1, performance_id: 1, name: "XSHOP", kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H) })).status, 403);
  assert.equal((await req(`/api/admin/flash-sales/${pctLiveSaleId}`, {
    method: "PATCH", token: shopAdminToken, body: { status: "disabled" },
  })).status, 403);
  assert.equal((await req(`/api/admin/flash-sales/${pctLiveSaleId}`, { token: shopAdminToken })).status, 403);
  // A shop-B show + performance (built by the shop admin, approved
  // by the shop admin — same flow as the R2 shows tests).
  const bRes = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R3 flash shop-B show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 50, shop_id: shopBId,
    },
  });
  assert.equal(bRes.status, 200, JSON.stringify(bRes.data));
  const bShowRes = bRes.data.resource.id;
  const bShow = await req("/api/shows", {
    method: "POST", token: shopAdminToken,
    body: { resource_id: bShowRes, title: "R3 限时抢购分店专场" },
  });
  assert.equal(bShow.status, 200, JSON.stringify(bShow.data));
  const bShowId = bShow.data.show.id;
  assert.equal((await req(`/api/admin/shows/${bShowId}`, {
    method: "PATCH", token: shopAdminToken, body: { status: "approved" },
  })).status, 200);
  const bPerf = await req(`/api/shows/${bShowId}/performances`, {
    method: "POST", token: shopAdminToken,
    body: { start_at: "2026-12-20T19:30:00", price_cents: 28000 },
  });
  assert.equal(bPerf.status, 200, JSON.stringify(bPerf.data));
  const bPerfId = bPerf.data.performance.id;
  assert.equal((await req(`/api/admin/performances/${bPerfId}`, {
    method: "PATCH", token: shopAdminToken, body: { status: "on_sale" },
  })).status, 200);
  const bTier = await req(`/api/performances/${bPerfId}/ticket-types`, {
    method: "POST", token: shopAdminToken,
    body: { name: "普通", price_cents: 28000, quota: 50 },
  });
  assert.equal(bTier.status, 200, JSON.stringify(bTier.data));
  const bTierId = bTier.data.ticket_type.id;
  // The shop admin CAN create in their own shop (no shop_id needed).
  const bSale = await createSale(shopAdminToken, {
    performance_id: bPerfId, name: "B PCT20", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(bSale.status, 200, JSON.stringify(bSale.data));
  assert.equal(bSale.data.flash_sale.shop_id, shopBId);
  // The platform admin cannot put a shop-B performance into a shop-1
  // sale (the performance does not belong to that shop) -> 400.
  assert.equal((await createSale(adminToken, {
    shop_id: 1, performance_id: bPerfId, name: "MISMATCH", kind: "pct", discount_pct: 10,
    start_at: iso(-H), end_at: iso(2 * H),
  })).status, 400);
  // A shop-B order gets the shop-B sale price.
  const ob2 = await orderAs(user1Token, {
    resourceId: bShowRes, quantity: 1,
    performance_id: bPerfId, ticket_type_id: bTierId,
  });
  assert.equal(ob2.status, 200, JSON.stringify(ob2.data));
  assert.equal(ob2.data.amount, 22400);
  assert.equal(ob2.data.flash_sale_id, bSale.data.flash_sale.id);
  assert.equal(ob2.data.flash_cents, 5600);
});

test("old-flow order never gets a flash price; i18n 418/231", async () => {
  // A live sale on a performance does not touch the plain old-flow
  // order on the same shop.
  const { perfId } = await makePerf();
  const sale = await createSale(adminToken, {
    performance_id: perfId, name: "T8 PCT20", kind: "pct", discount_pct: 20,
    start_at: iso(-H), end_at: iso(2 * H),
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const o = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 28000);
  assert.equal(o.data.flash_sale_id, null);
  assert.equal(o.data.flash_cents, 0);

  // i18n: 3 new flash-sale keys on both sides (347 -> 350, 151 -> 154); R3-4 adds 3 gift keys (350 -> 353, 154 -> 157); R3-5 adds 1 socMaoyan key H5-only (353 -> 354); R3-6 adds 6 stored-value keys (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206). R6-3 adds 2 creative keys H5 (397 -> 399), 1 mini (206 -> 207). R6-4 adds 6 match keys (399 -> 405) + 5 filter-bar keys mini-only (207 -> 218). R6-5 adds 13 comment/message-type keys (405 -> 418, 218 -> 231).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [418, 418, 418]);
  for (const k of ["flashSale", "flashSaleLeft", "flashSaleSaved"]) {
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
    assert.equal(blocks[lang].length, 231, `${lang} key count`);
    for (const k of ["flashSale", "flashSaleLeft", "flashSaleSaved"])
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
