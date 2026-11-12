// Guiyan Wave 4 #12 tests (venue availability + seat-map backend) — run
// against a REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/wave3.test.mjs: spawn server/server.mjs on TEST_PORT (default
// 3104) and talk to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database (the server seeds 62 resources + demo users on
// first boot). Do not point it at any shared or production database.
//
// Run order inside `npm test`: api-pg.test.mjs and wave3.test.mjs run
// BEFORE this file, so wave4 tests must never assert exact seed counts
// for orders/stock — earlier tests create orders and move stock.
// Expectations are computed from the live database (via the API) instead.
//
// Booking dates 2026-12-21..25 are used throughout: seed orders only
// cover 2026-12-01..06, and api-pg uses 2026-12-20, so these dates start
// clean on every resource. The seat-map itself has no jsdom harness in
// this repo — it is checked by build + live browser, not here.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5433/guiyan_test",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3104);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const D1 = "2026-12-21";
const D2 = "2026-12-22";
const D3 = "2026-12-23";
const D4 = "2026-12-24";
const D5 = "2026-12-25";

let proc;

async function req(p, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(username = "demo", password = process.env.DEMO_PASSWORD) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

async function listByCategory(category) {
  const r = await req(`/api/resources?category=${category}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.resources) && r.json.resources.length > 0, `no ${category} resources`);
  return r.json.resources;
}

async function createOrder(token, resourceId, quantity, bookingDate) {
  const r = await req("/api/orders", {
    method: "POST",
    body: { resourceId, quantity, booking_date: bookingDate },
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  return r.json;
}

function beijingToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: wave4 never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[wave4-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[wave4-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("wave4 server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

// --- #12: venue availability (rental 0/1) ---------------------------------

test("wave4 #12: rental venue is 1 on a free day, 0 once booked that day", async () => {
  const venues = await listByCategory("venue");
  const v = venues[0];
  const free = await req(`/api/resources/${v.id}/availability?date=${D1}`);
  assert.equal(free.status, 200, JSON.stringify(free.json));
  assert.equal(free.json.id, v.id);
  assert.equal(free.json.date, D1);
  assert.equal(free.json.mode, "rental");
  assert.equal(free.json.available, 1);
  assert.equal(free.json.capacity, v.stock);
  assert.ok(!free.json.dates.some((d) => d.booking_date === D1));

  const token = await login();
  await createOrder(token, v.id, 1, D1);
  const booked = await req(`/api/resources/${v.id}/availability?date=${D1}`);
  assert.equal(booked.status, 200);
  assert.equal(booked.json.mode, "rental");
  assert.equal(booked.json.available, 0);
  assert.ok(booked.json.dates.some((d) => d.booking_date === D1));
  const otherDay = await req(`/api/resources/${v.id}/availability?date=${D2}`);
  assert.equal(otherDay.status, 200);
  assert.equal(otherDay.json.available, 1);
});

// --- #12: date mode = live stock minus booked that day ---------------------

test("wave4 #12: show availability is stock minus tickets booked that day", async () => {
  const shows = await listByCategory("show");
  const s = shows.find((r) => r.stock >= 10);
  assert.ok(s, "need a show with stock >= 10");
  const token = await login();
  await createOrder(token, s.id, 2, D2);
  const res = await req(`/api/resources/${s.id}`);
  assert.equal(res.status, 200);
  const stockNow = res.json.resource.stock;
  const av = await req(`/api/resources/${s.id}/availability?date=${D2}`);
  assert.equal(av.status, 200, JSON.stringify(av.json));
  assert.equal(av.json.mode, "date");
  assert.equal(av.json.capacity, stockNow);
  assert.equal(av.json.available, stockNow - 2);
  assert.ok(av.json.dates.some((d) => d.booking_date === D2));
});

// --- #12: service mode is null, date defaults to today (Beijing) ----------

test("wave4 #12: service availability is null and date defaults to today", async () => {
  const services = await listByCategory("service");
  const s = services[0];
  const av = await req(`/api/resources/${s.id}/availability`);
  assert.equal(av.status, 200, JSON.stringify(av.json));
  assert.equal(av.json.mode, "none");
  assert.equal(av.json.available, null);
  assert.equal(av.json.date, beijingToday());
});

// --- #12: global mode = stock, ignoring the date ---------------------------

test("wave4 #12: global availability equals stock", async () => {
  const items = await listByCategory("copyright");
  const item = items[0];
  const av = await req(`/api/resources/${item.id}/availability?date=${D1}`);
  assert.equal(av.status, 200, JSON.stringify(av.json));
  assert.equal(av.json.mode, "global");
  assert.equal(av.json.available, item.stock);
  assert.equal(av.json.capacity, item.stock);
});

// --- #12: bad/past date -> 400, missing resource -> 404 --------------------

test("wave4 #12: bad or past date is 400, missing resource is 404", async () => {
  const venues = await listByCategory("venue");
  const v = venues[0];
  for (const bad of ["not-a-date", "2026-13-01", "2026-11-01", "2026-02-30"]) {
    const r = await req(`/api/resources/${v.id}/availability?date=${bad}`);
    assert.equal(r.status, 400, `${bad}: ${JSON.stringify(r.json)}`);
  }
  const missing = await req("/api/resources/999999/availability");
  assert.equal(missing.status, 404);
});

// --- #12: unpublished is 404 for non-admin, 200 for admin -----------------

test("wave4 #12: unpublished resource is 404 for non-admin, 200 for admin", async () => {
  const items = await listByCategory("creative");
  const item = items[0];
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await pool.query("UPDATE resources SET status='draft' WHERE id=$1", [item.id]);
    const anon = await req(`/api/resources/${item.id}/availability?date=${D1}`);
    assert.equal(anon.status, 404, JSON.stringify(anon.json));
    const user = await req(`/api/resources/${item.id}/availability?date=${D1}`, { token: await login() });
    assert.equal(user.status, 404, JSON.stringify(user.json));
    const admin = await req(`/api/resources/${item.id}/availability?date=${D1}`, { token: await adminLogin() });
    assert.equal(admin.status, 200, JSON.stringify(admin.json));
    assert.equal(admin.json.mode, "global");
  } finally {
    await pool.query("UPDATE resources SET status='published' WHERE id=$1", [item.id]);
    await pool.end();
  }
});

// --- #12: dates excludes cancelled/refunded ---------------------------------

test("wave4 #12: dates lists active bookings only, not cancelled ones", async () => {
  const venues = await listByCategory("venue");
  const v = venues[1];
  const token = await login();
  const o1 = await createOrder(token, v.id, 1, D3);
  const cancelled = await req(`/api/orders/${o1.id}/cancel`, { method: "POST", token });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.status, "cancelled");
  await createOrder(token, v.id, 1, D4);
  const av = await req(`/api/resources/${v.id}/availability?date=${D4}`);
  assert.equal(av.status, 200, JSON.stringify(av.json));
  assert.equal(av.json.available, 0);
  const days = av.json.dates.map((d) => d.booking_date);
  assert.ok(days.includes(D4), JSON.stringify(days));
  assert.ok(!days.includes(D3), JSON.stringify(days));
});

// --- #12: multiple bookings on one day accumulate ---------------------------

test("wave4 #12: multiple bookings on one day accumulate", async () => {
  const shows = await listByCategory("show");
  const s = shows.find((r) => r.stock >= 10);
  assert.ok(s, "need a show with stock >= 10");
  const token = await login();
  await createOrder(token, s.id, 2, D5);
  await createOrder(token, s.id, 3, D5);
  const res = await req(`/api/resources/${s.id}`);
  assert.equal(res.status, 200);
  const stockNow = res.json.resource.stock;
  const av = await req(`/api/resources/${s.id}/availability?date=${D5}`);
  assert.equal(av.status, 200, JSON.stringify(av.json));
  assert.equal(av.json.mode, "date");
  assert.equal(av.json.available, stockNow - 5);
  assert.equal(av.json.dates.filter((d) => d.booking_date === D5).length, 2);
});

// --- #15: simulated agreement per order (具体功能 #12) -------------------

test("wave4 #15: contract owner gets 200 with simulation header + scope/term lines", async () => {
  const items = await listByCategory("copyright");
  const item = items.find((r) => r.stock >= 1);
  assert.ok(item, "need a copyright resource with stock");
  const detail = await req(`/api/resources/${item.id}`);
  assert.equal(detail.status, 200);
  const meta = detail.json.resource.meta;
  assert.ok(meta && typeof meta === "object", JSON.stringify(detail.json.resource));
  const token = await login();
  const order = await createOrder(token, item.id, 1, D1);
  const c = await req(`/api/orders/${order.id}/contract`, { token });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.title, "模拟服务与授权协议");
  assert.ok(c.json.content.includes("【毕业实习演示文件，无真实合同效力】"), c.json.content);
  assert.ok(c.json.content.includes(`订单：${order.code}`), c.json.content);
  assert.ok(c.json.content.includes(`资源：${item.name}`), c.json.content);
  assert.ok(c.json.content.includes(`日期：${D1}`), c.json.content);
  assert.ok(c.json.content.includes("元（模拟）"), c.json.content);
  if (meta.scope) assert.ok(c.json.content.includes(`授权范围：${meta.scope}`), c.json.content);
  if (meta.term) assert.ok(c.json.content.includes(`期限：${meta.term}`), c.json.content);
  if (meta.territory) assert.ok(c.json.content.includes(`区域：${meta.territory}`), c.json.content);
  assert.ok(c.json.content.includes("设备押金："), c.json.content);
  assert.ok(c.json.content.includes("仅展示，不收取"), c.json.content);
  assert.ok(c.json.content.includes("服务流程：预约→审核→模拟支付→服务完成→模拟结算"), c.json.content);
  assert.ok(c.json.content.includes("纠纷可通过订单申诉提交，资金状态仅为本地模拟。"), c.json.content);
});

test("wave4 #15: another user gets 403 on someone else's contract", async () => {
  const items = await listByCategory("copyright");
  const item = items.find((r) => r.stock >= 1);
  assert.ok(item, "need a copyright resource with stock");
  const order = await createOrder(await login(), item.id, 1, D2);
  const uname = "wave4other" + Date.now().toString(36);
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { username: uname, password: "guiyan2026", name: "协议测试" },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  const other = await req(`/api/orders/${order.id}/contract`, { token: reg.json.token });
  assert.equal(other.status, 403, JSON.stringify(other.json));
});

test("wave4 #15: admin gets 200 on any order's contract", async () => {
  const items = await listByCategory("copyright");
  const item = items.find((r) => r.stock >= 1);
  assert.ok(item, "need a copyright resource with stock");
  const order = await createOrder(await login(), item.id, 1, D3);
  const c = await req(`/api/orders/${order.id}/contract`, { token: await adminLogin() });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.ok(c.json.content.includes(`订单：${order.code}`), c.json.content);
});

test("wave4 #15: missing order is 404, anonymous is 401", async () => {
  const token = await login();
  const missing = await req("/api/orders/999999/contract", { token });
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
  const anon = await req("/api/orders/999999/contract");
  assert.equal(anon.status, 401, JSON.stringify(anon.json));
});

test("wave4 #15: GET /api/resources/:id returns meta", async () => {
  const shows = await listByCategory("show");
  const s = shows.find((r) => r.meta && r.meta.duration != null);
  assert.ok(s, "need a show with meta.duration in the list response");
  const res = await req(`/api/resources/${s.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const meta = res.json.resource.meta;
  assert.ok(meta && typeof meta === "object", JSON.stringify(res.json.resource));
  assert.equal(meta.duration, s.meta.duration);
  assert.ok(Object.keys(meta).length > 0, JSON.stringify(meta));
});

// --- #13: refund/dispute flow ----------------------------------------------
// Wave 4 #13 BEHAVIOR CHANGE (Q2): refund no longer completes at once.
// paid -> refund_requested waits for an admin decision; only approveRefund
// moves it to refunded. No earlier test asserted refund -> refunded
// directly, so no old test needed updating for this change; the flow
// below pins the new behavior instead.

async function paidOrder(token, resourceId, quantity, bookingDate) {
  const created = await createOrder(token, resourceId, quantity, bookingDate);
  const confirm = await req(`/api/orders/${created.id}/confirm`, { method: "POST", token });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  const pay = await req(`/api/orders/${created.id}/pay`, { method: "POST", token });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.status, "paid");
  return created;
}

async function myOrder(token, id) {
  const list = await req("/api/orders", { token });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const o = list.json.orders.find((x) => x.id === id);
  assert.ok(o, `order ${id} missing from own list`);
  return o;
}

async function stockOf(resourceId) {
  const r = await req(`/api/resources/${resourceId}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.resource.stock;
}

async function pickShow(minStock = 1) {
  const shows = await listByCategory("show");
  const s = shows.find((r) => r.stock >= minStock);
  assert.ok(s, `need a show with stock >= ${minStock}`);
  return s;
}

test("wave4 #13: refund goes paid -> refund_requested, reason stored, stock held", async () => {
  const token = await login();
  const s = await pickShow(2);
  const before = await stockOf(s.id);
  const order = await paidOrder(token, s.id, 2, D4);
  assert.equal(await stockOf(s.id), before - 2);
  const r = await req(`/api/orders/${order.id}/refund`, {
    method: "POST",
    token,
    body: { reason: "临时有事，去不了了" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "refund_requested");
  const mine = await myOrder(token, order.id);
  assert.equal(mine.status, "refund_requested");
  assert.equal(mine.refund_reason, "临时有事，去不了了");
  assert.equal(mine.escrow, "模拟托管中");
  // Q3: an intermediate state holds the stock — nothing is returned yet.
  assert.equal(await stockOf(s.id), before - 2);
});

test("wave4 #13: approveRefund moves refund_requested -> refunded, returns stock", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const before = await stockOf(s.id);
  const order = await paidOrder(token, s.id, 1, D4);
  await req(`/api/orders/${order.id}/refund`, { method: "POST", token, body: { reason: "改期" } });
  const r = await req(`/api/orders/${order.id}/approveRefund`, { method: "POST", token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "refunded");
  const mine = await myOrder(token, order.id);
  assert.equal(mine.status, "refunded");
  assert.equal(mine.refund_decision, "审核通过，已模拟退款");
  assert.equal(mine.refund_reason, "改期");
  assert.equal(mine.escrow, "已模拟退款");
  // Final state: the stock comes back.
  assert.equal(await stockOf(s.id), before);
});

test("wave4 #13: approveRefund also works from disputed", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, D5);
  const d = await req(`/api/orders/${order.id}/dispute`, { method: "POST", token, body: { reason: "与商家有争议" } });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.status, "disputed");
  const r = await req(`/api/orders/${order.id}/approveRefund`, { method: "POST", token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "refunded");
  const mine = await myOrder(token, order.id);
  assert.equal(mine.refund_decision, "审核通过，已模拟退款");
  assert.equal(mine.escrow, "已模拟退款");
});

test("wave4 #13: rejectRefund needs a reason; with one it returns to paid", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, D5);
  await req(`/api/orders/${order.id}/refund`, { method: "POST", token, body: { reason: "想退" } });
  const noReason = await req(`/api/orders/${order.id}/rejectRefund`, { method: "POST", token: admin, body: {} });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.json));
  assert.equal((await myOrder(token, order.id)).status, "refund_requested");
  const r = await req(`/api/orders/${order.id}/rejectRefund`, {
    method: "POST",
    token: admin,
    body: { reason: "已过可退时限" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "paid");
  const mine = await myOrder(token, order.id);
  assert.equal(mine.refund_decision, "已过可退时限");
  assert.equal(mine.refund_reason, "想退");
  assert.equal(mine.escrow, "模拟托管中");
});

test("wave4 #13: dispute -> disputed; resolve settles; rejectDispute needs a reason", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  // resolve path
  const o1 = await paidOrder(token, s.id, 1, D4);
  const d1 = await req(`/api/orders/${o1.id}/dispute`, { method: "POST", token, body: { reason: "座位与描述不符" } });
  assert.equal(d1.status, 200, JSON.stringify(d1.json));
  assert.equal(d1.json.status, "disputed");
  assert.equal((await myOrder(token, o1.id)).refund_reason, "座位与描述不符");
  const res = await req(`/api/orders/${o1.id}/resolve`, { method: "POST", token: admin });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, "completed");
  assert.equal((await myOrder(token, o1.id)).escrow, "已结算");
  // rejectDispute path
  const o2 = await paidOrder(token, s.id, 1, D5);
  await req(`/api/orders/${o2.id}/dispute`, { method: "POST", token, body: { reason: "申诉理由" } });
  const noReason = await req(`/api/orders/${o2.id}/rejectDispute`, { method: "POST", token: admin, body: {} });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.json));
  assert.equal((await myOrder(token, o2.id)).status, "disputed");
  const rej = await req(`/api/orders/${o2.id}/rejectDispute`, {
    method: "POST",
    token: admin,
    body: { reason: "申诉不成立" },
  });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  assert.equal(rej.json.status, "paid");
  assert.equal((await myOrder(token, o2.id)).refund_decision, "申诉不成立");
});

test("wave4 #13: wrong-direction transitions are 400", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const pending = await createOrder(token, s.id, 1, D4);
  const refundPending = await req(`/api/orders/${pending.id}/refund`, { method: "POST", token });
  assert.equal(refundPending.status, 400, JSON.stringify(refundPending.json));
  const paid = await paidOrder(token, s.id, 1, D5);
  for (const [action, by] of [["approveRefund", admin], ["resolve", admin], ["rejectRefund", admin], ["rejectDispute", admin]]) {
    const r = await req(`/api/orders/${paid.id}/${action}`, { method: "POST", token: by, body: { reason: "x" } });
    assert.equal(r.status, 400, `${action} on paid: ${JSON.stringify(r.json)}`);
  }
  const disputed = await paidOrder(token, s.id, 1, D4);
  await req(`/api/orders/${disputed.id}/dispute`, { method: "POST", token, body: { reason: "争议" } });
  const again = await req(`/api/orders/${disputed.id}/dispute`, { method: "POST", token, body: { reason: "再申诉" } });
  assert.equal(again.status, 400, JSON.stringify(again.json));
  const refundDisputed = await req(`/api/orders/${disputed.id}/refund`, { method: "POST", token });
  assert.equal(refundDisputed.status, 400, JSON.stringify(refundDisputed.json));
});

test("wave4 #13: the four decisions are admin-only (owner gets 403)", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const o1 = await paidOrder(token, s.id, 1, D4);
  await req(`/api/orders/${o1.id}/refund`, { method: "POST", token, body: { reason: "想退" } });
  for (const action of ["approveRefund", "rejectRefund"]) {
    const r = await req(`/api/orders/${o1.id}/${action}`, { method: "POST", token, body: { reason: "我自己批" } });
    assert.equal(r.status, 403, `${action} by owner: ${JSON.stringify(r.json)}`);
  }
  assert.equal((await myOrder(token, o1.id)).status, "refund_requested");
  const o2 = await paidOrder(token, s.id, 1, D5);
  await req(`/api/orders/${o2.id}/dispute`, { method: "POST", token, body: { reason: "争议" } });
  for (const action of ["resolve", "rejectDispute"]) {
    const r = await req(`/api/orders/${o2.id}/${action}`, { method: "POST", token, body: { reason: "我自己判" } });
    assert.equal(r.status, 403, `${action} by owner: ${JSON.stringify(r.json)}`);
  }
  assert.equal((await myOrder(token, o2.id)).status, "disputed");
  // Admin can still decide both orders afterwards.
  assert.equal((await req(`/api/orders/${o1.id}/approveRefund`, { method: "POST", token: admin })).status, 200);
  assert.equal((await req(`/api/orders/${o2.id}/resolve`, { method: "POST", token: admin })).status, 200);
});

test("wave4 #13: admin calling an old transition on someone else's order is still 403", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const pending = await createOrder(token, s.id, 1, D4);
  const confirm = await req(`/api/orders/${pending.id}/confirm`, { method: "POST", token: admin });
  assert.equal(confirm.status, 403, JSON.stringify(confirm.json));
  await req(`/api/orders/${pending.id}/confirm`, { method: "POST", token });
  const pay = await req(`/api/orders/${pending.id}/pay`, { method: "POST", token: admin });
  assert.equal(pay.status, 403, JSON.stringify(pay.json));
  const paid = await paidOrder(token, s.id, 1, D5);
  const complete = await req(`/api/orders/${paid.id}/complete`, { method: "POST", token: admin });
  assert.equal(complete.status, 403, JSON.stringify(complete.json));
  const cancel = await req(`/api/orders/${pending.id}/cancel`, { method: "POST", token: admin });
  assert.equal(cancel.status, 403, JSON.stringify(cancel.json));
  // The orders are untouched by the admin attempts.
  assert.equal((await myOrder(token, pending.id)).status, "confirmed");
  assert.equal((await myOrder(token, paid.id)).status, "paid");
});

test("wave4 #13: an admin decision writes a notify message to the owner", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, D4);
  await req(`/api/orders/${order.id}/refund`, { method: "POST", token, body: { reason: "去不了" } });
  await req(`/api/orders/${order.id}/approveRefund`, { method: "POST", token: admin });
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      "SELECT * FROM messages WHERE user_id=(SELECT id FROM users WHERE username='demo') AND title='订单售后处理结果' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(rows.length, 1, "expected one after-sales message for the owner");
    assert.ok(rows[0].content.includes(order.code), rows[0].content);
    assert.ok(rows[0].content.includes("已模拟退款"), rows[0].content);
    assert.ok(rows[0].content.includes("模拟"), rows[0].content);
  } finally {
    await pool.end();
  }
});

test("wave4 #13: refund/dispute by another user is 403; admin may call them", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const uname = "w4o13" + Date.now().toString(36);
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { username: uname, password: "guiyan2026", name: "售后测试" },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  const other = reg.json.token;
  const order = await paidOrder(token, s.id, 1, D5);
  const refundOther = await req(`/api/orders/${order.id}/refund`, { method: "POST", token: other });
  assert.equal(refundOther.status, 403, JSON.stringify(refundOther.json));
  const disputeOther = await req(`/api/orders/${order.id}/dispute`, { method: "POST", token: other });
  assert.equal(disputeOther.status, 403, JSON.stringify(disputeOther.json));
  const refundAdmin = await req(`/api/orders/${order.id}/refund`, { method: "POST", token: admin, body: { reason: "管理员代申请" } });
  assert.equal(refundAdmin.status, 200, JSON.stringify(refundAdmin.json));
  assert.equal(refundAdmin.json.status, "refund_requested");
  assert.equal((await myOrder(token, order.id)).refund_reason, "管理员代申请");
});

// --- #13 B-035: a re-requested refund must not carry the old decision ----
// paid -> refund (A) -> rejectRefund (B) -> paid -> refund (C): the second
// request overwrites refund_reason with C and clears refund_decision, so
// the stale rejection B never shows on a pending request again.

test("wave4 #13 B-035: refund after a rejected refund clears the old refund_decision", async () => {
  const token = await login();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, D5);
  const r1 = await req(`/api/orders/${order.id}/refund`, {
    method: "POST",
    token,
    body: { reason: "理由A" },
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.status, "refund_requested");
  const rej = await req(`/api/orders/${order.id}/rejectRefund`, {
    method: "POST",
    token: admin,
    body: { reason: "理由B" },
  });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  assert.equal(rej.json.status, "paid");
  assert.equal((await myOrder(token, order.id)).refund_decision, "理由B");
  const r2 = await req(`/api/orders/${order.id}/refund`, {
    method: "POST",
    token,
    body: { reason: "理由C" },
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal(r2.json.status, "refund_requested");
  const mine = await myOrder(token, order.id);
  assert.equal(mine.status, "refund_requested");
  assert.equal(mine.refund_reason, "理由C");
  assert.equal(mine.refund_decision, "");
});
