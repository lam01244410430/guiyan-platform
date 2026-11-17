// tests/p1-spending-90d.test.mjs: P1 G5 — rolling 90-day consumption
// stats. Spawns server/server.mjs on TEST_PORT (default 3143) and talks
// to it over HTTP. DATABASE_URL must point at a FRESH disposable
// database (npm test is NOT idempotent on a reused DB).
//
// Covered (4 tests): (1) GET returns {shop_id, start_date, end_date,
// total_cents, orders, users} for shop 1 and the totals match the same
// window computed directly from the DB; (2) ageing one paid order past
// 90 days drops the totals by exactly that order (restored after);
// (3) a shop-scoped admin sees only their own shop whatever ?shop=
// says, while the platform admin can pick a shop; (4) anonymous ->
// 401, non-admin -> 403.
//
// Test usernames are hyphen-free. All assertions filter by this file's
// own usernames / resource / shop — other test files share this DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3143);
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

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function completeThrough(token, orderId) {
  // Seller-confirm: confirm goes through the platform admin; pay /
  // complete stay with the buyer token.
  assert.equal((await transition(adminToken, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

async function spending90d(token, qs = "") {
  const r = await req(`/api/admin/member-spending-90d${qs}`, { token });
  assert.equal(r.status, 200, `spending-90d ${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// The same window the endpoint uses, computed straight from the DB.
async function expectedTotals(shopId) {
  const startIso = new Date(Date.now() - 90 * 86400000).toISOString();
  const row = await pool.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.amount),0) AS total,
            COUNT(DISTINCT o.user_id) AS users
     FROM orders o JOIN resources r ON r.id=o.resource_id
     WHERE r.shop_id=$1 AND o.status IN ('paid','completed','disputed','refund_requested')
       AND o.created_at>=$2`,
    [shopId, startIso],
  );
  return {
    orders: Number(row.rows[0].orders),
    total_cents: Number(row.rows[0].total),
    users: Number(row.rows[0].users),
  };
}

let adminToken;
let userToken;
let shopBId;
let shopAdminToken;
let agedOrderId;

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
  userToken = await register("p1spduser", "Test1234");
  // Two completed ¥280 orders in shop 1 for this file's user.
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "P1 90d show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  for (let i = 0; i < 2; i++) {
    const o = await req("/api/orders", {
      method: "POST",
      token: userToken,
      body: { resourceId: res.data.resource.id, quantity: 1, booking_date: "2026-12-05" },
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    await completeThrough(userToken, o.data.id);
    if (i === 0) agedOrderId = o.data.id;
  }
  // Shop B + its scoped admin (same direct-insert pattern as
  // r5-member-insights): one completed ¥280 order there.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["p1spdshopadmin", pw, "P1 子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "P1 分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("p1spdshopadmin", "Admin1234");
  const bRes = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "P1 90d分店演出", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: shopBId,
    },
  });
  assert.equal(bRes.status, 200, JSON.stringify(bRes.data));
  const bToken = await register("p1spdshopbuser", "Test1234");
  const bo = await req("/api/orders", {
    method: "POST",
    token: bToken,
    body: { resourceId: bRes.data.resource.id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(bo.status, 200, JSON.stringify(bo.data));
  await completeThrough(bToken, bo.data.id);
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("GET returns the 90-day totals matching the DB window", async () => {
  const d = await spending90d(adminToken);
  assert.equal(d.shop_id, 1);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 90 * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  assert.equal(d.end_date, today);
  assert.equal(d.start_date, start);
  const exp = await expectedTotals(1);
  assert.equal(d.total_cents, exp.total_cents, `total ${d.total_cents} != ${exp.total_cents}`);
  assert.equal(d.orders, exp.orders, `orders ${d.orders} != ${exp.orders}`);
  assert.equal(d.users, exp.users, `users ${d.users} != ${exp.users}`);
  assert.ok(d.total_cents > 0 && d.orders > 0 && d.users > 0, "window must be non-empty");
});

test("ageing one paid order past 90 days drops the totals by exactly that order", async () => {
  const beforeTotals = await spending90d(adminToken);
  const agedAt = new Date(Date.now() - 100 * 86400000).toISOString();
  await pool.query("UPDATE orders SET created_at=$1 WHERE id=$2", [agedAt, agedOrderId]);
  const afterTotals = await spending90d(adminToken);
  assert.equal(afterTotals.total_cents, beforeTotals.total_cents - 28000);
  assert.equal(afterTotals.orders, beforeTotals.orders - 1);
  // The user still has one paid order inside the window.
  assert.equal(afterTotals.users, beforeTotals.users);
  await pool.query("UPDATE orders SET created_at=NOW() WHERE id=$1", [agedOrderId]);
  const restored = await spending90d(adminToken);
  assert.deepEqual(
    { total_cents: restored.total_cents, orders: restored.orders, users: restored.users },
    { total_cents: beforeTotals.total_cents, orders: beforeTotals.orders, users: beforeTotals.users },
  );
});

test("shop-scoped admin sees only their own shop whatever ?shop= says", async () => {
  const own = await spending90d(shopAdminToken);
  assert.equal(own.shop_id, shopBId);
  const expB = await expectedTotals(shopBId);
  assert.equal(own.total_cents, expB.total_cents);
  assert.equal(own.orders, expB.orders);
  const forced = await spending90d(shopAdminToken, "?shop=1");
  assert.equal(forced.shop_id, shopBId, "shop-scoped admin must be forced to their own shop");
  assert.equal(forced.total_cents, expB.total_cents);
  const asPlatform = await spending90d(adminToken, `?shop=${shopBId}`);
  assert.equal(asPlatform.shop_id, shopBId);
  assert.equal(asPlatform.total_cents, expB.total_cents);
});

test("anonymous -> 401, non-admin -> 403", async () => {
  const r1 = await req("/api/admin/member-spending-90d");
  assert.equal(r1.status, 401, JSON.stringify(r1.data));
  const r2 = await req("/api/admin/member-spending-90d", { token: userToken });
  assert.equal(r2.status, 403, JSON.stringify(r2.data));
});
