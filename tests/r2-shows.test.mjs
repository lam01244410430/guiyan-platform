// tests/r2-shows.test.mjs: R2-1 (rows 5, 6) — shows + performances.
// Spawns server/server.mjs on TEST_PORT (default 3110) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: create show -> pending; non-admin -> 403; cross-shop create
// -> 403; approve -> 200 + visible in the public list; reject -> not in
// the public list + cannot create performances; create performance on a
// pending show -> 400; on-sale performance appears in availability;
// cross-shop performance edit -> 403; validation (non-show resource,
// past start_at); i18n key counts (H5 467 + 82 th/ms/id, miniprogram 269 + 82, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3110);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

async function createShow(token, body) {
  return req("/api/shows", { method: "POST", token, body });
}
async function listShows(token) {
  return token
    ? req("/api/shows", { token })
    : req("/api/shows");
}
async function getShow(id, token) {
  return req(`/api/shows/${id}`, token ? { token } : {});
}
async function listAdminShows(token, qs = "") {
  return req(`/api/admin/shows${qs}`, { token });
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
async function getAvailability(resourceId) {
  return req(`/api/resources/${resourceId}/availability`);
}

let adminToken;
let shopAdminId;
let shopBId;
let mainShowResourceId;
let ownShowResourceId;
let showId;
let perfId;

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
  // A shop-scoped admin of our own (r1-shops already owns "shopadmin2"
  // in this shared DB, so this file uses its own usernames).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r2shopadmin", pw, "R2子店管理员", new Date().toISOString()],
  );
  shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R2南宁分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  // A main-shop show resource + a shop-B show resource (created via
  // the admin resource endpoint so the shop scoping is exercised).
  const r = await req("/api/admin/resources", { token: adminToken });
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowResourceId = mainShow.id;
  const own = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R2 test show B", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, shop_id: shopBId,
    },
  });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  ownShowResourceId = own.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("create show -> pending, with the resource in the same shop", async () => {
  const r = await createShow(adminToken, {
    resource_id: mainShowResourceId,
    title: "R2 刘三姐专场",
    description: "R2 test show",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.show.status, "pending");
  assert.equal(r.data.show.shop_id, 1);
  assert.equal(r.data.show.resource_id, mainShowResourceId);
  assert.deepEqual(r.data.show.performances, []);
  showId = r.data.show.id;
});

test("create show rejects a non-show resource and an unknown resource", async () => {
  const r = await req("/api/admin/resources", { token: adminToken });
  const venue = r.data.resources.find((x) => x.shop_id === 1 && x.category === "venue");
  assert.ok(venue, "fresh seed has a main-shop venue resource");
  assert.equal((await createShow(adminToken, {
    resource_id: venue.id, title: "R2 坏 show",
  })).status, 400);
  assert.equal((await createShow(adminToken, {
    resource_id: 99999, title: "R2 坏 show",
  })).status, 404);
});

test("non-admin and anonymous cannot create shows", async () => {
  const demoToken = await login("demo", "demo123");
  assert.equal((await createShow(demoToken, {
    resource_id: mainShowResourceId, title: "R2 越权 show",
  })).status, 403);
  assert.equal((await createShow(undefined, {
    resource_id: mainShowResourceId, title: "R2 越权 show",
  })).status, 403);
});

test("cross-shop create -> 403; own-shop create -> 200", async () => {
  const t2 = await login("r2shopadmin", "Admin1234");
  // Shop-scoped admin naming the main shop (or a shop-1 resource) is
  // a cross-shop create -> 403.
  assert.equal((await createShow(t2, {
    resource_id: mainShowResourceId, title: "R2 越权 show", shop_id: 1,
  })).status, 403);
  assert.equal((await createShow(t2, {
    resource_id: mainShowResourceId, title: "R2 越权 show",
  })).status, 400);
  // Own shop, own resource -> 200 (shop_id forced to their shop even
  // when the body names it explicitly).
  const r = await createShow(t2, {
    resource_id: ownShowResourceId, title: "R2 分店专场", shop_id: shopBId,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.show.shop_id, shopBId);
  assert.equal(r.data.show.status, "pending");
});

test("create performance on a pending show -> 400", async () => {
  const r = await createPerf(adminToken, showId, {
    start_at: "2026-12-05T19:30:00", price_cents: 28000,
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test("approve -> 200 + visible in the public list; admin sees it too", async () => {
  const r = await reviewShow(adminToken, showId, { status: "approved" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.show.status, "approved");
  const pub = await listShows();
  assert.equal(pub.status, 200);
  assert.ok(pub.data.shows.some((s) => s.id === showId));
  const one = await getShow(showId);
  assert.equal(one.status, 200);
  assert.equal(one.data.show.status, "approved");
  // The admin list is shop-scoped: a shop-B admin does not see it.
  const t2 = await login("r2shopadmin", "Admin1234");
  const mine = await listAdminShows(t2);
  assert.equal(mine.status, 200);
  assert.ok(!mine.data.shows.some((s) => s.id === showId));
  const all = await listAdminShows(adminToken, "?status=approved");
  assert.equal(all.status, 200);
  assert.ok(all.data.shows.some((s) => s.id === showId));
});

test("reject -> not in the public list + cannot create performances", async () => {
  const c = await createShow(adminToken, {
    resource_id: mainShowResourceId, title: "R2 被拒专场",
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rejectedId = c.data.show.id;
  const r = await reviewShow(adminToken, rejectedId, { status: "rejected" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.show.status, "rejected");
  const pub = await listShows();
  assert.ok(!pub.data.shows.some((s) => s.id === rejectedId));
  assert.equal((await getShow(rejectedId)).status, 404);
  // The platform admin still sees it by id.
  assert.equal((await getShow(rejectedId, adminToken)).status, 200);
  assert.equal((await createPerf(adminToken, rejectedId, {
    start_at: "2026-12-06T19:30:00", price_cents: 28000,
  })).status, 400);
});

test("create performance on an approved show; past start_at -> 400", async () => {
  assert.equal((await createPerf(adminToken, showId, {
    start_at: "2026-11-01T19:30:00", price_cents: 28000,
  })).status, 400);
  assert.equal((await createPerf(adminToken, showId, {
    start_at: "not-a-date", price_cents: 28000,
  })).status, 400);
  const r = await createPerf(adminToken, showId, {
    start_at: "2026-12-05T19:30:00", price_cents: 28000,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.performance.status, "scheduled");
  assert.equal(r.data.performance.price_cents, 28000);
  perfId = r.data.performance.id;
  // A scheduled performance is NOT in availability yet.
  const av0 = await getAvailability(mainShowResourceId);
  assert.equal(av0.status, 200);
  assert.ok(!av0.data.performances.some((p) => p.id === perfId));
});

test("on-sale performance appears in availability with price", async () => {
  const r = await patchPerf(adminToken, perfId, { status: "on_sale" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.performance.status, "on_sale");
  const av = await getAvailability(mainShowResourceId);
  assert.equal(av.status, 200);
  const found = av.data.performances.find((p) => p.id === perfId);
  assert.ok(found, JSON.stringify(av.data.performances));
  assert.equal(found.start_at, "2026-12-05T19:30:00");
  assert.equal(found.status, "on_sale");
  assert.equal(found.price_cents, 28000);
  // All pre-existing availability fields are unchanged.
  assert.ok("mode" in av.data && "available" in av.data && "dates" in av.data);
});

test("cross-shop performance edit -> 403; own-shop edit -> 200; cancel works", async () => {
  const t2 = await login("r2shopadmin", "Admin1234");
  assert.equal((await patchPerf(t2, perfId, { status: "cancelled" })).status, 403);
  assert.equal((await patchPerf(t2, perfId, { price_cents: 100 })).status, 403);
  const r = await patchPerf(adminToken, perfId, { price_cents: 30000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.performance.price_cents, 30000);
  assert.equal(r.data.performance.status, "on_sale");
  const c = await patchPerf(adminToken, perfId, { status: "cancelled" });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.performance.status, "cancelled");
  // A cancelled performance leaves availability again.
  const av = await getAvailability(mainShowResourceId);
  assert.ok(!av.data.performances.some((p) => p.id === perfId));
  // A cancelled performance can never go back on sale.
  assert.equal((await patchPerf(adminToken, perfId, { status: "on_sale" })).status, 400);
});

test("r2-shows i18n: H5 467 keys/language in zh/vi/en + 82 in th/ms/id, miniprogram 269 + 82, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [467, 467, 467, 82, 82, 82]);
  for (const k of ["perfTitle", "perfEmpty", "perfOnSale"]) {
    for (const l of ["zh", "vi", "en"])
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
    assert.equal(blocks[lang].length, 269, `${lang} key count`);
    for (const k of ["perfTitle", "perfEmpty", "perfOnSale"])
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
