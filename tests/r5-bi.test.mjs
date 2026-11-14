// tests/r5-bi.test.mjs: R5-3 (rows 39, 60) — BI dashboard + report
// export. Spawns server/server.mjs on TEST_PORT (default 3118) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered (7 tests): (1) BI KPIs equal GET /api/admin/stats
// (users/orders/revenue_cents/resources/demands — same query scope,
// shared adminStatsTotals()); (2) the 30-day series is 30 rows
// ending today (Beijing), ascending, and every row matches the real
// paid orders in the DB; (3) top_shows revenue matches the real
// paid orders for this file's show; (4) top_venues revenue matches
// the real paid orders for this file's venue; (5) the xlsx export
// is a valid zip (STORED entries) whose sheet + shared strings
// contain the KPI rows and the top-show rows, with the real xlsx
// MIME type and a bi-YYYY-MM-DD.xlsx filename; (6) the csv export
// carries the UTF-8 BOM and the KPI rows; (7) anonymous -> 401,
// non-admin -> 403 on both endpoints, and ?format=pdf -> 400
// (there is deliberately NO pdf endpoint — PDF goes via browser
// print, see server/routes/bi.mjs).
//
// The zip is read with node:zlib/node:fs only in spirit: STORED
// entries need no inflate, so the test parses the PK local file
// headers by hand and slices the entry bytes out directly.
//
// Test usernames are hyphen-free ([A-Za-z0-9_] only — R4-4 lesson:
// register rejects hyphens). All assertions filter by this file's
// own usernames / resource / show / venue — other test files share
// this DB. This file creates no i18n keys (admin labels are
// hardcoded Chinese), so the H5 405 / miniprogram 218 counts stay.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3118);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers };
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function completeThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

async function getBi(token) {
  const r = await req("/api/admin/bi", { token });
  assert.equal(r.status, 200, `bi -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function todayBeijing() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

// Minimal zip reader for STORED entries: walk the PK\x03\x04 local
// file headers, slice each entry's bytes out by its (uncompressed)
// size. No inflate anywhere — method must be 0 for every entry.
function readZipEntries(buf) {
  assert.equal(buf[0], 0x50, "not a zip (PK missing)");
  assert.equal(buf[1], 0x4b, "not a zip (PK missing)");
  assert.ok(
    buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])),
    "zip end-of-central-directory record missing",
  );
  const entries = new Map();
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const start = off + 30 + nameLen + extraLen;
    assert.equal(method, 0, `zip entry ${name} is not STORED (method ${method})`);
    entries.set(name, buf.subarray(start, start + size));
    off = start + size;
  }
  return entries;
}

let adminToken;
let userToken;
let plainResourceId;
let showId;
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
  userToken = await register("r5biuser", "Test1234");
  // A deterministic ¥280 show resource + show + venue, with 3
  // completed orders = ¥840 (84000 cents) of paid revenue today.
  const venue = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R5 BI 剧场", address: "南宁", capacity: 200 },
  });
  assert.equal(venue.status, 200, JSON.stringify(venue.data));
  venueId = venue.data.venue?.id ?? venue.data.id;
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R5 BI show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
  await pool.query("UPDATE resources SET venue_id=$1 WHERE id=$2", [venueId, plainResourceId]);
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: plainResourceId, title: "R5 BI 演出" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  showId = show.data.id;
  for (let i = 0; i < 3; i++) {
    const o = await orderAs(userToken, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    await completeThrough(userToken, o.data.id);
  }
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("BI KPIs equal GET /api/admin/stats (same query scope)", async () => {
  const bi = await getBi(adminToken);
  const stats = await req("/api/admin/stats", { token: adminToken });
  assert.equal(stats.status, 200, JSON.stringify(stats.data));
  for (const key of ["users", "orders", "revenue_cents", "resources", "demands"]) {
    assert.equal(
      bi.kpis[key], stats.data[key],
      `BI kpi ${key} (${bi.kpis[key]}) != admin stats ${key} (${stats.data[key]})`,
    );
  }
  // paid_rate = paid / all orders, 0..1.
  const row = await pool.query(
    "SELECT COUNT(*) FILTER (WHERE status IN ('paid','completed')) AS paid, COUNT(*) AS total FROM orders",
  );
  const paid = Number(row.rows[0].paid);
  const total = Number(row.rows[0].total);
  assert.equal(bi.kpis.paid_rate, total === 0 ? 0 : Math.round((paid / total) * 10000) / 10000);
  assert.ok(bi.kpis.paid_rate >= 0 && bi.kpis.paid_rate <= 1);
  // today_* match the real paid orders of today (Beijing).
  const today = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS revenue FROM orders
     WHERE status IN ('paid','completed')
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date = $1::date`,
    [todayBeijing()],
  );
  assert.equal(bi.kpis.today_orders, Number(today.rows[0].n));
  assert.equal(bi.kpis.today_revenue_cents, Number(today.rows[0].revenue));
});

test("30-day series: 30 rows ending today, every row matches the DB", async () => {
  const bi = await getBi(adminToken);
  assert.equal(bi.series.length, 30, `want 30 series rows, got ${bi.series.length}`);
  const today = todayBeijing();
  const start = new Date(new Date(today + "T00:00:00Z").getTime() - 29 * 86400000)
    .toISOString().slice(0, 10);
  assert.equal(bi.series[0].date, start);
  assert.equal(bi.series[29].date, today);
  const rows = await pool.query(
    `SELECT (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS date,
            COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue_cents
     FROM orders WHERE status IN ('paid','completed')
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date >= $1::date
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date <= $2::date
     GROUP BY 1 ORDER BY 1`,
    [start, today],
  );
  const byDate = new Map(
    rows.rows.map((r) => [
      String(r.date).slice(0, 10),
      { orders: Number(r.orders), revenue_cents: Number(r.revenue_cents) },
    ]),
  );
  for (let i = 0; i < 30; i++) {
    const date = new Date(new Date(start + "T00:00:00Z").getTime() + i * 86400000)
      .toISOString().slice(0, 10);
    assert.equal(bi.series[i].date, date);
    const want = byDate.get(date) || { orders: 0, revenue_cents: 0 };
    assert.equal(bi.series[i].orders, want.orders, `series ${date} orders`);
    assert.equal(bi.series[i].revenue_cents, want.revenue_cents, `series ${date} revenue`);
  }
});

test("top_shows revenue matches the real paid orders for this file's show", async () => {
  const bi = await getBi(adminToken);
  const mine = bi.top_shows.find((s) => s.show_id === showId);
  assert.ok(mine, `own show ${showId} missing from top_shows ${JSON.stringify(bi.top_shows)}`);
  assert.equal(mine.title, "R5 BI 演出");
  assert.equal(mine.orders, 3);
  assert.equal(mine.revenue_cents, 84000);
  // Cross-check against the same grouping run directly on the DB.
  const row = await pool.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.amount),0) AS revenue
     FROM orders o WHERE o.resource_id=$1 AND o.status IN ('paid','completed')`,
    [plainResourceId],
  );
  assert.equal(mine.orders, Number(row.rows[0].orders));
  assert.equal(mine.revenue_cents, Number(row.rows[0].revenue));
});

test("top_venues revenue matches the real paid orders for this file's venue", async () => {
  const bi = await getBi(adminToken);
  const mine = bi.top_venues.find((v) => v.venue_id === venueId);
  assert.ok(mine, `own venue ${venueId} missing from top_venues ${JSON.stringify(bi.top_venues)}`);
  assert.equal(mine.name, "R5 BI 剧场");
  assert.equal(mine.orders, 3);
  assert.equal(mine.revenue_cents, 84000);
});

test("xlsx export is a valid zip; sheet + shared strings contain the KPI rows", async () => {
  const r = await reqRaw("/api/admin/bi/export?format=xlsx", { token: adminToken });
  assert.equal(r.status, 200, `xlsx export -> ${r.status}`);
  assert.equal(
    r.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const date = todayBeijing();
  assert.equal(
    r.headers.get("content-disposition"),
    `attachment; filename="bi-${date}.xlsx"`,
  );
  const entries = readZipEntries(r.buf);
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/worksheets/sheet1.xml",
    "xl/sharedStrings.xml",
  ]) {
    assert.ok(entries.has(name), `xlsx missing entry ${name}`);
  }
  assert.ok(
    entries.get("xl/workbook.xml").toString("utf8").includes('name="BI"'),
    "workbook does not name the sheet BI",
  );
  const shared = entries.get("xl/sharedStrings.xml").toString("utf8");
  for (const label of ["用户数", "订单数", "收入（分）", "资源数", "需求数", "R5 BI 演出"]) {
    assert.ok(shared.includes(label), `sharedStrings missing label ${label}`);
  }
  const sheet = entries.get("xl/worksheets/sheet1.xml").toString("utf8");
  const bi = await getBi(adminToken);
  // The KPI numeric values live in the sheet as <v> cells.
  for (const value of [bi.kpis.users, bi.kpis.orders, bi.kpis.revenue_cents, 84000]) {
    assert.ok(sheet.includes(`<v>${value}</v>`), `sheet missing KPI value ${value}`);
  }
});

test("csv export carries the BOM and the KPI rows (default format is csv)", async () => {
  const bi = await getBi(adminToken);
  const def = await reqRaw("/api/admin/bi/export", { token: adminToken });
  assert.equal(def.status, 200, `csv export (default) -> ${def.status}`);
  assert.ok(def.headers.get("content-type").startsWith("text/csv"));
  const text = def.buf.toString("utf8");
  assert.ok(text.startsWith("\uFEFF"), "csv export is missing the UTF-8 BOM");
  for (const line of [
    `"用户数","${bi.kpis.users}"`,
    `"订单数","${bi.kpis.orders}"`,
    `"收入（分）","${bi.kpis.revenue_cents}"`,
  ]) {
    assert.ok(text.includes(line), `csv missing KPI row ${line}`);
  }
  assert.ok(text.includes("R5 BI 演出"), "csv missing the top-show row");
  assert.ok(text.includes('"84000"'), "csv missing the top-show revenue");
  const explicit = await reqRaw("/api/admin/bi/export?format=csv", { token: adminToken });
  assert.equal(explicit.status, 200);
  assert.ok(explicit.buf.toString("utf8").startsWith("\uFEFF"));
});

test("anonymous -> 401, non-admin -> 403 on both endpoints; no pdf format", async () => {
  assert.equal((await req("/api/admin/bi")).status, 401);
  assert.equal((await req("/api/admin/bi", { token: userToken })).status, 403);
  assert.equal((await reqRaw("/api/admin/bi/export?format=xlsx")).status, 401);
  assert.equal((await reqRaw("/api/admin/bi/export?format=xlsx", { token: userToken })).status, 403);
  assert.equal((await reqRaw("/api/admin/bi/export?format=csv")).status, 401);
  assert.equal((await reqRaw("/api/admin/bi/export?format=csv", { token: userToken })).status, 403);
  // ?format=pdf is deliberately NOT a thing: the server never
  // generates PDF files (no CJK font dependency); PDF goes via
  // browser print. A fake pdf endpoint returning HTML would lie.
  assert.equal((await reqRaw("/api/admin/bi/export?format=pdf", { token: adminToken })).status, 400);
});
