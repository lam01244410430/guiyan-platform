// tests/r2-venues.test.mjs: R2-4 (rows 10, 11) — venues + seat templates.
// Spawns server/server.mjs on TEST_PORT (default 3110) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: fresh-DB backfill yields 6 venues (2 demo + 4 catalog) with
// resources linked; create venue -> 200; non-admin / cross-shop -> 403;
// resource links venue_id -> 200 + detail has venue; cross-shop link
// -> 403; no-template venue -> has_seats false; create seat template ->
// zones stored; patch template -> 200; i18n key counts (H5 372,
// miniprogram 262, equal sets).
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

let adminToken;
let shopAdminToken;
let shopBId;
let shopBVenueId;
let mainShowResourceId;
let venueId;

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
  // A shop-scoped admin of our own (r2-shows owns "r2shopadmin" in
  // this shared DB, so this file uses its own usernames).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r2venueadmin", pw, "R2场馆子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R2场馆分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r2venueadmin", "Admin1234");
  const r = await req("/api/admin/resources", { token: adminToken });
  assert.equal(r.status, 200);
  const mainShow = r.data.resources.find((x) => x.shop_id === 1 && x.category === "show");
  assert.ok(mainShow, "fresh seed has a main-shop show resource");
  mainShowResourceId = mainShow.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

// The backfill runs first: this file must see the 6 seeded venues
// before its own creates add more. (The total is asserted by name,
// not by exact count: r1-shops created a venue-category resource in
// this shared DB after the backfill ran, so its venue_id is NULL by
// design; smoke check 37 asserts the exact 6 on a truly fresh DB.)
test("fresh-DB backfill yields 6 venues + resources linked", async () => {
  const r = await req("/api/venues");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byName = new Map(r.data.venues.map((v) => [v.name, v]));
  // 2 demo venues (seed.mjs) + 4 catalog venues (catalog-content.mjs).
  assert.equal(byName.get("广西文化艺术中心").capacity, 400);
  assert.equal(byName.get("广西文化艺术中心").address, "南宁市良庆区（演示地址）");
  assert.equal(byName.get("南宁小剧场").capacity, 220);
  assert.equal(byName.get("南宁小剧场").address, "南宁市青秀区（演示地址）");
  for (const name of ["邕江艺术空间·黑匣子剧场", "漓江畔·山水露天舞台", "柳江青年艺术剧场", "海风文化客厅·多功能厅"]) {
    assert.ok(byName.has(name), `missing backfilled venue ${name}`);
    assert.equal(byName.get(name).capacity, 180, name);
  }
  // Every seeded venue-category resource carries its venue_id now.
  const res = await req("/api/admin/resources", { token: adminToken });
  assert.equal(res.status, 200);
  const seedNames = ["广西文化艺术中心", "南宁小剧场", "邕江艺术空间·黑匣子剧场", "漓江畔·山水露天舞台", "柳江青年艺术剧场", "海风文化客厅·多功能厅"];
  const venueResources = res.data.resources.filter((x) => seedNames.includes(x.name));
  assert.equal(venueResources.length, 6, JSON.stringify(venueResources.map((x) => x.name)));
  for (const x of venueResources) {
    assert.ok(x.venue_id, `${x.name} has no venue_id`);
    assert.ok(x.venue && x.venue.id === x.venue_id, `${x.name} detail venue mismatch`);
    assert.equal(x.venue.name, x.name);
  }
});

test("create venue -> 200; non-admin and cross-shop create -> 403", async () => {
  const r = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R2测试剧场", address: "南宁测试路2号", capacity: 300, floor_plan: "一层观众席" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.venue.name, "R2测试剧场");
  assert.equal(r.data.venue.shop_id, 1);
  assert.equal(r.data.venue.capacity, 300);
  assert.equal(r.data.venue.has_seats, false);
  venueId = r.data.venue.id;
  const demoToken = await login("demo", "demo123");
  assert.equal((await req("/api/admin/venues", {
    method: "POST", token: demoToken,
    body: { name: "R2越权场馆", capacity: 10 },
  })).status, 403);
  assert.equal((await req("/api/admin/venues", {
    method: "POST",
    body: { name: "R2匿名场馆", capacity: 10 },
  })).status, 403);
  // Shop-scoped admin naming the main shop is a cross-shop create.
  assert.equal((await req("/api/admin/venues", {
    method: "POST", token: shopAdminToken,
    body: { name: "R2越权场馆", capacity: 10, shop_id: 1 },
  })).status, 403);
  // Own shop -> 200 (shop_id forced to their shop).
  const own = await req("/api/admin/venues", {
    method: "POST", token: shopAdminToken,
    body: { name: "R2分店二号剧场", capacity: 80, shop_id: shopBId },
  });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.venue.shop_id, shopBId);
});

test("no-template venue -> has_seats false; patch venue -> 200", async () => {
  const r = await req(`/api/venues/${venueId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.venue.has_seats, false);
  assert.deepEqual(r.data.venue.seat_templates, []);
  const p = await req(`/api/admin/venues/${venueId}`, {
    method: "PATCH", token: adminToken, body: { capacity: 320 },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.venue.capacity, 320);
  // Cross-shop patch -> 403; unknown venue -> 404.
  assert.equal((await req(`/api/admin/venues/${venueId}`, {
    method: "PATCH", token: shopAdminToken, body: { capacity: 1 },
  })).status, 403);
  assert.equal((await req(`/api/admin/venues/99999`, {
    method: "PATCH", token: adminToken, body: { capacity: 1 },
  })).status, 404);
  assert.equal((await req(`/api/venues/99999`)).status, 404);
});

test("resource links venue_id -> 200 + detail has venue; cross-shop link -> 403", async () => {
  // A venue in shop B (for the cross-shop link below).
  const vb = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R2分店剧场", address: "柳州测试路1号", capacity: 120, shop_id: shopBId },
  });
  assert.equal(vb.status, 200, JSON.stringify(vb.data));
  shopBVenueId = vb.data.venue.id;
  // Link via create.
  const c = await req("/api/admin/resources", {
    method: "POST", token: adminToken,
    body: {
      name: "R2 test show linked", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, venue_id: venueId,
    },
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.resource.venue_id, venueId);
  assert.deepEqual(c.data.resource.venue, { id: venueId, name: "R2测试剧场", address: "南宁测试路2号" });
  // Detail carries the same venue object.
  const d = await req(`/api/resources/${c.data.resource.id}`);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.deepEqual(d.data.resource.venue, { id: venueId, name: "R2测试剧场", address: "南宁测试路2号" });
  // A resource with no venue links to null.
  const d2 = await req(`/api/resources/${mainShowResourceId}`);
  assert.equal(d2.status, 200);
  assert.equal(d2.data.resource.venue, null);
  // Link via edit on a seeded show resource, then clear it again
  // (the shared seed must be left as found for later test files).
  const e = await req(`/api/admin/resources/${mainShowResourceId}`, {
    method: "PATCH", token: adminToken, body: { venue_id: venueId },
  });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.resource.venue_id, venueId);
  const clear = await req(`/api/admin/resources/${mainShowResourceId}`, {
    method: "PATCH", token: adminToken, body: { venue_id: null },
  });
  assert.equal(clear.status, 200, JSON.stringify(clear.data));
  assert.equal(clear.data.resource.venue_id, null);
  assert.equal(clear.data.resource.venue, null);
  // Cross-shop link -> 403 (shop-B venue on a shop-1 resource).
  assert.equal((await req(`/api/admin/resources/${mainShowResourceId}`, {
    method: "PATCH", token: adminToken, body: { venue_id: shopBVenueId },
  })).status, 403);
  // Unknown venue -> 400.
  assert.equal((await req(`/api/admin/resources/${mainShowResourceId}`, {
    method: "PATCH", token: adminToken, body: { venue_id: 99999 },
  })).status, 400);
});

test("create seat template -> zones stored; patch template -> 200", async () => {
  const zones = [
    { name: "A区", rows: 10, cols: 12 },
    { name: "B区", rows: 5, cols: 8 },
  ];
  const r = await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST", token: adminToken,
    body: { name: "默认座位图", zones },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.seat_template.zones, zones);
  const tplId = r.data.seat_template.id;
  // The venue now has seats.
  const v = await req(`/api/venues/${venueId}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.venue.has_seats, true);
  assert.equal(v.data.venue.seat_templates.length, 1);
  assert.deepEqual(v.data.venue.seat_templates[0].zones, zones);
  // Public template list.
  const list = await req(`/api/venues/${venueId}/seat-templates`);
  assert.equal(list.status, 200);
  assert.equal(list.data.seat_templates.length, 1);
  // Bad zones -> 400 (0 rows; empty list; non-integer cols).
  assert.equal((await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST", token: adminToken,
    body: { name: "坏模板", zones: [{ name: "A区", rows: 0, cols: 8 }] },
  })).status, 400);
  assert.equal((await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST", token: adminToken,
    body: { name: "坏模板", zones: [] },
  })).status, 400);
  // Cross-shop template create -> 403 (shop-B venue via shop-A admin
  // is covered by the patch below; here the shop-B admin tries the
  // main-shop venue).
  assert.equal((await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST", token: shopAdminToken,
    body: { name: "越权模板", zones },
  })).status, 403);
  // Patch the template (zones shrink to one zone).
  const p = await req(`/api/admin/seat-templates/${tplId}`, {
    method: "PATCH", token: adminToken,
    body: { zones: [{ name: "A区", rows: 10, cols: 12 }] },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(p.data.seat_template.zones, [{ name: "A区", rows: 10, cols: 12 }]);
  assert.equal((await req(`/api/admin/seat-templates/${tplId}`, {
    method: "PATCH", token: shopAdminToken,
    body: { name: "越权改名" },
  })).status, 403);
  assert.equal((await req(`/api/admin/seat-templates/99999`, {
    method: "PATCH", token: adminToken, body: { name: "无" },
  })).status, 404);
});

test("r2-venues i18n: H5 448 keys/language, miniprogram 262, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of ["venueTitle"]) {
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
    assert.equal(blocks[lang].length, 262, `${lang} key count`);
    for (const k of ["venueTitle"])
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
