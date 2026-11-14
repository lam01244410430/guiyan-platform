// tests/r5-alerts-ledger.test.mjs: R5-5 (rows 62, 21, 76) — anomaly
// alerts + finance ledger + per-resource stats. Spawns
// server/server.mjs on TEST_PORT (default 3120) and talks to it over
// HTTP. DATABASE_URL must point at a FRESH disposable database.
//
// Covered (9 tests): (1) sales drop beyond threshold -> an auto
// sales_drop alert appears (stable id auto:sales_drop:1); (2) a
// verify-failure spike -> an auto scan_abuse alert; (3) stock below
// threshold -> an auto low_stock alert for that resource; (4)
// disabling the rule removes the auto alert (other rules' alerts
// stay); (5) ledger totals = order totals (scoped to this file's
// own orders: income + refund_out == SUM(amount) over the orders
// still paid/completed); (6) topup writes topup_in ledger rows
// (+amount and +bonus); (7) reconcile marks the row (non-admin ->
// 403, anonymous -> 401); (8) resource stats match real
// events/orders/tickets/verifies; (9) cross-shop -> 403 (rule
// create, rule patch, ledger list, resource stats).
//
// Fixture notes: the sales-drop test inserts two big paid orders
// dated 10 days ago straight into the DB (the API cannot create
// past-dated orders) — ¥500,000 each, so the previous 7-day window
// dwarfs any recent revenue from the seed (last seed order Nov 9)
// or from earlier test files' small ¥280 orders, and the drop is
// ~97% >> the 50% threshold whatever else ran today. Auto alerts
// are computed on read and never stored. The stored-value refund
// direction is verified in code first: stored_value_ledger `refund`
// rows are POSITIVE (money back onto the card), so finance_ledger
// `card_refund` rows are positive too.
//
// Test usernames are hyphen-free ([A-Za-z0-9_] only — R4-4 lesson:
// register rejects hyphens). All assertions filter by this file's
// own usernames / resources / rules — other test files share this
// DB. This file creates no i18n keys (admin labels are hardcoded
// Chinese), so the H5 428 / miniprogram 242 counts stay.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3120);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

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
  return { token: r.data.token, userId: r.data.user.id };
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

async function getAlerts(token) {
  const r = await req("/api/admin/alerts", { token });
  assert.equal(r.status, 200, `alerts -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.alerts;
}

async function getLedger(token, qs = "?limit=200") {
  const r = await req(`/api/admin/finance-ledger${qs}`, { token });
  assert.equal(r.status, 200, `ledger ${qs} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data.ledger;
}

let adminToken;
let ledgerUser;
let statsUser;
let shopAdminToken;
let shopBId;
let salesDropRuleId;
let scanAbuseRuleId;
let lowStockRuleId;
let lowStockResourceId;
let ledgerResourceId;
let ledgerOrderIds = [];
let ledgerOrderAmounts = {};
let topupRowIds = [];
let statsResourceId;
let statsOrderAmount;

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
  ledgerUser = await register("r5ledgeruser", "Test1234");
  statsUser = await register("r5statsuser", "Test1234");
  // Sales-drop fixture: two big paid orders 10 days ago (previous
  // 7-day window) on seed resource 1 (main shop). The API cannot
  // create past-dated orders, so these go in by SQL — clearly
  // labelled test fixtures, never touched by other files. They
  // belong to the seed demo user (id 2), NOT to the ledger test
  // user: ¥1,000,000 of spending would make the buyer 钻石会员 and
  // discount their later orders by 15% (R3-1 tiers), which would
  // break the ledger test's exact amounts below.
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  const fixture = await pool.query(
    `INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,escrow,created_at)
     VALUES('GYR55DROP1',2,1,1,50000000,'2026-12-01','paid','H5','R5-5 test fixture','模拟托管中',$1),
           ('GYR55DROP2',2,1,1,50000000,'2026-12-01','paid','H5','R5-5 test fixture','模拟托管中',$1)
     RETURNING id`,
    [tenDaysAgo],
  );
  // The fixtures are inserted after server setup, so the setup
  // backfill never saw them — book their order_income rows here so
  // the ledger-vs-orders invariant holds globally, not just for
  // API-created orders.
  for (const row of fixture.rows)
    await pool.query(
      `INSERT INTO finance_ledger(shop_id,kind,amount_cents,order_id,note,created_at)
       VALUES(1,'order_income',50000000,$1,'',$2)`,
      [row.id, tenDaysAgo],
    );
  // A shop-scoped admin for the cross-shop test: inserted directly
  // (register fixes role=user), then made owner of a new shop —
  // owning the shop sets their users.shop_id (R1-1 pattern).
  // NOTE: r5-member-insights owns "r5shopadmin" in this shared DB,
  // so this file uses "r5ledgeradmin" (same convention as r2-pickup).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r5ledgeradmin", pw, "R5账本子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R5预警子店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r5ledgeradmin", "Admin1234");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("sales drop beyond threshold -> auto sales_drop alert appears", async () => {
  const created = await req("/api/admin/alert-rules", {
    method: "POST",
    token: adminToken,
    body: { kind: "sales_drop", shop_id: 1, config: { drop_pct: 50, window_days: 7 } },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.rule.kind, "sales_drop");
  assert.deepEqual(created.data.rule.config, { drop_pct: 50, window_days: 7 });
  salesDropRuleId = created.data.rule.id;
  const alerts = await getAlerts(adminToken);
  const auto = alerts.find((a) => a.auto === true && a.rule_kind === "sales_drop");
  assert.ok(auto, `no auto sales_drop alert: ${JSON.stringify(alerts.map((a) => a.id || a.title))}`);
  assert.equal(auto.id, "auto:sales_drop:1");
  assert.equal(auto.rule_id, salesDropRuleId);
  assert.ok(auto.title.includes("销量下滑"), auto.title);
});

test("verify-failure spike -> auto scan_abuse alert", async () => {
  const created = await req("/api/admin/alert-rules", {
    method: "POST",
    token: adminToken,
    body: { kind: "scan_abuse", config: { fail_count: 3, window_minutes: 60 } },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.rule.shop_id, null);
  scanAbuseRuleId = created.data.rule.id;
  for (const code of ["GY00000001", "GY00000002", "GY00000003"]) {
    const r = await req(`/api/verify/${code}`, { method: "POST", token: adminToken, body: {} });
    assert.equal(r.status, 404, `bogus verify ${code} -> ${r.status}`);
  }
  const alerts = await getAlerts(adminToken);
  const auto = alerts.find((a) => a.auto === true && a.rule_kind === "scan_abuse");
  assert.ok(auto, `no auto scan_abuse alert: ${JSON.stringify(alerts.map((a) => a.id || a.title))}`);
  assert.equal(auto.id, "auto:scan_abuse:platform");
  // The count may exceed 3 — earlier test files' bogus verifies
  // today are in the same 60-minute window and count too.
  assert.ok(auto.title.includes("核销失败激增"), auto.title);
  assert.ok(auto.detail.includes("≥ 阈值3次"), auto.detail);
});

test("stock below threshold -> auto low_stock alert for that resource", async () => {
  const created = await req("/api/admin/alert-rules", {
    method: "POST",
    token: adminToken,
    body: { kind: "low_stock", shop_id: 1, config: { stock_lt: 10 } },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  lowStockRuleId = created.data.rule.id;
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: { name: "R5预警低库存", category: "show", city: "南宁", price: 28000, unit: "张", stock: 0 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  lowStockResourceId = res.data.resource.id;
  const alerts = await getAlerts(adminToken);
  const auto = alerts.find(
    (a) => a.auto === true && a.rule_kind === "low_stock" && a.title.includes("R5预警低库存"),
  );
  assert.ok(auto, `no auto low_stock alert for own resource: ${JSON.stringify(alerts.filter((a) => a.auto).map((a) => a.id))}`);
  assert.equal(auto.id, `auto:low_stock:1:${lowStockResourceId}`);
  assert.ok(auto.title.includes("仅剩0"), auto.title);
});

test("disabling the rule removes the auto alert (other rules stay)", async () => {
  const patched = await req(`/api/admin/alert-rules/${lowStockRuleId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "disabled" },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.rule.status, "disabled");
  const alerts = await getAlerts(adminToken);
  const gone = alerts.find(
    (a) => a.auto === true && a.rule_kind === "low_stock" && a.title.includes("R5预警低库存"),
  );
  assert.equal(gone, undefined, `low_stock alert still present after disable: ${JSON.stringify(gone)}`);
  assert.ok(
    alerts.some((a) => a.auto === true && a.rule_kind === "sales_drop"),
    "sales_drop alert must survive disabling the low_stock rule",
  );
});

test("ledger totals = order totals (income + refunds over own orders)", async () => {
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: { name: "R5账本演出", category: "show", city: "南宁", price: 28000, unit: "张", stock: 100 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  ledgerResourceId = res.data.resource.id;
  // Two orders stay paid; a third is paid then fully refunded.
  for (const qty of [1, 2, 1]) {
    const o = await orderAs(ledgerUser.token, {
      resourceId: ledgerResourceId,
      quantity: qty,
      booking_date: "2026-12-20",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.amount, 28000 * qty, `order amount ${JSON.stringify(o.data)}`);
    await payThrough(ledgerUser.token, o.data.id);
    ledgerOrderIds.push(o.data.id);
    ledgerOrderAmounts[o.data.id] = o.data.amount;
  }
  const refundedId = ledgerOrderIds[2];
  assert.equal(
    (await transition(ledgerUser.token, refundedId, "refund", { reason: "R5-5测试退款" })).status,
    200,
  );
  const approved = await transition(adminToken, refundedId, "approveRefund", {});
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.refund_cents, 28000);
  assert.equal(approved.data.refunded_to_card_cents, 0);
  const rows = (await getLedger(adminToken)).filter((l) =>
    ledgerOrderIds.includes(l.order_id),
  );
  const income = rows
    .filter((l) => l.kind === "order_income")
    .reduce((n, l) => n + l.amount_cents, 0);
  const refunds = rows
    .filter((l) => l.kind === "refund_out")
    .reduce((n, l) => n + l.amount_cents, 0);
  assert.equal(income, 28000 + 56000 + 28000, `income rows: ${JSON.stringify(rows)}`);
  assert.equal(refunds, -28000, `refund rows: ${JSON.stringify(rows)}`);
  assert.equal(
    rows.filter((l) => l.kind === "card_refund").length,
    0,
    "no card share was used, so no card_refund row",
  );
  // Invariant (fixed): income + refund_out == SUM(amount) over the
  // orders still paid/completed (the refunded order drops out).
  const standing = ledgerOrderIds
    .slice(0, 2)
    .reduce((n, id) => n + ledgerOrderAmounts[id], 0);
  assert.equal(income + refunds, standing);
});

test("topup writes topup_in ledger rows (+amount and +bonus)", async () => {
  const before = await getLedger(adminToken, "?kind=topup_in&limit=200");
  const maxBefore = before.reduce((n, l) => Math.max(n, l.id), 0);
  const plans = await req("/api/shops/1/stored-value-plans");
  assert.equal(plans.status, 200, JSON.stringify(plans.data));
  const plan = (plans.data.stored_value_plans || []).find((p) => p.amount_cents === 10000);
  assert.ok(plan, "10000 plan missing");
  const topped = await req("/api/account/topup", {
    method: "POST",
    token: ledgerUser.token,
    body: { plan_id: plan.id },
  });
  assert.equal(topped.status, 200, JSON.stringify(topped.data));
  const after = await getLedger(adminToken, "?kind=topup_in&limit=200");
  const fresh = after.filter((l) => l.id > maxBefore);
  assert.deepEqual(
    fresh.map((l) => l.amount_cents).sort((a, b) => a - b),
    [1000, 10000],
    `new topup_in rows: ${JSON.stringify(fresh)}`,
  );
  assert.ok(fresh.every((l) => l.note.startsWith("svl:")), JSON.stringify(fresh));
  topupRowIds = fresh.map((l) => l.id);
});

test("reconcile marks the row (non-admin 403, anonymous 401)", async () => {
  assert.equal((await req("/api/admin/finance-ledger")).status, 401);
  const rowId = topupRowIds[0];
  assert.equal(
    (await req(`/api/admin/finance-ledger/${rowId}/reconcile`, {
      method: "POST",
      token: ledgerUser.token,
      body: {},
    })).status,
    403,
  );
  const reconciled = await req(`/api/admin/finance-ledger/${rowId}/reconcile`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.data));
  assert.equal(reconciled.data.ledger.reconciled, 1);
  const rows = await getLedger(adminToken, "?reconciled=1&limit=200");
  assert.ok(rows.some((l) => l.id === rowId), `row ${rowId} not in reconciled list`);
  assert.equal(
    (await req("/api/admin/finance-ledger/999999/reconcile", {
      method: "POST",
      token: adminToken,
      body: {},
    })).status,
    404,
  );
});

test("resource stats match real events, orders, tickets and verifies", async () => {
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: { name: "R5统计演出", category: "show", city: "南宁", price: 28000, unit: "张", stock: 100 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  statsResourceId = res.data.resource.id;
  for (let i = 0; i < 3; i++)
    assert.equal((await req(`/api/resources/${statsResourceId}/view`, { method: "POST", body: {} })).status, 200);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await req("/api/events", { method: "POST", body: { type: "click", detail: `resource:${statsResourceId}` } })).status,
      200,
    );
  const o = await orderAs(statsUser.token, {
    resourceId: statsResourceId,
    quantity: 2,
    booking_date: "2026-12-20",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  statsOrderAmount = o.data.amount;
  assert.equal(statsOrderAmount, 56000);
  await payThrough(statsUser.token, o.data.id);
  const tickets = await req(`/api/orders/${o.data.id}/tickets`, { token: statsUser.token });
  assert.equal(tickets.status, 200, JSON.stringify(tickets.data));
  assert.equal(tickets.data.tickets.length, 2);
  const code = tickets.data.tickets[0].code;
  const verified = await req(`/api/verify/${code}`, { method: "POST", token: adminToken, body: {} });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  const stats = await req(`/api/admin/resources/${statsResourceId}/stats`, { token: adminToken });
  assert.equal(stats.status, 200, JSON.stringify(stats.data));
  assert.deepEqual(
    {
      views: stats.data.views,
      event_views: stats.data.event_views,
      clicks: stats.data.clicks,
      orders: stats.data.orders,
      revenue_cents: stats.data.revenue_cents,
      tickets_sold: stats.data.tickets_sold,
      verify_count: stats.data.verify_count,
    },
    {
      views: 3,
      event_views: 3,
      clicks: 2,
      orders: 1,
      revenue_cents: 56000,
      tickets_sold: 2,
      verify_count: 1,
    },
    `stats mismatch: ${JSON.stringify(stats.data)}`,
  );
});

test("cross-shop -> 403 (rule create/patch, ledger list, resource stats)", async () => {
  assert.equal(
    (await req("/api/admin/alert-rules", {
      method: "POST",
      token: shopAdminToken,
      body: { kind: "low_stock", shop_id: 1, config: { stock_lt: 10 } },
    })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/alert-rules/${salesDropRuleId}`, {
      method: "PATCH",
      token: shopAdminToken,
      body: { status: "disabled" },
    })).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/finance-ledger?shop=1", { token: shopAdminToken })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/resources/${statsResourceId}/stats`, { token: shopAdminToken })).status,
    403,
  );
  // Positive controls: the shop admin CAN read their own shop's
  // ledger (empty) and rules (their shop + platform-level).
  const ownLedger = await req("/api/admin/finance-ledger", { token: shopAdminToken });
  assert.equal(ownLedger.status, 200, JSON.stringify(ownLedger.data));
  assert.ok(
    (ownLedger.data.ledger || []).every((l) => l.shop_id === shopBId),
    "shop admin must only see their own shop's ledger",
  );
  const ownRules = await req("/api/admin/alert-rules", { token: shopAdminToken });
  assert.equal(ownRules.status, 200, JSON.stringify(ownRules.data));
  assert.ok(
    (ownRules.data.rules || []).every(
      (r) => r.shop_id === shopBId || r.shop_id === null,
    ),
    "shop admin must only see their own + platform rules",
  );
  // Unknown config key -> 400; bad kind -> 400 (platform admin).
  assert.equal(
    (await req("/api/admin/alert-rules", {
      method: "POST",
      token: adminToken,
      body: { kind: "low_stock", shop_id: 1, config: { bogus: 1 } },
    })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/alert-rules", {
      method: "POST",
      token: adminToken,
      body: { kind: "nope", shop_id: 1, config: {} },
    })).status,
    400,
  );
});
