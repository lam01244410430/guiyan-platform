// Seller-confirm tests (Lam 2026-11-16: "Để bên bán xác nhận đơn").
// Run against a REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/wave4.test.mjs: spawn server/server.mjs on TEST_PORT (default
// 3125) and talk to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database.
//
// Covered: the permission matrix for confirm/reject — buyer 403,
// platform admin 200, same-shop admin 200, other-shop admin 403;
// seller reject moves pending -> cancelled (no new status) with an
// optional reason that reaches the buyer notify + audit log only;
// buyer cancel/pay/complete keep their old rules; confirm/reject on a
// non-pending order are 400; the 4 after-sales decisions stay
// admin-only for ANY admin (unscoped); GET /api/admin/orders carries
// the resource shop_id; buyer UI no longer renders a confirm button
// (web + miniprogram) while the admin OrderRow gates its
// 确认 / 驳回 buttons on sellerCanAct.
//
// Booking dates 2026-12-26..31 are used: seed orders cover
// 2026-12-01..06, api-pg 2026-12-20, wave4 2026-12-21..25. The file
// creates its OWN shop-1 show resource in `before`, so it never
// depends on shared seed stock or on a seed show without on-sale
// performances (showtimes-final can leave those behind).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const DATABASE_URL =
  process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres: <redacted>",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3125);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

let proc;
let adminToken; // root (platform admin, shop_id NULL)
let sameShopToken; // admin, shop_id = 1 (owns the test resource)
let otherShopToken; // admin, shop_id = another shop
let otherShopId;
let demoToken;
let demoId;
let resourceId;
let day = 26;

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

async function req(p, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text };
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token;
}

async function adminLogin() {
  return login("admin", process.env.ADMIN_PASSWORD);
}

function nextDate() {
  return `2026-12-${day++}`;
}

async function createOrder(token, bookingDate) {
  const r = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId, quantity: 1, booking_date: bookingDate },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  return r.json;
}

async function transition(token, orderId, action, body) {
  return req(`/api/orders/${orderId}/${action}`, {
    method: "POST",
    token,
    body: body === undefined ? {} : body,
  });
}

// Buyer order, seller-confirmed, buyer-paid: the shared setup for
// after-sales tests (confirm goes through the platform admin now).
async function paidOrder(token, bookingDate) {
  const created = await createOrder(token, bookingDate);
  assert.equal(
    (await transition(adminToken, created.id, "confirm")).status,
    200,
    "platform admin confirms the paid-order setup",
  );
  const pay = await transition(token, created.id, "pay");
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.status, "paid");
  return created;
}

async function latestMessage(userId, title) {
  const { rows } = await pool.query(
    "SELECT * FROM messages WHERE user_id=$1 AND title=$2 ORDER BY id DESC LIMIT 1",
    [userId, title],
  );
  return rows[0] || null;
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[seller-confirm-server] ${d}`));
  proc.stderr.on("data", (d) =>
    process.stderr.write(`[seller-confirm-server:err] ${d}`),
  );
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("seller-confirm server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
  adminToken = await adminLogin();
  demoToken = await login("demo", process.env.DEMO_PASSWORD);
  demoId = (await pool.query("SELECT id FROM users WHERE username='demo'")).rows[0].id;
  // A second shop for the cross-shop admin: reuse one if an earlier
  // test file already created it, else insert one directly.
  const shops = await pool.query("SELECT id FROM shops WHERE id <> 1 ORDER BY id LIMIT 1");
  if (shops.rows.length) {
    otherShopId = shops.rows[0].id;
  } else {
    const max = await pool.query("SELECT COALESCE(MAX(id), 1) AS m FROM shops");
    otherShopId = Number(max.rows[0].m) + 1;
    await pool.query(
      "INSERT INTO shops(id, parent_id, name, owner_id, status, created_at) VALUES($1, 1, '卖方确认测试分店', NULL, 'active', $2)",
      [otherShopId, new Date().toISOString()],
    );
  }
  // Shop-scoped admins, inserted directly: register fixes role=user.
  // Same-shop owns the test resource (shop 1); other-shop owns nothing
  // the buyer orders here.
  const pw = hashPassword("Seller1234");
  for (const [username, shopId] of [
    ["sc_seller_same", 1],
    ["sc_seller_other", otherShopId],
  ]) {
    const existing = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
    if (!existing.rows.length)
      await pool.query(
        "INSERT INTO users(username,password,name,role,shop_id,city,created_at) VALUES($1,$2,$3,'admin',$4,'南宁',$5)",
        [username, pw, username === "sc_seller_same" ? "卖方确认同店管理员" : "卖方确认他店管理员", shopId, new Date().toISOString()],
      );
    else
      await pool.query("UPDATE users SET password=$1, role='admin', shop_id=$2 WHERE username=$3", [pw, shopId, username]);
  }
  sameShopToken = await login("sc_seller_same", "Seller1234");
  otherShopToken = await login("sc_seller_other", "Seller1234");
  // Own shop-1 show resource, no performances: old-flow orders only.
  const cr = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "卖方确认测试演出",
      category: "show",
      city: "南宁",
      price: 28000,
      unit: "张",
      stock: 100,
      shop_id: 1,
    },
  });
  assert.equal(cr.status, 200, JSON.stringify(cr.json));
  resourceId = cr.json.resource.id;
});

after(async () => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
  await pool.end();
});

test("seller-confirm: buyer confirm is 403 and the order stays pending", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(demoToken, o.id, "confirm");
  assert.equal(r.status, 403, JSON.stringify(r.json));
  const mine = await req("/api/orders", { token: demoToken });
  assert.equal(mine.json.orders.find((x) => x.id === o.id).status, "pending");
});

test("seller-confirm: buyer reject is 403", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(demoToken, o.id, "reject", { reason: "我不想买了" });
  assert.equal(r.status, 403, JSON.stringify(r.json));
});

test("seller-confirm: platform admin confirm is 200 + buyer gets the confirm notify", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(adminToken, o.id, "confirm");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "confirmed");
  const m = await latestMessage(demoId, "订单已确认");
  assert.ok(m, "buyer should get an 订单已确认 message");
  assert.ok(m.content.includes(o.code), JSON.stringify(m));
  assert.ok(m.content.includes("卖方已确认您的预约，请尽快完成支付"), JSON.stringify(m));
  assert.equal(m.type, "order_status");
});

test("seller-confirm: same-shop admin confirm is 200", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(sameShopToken, o.id, "confirm");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "confirmed");
});

test("seller-confirm: other-shop admin confirm and reject are 403", async () => {
  const o = await createOrder(demoToken, nextDate());
  assert.equal((await transition(otherShopToken, o.id, "confirm")).status, 403);
  assert.equal((await transition(otherShopToken, o.id, "reject", { reason: "不是我的店" })).status, 403);
  const mine = await req("/api/orders", { token: demoToken });
  assert.equal(mine.json.orders.find((x) => x.id === o.id).status, "pending");
});

test("seller-confirm: seller reject with a reason -> cancelled + buyer notify carries the reason", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(sameShopToken, o.id, "reject", { reason: "该场次已满" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "cancelled");
  const m = await latestMessage(demoId, "订单已被驳回");
  assert.ok(m, "buyer should get an 订单已被驳回 message");
  assert.ok(m.content.includes(o.code), JSON.stringify(m));
  assert.ok(m.content.includes("该场次已满"), JSON.stringify(m));
  assert.equal(m.type, "order_status");
  // The reason is NOT stored on the order row (refund_decision
  // belongs to after-sales): the row reads back without it.
  const row = (await pool.query("SELECT refund_decision, refund_reason FROM orders WHERE id=$1", [o.id])).rows[0];
  assert.equal(row.refund_decision || "", "");
  assert.equal(row.refund_reason || "", "");
});

test("seller-confirm: seller reject without a reason still works", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await transition(adminToken, o.id, "reject");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "cancelled");
});

test("seller-confirm: buyer cancel still works, buyer pay from pending is still 400", async () => {
  const o1 = await createOrder(demoToken, nextDate());
  assert.equal((await transition(demoToken, o1.id, "cancel")).status, 200);
  const o2 = await createOrder(demoToken, nextDate());
  assert.equal((await transition(demoToken, o2.id, "pay")).status, 400);
});

test("seller-confirm: confirm/reject on a confirmed order are 400", async () => {
  const o = await createOrder(demoToken, nextDate());
  assert.equal((await transition(adminToken, o.id, "confirm")).status, 200);
  assert.equal((await transition(adminToken, o.id, "confirm")).status, 400);
  assert.equal((await transition(adminToken, o.id, "reject", { reason: "晚了" })).status, 400);
});

test("seller-confirm: after-sales decisions stay admin-only for ANY admin", async () => {
  const o = await paidOrder(demoToken, nextDate());
  // The buyer cannot decide their own refund.
  assert.equal(
    (await transition(demoToken, o.id, "refund", { reason: "去不了" })).status,
    200,
  );
  assert.equal(
    (await transition(demoToken, o.id, "approveRefund")).status,
    403,
  );
  // An other-shop admin CAN still decide (unchanged: decisions are
  // admin-only, not shop-scoped).
  assert.equal((await transition(otherShopToken, o.id, "approveRefund")).status, 200);
});

test("seller-confirm: GET /api/admin/orders carries the resource shop_id", async () => {
  const o = await createOrder(demoToken, nextDate());
  const r = await req("/api/admin/orders", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = r.json.orders.find((x) => x.id === o.id);
  assert.ok(row, "new order should be in the admin list");
  assert.equal(row.shop_id, 1);
});

test("seller-confirm UI: buyer pages show no confirm button on pending orders", () => {
  const app = readFileSync(path.join(repoDir, "web/assets/js/App.jsx"), "utf8");
  const dash = readFileSync(path.join(repoDir, "web/assets/js/UserDashboard.jsx"), "utf8");
  const ordersWxml = readFileSync(path.join(repoDir, "miniprogram/pages/orders/orders.wxml"), "utf8");
  const detailWxml = readFileSync(path.join(repoDir, "miniprogram/pages/detail/detail.wxml"), "utf8");
  for (const [name, src] of [["App.jsx", app], ["UserDashboard.jsx", dash], ["orders.wxml", ordersWxml], ["detail.wxml", detailWxml]]) {
    assert.ok(!src.includes('data-act="confirm"'), `${name} still renders a confirm button`);
  }
  // The cached-page fail-safe stays: the action mapping itself is
  // untouched (the server 403s a buyer confirm).
  assert.ok(app.includes('handleOrderAction("confirm"'), "App.jsx confirm mapping removed");
  assert.ok(dash.includes('usrOrderAction("confirm"'), "UserDashboard.jsx confirm mapping removed");
  // Cancel is still offered on pending orders.
  assert.ok(app.includes('data-act="cancel"'), "App.jsx lost the cancel button");
  assert.ok(dash.includes('data-act="cancel"'), "UserDashboard.jsx lost the cancel button");
});

test("seller-confirm UI: admin OrderRow gates 确认 / 驳回 on sellerCanAct", () => {
  const src = readFileSync(
    path.join(repoDir, "admin/assets/js/AdminDashboard.jsx"),
    "utf8",
  );
  assert.ok(
    src.includes('o.status === "pending" && sellerCanAct'),
    "OrderRow must gate the seller buttons on sellerCanAct",
  );
  assert.ok(src.includes('onSeller(o.id, "confirm")'), "OrderRow must offer 确认");
  assert.ok(src.includes('onSeller(o.id, "reject")'), "OrderRow must offer 驳回");
  assert.ok(src.includes("function doSellerOrder(id, action)"), "doSellerOrder handler missing");
  // The pending "!" mark stays.
  assert.ok(src.includes('title="待确认订单"'), "pending ! mark removed");
});
