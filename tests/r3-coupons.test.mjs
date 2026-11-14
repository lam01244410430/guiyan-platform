// tests/r3-coupons.test.mjs: R3-2 (row 15) — coupons.
// Spawns server/server.mjs on TEST_PORT (default 3111) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: admin create/list/get + validation (kind/value rules, code
// format + normalization, date window, duplicate code -> 409, cross-shop
// -> 403); fixed coupon redeems exactly (¥280 - ¥50 -> ¥230) with the
// redemption row + live stats; expired / not-yet-valid / disabled -> 400;
// minimum spend checked on the AFTER-tier remainder; per-user limit;
// quota exhausted -> 400; tier discount + coupon stacking math exact
// (¥28000 -> 5% tier -> ¥26600 -> 10% coupon -> ¥23940); cancel and
// refund approval release the redemption (quota + per-user restored);
// cross-shop code isolation (same code in two shops is fine, a
// shop-B-only code is not found in shop 1); i18n key counts (H5 448,
// miniprogram 262, equal sets).
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

async function createCoupon(token, body) {
  return req("/api/admin/coupons", { method: "POST", token, body });
}

let adminToken;
let demoToken;
let user1Token;
let user2Token;
let silverToken;
let plainResourceId;
let save5000Id;
let pct10Id;

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
  user1Token = await register("couponuser1", "Test1234");
  user2Token = await register("couponuser2", "Test1234");
  silverToken = await register("couponsilver", "Test1234");
  // A deterministic ¥280 plain resource for old-flow orders (price
  // 28000 cents, stock 100). Fresh registered users hold no tier, so
  // their orders are full price until they earn one.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R3 coupons plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("admin coupon create/list/get: fixed + pct; code normalized; validation 400; duplicate 409; non-admin 403", async () => {
  // Empty list on a fresh DB; anonymous + demo -> 403 (never 401).
  const empty = await req("/api/admin/coupons", { token: adminToken });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.coupons, []);
  assert.equal((await req("/api/admin/coupons")).status, 403);
  assert.equal((await req("/api/admin/coupons", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/coupons/99999", { token: adminToken })).status, 404);
  assert.equal((await createCoupon(demoToken, { code: "NOPE1", kind: "fixed", value_cents: 100 })).status, 403);
  assert.equal((await createCoupon(undefined, { code: "NOPE1", kind: "fixed", value_cents: 100 })).status, 403);

  const fixed = await createCoupon(adminToken, { code: "SAVE5000", kind: "fixed", value_cents: 5000 });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
  save5000Id = fixed.data.coupon.id;
  assert.equal(fixed.data.coupon.code, "SAVE5000");
  assert.equal(fixed.data.coupon.value_cents, 5000);
  assert.equal(fixed.data.coupon.discount_pct, null);
  assert.equal(fixed.data.coupon.redemption_count, 0);
  assert.equal(fixed.data.coupon.total_discount_cents, 0);
  const pct = await createCoupon(adminToken, { code: "PCT10", kind: "pct", discount_pct: 10 });
  assert.equal(pct.status, 200, JSON.stringify(pct.data));
  pct10Id = pct.data.coupon.id;
  assert.equal(pct.data.coupon.discount_pct, 10);
  assert.equal(pct.data.coupon.value_cents, null);
  // Lowercase code is normalized to uppercase on create.
  const lower = await createCoupon(adminToken, { code: "save2000", kind: "fixed", value_cents: 2000 });
  assert.equal(lower.status, 200, JSON.stringify(lower.data));
  assert.equal(lower.data.coupon.code, "SAVE2000");

  // Same-shop duplicate code -> 409 (both spellings: the normalized
  // form collides too).
  assert.equal((await createCoupon(adminToken, { code: "SAVE5000", kind: "fixed", value_cents: 1 })).status, 409);
  assert.equal((await createCoupon(adminToken, { code: "save5000", kind: "fixed", value_cents: 1 })).status, 409);
  // Validation -> 400: code too short / bad chars, wrong kind,
  // fixed with a pct, pct with a value, pct over 100, negative min
  // spend, quota 0, per-user 0, inverted date window, bad dates.
  assert.equal((await createCoupon(adminToken, { code: "AB", kind: "fixed", value_cents: 1 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "BAD-CODE", kind: "fixed", value_cents: 1 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "KIND1", kind: "weird", value_cents: 1 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "MIX1", kind: "fixed", value_cents: 1, discount_pct: 10 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "MIX2", kind: "pct", discount_pct: 10, value_cents: 1 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "PCT101", kind: "pct", discount_pct: 101 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "NEG1", kind: "fixed", value_cents: 1, min_spend_cents: -1 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "QUOTA0", kind: "fixed", value_cents: 1, quota: 0 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "PERU0", kind: "fixed", value_cents: 1, per_user_limit: 0 })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "WIN1", kind: "fixed", value_cents: 1, valid_from: "2027-01-02T00:00:00.000Z", valid_until: "2027-01-01T00:00:00.000Z" })).status, 400);
  assert.equal((await createCoupon(adminToken, { code: "DATE1", kind: "fixed", value_cents: 1, valid_from: "not-a-date" })).status, 400);

  // PATCH: code/shop_id are immutable -> 400; kind switch without
  // the new kind's value -> 400; a valid switch round-trips on a
  // throwaway coupon (left as pct 20, unused elsewhere).
  const patch1 = await createCoupon(adminToken, { code: "PATCH1", kind: "fixed", value_cents: 100 });
  assert.equal(patch1.status, 200, JSON.stringify(patch1.data));
  const patch1Id = patch1.data.coupon.id;
  assert.equal((await req(`/api/admin/coupons/${patch1Id}`, { method: "PATCH", token: adminToken, body: { code: "OTHER1" } })).status, 400);
  assert.equal((await req(`/api/admin/coupons/${patch1Id}`, { method: "PATCH", token: adminToken, body: { shop_id: 2 } })).status, 400);
  assert.equal((await req(`/api/admin/coupons/${patch1Id}`, { method: "PATCH", token: adminToken, body: { kind: "pct" } })).status, 400);
  const switched = await req(`/api/admin/coupons/${patch1Id}`, { method: "PATCH", token: adminToken, body: { kind: "pct", discount_pct: 20 } });
  assert.equal(switched.status, 200, JSON.stringify(switched.data));
  assert.equal(switched.data.coupon.kind, "pct");
  assert.equal(switched.data.coupon.discount_pct, 20);
  assert.equal(switched.data.coupon.value_cents, null);
  // Disable + re-enable round-trips (restored, so later tests see an
  // active coupon).
  const disabled = await req(`/api/admin/coupons/${save5000Id}`, { method: "PATCH", token: adminToken, body: { status: "disabled" } });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  assert.equal(disabled.data.coupon.status, "disabled");
  const enabled = await req(`/api/admin/coupons/${save5000Id}`, { method: "PATCH", token: adminToken, body: { status: "active" } });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  assert.equal(enabled.data.coupon.status, "active");
  assert.equal((await req(`/api/admin/coupons/${patch1Id}`, { method: "PATCH", token: demoToken, body: { status: "disabled" } })).status, 403);

  const list = await req("/api/admin/coupons", { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.coupons.length, 4);
  assert.deepEqual(
    list.data.coupons.map((c) => c.code),
    ["SAVE5000", "PCT10", "SAVE2000", "PATCH1"],
  );
});

test("fixed coupon redeems exactly: ¥280 - ¥50 -> ¥230; redemption row + stats count", async () => {
  const o = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "save5000",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 23000);
  assert.equal(o.data.discount_cents, 0);
  assert.equal(o.data.coupon_id, save5000Id);
  assert.equal(o.data.coupon_cents, 5000);
  const row = await pool.query(
    "SELECT amount, coupon_id, coupon_cents FROM orders WHERE id=$1",
    [o.data.id],
  );
  assert.equal(row.rows[0].amount, 23000);
  assert.equal(row.rows[0].coupon_id, save5000Id);
  assert.equal(row.rows[0].coupon_cents, 5000);
  const red = await pool.query(
    "SELECT coupon_id, user_id, order_id, amount_cents FROM coupon_redemptions WHERE order_id=$1",
    [o.data.id],
  );
  assert.equal(red.rows.length, 1);
  assert.equal(red.rows[0].coupon_id, save5000Id);
  assert.equal(red.rows[0].amount_cents, 5000);
  // Live stats on the detail endpoint and on the list agree.
  const detail = await req(`/api/admin/coupons/${save5000Id}`, { token: adminToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.coupon.redemption_count, 1);
  assert.equal(detail.data.coupon.total_discount_cents, 5000);
  assert.equal(detail.data.redemptions.length, 1);
  assert.equal(detail.data.redemptions[0].amount_cents, 5000);
  assert.equal(detail.data.redemptions[0].order_id, o.data.id);
  const list = await req("/api/admin/coupons", { token: adminToken });
  const mine = list.data.coupons.find((c) => c.id === save5000Id);
  assert.equal(mine.redemption_count, 1);
  assert.equal(mine.total_discount_cents, 5000);
  // The order detail carries the coupon snapshot too.
  const got = await req(`/api/orders/${o.data.id}`, { token: user1Token });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.order.coupon_id, save5000Id);
  assert.equal(got.data.order.coupon_cents, 5000);
});

test("expired / not-yet-valid / disabled coupon -> 400; unknown code -> 400", async () => {
  const expired = await createCoupon(adminToken, {
    code: "EXPIRED1", kind: "fixed", value_cents: 1000,
    valid_until: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(expired.status, 200, JSON.stringify(expired.data));
  const future = await createCoupon(adminToken, {
    code: "FUTURE1", kind: "fixed", value_cents: 1000,
    valid_from: "2027-01-01T00:00:00.000Z",
  });
  assert.equal(future.status, 200, JSON.stringify(future.data));
  const off = await createCoupon(adminToken, {
    code: "OFF1", kind: "fixed", value_cents: 1000, status: "disabled",
  });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  for (const code of ["EXPIRED1", "FUTURE1", "OFF1", "NOPE1234"]) {
    const o = await orderAs(user2Token, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
      coupon_code: code,
    });
    assert.equal(o.status, 400, `${code} -> ${o.status} ${JSON.stringify(o.data)}`);
  }
  // No redemption rows were recorded for the refused orders.
  const n = await pool.query("SELECT COUNT(*) AS n FROM coupon_redemptions");
  assert.equal(Number(n.rows[0].n), 1);
});

test("min spend is checked on the AFTER-tier remainder (Silver: base ¥28000, tier -¥1400, remainder ¥26600)", async () => {
  // Earn Silver first: 4 completed ¥280 orders = ¥1120 spending.
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
  // min_spend 27000 sits between the base (28000) and the remainder
  // (26600): it must FAIL, because the check is on the remainder.
  const tooHigh = await createCoupon(adminToken, {
    code: "MIN27000", kind: "fixed", value_cents: 100, min_spend_cents: 27000,
  });
  assert.equal(tooHigh.status, 200, JSON.stringify(tooHigh.data));
  const refused = await orderAs(silverToken, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "MIN27000",
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  // min_spend 26000 is below the remainder: it applies, ¥26600-¥100.
  const ok = await createCoupon(adminToken, {
    code: "MIN26000", kind: "fixed", value_cents: 100, min_spend_cents: 26000,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const o = await orderAs(silverToken, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "MIN26000",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 26500);
  assert.equal(o.data.discount_cents, 1400);
  assert.equal(o.data.coupon_cents, 100);
});

test("per-user limit: second use by the same user -> 400; quota exhausted -> 400", async () => {
  const once = await createCoupon(adminToken, {
    code: "ONCE1", kind: "fixed", value_cents: 1000, per_user_limit: 1,
  });
  assert.equal(once.status, 200, JSON.stringify(once.data));
  const o1 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "ONCE1",
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.amount, 27000);
  // Same user, second order with the same coupon -> 400.
  assert.equal((await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "ONCE1",
  })).status, 400);
  // A different user can still use it (per-user limit, not global).
  const o2 = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "ONCE1",
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 27000);
  assert.equal((await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "ONCE1",
  })).status, 400);

  // Quota: one slot total; the second user is refused once it is gone.
  const quota = await createCoupon(adminToken, {
    code: "QUOTA1", kind: "fixed", value_cents: 1000, quota: 1, per_user_limit: 5,
  });
  assert.equal(quota.status, 200, JSON.stringify(quota.data));
  const q1 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "QUOTA1",
  });
  assert.equal(q1.status, 200, JSON.stringify(q1.data));
  assert.equal((await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "QUOTA1",
  })).status, 400);
});

test("tier + coupon stacking math exact: ¥28000 -> 5% tier -> ¥26600 -> 10% coupon -> ¥23940; fixed on top of tier -> ¥21600", async () => {
  const pct = await orderAs(silverToken, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "PCT10",
  });
  assert.equal(pct.status, 200, JSON.stringify(pct.data));
  assert.equal(pct.data.amount, 23940);
  assert.equal(pct.data.discount_cents, 1400);
  assert.equal(pct.data.coupon_id, pct10Id);
  assert.equal(pct.data.coupon_cents, 2660);
  const row = await pool.query(
    "SELECT amount, discount_cents, tier_id, coupon_id, coupon_cents FROM orders WHERE id=$1",
    [pct.data.id],
  );
  assert.equal(row.rows[0].amount, 23940);
  assert.equal(row.rows[0].discount_cents, 1400);
  assert.equal(row.rows[0].coupon_id, pct10Id);
  assert.equal(row.rows[0].coupon_cents, 2660);
  // Fixed coupon on the same remainder: ¥26600 - ¥5000 = ¥21600.
  const fixed = await orderAs(silverToken, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "SAVE5000",
  });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
  assert.equal(fixed.data.amount, 21600);
  assert.equal(fixed.data.discount_cents, 1400);
  assert.equal(fixed.data.coupon_cents, 5000);
});

test("cancel releases the redemption (quota + per-user restored); refund approval releases too", async () => {
  const rel1 = await createCoupon(adminToken, {
    code: "REL1", kind: "fixed", value_cents: 1000, quota: 1, per_user_limit: 1,
  });
  assert.equal(rel1.status, 200, JSON.stringify(rel1.data));
  const rel1Id = rel1.data.coupon.id;
  const o1 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "REL1",
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  let detail = await req(`/api/admin/coupons/${rel1Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 1);
  assert.equal(detail.data.coupon.total_discount_cents, 1000);
  // Second use is refused while the first order stands.
  assert.equal((await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "REL1",
  })).status, 400);
  // Cancel the order: the redemption is released, stats drop to 0.
  assert.equal((await transition(user1Token, o1.data.id, "cancel")).status, 200);
  detail = await req(`/api/admin/coupons/${rel1Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 0);
  assert.equal(detail.data.coupon.total_discount_cents, 0);
  // The same user can use the coupon again (quota + per-user restored).
  const o2 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "REL1",
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 27000);
  detail = await req(`/api/admin/coupons/${rel1Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 1);
  // The cancelled order keeps its coupon snapshot as history.
  const gone = await pool.query(
    "SELECT coupon_id, coupon_cents, status FROM orders WHERE id=$1",
    [o1.data.id],
  );
  assert.equal(gone.rows[0].coupon_id, rel1Id);
  assert.equal(gone.rows[0].coupon_cents, 1000);
  assert.equal(gone.rows[0].status, "cancelled");

  // Refund path: pay -> refund request (still counted) -> admin
  // approval (released, reusable).
  const rel2 = await createCoupon(adminToken, {
    code: "REL2", kind: "fixed", value_cents: 1000, quota: 1, per_user_limit: 1,
  });
  assert.equal(rel2.status, 200, JSON.stringify(rel2.data));
  const rel2Id = rel2.data.coupon.id;
  const o3 = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "REL2",
  });
  assert.equal(o3.status, 200, JSON.stringify(o3.data));
  await payThrough(user2Token, o3.data.id);
  detail = await req(`/api/admin/coupons/${rel2Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 1);
  assert.equal((await transition(user2Token, o3.data.id, "refund", { reason: "R3 coupon release test" })).status, 200);
  detail = await req(`/api/admin/coupons/${rel2Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 1, "refund_requested does not release yet");
  assert.equal((await transition(adminToken, o3.data.id, "approveRefund", {})).status, 200);
  detail = await req(`/api/admin/coupons/${rel2Id}`, { token: adminToken });
  assert.equal(detail.data.coupon.redemption_count, 0);
  const o4 = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "REL2",
  });
  assert.equal(o4.status, 200, JSON.stringify(o4.data));
  assert.equal(o4.data.amount, 27000);
});

test("cross-shop: create/patch in shop 1 -> 403; same code in two shops is fine; shop-B-only code is not found in shop 1", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3couponadmin", pw, "R3 优惠券子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 优惠券分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  const shopBId = shop.data.shop.id;
  const shopAdminToken = await login("r3couponadmin", "Admin1234");
  // Shop admin cannot create a coupon in shop 1 or patch a shop-1
  // coupon (cross-shop -> 403).
  assert.equal((await createCoupon(shopAdminToken, { shop_id: 1, code: "XSHOP1", kind: "fixed", value_cents: 1 })).status, 403);
  assert.equal((await req(`/api/admin/coupons/${save5000Id}`, {
    method: "PATCH", token: shopAdminToken, body: { status: "disabled" },
  })).status, 403);
  assert.equal((await req(`/api/admin/coupons/${save5000Id}`, { token: shopAdminToken })).status, 403);
  // The shop admin CAN create in their own shop — even with the same
  // code as shop 1 (uniqueness is per shop).
  const bCoupon = await createCoupon(shopAdminToken, { code: "SAVE5000", kind: "fixed", value_cents: 7000 });
  assert.equal(bCoupon.status, 200, JSON.stringify(bCoupon.data));
  assert.equal(bCoupon.data.coupon.shop_id, shopBId);
  const bOnly = await createCoupon(shopAdminToken, { code: "BONLY1", kind: "fixed", value_cents: 1000 });
  assert.equal(bOnly.status, 200, JSON.stringify(bOnly.data));
  const bRes = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R3 coupons shop-B plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 50, shop_id: shopBId,
    },
  });
  assert.equal(bRes.status, 200, JSON.stringify(bRes.data));
  // Shop-B order with the shared code redeems the SHOP-B coupon (¥70
  // off, not shop 1's ¥50).
  const ob = await orderAs(user1Token, {
    resourceId: bRes.data.resource.id, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "save5000",
  });
  assert.equal(ob.status, 200, JSON.stringify(ob.data));
  assert.equal(ob.data.amount, 21000);
  assert.equal(ob.data.coupon_id, bCoupon.data.coupon.id);
  assert.equal(ob.data.coupon_cents, 7000);
  // A shop-B-only code is not found in shop 1 -> 400.
  assert.equal((await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    coupon_code: "BONLY1",
  })).status, 400);
});

test("r3-coupons i18n: H5 448 keys/language, miniprogram 262, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of ["couponCode", "couponCodePh", "couponSaved"]) {
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
    assert.equal(blocks[lang].length, 262, `${lang} key count`);
    for (const k of ["couponCode", "couponCodePh", "couponSaved"])
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
