// tests/r6-venues-library.test.mjs: R6-2 (rows 64, 65, 66) — venue /
// equipment / talent libraries. Spawns server/server.mjs on TEST_PORT
// (default 3110) and talks to it over HTTP. DATABASE_URL must point
// at a FRESH disposable database (npm test is NOT idempotent on a
// reused DB).
//
// Covered: day with a performance -> venue in occupied, not in free;
// day without -> venue in free; equipment rental charges the daily
// rent (meta.daily_rent_cents) and deducts stock per day (date mode,
// no one-per-day block); talents filter by meta.role; cross-shop
// venue patch -> 403; invalid date/month -> 400, unknown venue month
// -> 404; month mode lists the occupied date; i18n key counts (H5
// 399, miniprogram 207, equal sets).
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
let buyerToken;
let shopAdminToken;
let shopBId;
let venueId;
let venueName;
let equipmentId;
let actorId;
let directorId;

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD || "demo123",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
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
  // A buyer of our own (fresh user: 普通会员, 0% discount, so the
  // order amount is exactly the daily rent below).
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { username: "r62buyer", password: "Buyer123", name: "R62买家" },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  buyerToken = reg.data.token;
  // A shop-scoped admin of our own (r2-shows owns "r2shopadmin" and
  // r2-venues owns "r2venueadmin" in this shared DB).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r62shopadmin", pw, "R62子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R62分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
  shopAdminToken = await login("r62shopadmin", "Admin1234");
  // A seeded main-shop venue to occupy: 广西文化艺术中心.
  const venues = await req("/api/venues");
  assert.equal(venues.status, 200, JSON.stringify(venues.data));
  const seed = venues.data.venues.find((v) => v.name === "广西文化艺术中心");
  assert.ok(seed, "fresh seed has 广西文化艺术中心");
  assert.equal(seed.shop_id, 1);
  venueId = seed.id;
  venueName = seed.name;
  // A show resource staged in that venue + an approved show + one
  // performance on 2030-06-15. (Show resources are NOT linked by the
  // R2-4 backfill — only venue-category resources are — so this file
  // creates its own staged show resource.)
  const showRes = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R62测试剧目", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, venue_id: venueId,
    },
  });
  assert.equal(showRes.status, 200, JSON.stringify(showRes.data));
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: showRes.data.resource.id, title: "R62测试演出", description: "R62 test show" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  const reviewed = await req(`/api/admin/shows/${show.data.show.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "approved" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  const perf = await req(`/api/shows/${show.data.show.id}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: "2030-06-15T19:30:00", price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("day with a performance -> venue in occupied, not in free", async () => {
  const r = await req("/api/venues/available?date=2030-06-15");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.date, "2030-06-15");
  const inFree = r.data.free.find((v) => v.id === venueId);
  assert.equal(inFree, undefined, `${venueName} must not be free on its performance day`);
  const occ = r.data.occupied.find((v) => v.id === venueId);
  assert.ok(occ, `${venueName} must be occupied on its performance day`);
  assert.equal(occ.name, venueName);
  assert.equal(occ.performances.length, 1);
  assert.equal(occ.performances[0].show_title, "R62测试演出");
  assert.equal(occ.performances[0].start_at, "2030-06-15T19:30:00");
  // Another seeded venue with no performance that day stays free.
  const other = r.data.free.find((v) => v.name === "南宁小剧场");
  assert.ok(other, "南宁小剧场 must be free on 2030-06-15");
});

test("day without a performance -> venue in free, occupied empty", async () => {
  const r = await req("/api/venues/available?date=2030-01-01");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.date, "2030-01-01");
  assert.deepEqual(r.data.occupied, []);
  const names = r.data.free.map((v) => v.name);
  for (const name of ["广西文化艺术中心", "南宁小剧场", "邕江艺术空间·黑匣子剧场", "漓江畔·山水露天舞台", "柳江青年艺术剧场", "海风文化客厅·多功能厅"]) {
    assert.ok(names.includes(name), `missing free venue ${name}`);
  }
  // Anonymous: the endpoint is public.
  assert.equal((await req("/api/venues/available?date=2030-01-01")).status, 200);
});

test("equipment rental charges the daily rent and deducts stock per day", async () => {
  // Listed price ¥1500/day, daily rent ¥1200/day: the order must
  // charge the rent, not the price.
  const created = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R62灯光套装", category: "equipment", city: "南宁",
      price: 150000, unit: "天", stock: 3,
      meta: { daily_rent_cents: 120000, model: "R62-TEST" },
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.resource.meta.daily_rent_cents, 120000);
  equipmentId = created.data.resource.id;
  const order1 = await req("/api/orders", {
    method: "POST",
    token: buyerToken,
    body: { resourceId: equipmentId, quantity: 1, booking_date: "2030-02-10" },
  });
  assert.equal(order1.status, 200, JSON.stringify(order1.data));
  assert.equal(order1.data.amount, 120000);
  const after1 = await req(`/api/resources/${equipmentId}`);
  assert.equal(after1.status, 200);
  assert.equal(after1.data.resource.stock, 2);
  // Date mode: stock 2 minus 1 booked that day = 1 left that day.
  const avail1 = await req(`/api/resources/${equipmentId}/availability?date=2030-02-10`);
  assert.equal(avail1.status, 200, JSON.stringify(avail1.data));
  assert.equal(avail1.data.mode, "date");
  assert.equal(avail1.data.available, 1);
  // No one-per-day block any more: a second rental the same day
  // succeeds while stock remains.
  const order2 = await req("/api/orders", {
    method: "POST",
    token: buyerToken,
    body: { resourceId: equipmentId, quantity: 1, booking_date: "2030-02-10" },
  });
  assert.equal(order2.status, 200, JSON.stringify(order2.data));
  assert.equal(order2.data.amount, 120000);
  const after2 = await req(`/api/resources/${equipmentId}`);
  assert.equal(after2.data.resource.stock, 1);
  const avail2 = await req(`/api/resources/${equipmentId}/availability?date=2030-02-10`);
  assert.equal(avail2.data.available, 0);
  // A different day still sees the remaining unit.
  const availOther = await req(`/api/resources/${equipmentId}/availability?date=2030-02-11`);
  assert.equal(availOther.data.available, 1);
});

test("talents filter by role; bad role -> 400", async () => {
  const actor = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R62演员甲", category: "artist", city: "南宁",
      price: 500000, unit: "场", stock: 10,
      meta: { role: "演员", talent_fee_cents: 500000 },
    },
  });
  assert.equal(actor.status, 200, JSON.stringify(actor.data));
  actorId = actor.data.resource.id;
  assert.equal(actor.data.resource.meta.talent_fee_cents, 500000);
  const director = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R62导演甲", category: "artist", city: "南宁",
      price: 800000, unit: "场", stock: 10,
      meta: { role: "导演", talent_fee_cents: 800000 },
    },
  });
  assert.equal(director.status, 200, JSON.stringify(director.data));
  directorId = director.data.resource.id;
  const actors = await req("/api/resources?category=artist&role=演员");
  assert.equal(actors.status, 200, JSON.stringify(actors.data));
  const names = actors.data.resources.map((r) => r.name);
  assert.ok(names.includes("R62演员甲"), "role=演员 must list the actor");
  assert.ok(!names.includes("R62导演甲"), "role=演员 must not list the director");
  const writers = await req("/api/resources?category=artist&role=编剧");
  assert.equal(writers.status, 200);
  assert.ok(!writers.data.resources.map((r) => r.name).includes("R62演员甲"));
  assert.equal((await req("/api/resources?category=artist&role=歌手")).status, 400);
  // The role lives on the resource detail too.
  const one = await req(`/api/resources/${actorId}`);
  assert.equal(one.data.resource.meta.role, "演员");
});

test("cross-shop venue patch -> 403; own-shop venue patch -> 200", async () => {
  assert.equal((await req(`/api/admin/venues/${venueId}`, {
    method: "PATCH", token: shopAdminToken, body: { capacity: 1 },
  })).status, 403);
  const own = await req("/api/admin/venues", {
    method: "POST",
    token: shopAdminToken,
    body: { name: "R62分店剧场", capacity: 80 },
  });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.venue.shop_id, shopBId);
  const patched = await req(`/api/admin/venues/${own.data.venue.id}`, {
    method: "PATCH", token: shopAdminToken, body: { capacity: 90 },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.venue.capacity, 90);
  // Anonymous venue patch -> 403 (admin-only, like the other
  // admin venue writes).
  assert.equal((await req(`/api/admin/venues/${venueId}`, {
    method: "PATCH", body: { capacity: 1 },
  })).status, 403);
});

test("invalid date/month -> 400; unknown venue month -> 404", async () => {
  assert.equal((await req("/api/venues/available?date=not-a-date")).status, 400);
  assert.equal((await req("/api/venues/available?date=2026-02-30")).status, 400);
  assert.equal((await req("/api/venues/available?month=2030-06")).status, 400);
  assert.equal((await req("/api/venues/available?month=2030-13")).status, 400);
  assert.equal((await req(`/api/venues/available?venue_id=99999&month=2030-06`)).status, 404);
  assert.equal((await req(`/api/venues/available?venue_id=${venueId}&month=2030-13`)).status, 400);
});

test("month mode lists the occupied date for one venue", async () => {
  const r = await req(`/api/venues/available?venue_id=${venueId}&month=2030-06`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.month, "2030-06");
  assert.equal(r.data.venue.id, venueId);
  assert.equal(r.data.venue.name, venueName);
  const day = r.data.occupied.find((o) => o.date === "2030-06-15");
  assert.ok(day, "2030-06-15 must be occupied in month mode");
  assert.equal(day.performances.length, 1);
  assert.equal(day.performances[0].show_title, "R62测试演出");
  const empty = await req(`/api/venues/available?venue_id=${venueId}&month=2030-01`);
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.occupied, []);
});

test("r6-venues-library i18n: H5 399 keys/language, miniprogram 207, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [399, 399, 399]);
  for (const k of ["libVenue", "libEquipment", "libTalent", "talentRole", "roleActor", "roleDirector", "roleWriter", "dailyRent", "talentFee", "venueFree", "venueOccupied", "venueCalendar", "venueOccupiedDays"]) {
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
    assert.equal(blocks[lang].length, 207, `${lang} key count`);
    for (const k of ["libVenue", "libEquipment", "libTalent", "talentRole", "roleActor", "roleDirector", "roleWriter", "dailyRent", "talentFee", "venueFree", "venueOccupied", "venueCalendar", "venueOccupiedDays"])
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
