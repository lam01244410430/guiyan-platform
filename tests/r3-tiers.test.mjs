// tests/r3-tiers.test.mjs: R3-1 (rows 24, 14) — member tiers + tier discount.
// Spawns server/server.mjs on TEST_PORT (default 3111) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: 4 default main-shop tiers on a fresh DB; fresh user starts
// with no stored tier; spending >= ¥1000 upgrades to Silver (stored
// tier_id + GET /api/account/tier agree); a Silver order applies the
// exact 5% discount (¥28000 -> ¥26600, discount_cents 1400, tier_id
// snapshotted); a refund approval drops spending below the threshold
// -> downgrade to 普通会员 and the next order is full price; cross-shop
// tier create/patch -> 403; a main-shop Silver gets no discount on a
// shop-B order (tiers are per shop); validation (discount_pct > 100 /
// negative threshold -> 400; unknown tier PATCH -> 404); anonymous tier
// read -> 401; i18n key counts (H5 372, miniprogram 181, equal sets).
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

async function tierOfUser(username) {
  const row = await pool.query(
    "SELECT u.tier_id, t.name FROM users u LEFT JOIN member_tiers t ON t.id=u.tier_id WHERE u.username=$1",
    [username],
  );
  return row.rows[0];
}

async function tierIdByName(name, shopId = 1) {
  const row = await pool.query(
    "SELECT id FROM member_tiers WHERE name=$1 AND shop_id=$2",
    [name, shopId],
  );
  return row.rows[0]?.id;
}

let adminToken;
let demoToken;
let user1Token;
let user2Token;
let plainResourceId;
let shopBId;
let shopBResourceId;
let shopAdminToken;

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
  user1Token = await register("tieruser1", "Test1234");
  user2Token = await register("tieruser2", "Test1234");
  // A deterministic ¥280 plain resource for old-flow orders (price
  // 28000 cents, stock 100). Old-flow orders keep the exact pre-R3
  // behaviour apart from the tier discount.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R3 tiers plain", category: "digital", city: "南宁",
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

test("seed: 4 default main-shop tiers; anonymous tier read -> 401; unknown shop -> 404", async () => {
  const list = await req("/api/shops/1/member-tiers");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.member_tiers.length, 4);
  assert.deepEqual(
    list.data.member_tiers.map((t) => [t.name, t.min_spend_cents, t.discount_pct]),
    [
      ["普通会员", 0, 0],
      ["银卡会员", 100000, 5],
      ["金卡会员", 500000, 10],
      ["钻石会员", 1000000, 15],
    ],
  );
  assert.equal((await req("/api/shops/99999/member-tiers")).status, 404);
  assert.equal((await req("/api/account/tier")).status, 401);
  const adminList = await req("/api/admin/member-tiers", { token: adminToken });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.data.member_tiers.length, 4);
});

test("fresh user starts with no stored tier; spending 0; next tier 银卡", async () => {
  const r = await req("/api/account/tier", { token: user1Token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tier, null);
  assert.equal(r.data.spending_cents, 0);
  assert.equal(r.data.next_tier.name, "银卡会员");
  assert.equal(r.data.remaining_cents, 100000);
  assert.equal(r.data.discount_pct, 0);
  const row = await tierOfUser("tieruser1");
  assert.equal(row.tier_id, null);
});

test("spend enough -> upgrade to Silver at pay; stored tier_id + GET agree", async () => {
  // 3 completed orders: ¥840 spending, still 普通会员.
  for (let i = 0; i < 3; i++) {
    const o = await orderAs(user1Token, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.amount, 28000);
    assert.equal(o.data.discount_cents, 0);
    await completeThrough(user1Token, o.data.id);
  }
  let r = await req("/api/account/tier", { token: user1Token });
  assert.equal(r.data.tier.name, "普通会员");
  assert.equal(r.data.spending_cents, 84000);
  assert.equal(r.data.next_tier.name, "银卡会员");
  assert.equal(r.data.remaining_cents, 16000);
  assert.equal((await tierOfUser("tieruser1")).tier_id, await tierIdByName("普通会员"));
  // 4th order: pay takes spending to ¥1120 -> Silver at pay (before
  // the order is even completed — pay is a spending-changing trigger).
  const o4 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o4.status, 200, JSON.stringify(o4.data));
  await payThrough(user1Token, o4.data.id);
  r = await req("/api/account/tier", { token: user1Token });
  assert.equal(r.data.tier.name, "银卡会员");
  assert.equal(r.data.spending_cents, 112000);
  assert.equal(r.data.next_tier.name, "金卡会员");
  assert.equal(r.data.remaining_cents, 388000);
  assert.equal(r.data.discount_pct, 5);
  assert.equal((await tierOfUser("tieruser1")).tier_id, await tierIdByName("银卡会员"));
  // Completing keeps Silver (idempotent re-check, no spending change).
  assert.equal((await transition(user1Token, o4.data.id, "complete")).status, 200);
  r = await req("/api/account/tier", { token: user1Token });
  assert.equal(r.data.tier.name, "银卡会员");
});

test("Silver order applies the exact 5% discount (tier price first, then member discount)", async () => {
  const silverId = await tierIdByName("银卡会员");
  const o1 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.amount, 26600);
  assert.equal(o1.data.discount_cents, 1400);
  assert.equal(o1.data.tier_id, silverId);
  const row1 = await pool.query(
    "SELECT amount, discount_cents, tier_id FROM orders WHERE id=$1",
    [o1.data.id],
  );
  assert.equal(row1.rows[0].amount, 26600);
  assert.equal(row1.rows[0].discount_cents, 1400);
  assert.equal(row1.rows[0].tier_id, silverId);
  // Qty 2: base ¥560 -> discount ¥28 -> ¥532.
  const o2 = await orderAs(user1Token, {
    resourceId: plainResourceId, quantity: 2, booking_date: "2026-12-05",
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.amount, 53200);
  assert.equal(o2.data.discount_cents, 2800);
  assert.equal(o2.data.tier_id, silverId);
});

test("downgrade: refund approval drops spending below the threshold -> back to 普通会员", async () => {
  // Second user, marginal upgrade: 3 completed (¥840, 普通会员), then
  // a 4th paid order (¥1120, Silver at pay).
  for (let i = 0; i < 3; i++) {
    const o = await orderAs(user2Token, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    await completeThrough(user2Token, o.data.id);
  }
  const o4 = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o4.status, 200, JSON.stringify(o4.data));
  await payThrough(user2Token, o4.data.id);
  let r = await req("/api/account/tier", { token: user2Token });
  assert.equal(r.data.tier.name, "银卡会员");
  // Refund the paid 4th order; the admin approval drops spending to
  // ¥840 -> downgrade. The refund request alone (still a paid-derived
  // status) does not downgrade yet.
  assert.equal((await transition(user2Token, o4.data.id, "refund", { reason: "R3 downgrade test" })).status, 200);
  r = await req("/api/account/tier", { token: user2Token });
  assert.equal(r.data.tier.name, "银卡会员");
  assert.equal((await transition(adminToken, o4.data.id, "approveRefund", {})).status, 200);
  r = await req("/api/account/tier", { token: user2Token });
  assert.equal(r.data.tier.name, "普通会员");
  assert.equal(r.data.spending_cents, 84000);
  assert.equal(r.data.discount_pct, 0);
  assert.equal((await tierOfUser("tieruser2")).tier_id, await tierIdByName("普通会员"));
  // After the downgrade the next order is full price again.
  const o5 = await orderAs(user2Token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o5.status, 200, JSON.stringify(o5.data));
  assert.equal(o5.data.amount, 28000);
  assert.equal(o5.data.discount_cents, 0);
});

test("cross-shop tier create/patch -> 403; main-shop Silver gets no discount on a shop-B order", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3shopadmin", pw, "R3 子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r3shopadmin", "Admin1234");
  // Shop admin cannot create a tier in shop 1 (cross-shop -> 403) or
  // patch a shop-1 tier; anonymous and non-admin admin writes -> 403.
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST", token: shopAdminToken,
    body: { shop_id: 1, name: "越权等级", min_spend_cents: 0, discount_pct: 1 },
  })).status, 403);
  assert.equal((await req(`/api/admin/member-tiers/${await tierIdByName("银卡会员")}`, {
    method: "PATCH", token: shopAdminToken, body: { discount_pct: 99 },
  })).status, 403);
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST", token: demoToken,
    body: { name: "越权等级", min_spend_cents: 0, discount_pct: 1 },
  })).status, 403);
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST",
    body: { name: "越权等级", min_spend_cents: 0, discount_pct: 1 },
  })).status, 403);
  // The shop admin CAN create a tier in their own shop — with a
  // threshold user1 can never reach there, so it must not discount.
  const bTier = await req("/api/admin/member-tiers", {
    method: "POST", token: shopAdminToken,
    body: { name: "分店钻石", min_spend_cents: 99999999, discount_pct: 50 },
  });
  assert.equal(bTier.status, 200, JSON.stringify(bTier.data));
  assert.equal(bTier.data.member_tier.shop_id, shopBId);
  const bRes = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R3 shop-B plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 50, shop_id: shopBId,
    },
  });
  assert.equal(bRes.status, 200, JSON.stringify(bRes.data));
  shopBResourceId = bRes.data.resource.id;
  // user1 is Silver in shop 1, but shop B has its own tiers — the
  // shop-B order is full price, no main-shop discount leaks across.
  const o = await orderAs(user1Token, {
    resourceId: shopBResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 28000);
  assert.equal(o.data.discount_cents, 0);
  assert.equal(o.data.tier_id, null);
});

test("validation: discount_pct > 100 / negative threshold -> 400; unknown tier PATCH -> 404; admin list as demo -> 403", async () => {
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST", token: adminToken,
    body: { name: "坏等级", min_spend_cents: 0, discount_pct: 101 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST", token: adminToken,
    body: { name: "坏等级", min_spend_cents: -1, discount_pct: 5 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-tiers", {
    method: "POST", token: adminToken,
    body: { min_spend_cents: 0, discount_pct: 5 },
  })).status, 400);
  const silverId = await tierIdByName("银卡会员");
  assert.equal((await req(`/api/admin/member-tiers/${silverId}`, {
    method: "PATCH", token: adminToken, body: { discount_pct: 101 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-tiers/99999", {
    method: "PATCH", token: adminToken, body: { discount_pct: 5 },
  })).status, 404);
  assert.equal((await req("/api/admin/member-tiers", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/member-tiers")).status, 403);
  // A valid PATCH round-trips (and is restored, so the shared seed is
  // left as found for later files).
  const patched = await req(`/api/admin/member-tiers/${silverId}`, {
    method: "PATCH", token: adminToken, body: { benefits: "R3 test" },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.member_tier.benefits, "R3 test");
  const restored = await req(`/api/admin/member-tiers/${silverId}`, {
    method: "PATCH", token: adminToken, body: { benefits: "购票享 95 折" },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
});

test("r3-tiers i18n: H5 423 keys/language, miniprogram 236, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [423, 423, 423]);
  for (const k of ["memberTierTitle", "memberTierCurrent", "memberTierNext", "memberTierSpendMore", "memberTierDiscount"]) {
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
    assert.equal(blocks[lang].length, 236, `${lang} key count`);
    for (const k of ["memberTierTitle", "memberTierCurrent", "memberTierNext", "memberTierSpendMore", "memberTierDiscount"])
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
