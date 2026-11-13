// tests/r1-shops.test.mjs: R1-1 (row 1) — multi-shop org + permissions.
// Spawns server/server.mjs on TEST_PORT (default 3110) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: main-shop seed (id 1, "桂演平台总店", 62 resources), shop
// CRUD rules (platform admin only; owner must be an admin who owns no
// other shop; main shop cannot be disabled), shop scoping of the admin
// resources list/create/edit/sync (shop admin sees/edits only their own
// shop; cross-shop edit/sync -> 403; create is forced into their shop),
// and the owner-change handover (old owner -> NULL, new owner -> shop).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3110);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
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

async function getShops(token) {
  return req("/api/admin/shops", { token });
}
async function createShop(token, body) {
  return req("/api/admin/shops", { method: "POST", token, body });
}
async function patchShop(token, id, body) {
  return req(`/api/admin/shops/${id}`, { method: "PATCH", token, body });
}
async function listResources(token) {
  return req("/api/admin/resources", { token });
}
async function createResource(token, body) {
  return req("/api/admin/resources", { method: "POST", token, body });
}
async function patchResource(token, id, body) {
  return req(`/api/admin/resources/${id}`, { method: "PATCH", token, body });
}
async function syncResource(token, id) {
  return req(`/api/admin/resources/${id}/sync`, { method: "POST", token, body: {} });
}
async function listUsers(token) {
  return req("/api/admin/users", { token });
}
async function userByUsername(token, username) {
  const r = await listUsers(token);
  assert.equal(r.status, 200);
  return r.data.users.find((u) => u.username === username);
}

let adminToken;
let admin2Id;
let admin3Id;
let demoId;
let shopBId;
let mainShowId;
let ownShowId;

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
  // Second + third admins, inserted directly: register fixes role=user.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["shopadmin2", pw, "子店管理员2", new Date().toISOString()],
  );
  admin2Id = a2.rows[0].id;
  const a3 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','桂林',$4) RETURNING id",
    ["shopadmin3", pw, "子店管理员3", new Date().toISOString()],
  );
  admin3Id = a3.rows[0].id;
  demoId = (await userByUsername(adminToken, "demo")).id;
  // A main-shop show resource for the cross-shop edit/sync tests.
  const r = await listResources(adminToken);
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowId = mainShow.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("seed: exactly one shop, the main shop, with 62 resources", async () => {
  const r = await getShops(adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.data.shops.length, 1);
  const s = r.data.shops[0];
  assert.equal(s.id, 1);
  assert.equal(s.name, "桂演平台总店");
  assert.equal(s.parent_id, null);
  assert.equal(s.owner_id, 1);
  assert.equal(s.owner_name, "平台管理员");
  assert.equal(s.status, "active");
  assert.equal(s.resource_count, 62);
});

test("non-admin and anonymous cannot list shops", async () => {
  const demoToken = await login("demo", "demo123");
  assert.equal((await getShops(demoToken)).status, 403);
  assert.equal((await getShops(undefined)).status, 403);
});

test("create shop B with owner admin2; admin2 becomes shop-scoped", async () => {
  const r = await createShop(adminToken, {
    name: "桂演南宁分店",
    owner_id: admin2Id,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.shop.name, "桂演南宁分店");
  assert.equal(r.data.shop.parent_id, 1);
  assert.equal(r.data.shop.owner_id, admin2Id);
  assert.equal(r.data.shop.status, "active");
  assert.equal(r.data.shop.resource_count, 0);
  shopBId = r.data.shop.id;
  assert.ok(shopBId > 1);
  const owner = await userByUsername(adminToken, "shopadmin2");
  assert.equal(owner.shop_id, shopBId);
});

test("create shop rejects non-admin owner, unknown owner, unknown parent", async () => {
  assert.equal((await createShop(adminToken, { name: "坏店1", owner_id: demoId })).status, 400);
  assert.equal((await createShop(adminToken, { name: "坏店2", owner_id: 99999 })).status, 404);
  assert.equal((await createShop(adminToken, { name: "坏店3", parent_id: 99999 })).status, 404);
  // admin2 already owns shop B: a second shop for them is rejected.
  assert.equal((await createShop(adminToken, { name: "坏店4", owner_id: admin2Id })).status, 400);
});

test("shop admin cannot create or patch shops; sees only their own shop", async () => {
  const t2 = await login("shopadmin2", "Admin1234");
  assert.equal((await createShop(t2, { name: "越权店" })).status, 403);
  assert.equal((await patchShop(t2, shopBId, { name: "越权改名" })).status, 403);
  const r = await getShops(t2);
  assert.equal(r.status, 200);
  assert.equal(r.data.shops.length, 1);
  assert.equal(r.data.shops[0].id, shopBId);
});

test("shop admin creates into their own shop even when body says shop_id=1", async () => {
  const t2 = await login("shopadmin2", "Admin1234");
  const r = await createResource(t2, {
    name: "R1 test show B",
    category: "show",
    city: "南宁",
    price: 28000,
    unit: "张",
    stock: 10,
    shop_id: 1,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.resource.shop_id, shopBId);
  ownShowId = r.data.resource.id;
});

test("shop admin lists only their own shop's resources", async () => {
  const t2 = await login("shopadmin2", "Admin1234");
  const r = await listResources(t2);
  assert.equal(r.status, 200);
  assert.ok(r.data.resources.length >= 1);
  assert.ok(r.data.resources.every((x) => x.shop_id === shopBId));
  assert.ok(!r.data.resources.some((x) => x.id === mainShowId));
});

test("cross-shop edit/sync -> 403; own edit/sync -> 200", async () => {
  const t2 = await login("shopadmin2", "Admin1234");
  assert.equal((await patchResource(t2, mainShowId, { stock: 5 })).status, 403);
  assert.equal((await syncResource(t2, mainShowId)).status, 403);
  assert.equal((await patchResource(t2, ownShowId, { stock: 9 })).status, 200);
  assert.equal((await syncResource(t2, ownShowId)).status, 200);
});

test("platform admin creates into shop B by shop_id; unknown shop -> 404", async () => {
  const r = await createResource(adminToken, {
    name: "R1 platform into B",
    category: "venue",
    city: "桂林",
    price: 1000,
    unit: "场",
    shop_id: shopBId,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.resource.shop_id, shopBId);
  assert.equal((await createResource(adminToken, {
    name: "R1 bad shop",
    category: "venue",
    city: "桂林",
    price: 1000,
    unit: "场",
    shop_id: 99999,
  })).status, 404);
});

test("main shop cannot be disabled; shop B can be disabled and re-enabled", async () => {
  assert.equal((await patchShop(adminToken, 1, { status: "disabled" })).status, 400);
  const off = await patchShop(adminToken, shopBId, { status: "disabled" });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.shop.status, "disabled");
  // Creating into a disabled shop -> 400.
  assert.equal((await createResource(adminToken, {
    name: "R1 into disabled",
    category: "venue",
    city: "桂林",
    price: 1000,
    unit: "场",
    shop_id: shopBId,
  })).status, 400);
  const on = await patchShop(adminToken, shopBId, { status: "active" });
  assert.equal(on.status, 200);
  assert.equal(on.data.shop.status, "active");
});

test("owner change hands the shop over: old owner -> NULL, new owner -> shop", async () => {
  const r = await patchShop(adminToken, shopBId, { owner_id: admin3Id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.shop.owner_id, admin3Id);
  const oldOwner = await userByUsername(adminToken, "shopadmin2");
  assert.equal(oldOwner.shop_id, null);
  const newOwner = await userByUsername(adminToken, "shopadmin3");
  assert.equal(newOwner.shop_id, shopBId);
  // admin2 is a platform admin again: sees all shops.
  const t2 = await login("shopadmin2", "Admin1234");
  assert.equal((await getShops(t2)).data.shops.length, 2);
});
