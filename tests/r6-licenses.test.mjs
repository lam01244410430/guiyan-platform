// tests/r6-licenses.test.mjs: R6-1 (rows 63, 67) — 版权库 + 剧目库.
// Spawns server/server.mjs on TEST_PORT (default 3120) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database.
//
// Covered (8 tests): (1) register copyright -> appears in the public
// library (buy, pending); (2) filter by kind (buy/sell); (3) filter by
// status (pending/active/expired); (4) copyright meta fields echo on
// the resource detail (fact fields only, never invented); (5)
// cross-shop -> 403 (shop admin on a main-shop resource; non-admin
// and anonymous POST -> 403); (6) anonymous reads the public list
// 200; (7) validation: bad kind/status/dates -> 400, unknown resource
// -> 404; (8) the new `show-license` category is recognised on both
// sides (id + Chinese name) + i18n counts (H5 423, miniprogram 236).
//
// Test usernames are hyphen-free ([A-Za-z0-9_] only). All assertions
// filter by this file's own resources / licences — other test files
// share this DB but never write the licenses table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync, randomBytes } from "node:crypto";

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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

async function createResource(token, body) {
  const r = await req("/api/admin/resources", {
    method: "POST",
    token,
    body,
  });
  assert.equal(r.status, 200, `create resource -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.resource;
}

async function createLicense(token, body) {
  return req("/api/admin/licenses", { method: "POST", token, body });
}

async function listLicenses(qs = "") {
  const r = await req(`/api/licenses${qs}`);
  assert.equal(r.status, 200, `GET /api/licenses${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.licenses;
}

let adminToken;
let shopAdminToken;
let userToken;
let copyrightResourceId;
let showLicenseResourceId;
let buyLicenseId;
let sellLicenseId;

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
  const u = await req("/api/auth/register", {
    method: "POST",
    body: { username: "r6licuser", password: "Test1234", name: "r6licuser", email: "r6licuser@example.com" },
  });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  userToken = u.data.token;
  // A shop-scoped admin for the cross-shop test: inserted directly
  // (register fixes role=user), then made owner of a new shop —
  // owning the shop sets their users.shop_id (R1-1 pattern).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r6licadmin", pw, "R6版权子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R6版权子店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopAdminToken = await login("r6licadmin", "Admin1234");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("register copyright -> appears in the public library", async () => {
  const resource = await createResource(adminToken, {
    name: "R6版权刘三姐形象",
    category: "copyright",
    city: "南宁",
    price: 800000,
    unit: "次",
    meta: {
      copyright_holder: "R6版权测试方",
      license_type: "商业授权",
      ip_region: "广西",
    },
  });
  copyrightResourceId = resource.id;
  assert.deepEqual(resource.meta, {
    copyright_holder: "R6版权测试方",
    license_type: "商业授权",
    ip_region: "广西",
  });
  const created = await createLicense(adminToken, {
    resource_id: copyrightResourceId,
    licensor: "R6版权测试方",
    licensee: "R6被授权方",
    kind: "buy",
    price_cents: 800000,
    status: "pending",
    start_at: "2026-01-01",
    end_at: "2026-12-31",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.ok, true);
  assert.ok(Number.isSafeInteger(created.data.id));
  buyLicenseId = created.data.id;
  assert.equal(created.data.license.resource_name, "R6版权刘三姐形象");
  assert.equal(created.data.license.resource_category, "copyright");
  assert.equal(created.data.license.licensor, "R6版权测试方");
  assert.equal(created.data.license.licensee, "R6被授权方");
  assert.equal(created.data.license.kind, "buy");
  assert.equal(created.data.license.price_cents, 800000);
  assert.equal(created.data.license.status, "pending");
  const all = await listLicenses();
  const found = all.find((l) => l.id === buyLicenseId);
  assert.ok(found, `buy licence ${buyLicenseId} missing from public list`);
  assert.equal(found.resource_name, "R6版权刘三姐形象");
});

test("filter by kind (buy/sell)", async () => {
  const created = await createLicense(adminToken, {
    resource_id: copyrightResourceId,
    licensor: "R6版权测试方",
    licensee: "R6另一被授权方",
    kind: "sell",
    price_cents: 500000,
    status: "active",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  sellLicenseId = created.data.id;
  const buys = await listLicenses("?kind=buy");
  assert.ok(buys.some((l) => l.id === buyLicenseId), "buy licence missing from ?kind=buy");
  assert.ok(!buys.some((l) => l.id === sellLicenseId), "sell licence leaked into ?kind=buy");
  const sells = await listLicenses("?kind=sell");
  assert.ok(sells.some((l) => l.id === sellLicenseId), "sell licence missing from ?kind=sell");
  assert.ok(!sells.some((l) => l.id === buyLicenseId), "buy licence leaked into ?kind=sell");
  assert.equal((await req("/api/licenses?kind=nope")).status, 400);
});

test("filter by status (pending/active/expired)", async () => {
  const pendings = await listLicenses("?status=pending");
  assert.ok(pendings.some((l) => l.id === buyLicenseId), "pending licence missing from ?status=pending");
  assert.ok(!pendings.some((l) => l.id === sellLicenseId), "active licence leaked into ?status=pending");
  const actives = await listLicenses("?status=active");
  assert.ok(actives.some((l) => l.id === sellLicenseId), "active licence missing from ?status=active");
  assert.ok(!actives.some((l) => l.id === buyLicenseId), "pending licence leaked into ?status=active");
  const expireds = await listLicenses("?status=expired");
  assert.ok(!expireds.some((l) => l.id === buyLicenseId || l.id === sellLicenseId), "own licences leaked into ?status=expired");
  assert.equal((await req("/api/licenses?status=nope")).status, 400);
});

test("copyright meta fields echo on the resource detail", async () => {
  const r = await req(`/api/resources/${copyrightResourceId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.resource.meta.copyright_holder, "R6版权测试方");
  assert.equal(r.data.resource.meta.license_type, "商业授权");
  assert.equal(r.data.resource.meta.ip_region, "广西");
  // A resource without copyright meta carries no invented holder.
  const plain = await req("/api/resources/1");
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  assert.equal(plain.data.resource.meta.copyright_holder, undefined);
});

test("cross-shop -> 403 (shop admin on a main-shop resource)", async () => {
  assert.equal(
    (
      await createLicense(shopAdminToken, {
        resource_id: copyrightResourceId,
        licensor: "R6版权测试方",
        licensee: "R6子店",
        kind: "buy",
        price_cents: 100,
      })
    ).status,
    403,
  );
  // Non-admin and anonymous POSTs are 403 too (admin-only gate).
  assert.equal(
    (
      await createLicense(userToken, {
        resource_id: copyrightResourceId,
        licensor: "R6版权测试方",
        licensee: "R6用户",
        kind: "buy",
        price_cents: 100,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await createLicense(undefined, {
        resource_id: copyrightResourceId,
        licensor: "R6版权测试方",
        licensee: "R6匿名",
        kind: "buy",
        price_cents: 100,
      })
    ).status,
    403,
  );
  // Positive control: the shop admin CAN register on their own
  // shop's resource.
  const own = await createResource(shopAdminToken, {
    name: "R6子店版权",
    category: "copyright",
    city: "南宁",
    price: 10000,
    unit: "次",
  });
  const ownLic = await createLicense(shopAdminToken, {
    resource_id: own.id,
    licensor: "R6子店",
    licensee: "R6子店客户",
    kind: "sell",
    price_cents: 10000,
  });
  assert.equal(ownLic.status, 200, JSON.stringify(ownLic.data));
});

test("anonymous reads the public list 200", async () => {
  const r = await req("/api/licenses");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.licenses));
  assert.ok(r.data.licenses.some((l) => l.id === buyLicenseId));
  const filtered = await req("/api/licenses?kind=buy&status=pending");
  assert.equal(filtered.status, 200, JSON.stringify(filtered.data));
  assert.ok(filtered.data.licenses.some((l) => l.id === buyLicenseId));
});

test("validation: bad kind/status/dates -> 400, unknown resource -> 404", async () => {
  const base = {
    resource_id: copyrightResourceId,
    licensor: "R6版权测试方",
    licensee: "R6被授权方",
    kind: "buy",
    price_cents: 100,
  };
  assert.equal((await createLicense(adminToken, { ...base, kind: "rent" })).status, 400);
  assert.equal((await createLicense(adminToken, { ...base, status: "draft" })).status, 400);
  assert.equal((await createLicense(adminToken, { ...base, price_cents: -1 })).status, 400);
  assert.equal((await createLicense(adminToken, { ...base, price_cents: 100.5 })).status, 400);
  assert.equal((await createLicense(adminToken, { ...base, licensor: "  " })).status, 400);
  assert.equal((await createLicense(adminToken, { ...base, start_at: "2026-13-01" })).status, 400);
  assert.equal(
    (await createLicense(adminToken, { ...base, start_at: "2026-12-31", end_at: "2026-01-01" })).status,
    400,
  );
  assert.equal((await createLicense(adminToken, { ...base, resource_id: 999999 })).status, 404);
});

test("show-license category recognised (id + Chinese name) + i18n 423/236", async () => {
  const cats = await req("/api/categories");
  assert.equal(cats.status, 200, JSON.stringify(cats.data));
  assert.equal(cats.data.categories.length, 11);
  assert.ok(cats.data.categories.some((c) => c.id === "show-license"));
  assert.ok(cats.data.categories.some((c) => c.id === "copyright"));
  assert.equal(
    cats.data.categories.find((c) => c.id === "show-license").name,
    "剧目授权",
  );
  const resource = await createResource(adminToken, {
    name: "R6剧目授权测试",
    category: "show-license",
    city: "柳州",
    price: 120000,
    unit: "场",
  });
  showLicenseResourceId = resource.id;
  const byId = await req("/api/resources?category=show-license");
  assert.equal(byId.status, 200, JSON.stringify(byId.data));
  assert.ok(byId.data.resources.some((r) => r.id === showLicenseResourceId), "show-license resource missing from ?category=show-license");
  const byName = await req(`/api/resources?category=${encodeURIComponent("剧目授权")}`);
  assert.equal(byName.status, 200, JSON.stringify(byName.data));
  assert.ok(byName.data.resources.some((r) => r.id === showLicenseResourceId), "show-license resource missing from ?category=剧目授权");
  assert.equal((await req("/api/resources?category=nope")).status, 400);
  // i18n: 12 new licence keys on both sides (372 -> 384, 181 -> 193).
  const data = await import(path.resolve(repoDir, "web", "assets", "js", "data.js"));
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [423, 423, 423]);
  for (const k of ["licLibrary", "licKind", "licBuy", "licSell", "licStatus", "licPending", "licActive", "licExpired", "licHolder", "licType", "licRegion", "licInfo"]) {
    for (const l of data.LANGS)
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  }
  const text = fs.readFileSync(path.resolve(repoDir, "miniprogram", "utils", "i18n.js"), "utf8");
  const blocks = {};
  for (const lang of ["zh", "vi", "en"]) {
    const start = text.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const end = text.indexOf("\n  }", start);
    const block = text.slice(start, end);
    blocks[lang] = [...block.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  }
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 236, `${lang} key count`);
    for (const k of ["licLibrary", "licKind", "licBuy", "licSell", "licStatus", "licPending", "licActive", "licExpired", "licHolder", "licType", "licRegion", "licInfo"])
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
