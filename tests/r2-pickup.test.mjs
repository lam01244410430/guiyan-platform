// tests/r2-pickup.test.mjs: R2-3 (rows 8, 9) — pickup points + ticket
// templates. Spawns server/server.mjs on TEST_PORT (default 3112) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH disposable
// database (npm test is NOT idempotent on a reused DB).
//
// Covered: pickup required but not chosen -> 400; pickup point of
// another show -> 400; order with a valid pickup point -> 200, stored
// in DB, response + GET /api/orders/:id + GET /api/orders carry the
// pickup point + the shop's default template; public default template
// -> 200 (built-in when none set); setting a new default clears the
// old default; cross-shop template edit -> 403; i18n key counts (H5
// 397, miniprogram 206, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3112);
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

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function createShow(token, body) {
  return req("/api/shows", { method: "POST", token, body });
}
async function reviewShow(token, id, body) {
  return req(`/api/admin/shows/${id}`, { method: "PATCH", token, body });
}
async function createPerf(token, showId, body) {
  return req(`/api/shows/${showId}/performances`, { method: "POST", token, body });
}
async function patchPerf(token, id, body) {
  return req(`/api/admin/performances/${id}`, { method: "PATCH", token, body });
}
async function createTier(token, perfId, body) {
  return req(`/api/performances/${perfId}/ticket-types`, { method: "POST", token, body });
}
async function createPickup(token, showId, body) {
  return req(`/api/shows/${showId}/pickup-points`, { method: "POST", token, body });
}
async function listPickups(showId) {
  return req(`/api/shows/${showId}/pickup-points`);
}
async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}
async function createTemplate(token, body) {
  return req("/api/admin/ticket-templates", { method: "POST", token, body });
}
async function patchTemplate(token, id, body) {
  return req(`/api/admin/ticket-templates/${id}`, { method: "PATCH", token, body });
}
async function listTemplates(token) {
  return req("/api/admin/ticket-templates", { token });
}

let adminToken;
let demoToken;
let shopBToken;
let shopBId;
let mainShowResourceId;
let showAId;
let showBId;
let perfA;
let perfB;
let tierAId;
let pointAId;
let pointBId;
let orderAId;

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
  // A shop-scoped admin of our own (r2-shows owns "r2shopadmin" and
  // r1-shops owns "shopadmin2" in this shared DB, so this file uses
  // its own username). Direct DB insert, same pattern as r2-shows.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r2pickupadmin", pw, "R2取票子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R2取票分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopBToken = await login("r2pickupadmin", "Admin1234");
  const r = await req("/api/admin/resources", { token: adminToken });
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowResourceId = mainShow.id;
  const own = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R2 pickup show B", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, shop_id: shopBId,
    },
  });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  const ownShowResourceId = own.data.resource.id;
  // Show A (main shop, approved) with one on-sale performance, one
  // tier and one pickup point; show B (shop B, approved) the same.
  const sA = await createShow(adminToken, {
    resource_id: mainShowResourceId, title: "R2 取票专场 A",
  });
  assert.equal(sA.status, 200, JSON.stringify(sA.data));
  showAId = sA.data.show.id;
  assert.equal((await reviewShow(adminToken, showAId, { status: "approved" })).status, 200);
  const pA = await createPerf(adminToken, showAId, {
    start_at: "2026-12-05T19:30:00", price_cents: 28000,
  });
  assert.equal(pA.status, 200, JSON.stringify(pA.data));
  perfA = pA.data.performance.id;
  assert.equal((await patchPerf(adminToken, perfA, { status: "on_sale" })).status, 200);
  const tA = await createTier(adminToken, perfA, {
    name: "普通", price_cents: 28000, quota: 10,
  });
  assert.equal(tA.status, 200, JSON.stringify(tA.data));
  tierAId = tA.data.ticket_type.id;
  const ppA = await createPickup(adminToken, showAId, {
    name: "南宁剧场正门", address: "南宁市青秀区剧场路1号",
  });
  assert.equal(ppA.status, 200, JSON.stringify(ppA.data));
  pointAId = ppA.data.pickup_point.id;
  const sB = await createShow(adminToken, {
    resource_id: ownShowResourceId, title: "R2 取票专场 B", shop_id: shopBId,
  });
  assert.equal(sB.status, 200, JSON.stringify(sB.data));
  showBId = sB.data.show.id;
  assert.equal((await reviewShow(adminToken, showBId, { status: "approved" })).status, 200);
  const pB = await createPerf(adminToken, showBId, {
    start_at: "2026-12-06T19:30:00", price_cents: 28000,
  });
  assert.equal(pB.status, 200, JSON.stringify(pB.data));
  perfB = pB.data.performance.id;
  assert.equal((await patchPerf(adminToken, perfB, { status: "on_sale" })).status, 200);
  const ppB = await createPickup(adminToken, showBId, {
    name: "分店前台", address: "南宁市西乡塘区分店路2号",
  });
  assert.equal(ppB.status, 200, JSON.stringify(ppB.data));
  pointBId = ppB.data.pickup_point.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("pickup required but not chosen -> 400; public pickup list works", async () => {
  // The show's pickup points are public.
  const list = await listPickups(showAId);
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.pickup_points.length, 1);
  assert.equal(list.data.pickup_points[0].id, pointAId);
  assert.equal(list.data.pickup_points[0].name, "南宁剧场正门");
  // The show has >=1 pickup point, so the order must name one.
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perfA, ticket_type_id: tierAId,
  })).status, 400);
  // A non-performance (old-flow) order passing pickup_point_id -> 400.
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    booking_date: "2026-12-05", pickup_point_id: pointAId,
  })).status, 400);
  // Non-admin pickup create -> 403; unknown show -> 404.
  assert.equal((await createPickup(demoToken, showAId, {
    name: "越权取票点", address: "某地",
  })).status, 403);
  assert.equal((await listPickups(99999)).status, 404);
});

test("pickup point of another show -> 400", async () => {
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perfA, ticket_type_id: tierAId,
    pickup_point_id: pointBId,
  })).status, 400);
  assert.equal((await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perfA, ticket_type_id: tierAId,
    pickup_point_id: 99999,
  })).status, 400);
});

test("order with a valid pickup point -> 200 and stored in DB", async () => {
  const r = await orderAs(demoToken, {
    resourceId: mainShowResourceId, quantity: 1,
    performance_id: perfA, ticket_type_id: tierAId,
    pickup_point_id: pointAId,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  orderAId = r.data.id;
  // The response carries the pickup point + the shop's default
  // template — no default set yet, so the built-in default.
  assert.deepEqual(r.data.pickup_point, {
    id: pointAId, name: "南宁剧场正门", address: "南宁市青秀区剧场路1号",
  });
  assert.equal(r.data.ticket_template.name, "默认票面");
  assert.equal(r.data.ticket_template.color, "#0b3d36");
  assert.deepEqual(r.data.ticket_template.layout, {});
  const row = await pool.query(
    "SELECT pickup_point_id, performance_id, ticket_type_id FROM orders WHERE id=$1",
    [orderAId],
  );
  assert.equal(row.rows[0].pickup_point_id, pointAId);
  assert.equal(row.rows[0].performance_id, perfA);
  assert.equal(row.rows[0].ticket_type_id, tierAId);
  // GET /api/orders/:id and the order list carry the same enrichment.
  const one = await req(`/api/orders/${orderAId}`, { token: demoToken });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.equal(one.data.order.pickup_point.id, pointAId);
  assert.equal(one.data.order.ticket_template.name, "默认票面");
  assert.equal((await req(`/api/orders/${orderAId}`, { token: adminToken })).status, 200);
  assert.equal((await req(`/api/orders/${orderAId}`)).status, 401);
  const list = await req("/api/orders", { token: demoToken });
  assert.equal(list.status, 200);
  const found = list.data.orders.find((o) => o.id === orderAId);
  assert.ok(found, "created order in the list");
  assert.equal(found.pickup_point.id, pointAId);
  assert.equal(found.ticket_template.color, "#0b3d36");
  // A used pickup point cannot be deleted (400); an unused one can.
  assert.equal((await req(`/api/admin/pickup-points/${pointAId}`, {
    method: "DELETE", token: adminToken,
  })).status, 400);
  const extra = await createPickup(adminToken, showAId, {
    name: "临时取票点", address: "南宁市临时路3号",
  });
  assert.equal(extra.status, 200, JSON.stringify(extra.data));
  assert.equal((await req(`/api/admin/pickup-points/${extra.data.pickup_point.id}`, {
    method: "DELETE", token: adminToken,
  })).status, 200);
  assert.equal((await listPickups(showAId)).data.pickup_points.length, 1);
});

test("public default template -> 200 (built-in when none set)", async () => {
  const r = await req("/api/shops/1/ticket-template");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket_template.id, null);
  assert.equal(r.data.ticket_template.name, "默认票面");
  assert.equal(r.data.ticket_template.color, "#0b3d36");
  assert.deepEqual(r.data.ticket_template.layout, {});
  assert.equal((await req("/api/shops/99999/ticket-template")).status, 404);
  // Template validation: a colour outside the Guiyan allowlist and a
  // non-object layout are both refused before any write.
  assert.equal((await createTemplate(adminToken, {
    name: "坏颜色", color: "#ff0000", shop_id: 1,
  })).status, 400);
  assert.equal((await createTemplate(adminToken, {
    name: "坏版式", color: "#0b3d36", layout: [1, 2], shop_id: 1,
  })).status, 400);
  assert.equal((await createTemplate(demoToken, {
    name: "越权模板", color: "#0b3d36", shop_id: 1,
  })).status, 403);
});

test("setting a new default clears the old default", async () => {
  const t1 = await createTemplate(adminToken, {
    name: "朱红票面", color: "#c8452c", shop_id: 1, is_default: 1,
    layout: { title: "桂演之夜" },
  });
  assert.equal(t1.status, 200, JSON.stringify(t1.data));
  assert.equal(t1.data.ticket_template.is_default, 1);
  assert.deepEqual(t1.data.ticket_template.layout, { title: "桂演之夜" });
  // The public endpoint now returns the new default, not built-in.
  const pub1 = await req("/api/shops/1/ticket-template");
  assert.equal(pub1.data.ticket_template.id, t1.data.ticket_template.id);
  assert.equal(pub1.data.ticket_template.color, "#c8452c");
  const t2 = await createTemplate(adminToken, {
    name: "鎏金票面", color: "#c9a24b", shop_id: 1, is_default: 1,
  });
  assert.equal(t2.status, 200, JSON.stringify(t2.data));
  let list = await listTemplates(adminToken);
  assert.equal(list.status, 200);
  const byId = Object.fromEntries(list.data.ticket_templates.map((t) => [t.id, t]));
  assert.equal(byId[t1.data.ticket_template.id].is_default, 0);
  assert.equal(byId[t2.data.ticket_template.id].is_default, 1);
  // PATCH the first one back to default: the second loses it.
  const patched = await patchTemplate(adminToken, t1.data.ticket_template.id, { is_default: 1 });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.ticket_template.is_default, 1);
  list = await listTemplates(adminToken);
  const byId2 = Object.fromEntries(list.data.ticket_templates.map((t) => [t.id, t]));
  assert.equal(byId2[t1.data.ticket_template.id].is_default, 1);
  assert.equal(byId2[t2.data.ticket_template.id].is_default, 0);
  // Restore the shared state: no default for shop 1, so later runs
  // (and the public endpoint) see the built-in default again.
  assert.equal((await patchTemplate(adminToken, t1.data.ticket_template.id, { is_default: 0 })).status, 200);
  const pub2 = await req("/api/shops/1/ticket-template");
  assert.equal(pub2.data.ticket_template.name, "默认票面");
});

test("cross-shop template edit -> 403; i18n 372/181", async () => {
  // The shop-B admin cannot touch shop 1's template, nor name shop 1
  // on a create; their own shop works.
  const list = await listTemplates(adminToken);
  const t1 = list.data.ticket_templates.find((t) => t.shop_id === 1);
  assert.ok(t1, "a shop-1 template exists from the previous test");
  assert.equal((await patchTemplate(shopBToken, t1.id, { name: "越权改名" })).status, 403);
  assert.equal((await createTemplate(shopBToken, {
    name: "越权模板", color: "#0b3d36", shop_id: 1,
  })).status, 403);
  const own = await createTemplate(shopBToken, {
    name: "分店票面", color: "#14564d",
  });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.ticket_template.shop_id, shopBId);
  // A shop-scoped list shows only their own shop's templates.
  const mine = await listTemplates(shopBToken);
  assert.ok(mine.data.ticket_templates.length >= 1);
  assert.ok(mine.data.ticket_templates.every((t) => t.shop_id === shopBId));
  // i18n: 3 new pickup keys + 1 venue key + 2 seat keys on both sides (333 -> 339, 137 -> 143); R3-1 adds 5 member-tier keys (339 -> 344, 143 -> 148); R3-2 adds 3 coupon keys (344 -> 347, 148 -> 151); R3-3 adds 3 flash-sale keys (347 -> 350, 151 -> 154); R3-4 adds 3 gift keys (350 -> 353, 154 -> 157); R3-5 adds 1 socMaoyan key H5-only (353 -> 354); R3-6 adds 6 stored-value keys (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [397, 397, 397]);
  for (const k of ["pickupTitle", "pickupEmpty", "pickupPick"]) {
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
    assert.equal(blocks[lang].length, 206, `${lang} key count`);
    for (const k of ["pickupTitle", "pickupEmpty", "pickupPick"])
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
