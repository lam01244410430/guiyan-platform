// tests/r3-auto-coupons.test.mjs: R3-4 (row 17) — auto coupon gifting /
// 发券宝. Spawns server/server.mjs on TEST_PORT (default 3111) and talks
// to it over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: admin rule create/list/get + validation (bad trigger, bad
// conditions JSON, unknown condition key, min_spend on a tier rule,
// unknown coupon -> 400, cross-shop -> 403, anon/non-admin -> 403);
// first purchase -> gift row + inbox message with the code + GET
// /api/account/coupon-gifts lists it; no purchase -> no gift; second
// purchase does NOT re-gift the first-purchase rule; min_spend
// condition blocks (¥28000 < ¥30000) and allows (¥28000 >= ¥10000);
// tier upgrade -> gift (4th order pays past ¥1000 -> 银卡）; rule
// disabled -> no gift (and no retroactive gift when re-enabled);
// duplicate-trigger guard (pay then complete on the same first order
// still leaves exactly 1 gift); a gifted coupon is usable on the next
// order exactly like a normal coupon (same code path, per-user limit
// counts, second use -> 400) and cancelling the order that used it
// flips the gift back to 'gifted'; i18n key counts (H5 448,
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

async function plainOrder(token) {
  const o = await orderAs(token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 28000);
  return o.data.id;
}

async function createCoupon(token, body) {
  return req("/api/admin/coupons", { method: "POST", token, body });
}

async function createRule(token, body) {
  return req("/api/admin/coupon-rules", { method: "POST", token, body });
}

async function ruleDetail(token, ruleId) {
  return req(`/api/admin/coupon-rules/${ruleId}`, { token });
}

async function disableRule(token, ruleId) {
  const r = await req(`/api/admin/coupon-rules/${ruleId}`, {
    method: "PATCH", token, body: { status: "disabled" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

async function myGifts(token) {
  const r = await req("/api/account/coupon-gifts", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.coupon_gifts;
}

async function userId(username) {
  const row = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
  return row.rows[0].id;
}

let adminToken;
let demoToken;
let plainResourceId;

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
  // A deterministic ¥280 plain resource for old-flow orders (price
  // 28000 cents, stock 100). Fresh registered users hold no tier, so
  // their orders are full price until they earn one.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R3 auto plain", category: "digital", city: "南宁",
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

test("admin rule create/list/get: first_purchase + tier_upgraded; validation 400; anon/non-admin 403", async () => {
  // Empty list on a fresh DB; anonymous + demo -> 403 (never 401).
  const empty = await req("/api/admin/coupon-rules", { token: adminToken });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.coupon_rules, []);
  assert.equal((await req("/api/admin/coupon-rules")).status, 403);
  assert.equal((await req("/api/admin/coupon-rules", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/coupon-rules/99999", { token: adminToken })).status, 404);
  assert.equal((await createRule(demoToken, { name: "NOPE", trigger: "first_purchase", coupon_id: 1 })).status, 403);
  assert.equal((await createRule(undefined, { name: "NOPE", trigger: "first_purchase", coupon_id: 1 })).status, 403);

  const c1 = await createCoupon(adminToken, { code: "FIRST10", kind: "fixed", value_cents: 5000 });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  const c2 = await createCoupon(adminToken, { code: "TIER10", kind: "pct", discount_pct: 10 });
  assert.equal(c2.status, 200, JSON.stringify(c2.data));

  const fp = await createRule(adminToken, {
    name: "T1 首单赠券", trigger: "first_purchase", coupon_id: c1.data.coupon.id,
    conditions: { min_spend_cents: 10000 },
  });
  assert.equal(fp.status, 200, JSON.stringify(fp.data));
  assert.equal(fp.data.coupon_rule.name, "T1 首单赠券");
  assert.equal(fp.data.coupon_rule.trigger, "first_purchase");
  assert.equal(fp.data.coupon_rule.coupon_code, "FIRST10");
  assert.deepEqual(fp.data.coupon_rule.conditions, { min_spend_cents: 10000 });
  assert.equal(fp.data.coupon_rule.status, "active");
  assert.equal(fp.data.coupon_rule.gift_count, 0);
  const tu = await createRule(adminToken, {
    name: "T1 升级赠券", trigger: "tier_upgraded", coupon_id: c2.data.coupon.id,
  });
  assert.equal(tu.status, 200, JSON.stringify(tu.data));
  assert.deepEqual(tu.data.coupon_rule.conditions, {});

  // Validation -> 400: bad trigger, conditions not an object, unknown
  // condition key, min_spend on a tier rule, unknown coupon.
  const bad = [
    { name: "BAD", trigger: "birthday", coupon_id: c1.data.coupon.id },
    { name: "BAD", trigger: "first_purchase", coupon_id: c1.data.coupon.id, conditions: "x" },
    { name: "BAD", trigger: "first_purchase", coupon_id: c1.data.coupon.id, conditions: [1] },
    { name: "BAD", trigger: "first_purchase", coupon_id: c1.data.coupon.id, conditions: { foo: 1 } },
    { name: "BAD", trigger: "first_purchase", coupon_id: c1.data.coupon.id, conditions: { min_spend_cents: -1 } },
    { name: "BAD", trigger: "tier_upgraded", coupon_id: c2.data.coupon.id, conditions: { min_spend_cents: 100 } },
    { name: "BAD", trigger: "first_purchase", coupon_id: 99999 },
  ];
  for (const body of bad)
    assert.equal((await createRule(adminToken, body)).status, 400, JSON.stringify(body));

  // PATCH: trigger/coupon_id/shop_id are immutable -> 400; a valid
  // name/status patch round-trips; conditions on a tier rule -> 400.
  const fpId = fp.data.coupon_rule.id;
  const tuId = tu.data.coupon_rule.id;
  assert.equal((await req(`/api/admin/coupon-rules/${fpId}`, { method: "PATCH", token: adminToken, body: { trigger: "tier_upgraded" } })).status, 400);
  assert.equal((await req(`/api/admin/coupon-rules/${fpId}`, { method: "PATCH", token: adminToken, body: { coupon_id: c2.data.coupon.id } })).status, 400);
  assert.equal((await req(`/api/admin/coupon-rules/${fpId}`, { method: "PATCH", token: adminToken, body: { shop_id: 2 } })).status, 400);
  assert.equal((await req(`/api/admin/coupon-rules/${tuId}`, { method: "PATCH", token: adminToken, body: { conditions: { min_spend_cents: 100 } } })).status, 400);
  const renamed = await req(`/api/admin/coupon-rules/${fpId}`, { method: "PATCH", token: adminToken, body: { name: "T1 首单赠券改名" } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.coupon_rule.name, "T1 首单赠券改名");
  assert.equal((await req(`/api/admin/coupon-rules/${fpId}`, { method: "PATCH", token: demoToken, body: { status: "disabled" } })).status, 403);

  // Detail carries live gift counts + the gifts themselves (none yet).
  const detail = await ruleDetail(adminToken, fpId);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.coupon_rule.gift_count, 0);
  assert.deepEqual(detail.data.gifts, []);

  const list = await req("/api/admin/coupon-rules", { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.coupon_rules.length, 2);
  assert.deepEqual(
    list.data.coupon_rules.map((r) => r.name),
    ["T1 首单赠券改名", "T1 升级赠券"],
  );
  // Rules stay disabled after this test so later tests start clean.
  await disableRule(adminToken, fpId);
  await disableRule(adminToken, tuId);
});

test("first purchase -> gift row + inbox message + my gifts; pay then complete still leaves 1 gift", async () => {
  const c = await createCoupon(adminToken, { code: "FIRSTGIFT", kind: "fixed", value_cents: 5000 });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rule = await createRule(adminToken, {
    name: "T2 首单赠券", trigger: "first_purchase", coupon_id: c.data.coupon.id,
    conditions: { min_spend_cents: 10000 },
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const ruleId = rule.data.coupon_rule.id;

  const token = await register("autofirst", "Test1234");
  const uid = await userId("autofirst");
  // No purchase yet: no gifts, no gift message.
  assert.deepEqual(await myGifts(token), []);
  const before = await req("/api/messages", { token });
  assert.equal(before.data.messages.filter((m) => m.title === "优惠券到账").length, 0);

  const orderId = await plainOrder(token);
  await payThrough(token, orderId);
  // The gift: rule detail counts 1, trigger_ref is the order.
  const detail = await ruleDetail(adminToken, ruleId);
  assert.equal(detail.data.coupon_rule.gift_count, 1);
  assert.equal(detail.data.gifts.length, 1);
  assert.equal(detail.data.gifts[0].trigger_ref, `order:${orderId}`);
  assert.equal(detail.data.gifts[0].status, "gifted");
  assert.equal(detail.data.gifts[0].coupon_code, "FIRSTGIFT");
  assert.equal(detail.data.gifts[0].username, "autofirst");
  // The inbox message carries the code.
  const after = await req("/api/messages", { token });
  const giftMsg = after.data.messages.filter((m) => m.title === "优惠券到账");
  assert.equal(giftMsg.length, 1);
  assert.ok(giftMsg[0].content.includes("FIRSTGIFT"), giftMsg[0].content);
  // My gifts list shows it, and the events stream has the audit row.
  const mine = await myGifts(token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].coupon_code, "FIRSTGIFT");
  assert.equal(mine[0].status, "gifted");
  const ev = await pool.query(
    "SELECT COUNT(*) AS n FROM events WHERE user_id=$1 AND type='coupon_gift'",
    [uid],
  );
  assert.equal(Number(ev.rows[0].n), 1);
  // Complete is a second evaluation of the same trigger — the guard
  // holds: still exactly 1 gift, 1 message, 1 event row.
  assert.equal((await transition(token, orderId, "complete")).status, 200);
  const detail2 = await ruleDetail(adminToken, ruleId);
  assert.equal(detail2.data.coupon_rule.gift_count, 1);
  const after2 = await req("/api/messages", { token });
  assert.equal(after2.data.messages.filter((m) => m.title === "优惠券到账").length, 1);
  const ev2 = await pool.query(
    "SELECT COUNT(*) AS n FROM events WHERE user_id=$1 AND type='coupon_gift'",
    [uid],
  );
  assert.equal(Number(ev2.rows[0].n), 1);
  await disableRule(adminToken, ruleId);
});

test("no purchase -> no gift; second purchase does NOT re-gift the first-purchase rule", async () => {
  const c = await createCoupon(adminToken, { code: "SECONDGIFT", kind: "fixed", value_cents: 3000 });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rule = await createRule(adminToken, {
    name: "T3 首单赠券", trigger: "first_purchase", coupon_id: c.data.coupon.id,
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const ruleId = rule.data.coupon_rule.id;

  const token = await register("autosecond", "Test1234");
  assert.deepEqual(await myGifts(token), []);
  assert.equal((await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count, 0);

  const o1 = await plainOrder(token);
  await payThrough(token, o1);
  assert.equal((await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count, 1);
  assert.equal((await myGifts(token)).length, 1);
  // Second purchase: the rule does not fire again.
  const o2 = await plainOrder(token);
  await payThrough(token, o2);
  assert.equal((await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count, 1);
  assert.equal((await myGifts(token)).length, 1);
  await disableRule(adminToken, ruleId);
});

test("min_spend condition: ¥28000 order fires the ¥100 rule, not the ¥300 rule", async () => {
  const low = await createCoupon(adminToken, { code: "LOWGIFT", kind: "fixed", value_cents: 1000 });
  assert.equal(low.status, 200, JSON.stringify(low.data));
  const high = await createCoupon(adminToken, { code: "HIGHGIFT", kind: "fixed", value_cents: 1000 });
  assert.equal(high.status, 200, JSON.stringify(high.data));
  const lowRule = await createRule(adminToken, {
    name: "T4 低门槛", trigger: "first_purchase", coupon_id: low.data.coupon.id,
    conditions: { min_spend_cents: 10000 },
  });
  assert.equal(lowRule.status, 200, JSON.stringify(lowRule.data));
  const highRule = await createRule(adminToken, {
    name: "T4 高门槛", trigger: "first_purchase", coupon_id: high.data.coupon.id,
    conditions: { min_spend_cents: 30000 },
  });
  assert.equal(highRule.status, 200, JSON.stringify(highRule.data));
  const lowId = lowRule.data.coupon_rule.id;
  const highId = highRule.data.coupon_rule.id;

  const token = await register("autominspend", "Test1234");
  const o = await plainOrder(token);
  await payThrough(token, o);
  assert.equal((await ruleDetail(adminToken, lowId)).data.coupon_rule.gift_count, 1);
  assert.equal((await ruleDetail(adminToken, highId)).data.coupon_rule.gift_count, 0);
  const mine = await myGifts(token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].coupon_code, "LOWGIFT");
  await disableRule(adminToken, lowId);
  await disableRule(adminToken, highId);
});

test("tier upgrade -> gift: pays 1-3 no gift, 4th pay past ¥1000 -> 银卡 + gift", async () => {
  const c = await createCoupon(adminToken, { code: "TIERGIFT", kind: "pct", discount_pct: 10 });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rule = await createRule(adminToken, {
    name: "T5 升级赠券", trigger: "tier_upgraded", coupon_id: c.data.coupon.id,
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const ruleId = rule.data.coupon_rule.id;

  const token = await register("autosilver", "Test1234");
  for (let i = 0; i < 3; i++) {
    const o = await plainOrder(token);
    await payThrough(token, o);
    assert.equal(
      (await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count,
      0,
      `gift after pay ${i + 1}`,
    );
  }
  // 4th order: ¥840 + ¥280 = ¥1120 spending, past the ¥1000 Silver
  // threshold — the pay upgrades the tier and fires the rule.
  const o4 = await plainOrder(token);
  await payThrough(token, o4);
  const tier = await req("/api/account/tier", { token });
  assert.equal(tier.data.tier.name, "银卡会员");
  const detail = await ruleDetail(adminToken, ruleId);
  assert.equal(detail.data.coupon_rule.gift_count, 1);
  assert.equal(detail.data.gifts.length, 1);
  assert.equal(detail.data.gifts[0].trigger_ref, `tier:${tier.data.tier.id}`);
  assert.equal(detail.data.gifts[0].coupon_code, "TIERGIFT");
  const mine = await myGifts(token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].coupon_code, "TIERGIFT");
  await disableRule(adminToken, ruleId);
});

test("rule disabled -> no gift; re-enabling later does NOT gift retroactively", async () => {
  const c = await createCoupon(adminToken, { code: "OFFGIFT", kind: "fixed", value_cents: 1000 });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rule = await createRule(adminToken, {
    name: "T6 停用规则", trigger: "first_purchase", coupon_id: c.data.coupon.id,
    status: "disabled",
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const ruleId = rule.data.coupon_rule.id;

  const token = await register("autodisabled", "Test1234");
  const o1 = await plainOrder(token);
  await payThrough(token, o1);
  assert.equal((await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count, 0);
  assert.deepEqual(await myGifts(token), []);
  // Re-enable: the first purchase already happened, and the second
  // purchase is not a first purchase — still no gift.
  const on = await req(`/api/admin/coupon-rules/${ruleId}`, {
    method: "PATCH", token: adminToken, body: { status: "active" },
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const o2 = await plainOrder(token);
  await payThrough(token, o2);
  assert.equal((await ruleDetail(adminToken, ruleId)).data.coupon_rule.gift_count, 0);
  assert.deepEqual(await myGifts(token), []);
  await disableRule(adminToken, ruleId);
});

test("cross-shop: shop admin cannot create/patch/read shop-1 rules; shop-B coupon in a shop-1 rule -> 400", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3auto-admin", pw, "R3 自动发券子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 自动发券分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  const shopBId = shop.data.shop.id;
  const shopAdminToken = await login("r3auto-admin", "Admin1234");
  // A shop-1 rule to attempt against (created by the platform admin).
  const c1 = await createCoupon(adminToken, { code: "XSHOP1", kind: "fixed", value_cents: 1000 });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  const r1 = await createRule(adminToken, {
    name: "T7 主店规则", trigger: "first_purchase", coupon_id: c1.data.coupon.id,
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const r1Id = r1.data.coupon_rule.id;
  // Shop admin cannot create a rule in shop 1 or patch / read a
  // shop-1 rule (cross-shop -> 403).
  assert.equal((await createRule(shopAdminToken, { shop_id: 1, name: "XSHOP", trigger: "first_purchase", coupon_id: c1.data.coupon.id })).status, 403);
  assert.equal((await req(`/api/admin/coupon-rules/${r1Id}`, {
    method: "PATCH", token: shopAdminToken, body: { status: "disabled" },
  })).status, 403);
  assert.equal((await req(`/api/admin/coupon-rules/${r1Id}`, { token: shopAdminToken })).status, 403);
  // A shop-B coupon (created by the shop admin in their own shop).
  const cb = await createCoupon(shopAdminToken, { code: "BSHOP1", kind: "fixed", value_cents: 1000 });
  assert.equal(cb.status, 200, JSON.stringify(cb.data));
  // The platform admin cannot put a shop-B coupon into a shop-1 rule.
  assert.equal((await createRule(adminToken, {
    shop_id: 1, name: "MISMATCH", trigger: "first_purchase", coupon_id: cb.data.coupon.id,
  })).status, 400);
  // The shop admin CAN create in their own shop (no shop_id needed).
  const bRule = await createRule(shopAdminToken, {
    name: "T7 分店规则", trigger: "first_purchase", coupon_id: cb.data.coupon.id,
  });
  assert.equal(bRule.status, 200, JSON.stringify(bRule.data));
  assert.equal(bRule.data.coupon_rule.shop_id, shopBId);
  await disableRule(adminToken, r1Id);
  await disableRule(shopAdminToken, bRule.data.coupon_rule.id);
});

test("gifted coupon is usable on the next order like a normal coupon; cancelling that order restores the gift", async () => {
  const c = await createCoupon(adminToken, { code: "USEGIFT", kind: "pct", discount_pct: 10 });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rule = await createRule(adminToken, {
    name: "T8 首单赠券", trigger: "first_purchase", coupon_id: c.data.coupon.id,
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const ruleId = rule.data.coupon_rule.id;

  const token = await register("autouse", "Test1234");
  const o1 = await plainOrder(token);
  await payThrough(token, o1);
  assert.equal((await myGifts(token)).length, 1);
  assert.equal((await myGifts(token))[0].status, "gifted");
  // Next order uses the gifted code: ¥28000 - 10% = ¥25200.
  const o2 = await orderAs(token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-06",
    coupon_code: "USEGIFT",
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 25200);
  assert.equal(o2.data.coupon_cents, 2800);
  const mine = await myGifts(token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "redeemed");
  assert.equal(mine[0].redeemed_order_id, o2.data.id);
  // Per-user limit 1 is consumed: a second use fails.
  const o3 = await orderAs(token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-07",
    coupon_code: "USEGIFT",
  });
  assert.equal(o3.status, 400, JSON.stringify(o3.data));
  // Cancel the order that used the gift: the redemption is released
  // and the gift flips back to 'gifted' — usable again.
  assert.equal((await transition(token, o2.data.id, "cancel")).status, 200);
  const mine2 = await myGifts(token);
  assert.equal(mine2.length, 1);
  assert.equal(mine2[0].status, "gifted");
  assert.equal(mine2[0].redeemed_order_id, null);
  const o4 = await orderAs(token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-08",
    coupon_code: "USEGIFT",
  });
  assert.equal(o4.status, 200, JSON.stringify(o4.data));
  assert.equal(o4.data.amount, 25200);
  await disableRule(adminToken, ruleId);
});

test("r3-auto-coupons i18n: H5 448 keys/language, miniprogram 262, equal sets", async () => {
  // i18n: 3 new gift-coupon keys on both sides (350 -> 353, 154 -> 157); R3-5 adds 1 socMaoyan key H5-only (353 -> 354); R3-6 adds 6 stored-value keys (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206). R6-3 adds 2 creative keys H5 (397 -> 399), 1 mini (206 -> 207). R6-4 adds 6 match keys (399 -> 405) + 5 filter-bar keys mini-only (207 -> 218). R6-5 adds 13 comment/message-type keys (405 -> 418, 218 -> 231). R6-6 adds 5 escrow keys (418 -> 423, 231 -> 236). R7-2 adds 4 voice keys H5 (423 -> 427), 5 mini (236 -> 241).; R7-3 adds 1 knowledge-graph key (427 -> 428, 241 -> 242).; R7-6 adds 20 context/itinerary keys (428 -> 448, 242 -> 262).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of ["giftCouponTitle", "giftCouponEmpty", "giftCouponUsed"]) {
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
    for (const k of ["giftCouponTitle", "giftCouponEmpty", "giftCouponUsed"])
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
  // Anonymous users cannot list gifts (401), and the endpoint is
  // scoped to the caller — another user sees none of these gifts.
  assert.equal((await req("/api/account/coupon-gifts")).status, 401);
});
