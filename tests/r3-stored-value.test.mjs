// tests/r3-stored-value.test.mjs: R3-6 (rows 26, 27, 28, 77) — stored
// value 文惠卡: top-up plans + cap + bonus; ledger + CSV export; buy
// with the card (shortfall simulated); refund back to the card first;
// row 77 platform coupon + subsidy grant. Spawns server/server.mjs on
// TEST_PORT (default 3111) and talks to it over HTTP. DATABASE_URL must
// point at a FRESH disposable database (npm test is NOT idempotent on a
// reused DB).
//
// Covered: 3 default plans (public + admin lists, unknown shop 404,
// anon/non-admin admin 403); top-up 100 -> bonus 10 -> balance 110
// (topup + bonus ledger rows, profile balance real); buy ¥120 -> 110
// from the card + 10 simulated remainder (pay response + order row +
// spend ledger row, balance 0); refund approval -> 110 back to the
// card first (refund ledger row); cap ¥5000 enforced on top-up and
// grant (8 x ¥500 plan -> ¥4800, 9th -> 400, balance unchanged);
// top-up validation (unknown plan 404, disabled plan 400, anon 401);
// ledger paging + CSV export (BOM + 6 columns + row count, own +
// admin); row 77 platform coupon (shop_id NULL: works in another
// shop, shop coupon wins on the same code, duplicate platform code
// 409, shop-scoped admin cannot create one); subsidy grant (balance +
// bonus ledger row, cross-shop 403, validation 400/404); plan admin
// CRUD + cross-shop 403; i18n key counts (H5 418, miniprogram 231,
// equal sets).
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

async function reqRaw(path, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "GET", headers });
  // BOM on raw bytes: Response.text() decodes UTF-8 and strips a leading
  // U+FEFF, so startsWith("\uFEFF") can never pass even though the wire
  // bytes are correct (same trap as the admin orders CSV test in
  // api-pg.test.mjs). TextDecoder also strips the BOM, so `text` starts
  // at the header with no slice.
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, text: new TextDecoder("utf-8").decode(buf), buf };
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

async function topup(token, planId) {
  return req("/api/account/topup", { method: "POST", token, body: { plan_id: planId } });
}

async function storedValue(token) {
  return req("/api/account/stored-value", { token });
}

async function planIdFor(amountCents) {
  const plans = await req("/api/shops/1/stored-value-plans");
  assert.equal(plans.status, 200, JSON.stringify(plans.data));
  const plan = (plans.data.stored_value_plans || []).find(
    (p) => p.amount_cents === amountCents,
  );
  assert.ok(plan, `no plan for amount ${amountCents}`);
  return plan.id;
}

let adminToken;
let demoToken;
let plain120Id;
let plain280Id;
// Shop B + its scoped admin (created in the row-77 test, reused by
// the grant + plan cross-shop tests below).
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
  demoToken = await login("demo", "demo123");
  // Deterministic plain resources for old-flow orders (fresh
  // registered users hold no tier, so their orders are full price
  // until they earn one).
  for (const [price, key] of [[12000, "plain120Id"], [28000, "plain280Id"]]) {
    const plain = await req("/api/admin/resources", {
      method: "POST",
      token: adminToken,
      body: {
        name: `R3 stored-value ${price}`, category: "digital", city: "南宁",
        price, unit: "张", stock: 100, shop_id: 1,
      },
    });
    assert.equal(plain.status, 200, JSON.stringify(plain.data));
    if (key === "plain120Id") plain120Id = plain.data.resource.id;
    else plain280Id = plain.data.resource.id;
  }
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("default plans: 3 seeded plans, public list, unknown shop 404, anon/non-admin admin 403", async () => {
  const pub = await req("/api/shops/1/stored-value-plans");
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.deepEqual(
    (pub.data.stored_value_plans || []).map((p) => [p.amount_cents, p.bonus_cents]),
    [[10000, 1000], [20000, 3000], [50000, 10000]],
  );
  assert.equal((await req("/api/shops/99999/stored-value-plans")).status, 404);
  const list = await req("/api/admin/stored-value-plans", { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.stored_value_plans.length, 3);
  assert.equal((await req("/api/admin/stored-value-plans")).status, 403);
  assert.equal((await req("/api/admin/stored-value-plans", { token: demoToken })).status, 403);
});

test("top-up 100 -> bonus 10 -> balance 110; ledger topup+bonus; profile balance real", async () => {
  const { token, id } = await register("svtopup", "Test1234");
  // No account yet: balance 0, empty ledger, plans still listed.
  const empty = await storedValue(token);
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.equal(empty.data.account, null);
  assert.equal(empty.data.total, 0);
  assert.deepEqual(empty.data.ledger, []);
  assert.equal(empty.data.plans.length, 3);

  const planId = await planIdFor(10000);
  const topped = await topup(token, planId);
  assert.equal(topped.status, 200, JSON.stringify(topped.data));
  assert.equal(topped.data.simulated, true);
  assert.equal(topped.data.account.balance_cents, 11000);
  assert.equal(topped.data.account.user_id, id);
  assert.equal(topped.data.account.shop_id, 1);

  const after = await storedValue(token);
  assert.equal(after.data.account.balance_cents, 11000);
  assert.equal(after.data.total, 2);
  const kinds = after.data.ledger.map((l) => [l.kind, l.amount_cents]);
  assert.ok(kinds.some(([k, a]) => k === "topup" && a === 10000), JSON.stringify(kinds));
  assert.ok(kinds.some(([k, a]) => k === "bonus" && a === 1000), JSON.stringify(kinds));
  assert.ok(after.data.ledger.every((l) => l.kind_label), "ledger rows carry kind_label");

  // The Wave 3 #11 portrait now reports the REAL balance.
  const profile = await req("/api/profile", { token });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.profile.portrait.spending.balance, 11000);
  assert.equal(profile.data.profile.portrait.spending.storedValue, "已接入");
});

test("buy ¥120 -> 110 from card + 10 simulated remainder; balance 0; spend ledger row", async () => {
  const { token } = await register("svbuy", "Test1234");
  const planId = await planIdFor(10000);
  assert.equal((await topup(token, planId)).status, 200);
  const before = await storedValue(token);
  assert.equal(before.data.account.balance_cents, 11000);

  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain120Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 12000);
  assert.equal(o.data.stored_value_cents, 0);
  const paid = await payThrough(token, o.data.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.stored_value_cents, 11000);
  assert.equal(paid.remainder_cents, 1000);

  const order = await req(`/api/orders/${o.data.id}`, { token });
  assert.equal(order.data.order.stored_value_cents, 11000);
  assert.equal(order.data.order.amount, 12000);
  const after = await storedValue(token);
  assert.equal(after.data.account.balance_cents, 0);
  const spend = after.data.ledger.find((l) => l.kind === "spend");
  assert.ok(spend, JSON.stringify(after.data.ledger));
  assert.equal(spend.amount_cents, -11000);
  assert.equal(spend.order_id, o.data.id);
});

test("refund -> card first: approveRefund returns 110 to the card; refund ledger row", async () => {
  const { token } = await register("svrefund", "Test1234");
  const planId = await planIdFor(10000);
  assert.equal((await topup(token, planId)).status, 200);
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain120Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await payThrough(token, o.data.id);
  const mid = await storedValue(token);
  assert.equal(mid.data.account.balance_cents, 0);

  assert.equal((await transition(token, o.data.id, "refund", { reason: "不去了" })).status, 200);
  // A requested (not yet approved) refund writes no ledger row.
  const requested = await storedValue(token);
  assert.equal(requested.data.account.balance_cents, 0);
  assert.equal(requested.data.ledger.filter((l) => l.kind === "refund").length, 0);

  const approved = await transition(adminToken, o.data.id, "approveRefund");
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.refunded_to_card_cents, 11000);
  const after = await storedValue(token);
  assert.equal(after.data.account.balance_cents, 11000);
  const refund = after.data.ledger.find((l) => l.kind === "refund");
  assert.ok(refund, JSON.stringify(after.data.ledger));
  assert.equal(refund.amount_cents, 11000);
  assert.equal(refund.order_id, o.data.id);
  // The order keeps its stored_value_cents snapshot as history.
  const order = await req(`/api/orders/${o.data.id}`, { token });
  assert.equal(order.data.order.stored_value_cents, 11000);
});

test("cap ¥5000: 8 x ¥500 plan -> ¥4800, 9th -> 400, balance unchanged; grant over cap -> 400", async () => {
  const { token, id } = await register("svcap", "Test1234");
  const planId = await planIdFor(50000);
  for (let i = 0; i < 8; i++) {
    const r = await topup(token, planId);
    assert.equal(r.status, 200, `top-up ${i + 1} -> ${r.status} ${JSON.stringify(r.data)}`);
  }
  const full = await storedValue(token);
  assert.equal(full.data.account.balance_cents, 480000);
  // The 9th top-up would take the balance to ¥5400 — over the cap.
  const over = await topup(token, planId);
  assert.equal(over.status, 400, JSON.stringify(over.data));
  const still = await storedValue(token);
  assert.equal(still.data.account.balance_cents, 480000);
  // A grant that would also cross the cap fails the same way.
  const grant = await req("/api/admin/stored-value/grant", {
    method: "POST",
    token: adminToken,
    body: { user_id: id, amount_cents: 30000 },
  });
  assert.equal(grant.status, 400, JSON.stringify(grant.data));
  const still2 = await storedValue(token);
  assert.equal(still2.data.account.balance_cents, 480000);
});

test("top-up validation: unknown plan 404, disabled plan 400, anon 401", async () => {
  const { token } = await register("svvalid", "Test1234");
  assert.equal((await topup(token, 99999)).status, 404);
  assert.equal((await topup(undefined, await planIdFor(10000))).status, 401);
  assert.equal((await storedValue(undefined)).status, 401);
  // A disabled plan exists but cannot be bought.
  const created = await req("/api/admin/stored-value-plans", {
    method: "POST",
    token: adminToken,
    body: { amount_cents: 1000, bonus_cents: 0, status: "disabled" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const disabledId = created.data.stored_value_plan.id;
  assert.equal((await topup(token, disabledId)).status, 400);
  // The disabled plan never appears in the public list.
  const pub = await req("/api/shops/1/stored-value-plans");
  assert.ok(!(pub.data.stored_value_plans || []).some((p) => p.id === disabledId));
});

test("ledger paging + CSV export: BOM, 6 columns, row count (own + admin)", async () => {
  const { token, id } = await register("svcsv", "Test1234");
  const planId = await planIdFor(10000);
  assert.equal((await topup(token, planId)).status, 200);
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain120Id, quantity: 1, booking_date: "2026-12-05" },
  });
  await payThrough(token, o.data.id);
  const full = await storedValue(token);
  assert.ok(full.data.total >= 3, `expected topup+bonus+spend, got ${full.data.total}`);
  const page = await req("/api/account/stored-value?limit=2", { token });
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.equal(page.data.ledger.length, 2);
  assert.equal(page.data.total, full.data.total);
  // Newest first: the spend row (pay) comes before the top-up rows.
  assert.equal(page.data.ledger[0].kind, "spend");

  const csv = await reqRaw("/api/account/stored-value?format=csv", { token });
  assert.equal(csv.status, 200);
  assert.deepEqual(
    [...csv.buf.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "CSV must start with a UTF-8 BOM",
  );
  const lines = csv.text.split("\r\n");
  assert.equal(lines[0], '"流水号","时间","类型","金额(元)","订单号","备注"');
  assert.equal(lines.length - 1, full.data.total);
  assert.ok(lines.some((l) => l.includes('"消费"') && l.includes('110.00')), lines.join("\n"));

  const adminCsv = await reqRaw(`/api/admin/stored-value/${id}?format=csv`, { token: adminToken });
  assert.equal(adminCsv.status, 200);
  assert.deepEqual(
    [...adminCsv.buf.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "admin CSV must start with a UTF-8 BOM",
  );
  assert.equal(adminCsv.text.split("\r\n").length - 1, full.data.total);
  assert.equal((await reqRaw(`/api/admin/stored-value/${id}?format=csv`)).status, 403);
});

test("row 77: platform coupon (shop_id NULL) works in another shop; shop coupon wins; dup 409; scoped admin 403", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3sv-admin", pw, "R3 储值子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 储值分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r3sv-admin", "Admin1234");

  // A platform coupon: explicit shop_id null, fixed ¥50 off, min ¥100,
  // per-user limit 10 (the same user redeems it twice below, in shop 1
  // and in shop B).
  const plat = await req("/api/admin/coupons", {
    method: "POST", token: adminToken,
    body: { shop_id: null, code: "PLAT77", kind: "fixed", value_cents: 5000, min_spend_cents: 10000, per_user_limit: 10 },
  });
  assert.equal(plat.status, 200, JSON.stringify(plat.data));
  assert.equal(plat.data.coupon.shop_id, null);
  // A second platform coupon with the same code -> 409 (the NULL-shop
  // pre-check is the real guard — Postgres UNIQUE ignores NULLs).
  assert.equal((await req("/api/admin/coupons", {
    method: "POST", token: adminToken,
    body: { shop_id: null, code: "PLAT77", kind: "fixed", value_cents: 1000, min_spend_cents: 0 },
  })).status, 409);
  // A shop-scoped admin cannot create a platform coupon.
  assert.equal((await req("/api/admin/coupons", {
    method: "POST", token: shopAdminToken,
    body: { shop_id: null, code: "PLAT88", kind: "fixed", value_cents: 1000, min_spend_cents: 0 },
  })).status, 403);

  // The platform coupon works on a shop-1 order (lowercase code is
  // normalized, as before).
  const { token } = await register("svplat", "Test1234");
  const o1 = await req("/api/orders", {
    method: "POST", token,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05", coupon_code: "plat77" },
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  assert.equal(o1.data.coupon_cents, 5000);
  assert.equal(o1.data.amount, 23000);

  // A shop-1 coupon with the SAME code wins over the platform one.
  const shopCoupon = await req("/api/admin/coupons", {
    method: "POST", token: adminToken,
    body: { shop_id: 1, code: "PLAT77", kind: "fixed", value_cents: 7000, min_spend_cents: 10000 },
  });
  assert.equal(shopCoupon.status, 200, JSON.stringify(shopCoupon.data));
  const o2 = await req("/api/orders", {
    method: "POST", token,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05", coupon_code: "PLAT77" },
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  assert.equal(o2.data.coupon_cents, 7000);
  assert.equal(o2.data.amount, 21000);

  // ...and the platform coupon still applies in shop B, where no
  // shop coupon of that code exists.
  const resB = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R3 stored-value shop-B", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: shopBId,
    },
  });
  assert.equal(resB.status, 200, JSON.stringify(resB.data));
  const o3 = await req("/api/orders", {
    method: "POST", token,
    body: { resourceId: resB.data.resource.id, quantity: 1, booking_date: "2026-12-05", coupon_code: "PLAT77" },
  });
  assert.equal(o3.status, 200, JSON.stringify(o3.data));
  assert.equal(o3.data.coupon_cents, 5000);
  assert.equal(o3.data.amount, 23000);
});

test("subsidy grant: balance + bonus ledger row; cross-shop 403; validation 400/404", async () => {
  const { token, id } = await register("svgrant", "Test1234");
  const granted = await req("/api/admin/stored-value/grant", {
    method: "POST", token: adminToken,
    body: { user_id: id, amount_cents: 5000, note: "测试补贴" },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.data));
  assert.equal(granted.data.account.balance_cents, 5000);
  const after = await storedValue(token);
  assert.equal(after.data.account.balance_cents, 5000);
  const bonus = after.data.ledger.find((l) => l.kind === "bonus");
  assert.ok(bonus, JSON.stringify(after.data.ledger));
  assert.equal(bonus.amount_cents, 5000);
  assert.equal(bonus.note, "测试补贴");
  // The admin read shows the same account + user.
  const adminRead = await req(`/api/admin/stored-value/${id}`, { token: adminToken });
  assert.equal(adminRead.status, 200, JSON.stringify(adminRead.data));
  assert.equal(adminRead.data.user.username, "svgrant");
  assert.equal(adminRead.data.account.balance_cents, 5000);
  assert.equal((await req("/api/admin/stored-value/99999", { token: adminToken })).status, 404);
  // Validation: unknown user 404, bad amounts 400, anon/non-admin 403.
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", token: adminToken, body: { user_id: 99999, amount_cents: 100 },
  })).status, 404);
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", token: adminToken, body: { user_id: id, amount_cents: 0 },
  })).status, 400);
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", token: adminToken, body: { user_id: id, amount_cents: 500001 },
  })).status, 400);
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", body: { user_id: id, amount_cents: 100 },
  })).status, 403);
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", token: demoToken, body: { user_id: id, amount_cents: 100 },
  })).status, 403);
  // Cross-shop: the shop-B admin cannot grant into shop 1.
  assert.equal((await req("/api/admin/stored-value/grant", {
    method: "POST", token: shopAdminToken, body: { user_id: id, shop_id: 1, amount_cents: 100 },
  })).status, 403);
  // ...but CAN grant into their own shop.
  const ownShop = await req("/api/admin/stored-value/grant", {
    method: "POST", token: shopAdminToken, body: { user_id: id, amount_cents: 100 },
  });
  assert.equal(ownShop.status, 200, JSON.stringify(ownShop.data));
  assert.equal(ownShop.data.account.shop_id, shopBId);
  assert.equal(ownShop.data.account.balance_cents, 100);
});

test("plan admin CRUD + cross-shop 403; i18n 418/231", async () => {
  const created = await req("/api/admin/stored-value-plans", {
    method: "POST", token: adminToken,
    body: { amount_cents: 30000, bonus_cents: 2000 },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.stored_value_plan.shop_id, 1);
  const planId = created.data.stored_value_plan.id;
  const patched = await req(`/api/admin/stored-value-plans/${planId}`, {
    method: "PATCH", token: adminToken, body: { bonus_cents: 2500 },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.stored_value_plan.bonus_cents, 2500);
  assert.equal((await req(`/api/admin/stored-value-plans/${planId}`, {
    method: "PATCH", token: adminToken, body: { shop_id: 2 },
  })).status, 400);
  assert.equal((await req("/api/admin/stored-value-plans", {
    method: "POST", token: adminToken, body: { amount_cents: 0, bonus_cents: 0 },
  })).status, 400);
  // Cross-shop: the shop-B admin cannot create into shop 1 or patch a
  // shop-1 plan — but CAN create in their own shop.
  assert.equal((await req("/api/admin/stored-value-plans", {
    method: "POST", token: shopAdminToken, body: { shop_id: 1, amount_cents: 1000, bonus_cents: 0 },
  })).status, 403);
  assert.equal((await req(`/api/admin/stored-value-plans/${planId}`, {
    method: "PATCH", token: shopAdminToken, body: { bonus_cents: 1 },
  })).status, 403);
  const ownPlan = await req("/api/admin/stored-value-plans", {
    method: "POST", token: shopAdminToken,
    body: { amount_cents: 1000, bonus_cents: 100 },
  });
  assert.equal(ownPlan.status, 200, JSON.stringify(ownPlan.data));
  assert.equal(ownPlan.data.stored_value_plan.shop_id, shopBId);

  // i18n: 6 new stored-value keys on both sides (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206). R6-3 adds 2 creative keys H5 (397 -> 399), 1 mini (206 -> 207). R6-4 adds 6 match keys (399 -> 405) + 5 filter-bar keys mini-only (207 -> 218). R6-5 adds 13 comment/message-type keys (405 -> 418, 218 -> 231).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [418, 418, 418]);
  for (const l of data.LANGS)
    for (const k of ["storedValueTitle", "storedValueBalance", "storedValueTopup", "storedValuePlan", "storedValueEmpty", "storedValueUsed"])
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
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
    for (const k of ["storedValueTitle", "storedValueBalance", "storedValueTopup", "storedValuePlan", "storedValueEmpty", "storedValueUsed"])
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
