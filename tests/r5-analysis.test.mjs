// tests/r5-analysis.test.mjs: R5-4 (rows 59, 61) — data aggregation +
// smart analysis. Extends GET /api/admin/analysis (buildAnalysis in
// server/routes/admin-insights.mjs — no second implementation) with
// three sections from real R2–R4 data, plus the analysis_snapshots
// table + POST /api/admin/analysis/refresh + ?source=snapshot|live.
//
// Covered (8 tests): (1) refresh upserts the snapshot and its numbers
// match live; (2) per-show revenue matches the real paid orders
// (orders -> performances -> shows via orders.performance_id, with
// the old-flow fallback via orders.resource_id = shows.resource_id);
// (3) a venue WITH seat data has a numeric seatOccupancy (the
// "暂无关联售票样本" label must NOT appear for it) while a venue
// with genuinely no seats still shows null honestly; (4) coupon /
// flash-sale effectiveness matches the real redemptions and orders;
// (5) tier distribution + spending buckets match the real users
// (computed independently from the DB in the test); (6) ?source=
// snapshot returns the stored payload + computed_at, bad source ->
// 400, a period never refreshed -> 404; (7) anonymous -> 401 /
// non-admin -> 403 on refresh (GET keeps its existing 403 for both);
// (8) recommendations are rule text only: the low-occupancy show
// suggests a flash sale, the top show suggests promotion, and no
// recommendation claims to be AI.
//
// The fixture show ("R5分析演出", ¥280, 1 performance, 4 seats,
// 1 sold seat) yields: shows entry {performances 1, orders 2,
// revenue 50400 (¥280 seat order + ¥22400 flash order), occupancy
// 25}; venue seatOccupancy 25. The coupon order is a separate
// old-flow order (¥28000 - ¥5000 coupon = ¥23000 paid). A second
// user ("r5analysissilver") completes 4 x ¥280 orders = ¥112000
// spending, so the tier distribution has a real 银卡会员 member.
//
// Test usernames are hyphen-free ([A-Za-z0-9_] only — R4-4 lesson:
// register rejects hyphens). All assertions filter by this file's
// own usernames / resource / show / venue / coupon code — other test
// files share this DB. This file creates no i18n keys (admin labels
// are hardcoded Chinese), so the H5 455 (+82 th/ms/id) / miniprogram 269 (+82 th/ms/id) counts stay.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3119);
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

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
}

async function completeThrough(token, orderId) {
  await payThrough(token, orderId);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

async function getAnalysis(token, qs = "?period=day") {
  const r = await req(`/api/admin/analysis${qs}`, { token });
  assert.equal(r.status, 200, `analysis ${qs} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}
const H = 60 * 60 * 1000;

let adminToken;
let userToken;
let silverToken;
let plainResourceId;
let showResourceId;
let showId;
let perfId;
let venueId;
let emptyVenueId;
let couponId;
let flashSaleId;

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
  userToken = await register("r5analysisuser", "Test1234");
  silverToken = await register("r5analysissilver", "Test1234");
  // A venue with a 2x2 seat template + one approved show + one
  // on-sale performance + one ticket type (r2-seats pattern), plus
  // a second venue with no shows at all (the honest-null case).
  const venue = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R5分析剧场", address: "南宁", capacity: 4 },
  });
  assert.equal(venue.status, 200, JSON.stringify(venue.data));
  venueId = venue.data.venue?.id ?? venue.data.id;
  const emptyVenue = await req("/api/admin/venues", {
    method: "POST",
    token: adminToken,
    body: { name: "R5分析空剧场", address: "南宁", capacity: 50 },
  });
  assert.equal(emptyVenue.status, 200, JSON.stringify(emptyVenue.data));
  emptyVenueId = emptyVenue.data.venue?.id ?? emptyVenue.data.id;
  const tpl = await req(`/api/venues/${venueId}/seat-templates`, {
    method: "POST",
    token: adminToken,
    body: { name: "默认座位图", zones: [{ name: "A区", rows: 2, cols: 2 }] },
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.data));
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R5分析演出", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 100, venue_id: venueId,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  showResourceId = res.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: showResourceId, title: "R5分析演出" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  showId = show.data.show?.id ?? show.data.id;
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
  const tierId = tier.data.ticket_type.id;
  const gen = await req(`/api/admin/performances/${perfId}/seats/generate`, {
    method: "POST", token: adminToken, body: {},
  });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.generated, 4);
  // Seat order: create -> select seat (1,1) -> confirm -> pay.
  // The buyer is fresh (no tier), so the paid amount is the full
  // ¥28000 and the seat ends up sold.
  const seatOrder = await orderAs(userToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(seatOrder.status, 200, JSON.stringify(seatOrder.data));
  const seats = await req(`/api/performances/${perfId}/seats`);
  assert.equal(seats.status, 200, JSON.stringify(seats.data));
  const seatA = seats.data.seats.find((s) => s.row === 1 && s.col === 1);
  assert.ok(seatA, "no seat at 1x1");
  assert.equal((await req(`/api/orders/${seatOrder.data.id}/seats`, {
    method: "POST", token: userToken, body: { seat_ids: [seatA.id] },
  })).status, 200);
  await payThrough(userToken, seatOrder.data.id);
  // Flash sale (20% off, live window) on the same performance, then
  // a second paid order through it — no seat, ¥22400.
  const sale = await req("/api/admin/flash-sales", {
    method: "POST",
    token: adminToken,
    body: {
      performance_id: perfId, name: "R5分析限时购", kind: "pct",
      discount_pct: 20, start_at: iso(-H), end_at: iso(2 * H),
    },
  });
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  flashSaleId = sale.data.flash_sale.id;
  const flashOrder = await orderAs(userToken, {
    resourceId: showResourceId, quantity: 1,
    performance_id: perfId, ticket_type_id: tierId,
  });
  assert.equal(flashOrder.status, 200, JSON.stringify(flashOrder.data));
  await payThrough(userToken, flashOrder.data.id);
  // Coupon order (old-flow, separate plain resource): fixed ¥5000
  // off ¥28000 -> ¥23000 paid, one redemption of ¥5000.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R5分析商品", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
  const coupon = await req("/api/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: "R5A5000", kind: "fixed", value_cents: 5000 },
  });
  assert.equal(coupon.status, 200, JSON.stringify(coupon.data));
  couponId = coupon.data.coupon.id;
  const couponOrder = await orderAs(userToken, {
    resourceId: plainResourceId, quantity: 1,
    booking_date: "2026-12-05", coupon_code: "R5A5000",
  });
  assert.equal(couponOrder.status, 200, JSON.stringify(couponOrder.data));
  await completeThrough(userToken, couponOrder.data.id);
  // Silver member: 4 completed ¥280 orders = ¥112000 spending,
  // over the 银卡会员 ¥100000 threshold.
  for (let i = 0; i < 4; i++) {
    const o = await orderAs(silverToken, {
      resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    await completeThrough(silverToken, o.data.id);
  }
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("refresh upserts the snapshot and its numbers match live", async () => {
  const r = await req("/api/admin/analysis/refresh", {
    method: "POST",
    token: adminToken,
    body: { period: "day" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.period, "day");
  assert.ok(r.data.computed_at, "refresh must return computed_at");
  const row = await pool.query(
    "SELECT * FROM analysis_snapshots WHERE period=$1",
    ["day"],
  );
  assert.equal(row.rows.length, 1, "one snapshot row for period day");
  assert.equal(row.rows[0].created_at, r.data.computed_at);
  const stored = JSON.parse(row.rows[0].payload);
  // Refresh is idempotent: a second refresh keeps exactly one row
  // and the same numbers.
  const r2 = await req("/api/admin/analysis/refresh", {
    method: "POST",
    token: adminToken,
    body: { period: "day" },
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const row2 = await pool.query(
    "SELECT COUNT(*) AS n FROM analysis_snapshots WHERE period=$1",
    ["day"],
  );
  assert.equal(Number(row2.rows[0].n), 1);
  const live = await getAnalysis(adminToken);
  assert.equal(stored.kpis.revenue, live.kpis.revenue);
  assert.equal(stored.kpis.orders, live.kpis.orders);
  const storedShow = stored.shows.find((s) => s.show_id === showId);
  const liveShow = live.shows.find((s) => s.show_id === showId);
  assert.ok(storedShow && liveShow, "own show missing from shows");
  assert.deepEqual(storedShow, liveShow);
  assert.deepEqual(stored.promos, live.promos);
});

test("per-show revenue matches the real paid orders", async () => {
  const a = await getAnalysis(adminToken);
  const mine = a.shows.find((s) => s.show_id === showId);
  assert.ok(mine, `own show ${showId} missing from shows`);
  assert.equal(mine.title, "R5分析演出");
  assert.equal(mine.performances, 1);
  // 2 paid performance orders: ¥28000 seat order + ¥22400 flash order.
  assert.equal(mine.orders, 2);
  assert.equal(mine.revenue_cents, 50400);
  assert.equal(mine.occupancy, 25);
  // Cross-check with the same join run directly on the DB:
  // performance_id -> performance, or (NULL performance_id AND
  // resource_id = the show's resource).
  const db = await pool.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue
     FROM orders
     WHERE status IN ('paid','completed','disputed','refund_requested')
       AND (performance_id=$1 OR (performance_id IS NULL AND resource_id=$2))`,
    [perfId, showResourceId],
  );
  assert.equal(mine.orders, Number(db.rows[0].orders));
  assert.equal(mine.revenue_cents, Number(db.rows[0].revenue));
});

test("venue with seat data has numeric seatOccupancy; venue with no seats keeps the honest null", async () => {
  const a = await getAnalysis(adminToken);
  const mine = a.venues.find((v) => v.id === venueId);
  assert.ok(mine, `own venue ${venueId} missing from venues`);
  assert.equal(mine.performances, 1);
  // 4 seats, 1 sold (the paid seat order) -> 25%, a NUMBER — the
  // "暂无关联售票样本" label must not apply to this venue.
  assert.equal(typeof mine.seatOccupancy, "number");
  assert.equal(mine.seatOccupancy, 25);
  const line = a.report
    .split("\n")
    .find((l) => l.startsWith("R5分析剧场："));
  assert.ok(line, "own venue line missing from the report");
  assert.ok(
    !line.includes("暂无关联售票样本"),
    `seated venue line must not carry the label: ${line}`,
  );
  // The genuinely seat-less venue keeps the honest null — the
  // label is NOT removed entirely.
  const empty = a.venues.find((v) => v.id === emptyVenueId);
  assert.ok(empty, `empty venue ${emptyVenueId} missing from venues`);
  assert.equal(empty.performances, 0);
  assert.equal(empty.seatOccupancy, null);
  const emptyLine = a.report
    .split("\n")
    .find((l) => l.startsWith("R5分析空剧场："));
  assert.ok(emptyLine, "empty venue line missing from the report");
  assert.ok(
    emptyLine.includes("暂无关联售票样本"),
    `seat-less venue line must keep the label: ${emptyLine}`,
  );
});

test("coupon/flash effectiveness matches the real redemptions and orders", async () => {
  const a = await getAnalysis(adminToken);
  assert.ok(a.promos, "promos section missing");
  const mine = a.promos.coupons.find((c) => c.coupon_id === couponId);
  assert.ok(mine, `own coupon ${couponId} missing from promos.coupons`);
  assert.equal(mine.code, "R5A5000");
  assert.equal(mine.redemptions, 1);
  assert.equal(mine.total_discount_cents, 5000);
  const red = await pool.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS total FROM coupon_redemptions WHERE coupon_id=$1",
    [couponId],
  );
  assert.equal(mine.redemptions, Number(red.rows[0].n));
  assert.equal(mine.total_discount_cents, Number(red.rows[0].total));
  const withCoupon = await pool.query(
    `SELECT COUNT(*) AS n FROM orders
     WHERE status IN ('paid','completed','disputed','refund_requested')
       AND coupon_id IS NOT NULL`,
  );
  const withoutCoupon = await pool.query(
    `SELECT COUNT(*) AS n FROM orders
     WHERE status IN ('paid','completed','disputed','refund_requested')
       AND coupon_id IS NULL`,
  );
  assert.equal(a.promos.orders_with_coupon, Number(withCoupon.rows[0].n));
  assert.equal(a.promos.orders_without_coupon, Number(withoutCoupon.rows[0].n));
  assert.ok(a.promos.orders_with_coupon >= 1);
  const sale = a.promos.flash_sales.find((f) => f.flash_sale_id === flashSaleId);
  assert.ok(sale, `own flash sale ${flashSaleId} missing from promos.flash_sales`);
  assert.equal(sale.name, "R5分析限时购");
  assert.equal(sale.sold, 1);
  assert.equal(sale.revenue_cents, 22400);
  const db = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS revenue
     FROM orders
     WHERE status IN ('paid','completed','disputed','refund_requested')
       AND flash_sale_id=$1`,
    [flashSaleId],
  );
  assert.equal(sale.sold, Number(db.rows[0].n));
  assert.equal(sale.revenue_cents, Number(db.rows[0].revenue));
});

test("tier distribution + spending buckets match the real users", async () => {
  const a = await getAnalysis(adminToken);
  assert.ok(a.members, "members section missing");
  // Independent computation straight from the DB: spending per
  // non-admin user (PAID_STATUSES, main shop via resources.shop_id),
  // tier = highest shop-1 tier at or below spending.
  const tiers = await pool.query(
    "SELECT * FROM member_tiers WHERE shop_id=1 ORDER BY min_spend_cents DESC",
  );
  const spending = await pool.query(
    `SELECT o.user_id AS user_id, COALESCE(SUM(o.amount),0) AS spending
     FROM orders o JOIN resources r ON r.id=o.resource_id
     WHERE r.shop_id=1
       AND o.status IN ('paid','completed','disputed','refund_requested')
     GROUP BY o.user_id`,
  );
  const spendByUser = new Map(
    spending.rows.map((r) => [r.user_id, Number(r.spending)]),
  );
  const allUsers = await pool.query(
    "SELECT COUNT(*) AS n FROM users WHERE role<>'admin'",
  );
  const totalUsers = Number(allUsers.rows[0].n);
  assert.equal(a.members.total_users, totalUsers);
  const want = new Map();
  const userIds = await pool.query("SELECT id FROM users WHERE role<>'admin'");
  const buckets = [
    { label: "未消费", min: 0, max: 0 },
    { label: "100元以下", min: 1, max: 9999 },
    { label: "100–1000元", min: 10000, max: 99999 },
    { label: "1000–5000元", min: 100000, max: 499999 },
    { label: "5000元以上", min: 500000, max: null },
  ];
  const wantBuckets = buckets.map((b) => ({ ...b, users: 0 }));
  for (const { id } of userIds.rows) {
    const s = spendByUser.get(id) || 0;
    const tier =
      tiers.rows.find((t) => s >= Number(t.min_spend_cents)) || null;
    const name = tier ? tier.name : "未定级";
    want.set(name, (want.get(name) || 0) + 1);
    const bucket = wantBuckets.find(
      (b) => s >= b.min && (b.max === null || s <= b.max),
    );
    if (bucket) bucket.users += 1;
  }
  assert.equal(
    a.members.tiers.reduce((n, t) => n + t.users, 0),
    totalUsers,
    "tier counts must add up to all non-admin users",
  );
  for (const t of a.members.tiers) {
    assert.equal(
      t.users, want.get(t.name),
      `tier ${t.name}: ${t.users} != ${want.get(t.name)}`,
    );
  }
  assert.equal(
    a.members.buckets.reduce((n, b) => n + b.users, 0),
    totalUsers,
    "bucket counts must add up to all non-admin users",
  );
  for (let i = 0; i < buckets.length; i++) {
    assert.equal(a.members.buckets[i].label, buckets[i].label);
    assert.equal(
      a.members.buckets[i].users, wantBuckets[i].users,
      `bucket ${buckets[i].label}: ${a.members.buckets[i].users} != ${wantBuckets[i].users}`,
    );
  }
  // The silver fixture user really is 银卡会员 now (¥112000 spent).
  const silver = a.members.tiers.find((t) => t.name === "银卡会员");
  assert.ok(silver && silver.users >= 1, "no 银卡会员 in the distribution");
});

test("snapshot source returns the stored payload + computed_at; bad source 400; missing period 404", async () => {
  await req("/api/admin/analysis/refresh", {
    method: "POST",
    token: adminToken,
    body: { period: "day" },
  });
  const snap = await req("/api/admin/analysis?period=day&source=snapshot", {
    token: adminToken,
  });
  assert.equal(snap.status, 200, JSON.stringify(snap.data));
  assert.equal(snap.data.source, "snapshot");
  assert.ok(snap.data.computed_at, "snapshot must carry computed_at");
  const row = await pool.query(
    "SELECT created_at FROM analysis_snapshots WHERE period=$1",
    ["day"],
  );
  assert.equal(snap.data.computed_at, row.rows[0].created_at);
  const live = await getAnalysis(adminToken);
  assert.equal(snap.data.kpis.revenue, live.kpis.revenue);
  assert.deepEqual(
    snap.data.shows.find((s) => s.show_id === showId),
    live.shows.find((s) => s.show_id === showId),
  );
  assert.equal(
    (await req("/api/admin/analysis?period=day&source=bogus", { token: adminToken })).status,
    400,
  );
  // Quarter was never refreshed in this run.
  assert.equal(
    (await req("/api/admin/analysis?period=quarter&source=snapshot", { token: adminToken })).status,
    404,
  );
});

test("anonymous -> 401 / non-admin -> 403 on refresh; GET keeps its existing 403", async () => {
  assert.equal(
    (await req("/api/admin/analysis/refresh", {
      method: "POST",
      body: { period: "day" },
    })).status,
    401,
  );
  assert.equal(
    (await req("/api/admin/analysis/refresh", {
      method: "POST",
      token: userToken,
      body: { period: "day" },
    })).status,
    403,
  );
  assert.equal((await req("/api/admin/analysis?period=day")).status, 403);
  assert.equal(
    (await req("/api/admin/analysis?period=day", { token: userToken })).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/analysis?period=day&source=snapshot")).status,
    403,
  );
});

test("recommendations are rule text: low occupancy suggests a flash sale, top show suggests promotion, nothing claims AI", async () => {
  const a = await getAnalysis(adminToken);
  assert.ok(Array.isArray(a.recommendations), "recommendations missing");
  const flash = a.recommendations.find(
    (r) => r.type === "flash_sale" && r.show_id === showId,
  );
  assert.ok(flash, `no flash_sale recommendation for own show: ${JSON.stringify(a.recommendations)}`);
  assert.equal(flash.occupancy, 25);
  assert.ok(flash.text.includes("考虑限时抢购"), flash.text);
  const top = [...a.shows].sort(
    (x, y) => y.revenue_cents - x.revenue_cents || y.orders - x.orders,
  )[0];
  assert.ok(top && top.revenue_cents > 0, "no top show with revenue");
  const promote = a.recommendations.find(
    (r) => r.type === "promote" && r.show_id === top.show_id,
  );
  assert.ok(promote, `no promote recommendation for top show ${top.show_id}`);
  assert.ok(promote.text.includes("加大推广"), promote.text);
  for (const r of a.recommendations) {
    assert.ok(!/AI|人工智能|大模型|智能模型/.test(r.text), `recommendation claims AI: ${r.text}`);
  }
});
