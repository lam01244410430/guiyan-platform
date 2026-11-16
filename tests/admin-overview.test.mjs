// tests/admin-overview.test.mjs: admin overview dashboard (2026-11-16) —
// (1) GET /api/admin/stats carries published_resources + active_users_30d
//     and both match the same definition computed directly in SQL;
// (2) GET /api/admin/analysis channels match the real paid orders grouped
//     by channel; (3) source-grep: the 4 KPI cards, the trend + donut,
//     the lazy overview load, and no screenshot figures anywhere.
// Server part mirrors tests/r5-bi.test.mjs (spawn server.mjs on TEST_PORT,
// fresh disposable DB — npm test is NOT idempotent on a reused DB).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

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

test("stats carries published_resources + active_users_30d matching direct SQL", async () => {
  const r = await req("/api/admin/stats", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const published = await pool.query(
    "SELECT COUNT(*) AS n FROM resources WHERE status = 'published'",
  );
  assert.equal(
    Number(r.data.published_resources),
    Number(published.rows[0].n),
    `published_resources ${r.data.published_resources} != SQL ${published.rows[0].n}`,
  );
  // Same definition as the endpoint: non-admin users with >=1 order in
  // the last 30 Beijing days (Beijing today minus 29), any status.
  const active = await pool.query(
    `SELECT COUNT(DISTINCT user_id) AS n FROM orders
       WHERE DATE(created_at::timestamptz AT TIME ZONE 'Asia/Shanghai') >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - 29)
         AND user_id IN (SELECT id FROM users WHERE role <> 'admin')`,
  );
  assert.equal(
    Number(r.data.active_users_30d),
    Number(active.rows[0].n),
    `active_users_30d ${r.data.active_users_30d} != SQL ${active.rows[0].n}`,
  );
  // The old totals are still there, unchanged.
  assert.equal(typeof r.data.users, "number");
  assert.equal(typeof r.data.orders, "number");
  assert.equal(typeof r.data.revenue_cents, "number");
  assert.equal(typeof r.data.resources, "number");
  assert.ok(Number(r.data.published_resources) <= Number(r.data.resources));
  assert.ok(Number(r.data.active_users_30d) <= Number(r.data.users));
});

test("analysis channels match the real paid orders grouped by channel", async () => {
  const r = await req("/api/admin/analysis?period=day", { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.channels));
  // Same paid scope as the endpoint (admin-insights.mjs PAID_STATUSES):
  // paid + completed + disputed + refund_requested — money received and
  // not yet refunded counts; fully-refunded orders do not. (The R5
  // analysis tests use this same 4-status list.)
  const rows = await pool.query(
    `SELECT channel AS name, SUM(amount)::bigint AS amount, COUNT(*)::bigint AS orders
       FROM orders WHERE status IN ('paid','completed','disputed','refund_requested')
       GROUP BY channel ORDER BY amount DESC`,
  );
  assert.equal(r.data.channels.length, rows.rows.length, "channel count must match the DB");
  for (let i = 0; i < rows.rows.length; i++) {
    assert.equal(r.data.channels[i].name, rows.rows[i].name);
    assert.equal(Number(r.data.channels[i].amount), Number(rows.rows[i].amount));
    assert.equal(Number(r.data.channels[i].orders), Number(rows.rows[i].orders));
  }
  const sum = r.data.channels.reduce((a, c) => a + Number(c.amount), 0);
  assert.equal(sum, Number(r.data.kpis.revenue), "channel amounts must sum to total revenue");
});

// ---- source-grep checks (no server needed) ----

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const donutJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "DonutChart.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);

test("overview header: title + subtitle + period chips + real export button", () => {
  assert.ok(dashboardJsx.includes("运营总览"), "header title must exist");
  assert.ok(dashboardJsx.includes("演艺资源与运营数据，一目了然"), "header subtitle must exist");
  assert.ok(dashboardJsx.includes("ov-period"), "period chips must live in the overview header");
  assert.ok(dashboardJsx.includes("导出当前统计"), "export button must exist");
  assert.ok(dashboardJsx.includes("onClick={doExportCsv}"), "export must reuse the existing CSV export");
});

test("overview KPI cards: four cards, real fields, honest sub-notes", () => {
  for (const [id, label] of [
    ["ovKpiRevenue", "交易总额"],
    ["ovKpiOrders", "预约订单"],
    ["ovKpiResources", "上架资源"],
    ["ovKpiActiveUsers", "活跃用户"],
  ]) {
    assert.ok(dashboardJsx.includes(`id="${id}"`), `KPI card ${id} must exist`);
    assert.ok(dashboardJsx.includes(label), `KPI label ${label} must exist`);
  }
  assert.ok(dashboardJsx.includes("stats.revenue_cents"), "revenue must come from stats");
  assert.ok(dashboardJsx.includes("stats.published_resources"), "published count must come from stats");
  assert.ok(dashboardJsx.includes("stats.active_users_30d"), "active users must come from stats");
  assert.ok(dashboardJsx.includes("仅含已支付/已完成订单"), "revenue sub-note must state the paid/completed scope");
  assert.ok(dashboardJsx.includes("近30天下单去重用户"), "active-users sub-note must state the 30-day window");
});

test("overview charts: trend reuses TrendChart with the real date range; donut is new", () => {
  assert.ok(dashboardJsx.includes('import DonutChart from "./DonutChart.jsx"'), "DonutChart must be imported");
  assert.ok(dashboardJsx.includes("<DonutChart channels={analysis.channels}"), "donut must take the real analysis channels");
  assert.ok(dashboardJsx.includes("total={stats ? stats.revenue_cents : 0}"), "donut centre must be the real revenue total");
  assert.ok(dashboardJsx.includes("<TrendChart series={seriesData.series}"), "trend must reuse TrendChart");
  assert.ok(
    dashboardJsx.includes("seriesData.series[0].date") && dashboardJsx.includes("seriesData.series[seriesData.series.length - 1].date"),
    "trend range label must use the real first/last bucket dates",
  );
  assert.ok(donutJsx.includes("交易总额"), "donut centre must label the total");
  assert.ok(donutJsx.includes("donut-legend"), "donut legend must exist");
  assert.ok(donutJsx.includes("toFixed(1)}%"), "legend must show a percentage");
});

test("overview lazy load: trend + analysis fetch when the overview opens", () => {
  assert.ok(
    dashboardJsx.includes('view === "overview" && (loadedRef.current.overview !== period || analysisStale)'),
    "overview must have its own lazy-load guard",
  );
  assert.ok(dashboardJsx.includes('apiGet("/api/admin/stats?period=" + period)'), "overview must fetch the trend series");
  assert.ok(dashboardJsx.includes('apiGet("/api/admin/analysis?period=" + period)'), "overview must fetch the analysis channels");
});

test("donut palette: muted brand tokens only, no hex literals in the component", () => {
  const colors = donutJsx.match(/DONUT_COLORS = \[([\s\S]*?)\];/);
  assert.ok(colors, "DONUT_COLORS must exist");
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(colors[1]), "donut colours must be CSS tokens, never hex literals");
  assert.ok(colors[1].includes("var(--brand-pine)"), "first rank must be pine");
  assert.ok(colors[1].includes("var(--brand-cinnabar)"), "second rank must be cinnabar");
  assert.ok(css.includes("--brand-pine:#0b3d36"), "pine token must exist in :root");
  assert.ok(css.includes("--brand-cinnabar:#b03a1e"), "cinnabar token must exist in :root");
});

test("no screenshot figures: the reference numbers never enter the code", () => {
  for (const needle of ["148,703", "148703", "210笔"]) {
    assert.ok(!dashboardJsx.includes(needle), `AdminDashboard must not contain ${needle}`);
    assert.ok(!donutJsx.includes(needle), `DonutChart must not contain ${needle}`);
  }
});
