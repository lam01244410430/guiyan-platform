// tests/showtimes-final.test.mjs: showtimes-final (Q1a + Q2a + Q3a,
// 2026-11-16) — direct performances for any resource (show-category included).
// Spawns server/server.mjs on TEST_PORT (default 3351) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: create direct performance -> 200 + on_sale + default 标准票
// tier (quota = resource stock, min 1); non-admin / cross-shop -> 403;
// unknown resource -> 404; draft resource / past start_at -> 400;
// availability lists the direct performance (show_id null) with tiers
// and seats [] ; show-linked regression on the same resource (backfill
// sets resource_id); order without a performance when on-sale
// performances exist -> 400; order with the direct perf + default tier
// -> 200, booking_date = start date, amount = tier price x qty;
// another resource's performance / pickup_point_id on a direct perf
// -> 400; quota sold-out -> 409, cancel restores it; expired tier ->
// 400; cancelled perf not sellable; pay issues tickets, refund approval
// restores quota; flash sale on a direct performance (shop via
// resource); docs have no 待补充 except the 00-readme.md:4 rule;
// honesty markers intact; internal .note blocks + 模拟/演示 code
// comments gone; i18n key counts (H5 483 + 82 th/ms/id, miniprogram
// 270 + 82, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3351);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  return { token: r.data.token, id: r.data.user.id };
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  const pay = await transition(token, orderId, "pay");
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  return pay.data;
}

async function availability(resourceId) {
  return req(`/api/resources/${resourceId}/availability`);
}

async function createResource(token, body) {
  return req("/api/admin/resources", { method: "POST", token, body });
}

async function createDirectPerf(token, resourceId, body) {
  return req(`/api/resources/${resourceId}/performances`, {
    method: "POST",
    token,
    body,
  });
}

async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

let adminToken;
let demoToken;
let orderToken; // fresh account for amount-sensitive order tests (see before())
let shopAdminToken;
let shopBId;
let resId; // tourism resource, stock 5, ¥100
let resBId; // second tourism resource (cross-resource perf checks)
let showResId; // show-category resource (show-linked regression)
let showId;
let showPerfId;
let perfId; // direct perf on resId
let tierId; // its default 标准票 tier
let orderAId; // qty-2 order on perfId
let orderCId; // qty-5 order on perfId

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
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
  // The full suite shares one DB across files, so by the time this file
  // runs demo has paid spend from earlier files and holds a 15%-off
  // member tier (17000, not 20000, for a ¥200 tier order). Amount-
  // sensitive order tests below use a fresh account with no tier.
  orderToken = (await register("sforder", "sforder123")).token;
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["sffshopadmin", pw, "SF子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "SF测试分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("sffshopadmin", "Admin1234");
  const r = await createResource(adminToken, {
    name: "SF direct perf 旅游", category: "tourism", city: "南宁",
    price: 10000, unit: "张", stock: 5,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  resId = r.data.resource.id;
  const rB = await createResource(adminToken, {
    name: "SF direct perf 旅游 B", category: "tourism", city: "柳州",
    price: 10000, unit: "张", stock: 5,
  });
  assert.equal(rB.status, 200, JSON.stringify(rB.data));
  resBId = rB.data.resource.id;
  const rS = await createResource(adminToken, {
    name: "SF show 回归", category: "show", city: "南宁",
    price: 28000, unit: "张", stock: 10,
  });
  assert.equal(rS.status, 200, JSON.stringify(rS.data));
  showResId = rS.data.resource.id;
});

after(async () => {
  if (child) child.kill();
  await pool.end();
});

test("create direct performance: admin 200, on_sale, default 标准票 tier quota = stock", async () => {
  const c = await createDirectPerf(adminToken, resId, {
    start_at: "2026-12-05T19:30:00", price_cents: 10000,
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.performance.status, "on_sale");
  assert.equal(c.data.performance.show_id, null);
  assert.equal(c.data.performance.resource_id, resId);
  assert.equal(c.data.performance.start_at, "2026-12-05T19:30:00");
  assert.equal(c.data.performance.price_cents, 10000);
  assert.equal(c.data.ticket_type.name, "标准票");
  assert.equal(c.data.ticket_type.price_cents, 10000);
  assert.equal(c.data.ticket_type.quota, 5);
  assert.equal(c.data.ticket_type.sale_until, null);
  perfId = c.data.performance.id;
  tierId = c.data.ticket_type.id;
  // The row in the DB carries the same link.
  const row = await pool.query(
    "SELECT show_id, resource_id, status FROM performances WHERE id=$1",
    [perfId],
  );
  assert.equal(row.rows[0].show_id, null);
  assert.equal(row.rows[0].resource_id, resId);
  assert.equal(row.rows[0].status, "on_sale");
});

test("create direct performance: non-admin 403, cross-shop 403, unknown 404, draft 400, past start_at 400", async () => {
  assert.equal(
    (await createDirectPerf(demoToken, resId, { start_at: "2026-12-06T19:30:00", price_cents: 10000 })).status,
    403,
  );
  assert.equal(
    (await createDirectPerf(shopAdminToken, resId, { start_at: "2026-12-06T19:30:00", price_cents: 10000 })).status,
    403,
  );
  assert.equal(
    (await createDirectPerf(adminToken, 99999, { start_at: "2026-12-06T19:30:00", price_cents: 10000 })).status,
    404,
  );
  const draft = await createResource(adminToken, {
    name: "SF draft", category: "tourism", city: "南宁",
    price: 10000, unit: "张", stock: 5,
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  const patched = await req(`/api/admin/resources/${draft.data.resource.id}`, {
    method: "PATCH", token: adminToken, body: { status: "draft" },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  const onDraft = await createDirectPerf(adminToken, draft.data.resource.id, {
    start_at: "2026-12-06T19:30:00", price_cents: 10000,
  });
  assert.equal(onDraft.status, 400, JSON.stringify(onDraft.data));
  const past = await createDirectPerf(adminToken, resId, {
    start_at: "2026-11-01T19:30:00", price_cents: 10000,
  });
  assert.equal(past.status, 400, JSON.stringify(past.data));
});

test("availability lists the direct performance (show_id null) with tiers; seats are empty", async () => {
  const a = await availability(resId);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.performances.length, 1);
  const pf = a.data.performances[0];
  assert.equal(pf.id, perfId);
  assert.equal(pf.show_id, null);
  assert.equal(pf.status, "on_sale");
  assert.equal(pf.ticket_types.length, 1);
  assert.equal(pf.ticket_types[0].id, tierId);
  assert.equal(pf.ticket_types[0].name, "标准票");
  assert.equal(pf.ticket_types[0].available, 5);
  const seats = await req(`/api/performances/${perfId}/seats`);
  assert.equal(seats.status, 200, JSON.stringify(seats.data));
  assert.deepEqual(seats.data.seats, []);
  const tiers = await req(`/api/performances/${perfId}/ticket-types`);
  assert.equal(tiers.status, 200, JSON.stringify(tiers.data));
  assert.equal(tiers.data.ticket_types.length, 1);
});

test("show-linked regression: same show resource lists both kinds; backfill sets resource_id", async () => {
  const s = await req("/api/shows", {
    method: "POST", token: adminToken,
    body: { title: "SF 回归演出", resource_id: showResId, description: "" },
  });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  showId = s.data.show.id;
  assert.equal(
    (await req(`/api/admin/shows/${showId}`, { method: "PATCH", token: adminToken, body: { status: "approved" } })).status,
    200,
  );
  const p = await req(`/api/shows/${showId}/performances`, {
    method: "POST", token: adminToken,
    body: { start_at: "2026-12-05T20:00:00", price_cents: 28000 },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  showPerfId = p.data.performance.id;
  assert.equal(p.data.performance.resource_id, showResId);
  assert.equal(
    (await req(`/api/admin/performances/${showPerfId}`, { method: "PATCH", token: adminToken, body: { status: "on_sale" } })).status,
    200,
  );
  const d = await createDirectPerf(adminToken, showResId, {
    start_at: "2026-12-06T19:30:00", price_cents: 28000,
  });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const a = await availability(showResId);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.performances.length, 2);
  const linked = a.data.performances.find((x) => x.id === showPerfId);
  const direct = a.data.performances.find((x) => x.id === d.data.performance.id);
  assert.equal(linked.show_id, showId);
  assert.equal(linked.resource_id, showResId);
  assert.equal(direct.show_id, null);
  assert.equal(direct.resource_id, showResId);
  const row = await pool.query(
    "SELECT resource_id FROM performances WHERE id=$1",
    [showPerfId],
  );
  assert.equal(row.rows[0].resource_id, showResId);
});

test("order without a performance when on-sale performances exist -> 400", async () => {
  const o = await orderAs(demoToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o.status, 400, JSON.stringify(o.data));
  assert.equal(o.data.error, "该资源有在售场次，请选择场次");
});

test("order direct perf + default tier -> 200, booking_date = start date, amount = tier price x qty", async () => {
  const o = await orderAs(orderToken, {
    resourceId: resId, quantity: 2, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 20000);
  assert.equal(o.data.pickup_point, null);
  assert.ok(o.data.ticket_template, "tier order carries the shop template");
  orderAId = o.data.id;
  const row = await pool.query(
    "SELECT booking_date, amount, performance_id, ticket_type_id FROM orders WHERE id=$1",
    [orderAId],
  );
  assert.equal(row.rows[0].booking_date, "2026-12-05");
  assert.equal(row.rows[0].amount, 20000);
  assert.equal(row.rows[0].performance_id, perfId);
  assert.equal(row.rows[0].ticket_type_id, tierId);
});

test("order with another resource's performance -> 400; pickup_point_id on a direct perf -> 400", async () => {
  const other = await createDirectPerf(adminToken, resBId, {
    start_at: "2026-12-05T19:30:00", price_cents: 10000,
  });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  const cross = await orderAs(demoToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
    performance_id: other.data.performance.id,
    ticket_type_id: other.data.ticket_type.id,
  });
  assert.equal(cross.status, 400, JSON.stringify(cross.data));
  assert.equal(cross.data.error, "场次不属于该资源");
  const pickup = await orderAs(demoToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId, pickup_point_id: 1,
  });
  assert.equal(pickup.status, 400, JSON.stringify(pickup.data));
  assert.equal(pickup.data.error, "该场次无需选择取票点");
});

test("quota: sold-out -> 409; cancel restores it", async () => {
  // 2 of 5 sold by orderA; 4 more do not fit.
  const over = await orderAs(orderToken, {
    resourceId: resId, quantity: 4, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(over.status, 409, JSON.stringify(over.data));
  assert.equal((await transition(orderToken, orderAId, "cancel")).status, 200);
  const full = await orderAs(orderToken, {
    resourceId: resId, quantity: 5, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(full.status, 200, JSON.stringify(full.data));
  orderCId = full.data.id;
  const oneMore = await orderAs(orderToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(oneMore.status, 409, JSON.stringify(oneMore.data));
});

test("expired tier -> 400; cancelled perf not sellable", async () => {
  const t = await req(`/api/performances/${perfId}/ticket-types`, {
    method: "POST", token: adminToken,
    body: { name: "早鸟票", price_cents: 8000, quota: 5, sale_until: "2026-11-10T00:00:00" },
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const expired = await orderAs(demoToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: t.data.ticket_type.id,
  });
  assert.equal(expired.status, 400, JSON.stringify(expired.data));
  assert.equal(expired.data.error, "该票种已过售票截止时间");
  const p2 = await createDirectPerf(adminToken, resId, {
    start_at: "2026-12-07T19:30:00", price_cents: 10000,
  });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  assert.equal(
    (await req(`/api/admin/performances/${p2.data.performance.id}`, { method: "PATCH", token: adminToken, body: { status: "cancelled" } })).status,
    200,
  );
  const a = await availability(resId);
  assert.equal(a.data.performances.some((x) => x.id === p2.data.performance.id), false);
  const gone = await orderAs(demoToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-07",
    performance_id: p2.data.performance.id,
    ticket_type_id: p2.data.ticket_type.id,
  });
  assert.equal(gone.status, 400, JSON.stringify(gone.data));
  assert.equal(gone.data.error, "场次不在售");
});

test("pay issues tickets; refund approval restores quota", async () => {
  await payThrough(orderToken, orderCId);
  const list = await req(`/api/orders/${orderCId}/tickets`, { token: orderToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.tickets.length, 5);
  assert.ok(list.data.tickets.every((x) => x.status === "issued"));
  assert.equal((await transition(orderToken, orderCId, "refund", { reason: "不去了" })).status, 200);
  assert.equal((await transition(adminToken, orderCId, "approveRefund")).status, 200);
  const after = await req(`/api/orders/${orderCId}/tickets`, { token: orderToken });
  assert.ok(after.data.tickets.every((x) => x.status === "void"));
  const again = await orderAs(orderToken, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-05",
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(again.status, 200, JSON.stringify(again.data));
});

test("flash sale on a direct performance: create 200 (shop via resource); cross-shop 400", async () => {
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const H = 60 * 60 * 1000;
  const p3 = await createDirectPerf(adminToken, resId, {
    start_at: "2026-12-08T19:30:00", price_cents: 10000,
  });
  assert.equal(p3.status, 200, JSON.stringify(p3.data));
  const sale = await req("/api/admin/flash-sales", {
    method: "POST", token: adminToken,
    body: {
      performance_id: p3.data.performance.id, name: "SF direct sale",
      kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H),
    },
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  const cross = await req("/api/admin/flash-sales", {
    method: "POST", token: shopAdminToken,
    body: {
      performance_id: p3.data.performance.id, name: "SF cross sale",
      kind: "pct", discount_pct: 10, start_at: iso(-H), end_at: iso(2 * H),
    },
  });
  assert.equal(cross.status, 400, JSON.stringify(cross.data));
  assert.equal(cross.data.error, "场次不属于该店铺");
  // Member-tier discount: demo paid ¥100 in the refund test above, so
  // demo now holds a 15%-off tier and this flash order would price at
  // 7650, not 9000. A fresh account has no tier, so the flash price
  // is asserted cleanly here.
  const fresh = await register("sfflash", "sfflash123");
  const o = await orderAs(fresh.token, {
    resourceId: resId, quantity: 1, booking_date: "2026-12-08",
    performance_id: p3.data.performance.id,
    ticket_type_id: p3.data.ticket_type.id,
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 9000);
  assert.equal(o.data.flash_cents, 1000);
});

test("showtimes-final i18n: H5 483 keys/language in zh/vi/en + 82 in th/ms/id, miniprogram 270 + 82, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [483, 483, 483, 82, 82, 82]);
  for (const l of ["zh", "vi", "en"])
    assert.equal(data.I18N[l].perfPick, { zh: "请选择场次", vi: "Vui lòng chọn suất diễn", en: "Choose a performance" }[l]);
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
    assert.equal(blocks[lang].length, 270, `${lang} key count`);
    assert.ok(blocks[lang].includes("perfPick"), `perfPick missing in mini ${lang}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
});

test("showtimes-final docs: no 待补充 except the 00-readme.md:4 rule", async () => {
  const dir = path.resolve(repoDir, "docs", "10-she-ji-wen-dang");
  const hits = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("待补充")) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, ["00-readme.md:4"]);
});

test("showtimes-final Q2a: honesty markers intact in data + admin", async () => {
  const h5 = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "data.js"), "utf8",
  );
  const mini = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"), "utf8",
  );
  const admin = fs.readFileSync(
    path.resolve(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"), "utf8",
  );
  const app = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "App.jsx"), "utf8",
  );
  for (const s of ["模拟支付", "下载模拟协议", "最近模拟同步", "模拟点播", "押金（元，模拟）", "草稿订单已创建，请确认后支付（模拟支付，未扣款）"]) {
    assert.ok(h5.includes(s) || mini.includes(s), `honesty marker missing: ${s}`);
  }
  // 模拟托管中 is not an i18n string — it is a literal escrow value
  // in the web order list and the admin dashboard (kept, Q2a).
  assert.ok(app.includes("模拟托管中"), "web honesty marker missing: 模拟托管中");
  assert.ok(mini.includes('simPay: "模拟支付"'), "mini simPay missing");
  for (const s of ["模拟托管中", "下载模拟协议", "最近模拟同步", "模拟经营分析报告", "已触发模拟预警", "已模拟同步", "模拟事件"]) {
    assert.ok(admin.includes(s), `admin honesty marker missing: ${s}`);
  }
  // The exact "（模拟事件）" label is appended server-side to insight
  // titles (admin-insights.mjs) and rendered by the admin UI.
  const insights = fs.readFileSync(
    path.resolve(repoDir, "server", "routes", "admin-insights.mjs"), "utf8",
  );
  assert.ok(insights.includes("（模拟事件）"), "server honesty marker missing: （模拟事件）");
});

test("showtimes-final Q2a: internal .note blocks + 模拟/演示 code comments gone", async () => {
  const admin = fs.readFileSync(
    path.resolve(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"), "utf8",
  );
  for (const s of ["订单可在订单页处理售后", "短信群发尚未接入服务商", "以下预警中，库存/预约/售后为真实数据规则触发", "文小惠形象配置（设计未到", "账本与订单同事务记账", "管理端写资源会改库存/容量/详情", "演出须关联本店的演出剧目类资源"]) {
    assert.ok(!admin.includes(s), `internal note still present: ${s}`);
  }
  for (const s of ["演出未通过审核，不可创建场次", "当前规则：流失天数", "零成交资源"]) {
    assert.ok(admin.includes(s), `kept functional note missing: ${s}`);
  }
  // No 模拟/演示 left in a line comment (// ...) or a block-comment
  // continuation line (* ...) anywhere in product code.
  const roots = ["server", "admin/assets/js", "web/assets/js", "miniprogram"];
  const exts = [".mjs", ".js", ".jsx"];
  const bad = [];
  for (const root of roots) {
    const dir = path.resolve(repoDir, root);
    for (const f of walk(dir)) {
      if (!exts.some((e) => f.endsWith(e))) continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        if ((t.startsWith("//") || t.startsWith("*")) && (t.includes("模拟") || t.includes("演示")))
          bad.push(`${path.relative(repoDir, f)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(bad, []);
  // The one block-comment filename mention is rewritten too.
  assert.ok(!admin.includes("-模拟协议.txt. */"), "agreement filename still named in a comment");
  function walk(d) {
    const out = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
});

test("show-perf-ui: resource rows render 场次管理 for show-category resources too", async () => {
  const admin = fs.readFileSync(
    path.resolve(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"), "utf8",
  );
  // The old gate hid the button on show rows (r.category !== "show");
  // the button is now unconditional, reusing the same inline manager
  // (toggleResPerfManager + resPerfResId panel) for every resource row.
  assert.ok(!admin.includes('r.category !== "show"'), "show gate on 场次管理 still present");
  assert.ok(
    admin.includes("onClick={() => toggleResPerfManager(r)}"),
    "resource-row 场次管理 button missing",
  );
  assert.ok(admin.includes("收起场次"), "场次管理 toggle label missing");
  // The reused panel also carries the per-performance cancel control
  // (doResPerfStatus -> PATCH /api/admin/performances/:id), so a show
  // row gets create AND cancel, not create only.
  assert.ok(
    admin.includes('doResPerfStatus(pf, r.id, "cancelled")'),
    "resource-row panel cancel control missing",
  );
  // 同步渠道 stays show-only (a different feature, untouched).
  assert.ok(admin.includes("同步渠道"), "同步渠道 button missing");
  assert.ok(
    admin.includes('{r.category === "show" ? ('),
    "同步渠道 lost its show-only gate",
  );
});

test("show-perf-ui: create direct performance on a show-category resource -> 200, on_sale, default tier", async () => {
  const c = await createDirectPerf(adminToken, showResId, {
    start_at: "2026-12-07T19:30:00", price_cents: 28000,
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.performance.status, "on_sale");
  assert.equal(c.data.performance.show_id, null);
  assert.equal(c.data.performance.resource_id, showResId);
  assert.equal(c.data.performance.start_at, "2026-12-07T19:30:00");
  assert.equal(c.data.performance.price_cents, 28000);
  assert.equal(c.data.ticket_type.name, "标准票");
  assert.equal(c.data.ticket_type.price_cents, 28000);
  assert.equal(c.data.ticket_type.quota, 10);
  const a = await availability(showResId);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.ok(
    a.data.performances.some((x) => x.id === c.data.performance.id && x.status === "on_sale"),
    "new direct perf missing from availability",
  );
  // Cancel it the way the panel does (PATCH .../cancelled): it leaves
  // the on-sale list, and a cancelled performance never goes back.
  const cx = await req(`/api/admin/performances/${c.data.performance.id}`, {
    method: "PATCH", token: adminToken, body: { status: "cancelled" },
  });
  assert.equal(cx.status, 200, JSON.stringify(cx.data));
  assert.equal(cx.data.performance.status, "cancelled");
  const a2 = await availability(showResId);
  assert.equal(a2.status, 200, JSON.stringify(a2.data));
  assert.equal(
    a2.data.performances.some((x) => x.id === c.data.performance.id),
    false,
  );
  assert.equal(
    (await req(`/api/admin/performances/${c.data.performance.id}`, {
      method: "PATCH", token: adminToken, body: { status: "on_sale" },
    })).status,
    400,
  );
});
