// tests/r2-seats.test.mjs: R2-5 (rows 12, 13) — seat selection + venue analysis.
// Spawns server/server.mjs on TEST_PORT (default 3110) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: generate -> seat count matches the template (idempotent);
// select -> held (10-minute hold); 2nd order same seat -> 409; pay ->
// sold; cancel -> released; expired hold (held_until set directly in
// the test) can be re-selected; analysis numbers match real orders;
// no-template venue generate -> 400; i18n key counts (H5 366,
// miniprogram 168, equal sets).
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
let demoToken;
let shopAdminToken;
let venueId;
let showResourceId;
let perfId;
let tierId;
let seatA;
let seatB;
let order1;
let order2;

async function createOrder(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

async function transitionOrder(token, orderId, action) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token });
}

async function listSeats() {
  const r = await req(`/api/performances/${perfId}/seats`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.seats;
}

function seatByPos(seats, row, col) {
  const s = seats.find((x) => x.row === row && x.col === col);
  assert.ok(s, `no seat at ${row}x${col}`);
  return s;
}

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
  // A shop-scoped admin of our own (r2-shows owns "r2shopadmin",
  // r2-venues owns "r2venueadmin" in this shared DB).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r2seatadmin", pw, "R2选座子店管理员", new Date().toISOString()],
  );
  const shopAdminId = a2.rows[0].id;
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "R2选座分店", owner_id: shopAdminId },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopAdminToken = await login("r2seatadmin", "Admin1234");
  // Main-shop venue + one template (A区 2x2 = 4 seats).
  const v = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R2选座剧场", address: "南宁测试路3号", capacity: 4 },
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  venueId = v.data.venue.id;
  const tpl = await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST",
    token: adminToken,
    body: { name: "默认座位图", zones: [{ name: "A区", rows: 2, cols: 2 }] },
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.data));
  // Show resource linked to the venue + approved show + on-sale
  // performance + one ticket type.
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R2 seat show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, venue_id: venueId,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  showResourceId = res.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: showResourceId, title: "R2选座专场" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  const showId = show.data.show.id;
  assert.equal((await req(`/api/admin/shows/${showId}`, {
    method: "PATCH", token: adminToken, body: { status: "approved" },
  })).status, 200);
  const perf = await req(`/api/shows/${showId}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: "2026-12-10T19:30:00", price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
  perfId = perf.data.performance.id;
  assert.equal((await req(`/api/admin/performances/${perfId}`, {
    method: "PATCH", token: adminToken, body: { status: "on_sale" },
  })).status, 200);
  const tier = await req(`/api/performances/${perfId}/ticket-types`, {
    method: "POST",
    token: adminToken,
    body: { name: "普通票", price_cents: 28000, quota: 10 },
  });
  assert.equal(tier.status, 200, JSON.stringify(tier.data));
  tierId = tier.data.ticket_type.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("generate -> seat count matches the template; idempotent", async () => {
  // A scheduled performance's seats are not public yet.
  assert.equal((await req(`/api/performances/${perfId}/seats`)).status, 200);
  const g = await req(`/api/admin/performances/${perfId}/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.generated, 4);
  assert.equal(g.data.total, 4);
  // Second generate is a no-op (idempotent, skips existing).
  const g2 = await req(`/api/admin/performances/${perfId}/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  });
  assert.equal(g2.status, 200, JSON.stringify(g2.data));
  assert.equal(g2.data.generated, 0);
  assert.equal(g2.data.total, 4);
  const seats = await listSeats();
  assert.equal(seats.length, 4);
  assert.ok(seats.every((s) => s.status === "available" && s.zone === "A区"));
  // Cross-shop generate -> 403; unknown performance -> 404.
  assert.equal((await req(`/api/admin/performances/${perfId}/seats/generate`, {
    method: "POST", token: shopAdminToken, body: {},
  })).status, 403);
  assert.equal((await req(`/api/admin/performances/99999/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  })).status, 404);
  seatA = seatByPos(seats, 1, 1);
  seatB = seatByPos(seats, 1, 2);
});

test("select -> held for 10 minutes; another order cannot take it", async () => {
  const o1 = await createOrder(demoToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(o1.status, 200, JSON.stringify(o1.data));
  order1 = o1.data.id;
  // Only a pending order can select; the hold is 10 minutes.
  const h = await req(`/api/orders/${order1}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatA.id] },
  });
  assert.equal(h.status, 200, JSON.stringify(h.data));
  assert.equal(h.data.seats.length, 1);
  assert.equal(h.data.seats[0].status, "held");
  const until = new Date(h.data.held_until).valueOf() - Date.now();
  assert.ok(until > 9 * 60 * 1000 && until <= 10 * 60 * 1000, `held_until in ${until}ms`);
  const seats = await listSeats();
  assert.equal(seatByPos(seats, 1, 1).status, "held");
  // A second pending order taking the same seat -> 409; taking a
  // different seat -> 200.
  const o2 = await createOrder(demoToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  order2 = o2.data.id;
  assert.equal((await req(`/api/orders/${order2}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatA.id] },
  })).status, 409);
  const h2 = await req(`/api/orders/${order2}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatB.id] },
  });
  assert.equal(h2.status, 200, JSON.stringify(h2.data));
  assert.equal(h2.data.seats[0].status, "held");
  // Another user cannot select seats on this order -> 403.
  const other = await login("supplier", "demo123");
  assert.equal((await req(`/api/orders/${order1}/seats`, {
    method: "POST", token: other, body: { seat_ids: [seatB.id] },
  })).status, 403);
});

test("pay -> sold; a paid order cannot select seats", async () => {
  assert.equal((await transitionOrder(demoToken, order1, "confirm")).status, 200);
  assert.equal((await transitionOrder(demoToken, order1, "pay")).status, 200);
  let seats = await listSeats();
  assert.equal(seatByPos(seats, 1, 1).status, "sold");
  assert.equal(seatByPos(seats, 1, 2).status, "held");
  // A paid order can no longer select seats.
  assert.equal((await req(`/api/orders/${order1}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatB.id] },
  })).status, 400);
});

test("cancel -> held seat released", async () => {
  // Cancelling order 2 releases its held seat; the sold seat stays sold.
  assert.equal((await transitionOrder(demoToken, order2, "cancel")).status, 200);
  const seats = await listSeats();
  assert.equal(seatByPos(seats, 1, 2).status, "available");
  assert.equal(seatByPos(seats, 1, 1).status, "sold");
});

test("expired hold can be re-selected (lazy expiry, no background job)", async () => {
  const o3 = await createOrder(demoToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(o3.status, 200, JSON.stringify(o3.data));
  const order3 = o3.data.id;
  assert.equal((await req(`/api/orders/${order3}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatB.id] },
  })).status, 200);
  // Age the hold past its 10 minutes directly in the DB (the test
  // stands in for time passing; there is no expiry job to wait for).
  await pool.query(
    "UPDATE seats SET held_until=$1 WHERE id=$2",
    [new Date(Date.now() - 60 * 1000).toISOString(), seatB.id],
  );
  // Reads treat the expired hold as available.
  assert.equal(seatByPos(await listSeats(), 1, 2).status, "available");
  // A fourth order takes the seat.
  const o4 = await createOrder(demoToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(o4.status, 200, JSON.stringify(o4.data));
  assert.equal((await req(`/api/orders/${o4.data.id}/seats`, {
    method: "POST", token: demoToken, body: { seat_ids: [seatB.id] },
  })).status, 200);
  assert.equal(seatByPos(await listSeats(), 1, 2).status, "held");
  // Clean up: cancel both leftover pending orders so the shared DB
  // keeps no stray holds behind (their seats return to available).
  assert.equal((await transitionOrder(demoToken, order3, "cancel")).status, 200);
  assert.equal((await transitionOrder(demoToken, o4.data.id, "cancel")).status, 200);
  assert.equal(seatByPos(await listSeats(), 1, 2).status, "available");
});

test("analysis numbers match real orders", async () => {
  const r = await req("/api/admin/analysis?period=day", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const mine = r.data.venues.find((v) => v.name === "R2选座剧场");
  assert.ok(mine, JSON.stringify(r.data.venues.map((v) => v.name)));
  // 1 performance, 4 seats, 1 sold (order 1 paid) -> 25%.
  assert.equal(mine.performances, 1);
  assert.equal(mine.seatOccupancy, 25);
  // 1 paid order -> ticket revenue is that order's real amount (R3-1:
  // the demo buyer holds a member tier, so the paid amount is the
  // discounted ¥23800, not the ¥28000 ticket price — the analysis must
  // match the real order, whatever it is).
  const paid = await pool.query(
    "SELECT amount FROM orders WHERE id=$1",
    [order1],
  );
  const expectedRevenue = paid.rows[0].amount;
  assert.equal(mine.ticketRevenue, expectedRevenue);
  assert.equal(mine.averageRevenue, expectedRevenue);
  // Response shape unchanged (recommendations etc.).
  assert.ok(Array.isArray(mine.recommendations));
  assert.ok("occupancy" in mine && "idleRate" in mine);
  // A backfilled venue with no performances has no seat sample.
  const plain = r.data.venues.find((v) => v.name === "广西文化艺术中心");
  assert.ok(plain, "backfilled venue missing from analysis");
  assert.equal(plain.performances, 0);
  assert.equal(plain.seatOccupancy, null);
  assert.equal(plain.averageRevenue, null);
});

test("no-template venue generate -> 400; unsold performance seats -> 404", async () => {
  const v = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R2无模板剧场", capacity: 50 },
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R2 no-template show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, venue_id: v.data.venue.id,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: res.data.resource.id, title: "R2无模板专场" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  const showId = show.data.show.id;
  assert.equal((await req(`/api/admin/shows/${showId}`, {
    method: "PATCH", token: adminToken, body: { status: "approved" },
  })).status, 200);
  const perf = await req(`/api/shows/${showId}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: "2026-12-11T19:30:00", price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
  const noTplPerfId = perf.data.performance.id;
  const g = await req(`/api/admin/performances/${noTplPerfId}/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  });
  assert.equal(g.status, 400, JSON.stringify(g.data));
  assert.equal(g.data.error, "该场馆未配置座位模板");
  // A scheduled (not on-sale) performance's seats are not public.
  assert.equal((await req(`/api/performances/${noTplPerfId}/seats`)).status, 404);
  assert.equal((await req(`/api/performances/99999/seats`)).status, 404);
});

test("r2-seats i18n: H5 366 keys/language, miniprogram 168, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [366, 366, 366]);
  for (const k of ["seatPick", "seatSelected"]) {
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
    assert.equal(blocks[lang].length, 168, `${lang} key count`);
    for (const k of ["seatPick", "seatSelected"])
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
