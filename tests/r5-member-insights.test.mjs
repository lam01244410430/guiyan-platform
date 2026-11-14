// tests/r5-member-insights.test.mjs: R5-2 (rows 38, 54) — member data +
// operating suggestions (rule text, NO model). Spawns server/server.mjs
// on TEST_PORT (default 3117) and talks to it over HTTP. DATABASE_URL
// must point at a FRESH disposable database (npm test is NOT idempotent
// on a reused DB).
//
// Covered (7 tests): (1) a user with no paid order in 90 days is in
// the churn list (with a callback suggestion, since spending > 0);
// (2) a user ¥160 from the Silver threshold is an upgrade_candidate
// (within the 20% gap) with an upgrade suggestion; (3) spending and
// last_order_at match the real orders in the DB; (4) PATCHing the
// rules (churnDays 90 -> 120) moves the 100-day-old buyer out of the
// churn list, and invalid rules (unknown key, out-of-range value)
// are 400s; the callback suggestion follows its own rule
// (callbackDays 90 -> 120 clears it; both rules are restored before
// the test ends); (5) a shop-scoped admin sees only their own shop's
// members whatever ?shop= says; (6) anonymous -> 401, non-admin ->
// 403 on both endpoints; (7) push_show is the highest-revenue show
// of the shop in the last 30 days.
//
// Time-travel (ageing an order 100 days) is done with direct pg
// UPDATEs, like tests/account-otp.test.mjs. Test usernames are
// hyphen-free ([A-Za-z0-9_] only — R4-4 lesson: register rejects
// hyphens). The rules PATCH in test 4 restores the defaults before
// it finishes, so no later test (and no other file) sees changed
// rules. All assertions filter by this file's own usernames /
// resource / show — other test files share this DB.
//
// i18n key counts (H5 418, miniprogram 231) are asserted by
// tests/r4-tickets.test.mjs, tests/r2-pickup.test.mjs and
// tests/p3bugs.test.mjs — this file adds NO customer-visible string
// (the admin view labels are hardcoded Chinese), so the counts stay
// 418/231.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3117);
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

async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function completeThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

async function userIdByName(username) {
  const row = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
  return row.rows[0]?.id;
}

async function insights(token, qs = "") {
  const r = await req(`/api/admin/member-insights${qs}`, { token });
  assert.equal(r.status, 200, `insights ${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs.
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

let adminToken;
let userToken;
let plainResourceId;
let showId;
let churnUserId;
let upgradeUserId;
let shopBId;
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
  userToken = await register("r5insightuser", "Test1234");
  // A deterministic ¥280 show resource for old-flow orders (price
  // 28000 cents, stock 100). Category "show" so a show can link to
  // it for the push_show suggestion.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R5 insights show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: plainResourceId, title: "R5 会员数据演出" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  showId = show.data.id;
  // Churn user: one completed ¥280 order, then aged 100 days.
  const churnToken = await register("r5churnuser", "Test1234");
  churnUserId = await userIdByName("r5churnuser");
  const co = await orderAs(churnToken, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(co.status, 200, JSON.stringify(co.data));
  await completeThrough(churnToken, co.data.id);
  const agedAt = new Date(Date.now() - 100 * 86400000).toISOString();
  await pool.query("UPDATE orders SET created_at=$1 WHERE id=$2", [agedAt, co.data.id]);
  // Upgrade user: 3 completed ¥280 orders = ¥840 spending, ¥160
  // below the ¥1000 Silver threshold (16% gap < 20% default).
  const upgradeToken = await register("r5upgradeuser", "Test1234");
  upgradeUserId = await userIdByName("r5upgradeuser");
  for (let i = 0; i < 3; i++) {
    const o = await orderAs(upgradeToken, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    await completeThrough(upgradeToken, o.data.id);
  }
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("user with no paid order in 90 days is churned, with a callback suggestion", async () => {
  const d = await insights(adminToken);
  const u = d.users.find((x) => x.user_id === churnUserId);
  assert.ok(u, `churn user missing from ${JSON.stringify(d.users.map((x) => x.user_id))}`);
  assert.equal(u.spending_cents, 28000);
  assert.equal(u.churn, true);
  assert.equal(u.upgrade_candidate, false);
  assert.equal(u.tier, "普通会员");
  assert.ok(u.last_order_at, "last_order_at must be the aged order time, not null");
  assert.ok(
    Date.now() - new Date(u.last_order_at).valueOf() > 90 * 86400000,
    `last_order_at ${u.last_order_at} is not 90+ days old`,
  );
  const cb = d.suggestions.find((s) => s.type === "callback" && s.user_id === churnUserId);
  assert.ok(cb, `no callback suggestion for the churned spender in ${JSON.stringify(d.suggestions)}`);
});

test("user near the Silver threshold is an upgrade_candidate, with an upgrade suggestion", async () => {
  const d = await insights(adminToken);
  const u = d.users.find((x) => x.user_id === upgradeUserId);
  assert.ok(u, "upgrade user missing from the insights list");
  assert.equal(u.spending_cents, 84000);
  assert.equal(u.churn, false);
  assert.equal(u.tier, "普通会员");
  assert.equal(u.upgrade_candidate, true);
  assert.equal(u.next_tier, "银卡会员");
  assert.equal(u.remaining_cents, 16000);
  const up = d.suggestions.find((s) => s.type === "upgrade" && s.user_id === upgradeUserId);
  assert.ok(up, `no upgrade suggestion for the near-threshold user in ${JSON.stringify(d.suggestions)}`);
  assert.equal(up.next_tier, "银卡会员");
  assert.equal(up.remaining_cents, 16000);
});

test("spending and last_order_at match the real orders in the DB", async () => {
  const row = await pool.query(
    `SELECT COALESCE(SUM(o.amount),0) AS spending, MAX(o.created_at) AS last_order_at
     FROM orders o JOIN resources r ON r.id=o.resource_id
     WHERE o.user_id=$1 AND r.shop_id=1 AND o.status IN ('paid','completed','disputed','refund_requested')`,
    [upgradeUserId],
  );
  const d = await insights(adminToken);
  const u = d.users.find((x) => x.user_id === upgradeUserId);
  // Raw pg returns SUM(int) as a string (no int8/numeric -> Number
  // parsers on the test pool, unlike the server store) — compare
  // as numbers.
  assert.equal(u.spending_cents, Number(row.rows[0].spending));
  assert.equal(u.last_order_at, row.rows[0].last_order_at);
});

test("PATCHing churnDays moves the 100-day buyer out of the churn list; bad rules -> 400", async () => {
  // Unknown keys are rejected, as are out-of-range values.
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { churnDays: 90, nope: 1 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { churnDays: 0 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { churnDays: 366 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { upgradeGapPct: 101 },
  })).status, 400);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { callbackDays: 0 },
  })).status, 400);
  // Defaults are the documented 90 / 20 / 90.
  const before = await req("/api/admin/member-insight-rules", { token: adminToken });
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.deepEqual(before.data.rules, { churnDays: 90, upgradeGapPct: 20, callbackDays: 90 });
  // 100 days old: churned at 90, not churned at 120.
  const patched = await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { churnDays: 120 },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.rules.churnDays, 120);
  assert.equal(patched.data.rules.upgradeGapPct, 20);
  let d = await insights(adminToken);
  assert.equal(d.users.find((x) => x.user_id === churnUserId).churn, false);
  // The callback suggestion follows its own rule (callbackDays,
  // still 90), NOT churnDays — so it stays while the churn flag
  // is off. Only raising callbackDays clears it.
  assert.equal(
    d.suggestions.some((s) => s.type === "callback" && s.user_id === churnUserId),
    true,
  );
  const patchedCb = await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { callbackDays: 120 },
  });
  assert.equal(patchedCb.status, 200, JSON.stringify(patchedCb.data));
  assert.equal(patchedCb.data.rules.callbackDays, 120);
  assert.equal(patchedCb.data.rules.churnDays, 120);
  d = await insights(adminToken);
  assert.equal(
    d.suggestions.some((s) => s.type === "callback" && s.user_id === churnUserId),
    false,
  );
  // Restore the defaults before finishing, so no later test (and
  // no other file) sees changed rules.
  const restored = await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: adminToken, body: { churnDays: 90, callbackDays: 90 },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.rules, { churnDays: 90, upgradeGapPct: 20, callbackDays: 90 });
  d = await insights(adminToken);
  assert.equal(d.users.find((x) => x.user_id === churnUserId).churn, true);
  assert.equal(
    d.suggestions.some((s) => s.type === "callback" && s.user_id === churnUserId),
    true,
  );
});

test("cross-shop admin sees only their own shop's members", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as
  // r1-shops / r3-tiers): creating the shop with owner_id sets the
  // owner's shop_id, which is the admin's scope.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r5shopadmin", pw, "R5 子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R5 分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r5shopadmin", "Admin1234");
  const bRes = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R5 分店演出", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: shopBId,
    },
  });
  assert.equal(bRes.status, 200, JSON.stringify(bRes.data));
  const bToken = await register("r5shopbuser", "Test1234");
  const bUserId = await userIdByName("r5shopbuser");
  const bo = await orderAs(bToken, {
    resourceId: bRes.data.resource.id, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(bo.status, 200, JSON.stringify(bo.data));
  await completeThrough(bToken, bo.data.id);
  // The scoped admin is forced to shop B whether they ask for shop
  // 1 or for no shop at all: the shop-1-only users are absent, the
  // shop-B buyer is present with shop-B spending.
  for (const qs of ["?shop=1", ""]) {
    const d = await insights(shopAdminToken, qs);
    const ids = d.users.map((x) => x.user_id);
    assert.ok(!ids.includes(churnUserId), `scoped admin saw shop-1 churn user via ${qs}`);
    assert.ok(!ids.includes(upgradeUserId), `scoped admin saw shop-1 upgrade user via ${qs}`);
    const bu = d.users.find((x) => x.user_id === bUserId);
    assert.ok(bu, `scoped admin missed the shop-B buyer via ${qs}`);
    assert.equal(bu.spending_cents, 28000);
  }
  // The platform admin asking for shop B sees the same buyer.
  const d = await insights(adminToken, `?shop=${shopBId}`);
  const bu = d.users.find((x) => x.user_id === bUserId);
  assert.ok(bu, "platform admin missed the shop-B buyer");
  assert.equal(bu.spending_cents, 28000);
  assert.ok(!d.users.some((x) => x.user_id === upgradeUserId));
});

test("anonymous -> 401, non-admin -> 403 on both endpoints", async () => {
  assert.equal((await req("/api/admin/member-insights")).status, 401);
  assert.equal((await req("/api/admin/member-insights", { token: userToken })).status, 403);
  assert.equal((await req("/api/admin/member-insight-rules")).status, 401);
  assert.equal((await req("/api/admin/member-insight-rules", { token: userToken })).status, 403);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", body: { churnDays: 30 },
  })).status, 401);
  assert.equal((await req("/api/admin/member-insight-rules", {
    method: "PATCH", token: userToken, body: { churnDays: 30 },
  })).status, 403);
});

test("push_show is the highest-revenue show of the shop in the last 30 days", async () => {
  // The 30-day window excludes the churn user's order (aged 100
  // days): this file's show earns only the upgrade user's 3 x ¥280.
  const mine = await pool.query(
    `SELECT COALESCE(SUM(o.amount),0) AS revenue FROM orders o
     WHERE o.resource_id=$1 AND o.status IN ('paid','completed','disputed','refund_requested')
       AND o.created_at >= $2`,
    [plainResourceId, new Date(Date.now() - 30 * 86400000).toISOString()],
  );
  assert.equal(Number(mine.rows[0].revenue), 84000);
  // The top show is computed live from the DB — other test files
  // share this DB and may have paid orders on their own shows, so
  // the expected top show is whatever the same query returns, not
  // a hardcoded show of this file.
  const top = await pool.query(
    `SELECT s.id AS show_id, s.title AS title, COALESCE(SUM(o.amount),0) AS revenue_cents
     FROM shows s
     JOIN orders o ON o.resource_id=s.resource_id
     JOIN resources r ON r.id=o.resource_id
     WHERE s.shop_id=1 AND r.shop_id=1
       AND o.status IN ('paid','completed','disputed','refund_requested')
       AND o.created_at >= $1
     GROUP BY s.id, s.title ORDER BY revenue_cents DESC LIMIT 1`,
    [new Date(Date.now() - 30 * 86400000).toISOString()],
  );
  assert.equal(top.rows.length, 1, "no paid show revenue in the last 30 days at all");
  const d = await insights(adminToken);
  const pushes = d.suggestions.filter((s) => s.type === "push_show");
  assert.equal(pushes.length, 1, `want exactly one push_show, got ${JSON.stringify(d.suggestions)}`);
  assert.equal(pushes[0].show_id, top.rows[0].show_id);
  assert.equal(pushes[0].title, top.rows[0].title);
  assert.equal(pushes[0].revenue_cents, Number(top.rows[0].revenue_cents));
});
