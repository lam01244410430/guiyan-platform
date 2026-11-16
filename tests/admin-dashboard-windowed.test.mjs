// Admin dashboard redesign D1 — windowed stats/analysis (server).
// The KPI strip + donut centre are totals for the SELECTED period,
// not cumulative totals, with a previous window (same length, same
// elapsed time) + prevSeries + a partial flag on the last bucket.
//
// Hand-computed fixture answers (seed DB, ref Beijing 2026-11-16 —
// from ~/workspace/_work/dashfx-evidence + dashred windowed SQL):
//   day cur  2026-10-18..11-16: revenue ¥165,128.00 / 150 orders / 64 users
//   day prev 2026-09-18..10-17: revenue ¥114,552.00 / 99 orders / 61 users
//   day channels cur: H5 ¥69,777/27, 抖音 ¥37,250/18, 微信小程序 ¥29,252/9, 猫眼 ¥28,849/19
//   week cur 12wk: ¥325,935.00 / 286 orders; prev: ¥33,758.00 / 10 orders
//   month/quarter cur: ¥374,708.00 / 310 orders (all seed data); prev: 0
//   busiest day in the 30d window: 2026-11-09 ¥28,754.00 / 5 orders
// The tests below do NOT hardcode those numbers (the "today" the
// server uses moves): they recompute the same windows with
// independent SQL in the test, so they stay green on any run date
// while still catching any drift between the API and the DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { formatDelta, fmtCompactTick, summarizeSeries } from "../admin/assets/js/adminApi.js";

const PORT = Number(process.env.TEST_PORT || 3126);
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

let adminToken;

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
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

// ---- window bounds, recomputed in the test (independent of the app) ----
function beijingToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function shiftDay(d, n) {
  return new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function addMonths(d, n) {
  const [y, m] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function mondayOf(d) {
  const n = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
  return shiftDay(d, -n);
}
function testWindow(period, today) {
  let curStart;
  let prevStart;
  if (period === "week") {
    curStart = shiftDay(mondayOf(today), -77);
    prevStart = shiftDay(curStart, -84);
  } else if (period === "month") {
    curStart = addMonths(today.slice(0, 8) + "01", -11);
    prevStart = addMonths(curStart, -12);
  } else if (period === "quarter") {
    const m = Number(today.slice(5, 7));
    const thisQ = `${today.slice(0, 5)}${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    curStart = addMonths(thisQ, -9);
    prevStart = addMonths(curStart, -12);
  } else {
    curStart = shiftDay(today, -29);
    prevStart = shiftDay(today, -59);
  }
  const elapsed = Math.round(
    (new Date(today + "T00:00:00Z") - new Date(curStart + "T00:00:00Z")) / 86400000,
  );
  return { start: curStart, end: today, prevStart, prevEnd: shiftDay(prevStart, elapsed) };
}

const BJ = "(created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date";
async function windowSql(start, end) {
  const r = await pool.query(
    `SELECT
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status IN ('paid','completed') AND ${BJ} >= $1 AND ${BJ} <= $2) AS revenue,
      (SELECT COUNT(*) FROM orders WHERE ${BJ} >= $1 AND ${BJ} <= $2) AS orders,
      (SELECT COUNT(*) FROM orders WHERE status IN ('paid','completed') AND ${BJ} >= $1 AND ${BJ} <= $2) AS paid_orders,
      (SELECT COUNT(DISTINCT user_id) FROM orders WHERE ${BJ} >= $1 AND ${BJ} <= $2
        AND user_id IN (SELECT id FROM users WHERE role <> 'admin')) AS active_users`,
    [start, end],
  );
  return r.rows[0];
}

const sum = (a, k) => a.reduce((n, r) => n + Number(r[k] || 0), 0);

test("stats?period=day: 30 buckets, windowed totals + previous match independent SQL", async () => {
  const today = beijingToday();
  const w = testWindow("day", today);
  const r = await req("/api/admin/stats?period=day", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.window, {
    start: w.start,
    end: w.end,
    prev_start: w.prevStart,
    prev_end: w.prevEnd,
  });
  assert.equal(r.data.series.length, 30, "day window is 30 daily buckets");
  assert.equal(r.data.prevSeries.length, 30, "previous window has the same 30 buckets");
  assert.equal(r.data.series[0].date, w.start, "first bucket is the window start");
  assert.equal(r.data.series[29].date, w.end, "last bucket is today");
  assert.equal(r.data.series[29].partial, true, "today's bucket is partial");
  assert.equal(r.data.prevSeries[29].partial, true, "previous last bucket is cut by elapsed time");
  assert.ok(r.data.series.slice(0, 29).every((b) => b.partial === false), "only the last bucket is partial");
  const cur = await windowSql(w.start, w.end);
  const prev = await windowSql(w.prevStart, w.prevEnd);
  assert.equal(sum(r.data.series, "amount"), Number(r.data.totals.revenue_cents), "series sums to the windowed revenue");
  assert.equal(sum(r.data.series, "count"), Number(cur.paid_orders), "series counts are paid/completed only");
  assert.equal(sum(r.data.prevSeries, "amount"), Number(r.data.previous.revenue_cents), "prevSeries sums to the previous revenue");
  assert.equal(sum(r.data.prevSeries, "count"), Number(prev.paid_orders), "prevSeries counts are paid/completed only");
  assert.equal(Number(r.data.totals.revenue_cents), Number(cur.revenue), "windowed revenue must match direct SQL");
  assert.equal(Number(r.data.totals.orders), Number(cur.orders), "windowed orders must match direct SQL");
  assert.equal(Number(r.data.totals.active_users), Number(cur.active_users), "windowed active users must match direct SQL");
  assert.equal(Number(r.data.previous.revenue_cents), Number(prev.revenue), "previous revenue must match direct SQL");
  assert.equal(Number(r.data.previous.orders), Number(prev.orders), "previous orders must match direct SQL");
  assert.equal(Number(r.data.previous.active_users), Number(prev.active_users), "previous active users must match direct SQL");
  const pub = await pool.query("SELECT COUNT(*) AS n FROM resources WHERE status='published'");
  assert.equal(Number(r.data.totals.published_resources), Number(pub.rows[0].n), "published resources are point-in-time");
  assert.equal(r.data.previous.published_resources, null, "published resources have no previous");
  // The delta the KPI strip renders from these two numbers (day fixture:
  // revenue +44.2%, orders +51.5% on 2026-11-16) — elapsed-matched, so
  // a partial current window never compares against a full previous one.
  const dRev = (Number(r.data.totals.revenue_cents) - Number(r.data.previous.revenue_cents)) / Number(r.data.previous.revenue_cents);
  assert.ok(dRev > 0, "day revenue must be up vs the previous 30 days on the seed");
  assert.ok(Math.abs(dRev - (Number(cur.revenue) - Number(prev.revenue)) / Number(prev.revenue)) < 1e-9, "delta must come from the same two SQL totals");
});

test("stats?period=week/month/quarter: bucket counts 12/12/4, prev zero where the seed has no data", async () => {
  const today = beijingToday();
  for (const [period, n] of [["week", 12], ["month", 12], ["quarter", 4]]) {
    const w = testWindow(period, today);
    const r = await req(`/api/admin/stats?period=${period}`, { token: adminToken });
    assert.equal(r.status, 200, `${period} -> ${r.status} ${JSON.stringify(r.data)}`);
    assert.deepEqual(r.data.window, {
      start: w.start,
      end: w.end,
      prev_start: w.prevStart,
      prev_end: w.prevEnd,
    });
    assert.equal(r.data.series.length, n, `${period} must have ${n} buckets`);
    assert.equal(r.data.prevSeries.length, n, `${period} prevSeries must have ${n} buckets`);
    assert.equal(r.data.series[n - 1].partial, true, `${period} last bucket is partial`);
    assert.equal(r.data.prevSeries[n - 1].partial, true, `${period} prev last bucket is partial`);
    assert.equal(sum(r.data.series, "amount"), Number(r.data.totals.revenue_cents), `${period} series sums to totals revenue`);
    assert.equal(sum(r.data.prevSeries, "amount"), Number(r.data.previous.revenue_cents), `${period} prevSeries sums to previous revenue`);
    const cur = await windowSql(w.start, w.end);
    const prev = await windowSql(w.prevStart, w.prevEnd);
    assert.equal(Number(r.data.totals.revenue_cents), Number(cur.revenue), `${period} revenue must match direct SQL`);
    assert.equal(Number(r.data.totals.orders), Number(cur.orders), `${period} orders must match direct SQL`);
    assert.equal(Number(r.data.previous.revenue_cents), Number(prev.revenue), `${period} previous revenue must match direct SQL`);
    assert.equal(Number(r.data.previous.orders), Number(prev.orders), `${period} previous orders must match direct SQL`);
  }
  // Seed property (data starts 2026-08-16): the month/quarter previous
  // windows end in 2025, so their previous totals are 0 — the KPI
  // strip must render grey "was ¥0", never a percent.
  const month = await req("/api/admin/stats?period=month", { token: adminToken });
  assert.equal(Number(month.data.previous.revenue_cents), 0, "month previous revenue is 0 on the seed");
  assert.equal(Number(month.data.previous.orders), 0, "month previous orders are 0 on the seed");
  const quarter = await req("/api/admin/stats?period=quarter", { token: adminToken });
  assert.equal(Number(quarter.data.previous.revenue_cents), 0, "quarter previous revenue is 0 on the seed");
});

test("analysis?period=day: kpis == stats totals, channels windowed and summing to revenue", async () => {
  const today = beijingToday();
  const w = testWindow("day", today);
  const a = await req("/api/admin/analysis?period=day", { token: adminToken });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const s = await req("/api/admin/stats?period=day", { token: adminToken });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual(a.data.window, s.data.window, "analysis and stats share one window");
  assert.equal(Number(a.data.kpis.revenue), Number(s.data.totals.revenue_cents), "analysis revenue must equal stats windowed revenue");
  assert.equal(Number(a.data.kpis.orders), Number(s.data.totals.orders), "analysis orders must equal stats windowed orders");
  assert.equal(Number(a.data.kpis.users), Number(s.data.totals.active_users), "analysis users must equal stats windowed active users");
  assert.equal(Number(a.data.previous.revenue), Number(s.data.previous.revenue_cents), "analysis previous revenue must equal stats previous");
  assert.equal(Number(a.data.previous.orders), Number(s.data.previous.orders), "analysis previous orders must equal stats previous");
  assert.deepEqual(a.data.series, s.data.series, "analysis series must equal stats series");
  assert.deepEqual(a.data.prevSeries, s.data.prevSeries, "analysis prevSeries must equal stats prevSeries");
  const channelSum = a.data.channels.reduce((n, c) => n + Number(c.amount), 0);
  assert.equal(channelSum, Number(a.data.kpis.revenue), "channel amounts must sum to the windowed revenue (donut centre = KPI)");
  const rows = await pool.query(
    `SELECT channel AS name, SUM(amount)::bigint AS amount, COUNT(*)::bigint AS orders
       FROM orders WHERE status IN ('paid','completed') AND ${BJ} >= $1 AND ${BJ} <= $2
       GROUP BY channel ORDER BY amount DESC`,
    [w.start, w.end],
  );
  assert.equal(a.data.channels.length, rows.rows.length, "channel count must match the windowed DB rows");
  for (let i = 0; i < rows.rows.length; i++) {
    assert.equal(a.data.channels[i].name, rows.rows[i].name);
    assert.equal(Number(a.data.channels[i].amount), Number(rows.rows[i].amount));
    assert.equal(Number(a.data.channels[i].orders), Number(rows.rows[i].orders));
  }
  const lines = a.data.report.split("\n");
  assert.ok(lines[1].includes(`${w.start}—${w.end}`), "report must state the window: " + lines[1]);
  assert.ok(lines[2].includes("窗口内订单"), "report must say windowed orders, not historical: " + lines[2]);
  assert.ok(lines[2].includes((Number(a.data.kpis.revenue) / 100).toFixed(2)), "report revenue must be the windowed revenue");
  assert.equal(a.data.definitions.orders, "窗口内全部订单，包含取消与退款", "orders definition must say windowed");
  assert.equal(a.data.definitions.users, "统计窗口内提交订单的去重用户数", "users definition must say windowed");
});

test("stats without ?period= keeps the cumulative totals (backwards compatible)", async () => {
  // No hardcoded seed totals here: this file runs after
  // admin-overview.test.mjs in the chain, and that file creates two
  // extra orders in the same DB — so the cumulative totals are
  // compared against direct SQL, not against the seed's ¥374,708/310.
  const r = await req("/api/admin/stats", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rev = await pool.query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE status IN ('paid','completed')",
  );
  const ord = await pool.query("SELECT COUNT(*) AS n FROM orders");
  assert.equal(Number(r.data.revenue_cents), Number(rev.rows[0].total), "cumulative revenue must match direct SQL");
  assert.equal(Number(r.data.orders), Number(ord.rows[0].n), "cumulative orders must match direct SQL");
  assert.ok(!("totals" in r.data), "cumulative payload carries no windowed totals");
  assert.ok(!("prevSeries" in r.data), "cumulative payload carries no prevSeries");
});

// ---- pure helpers (adminApi.js) ----

test("formatDelta: zero previous and small base read grey 'was N', never a percent", () => {
  assert.deepEqual(formatDelta(100, 0, 0, (v) => "¥" + (v / 100), true), { text: "was ¥0", tone: "neutral" });
  assert.deepEqual(formatDelta(0, 1, 1, (v) => v + "笔", true), { text: "was 1笔", tone: "neutral" });
  assert.deepEqual(formatDelta(5, 4, 4, (v) => v + "笔", true), { text: "was 4笔", tone: "neutral" });
  assert.deepEqual(formatDelta(100, 50, 50, (v) => "¥" + v, null), { text: "▲ 100.0%", tone: "neutral" });
  assert.deepEqual(formatDelta(100, 50, 50, (v) => "¥" + v, true), { text: "▲ 100.0%", tone: "up" });
  assert.deepEqual(formatDelta(50, 100, 100, (v) => "¥" + v, true), { text: "▼ 50.0%", tone: "down" });
  assert.deepEqual(formatDelta(100, 100, 100, (v) => "¥" + v, true), { text: "±0%", tone: "neutral" });
  assert.deepEqual(formatDelta(1100, 100, 100, (v) => "¥" + v, true), { text: "▲ 10×+", tone: "up" });
  assert.deepEqual(formatDelta(100, null, 0, (v) => "¥" + v, true), { text: "", tone: "neutral" });
  // Day fixture delta (ref 2026-11-16): revenue +44.2% on a base of 50 paid orders.
  const d = formatDelta(16512800, 11455200, 50, (v) => "¥" + (v / 100).toLocaleString("zh-CN"), true);
  assert.equal(d.text, "▲ 44.2%", "day revenue delta must be +44.2%");
  assert.equal(d.tone, "up");
});

test("fmtCompactTick: round Y ticks, never 2,103", () => {
  assert.equal(fmtCompactTick(4000, true), "¥4k");
  assert.equal(fmtCompactTick(2500, true), "¥2.5k");
  assert.equal(fmtCompactTick(500, true), "¥500");
  assert.equal(fmtCompactTick(0, true), "¥0");
  assert.equal(fmtCompactTick(1200, false), "1.2k");
  assert.equal(fmtCompactTick(800, false), "800");
});

test("summarizeSeries: daily avg, best day, weekday vs weekend (day only)", () => {
  // Synthetic 7-day week: Mon 2026-11-09 .. Sun 2026-11-15.
  const series = [
    { date: "2026-11-09", label: "11-09", amount: 10000, count: 2 },
    { date: "2026-11-10", label: "11-10", amount: 0, count: 0 },
    { date: "2026-11-11", label: "11-11", amount: 20000, count: 3 },
    { date: "2026-11-12", label: "11-12", amount: 0, count: 0 },
    { date: "2026-11-13", label: "11-13", amount: 10000, count: 1 },
    { date: "2026-11-14", label: "11-14", amount: 30000, count: 4 },
    { date: "2026-11-15", label: "11-15", amount: 0, count: 0 },
  ];
  const s = summarizeSeries(series, "day", "amount");
  assert.equal(s.avg, 70000 / 7, "daily avg is the window total / buckets");
  assert.deepEqual(s.best, { label: "11-14", value: 30000 }, "best day is the max bucket");
  assert.equal(s.weekdayAvg, 40000 / 5, "weekday avg covers Mon–Fri");
  assert.equal(s.weekendAvg, 30000 / 2, "weekend avg covers Sat–Sun");
  const w = summarizeSeries(series, "week", "amount");
  assert.equal(w.weekdayAvg, null, "weekday split only exists for period=day");
  assert.equal(w.weekendAvg, null);
  assert.deepEqual(summarizeSeries([], "day", "amount"), { avg: 0, best: null, weekdayAvg: null, weekendAvg: null });
});

// ---- the windowed payload is what the dashboard reads (source-grep
// for the dashboard change lives in tests/admin-dashboard-redesign.test.mjs,
// with the components that read it) ----
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("test file is wired into the npm test chain", () => {
  const serverPkg = JSON.parse(
    fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
  );
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-dashboard-windowed.test.mjs"),
    "server/package.json test script must run tests/admin-dashboard-windowed.test.mjs",
  );
});
