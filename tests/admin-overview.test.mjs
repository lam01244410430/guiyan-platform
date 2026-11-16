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
  // Same paid scope as the stats KPI (adminStatsTotals revenue_cents)
  // and the analysis revenue: paid + completed ONLY. Disputed /
  // refund_requested orders are under after-sales handling and stay
  // out of revenue, so the donut (channels) sums to the KPI total.
  // (The R5 analysis sections — shows / promos / venues — keep the
  // wider 4-status PAID_STATUSES; only revenue + channels use this
  // scope, see admin-insights.mjs REVENUE_STATUSES.)
  const rows = await pool.query(
    `SELECT channel AS name, SUM(amount)::bigint AS amount, COUNT(*)::bigint AS orders
       FROM orders WHERE status IN ('paid','completed')
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

test("channels sum = kpis.revenue = stats revenue with refund_requested/disputed orders present", async () => {
  // Live-data regression for the ¥3,600 donut gap (GY2026000005):
  // on the seed DB there are no disputed / refund_requested orders,
  // so the channels test above cannot tell the two scopes apart.
  // Drive two real orders through the API (probe2 flow: create as
  // demo -> confirm -> pay -> refund / dispute) and assert the
  // excluded statuses move no revenue at all.
  const before = await req("/api/admin/analysis?period=day", { token: adminToken });
  assert.equal(before.status, 200, JSON.stringify(before.data));
  const statsBefore = await req("/api/admin/stats", { token: adminToken });
  assert.equal(statsBefore.status, 200, JSON.stringify(statsBefore.data));
  const resource = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: { name: "总览 donut 退款测试商品", category: "digital", city: "南宁", price: 28000, unit: "张", stock: 100, shop_id: 1 },
  });
  assert.equal(resource.status, 200, JSON.stringify(resource.data));
  const resourceId = resource.data.resource.id;
  const demoToken = await login("demo", "demo123");
  async function makePaidOrder(bookingDate) {
    const created = await req("/api/orders", {
      method: "POST",
      token: demoToken,
      body: { resourceId, quantity: 1, booking_date: bookingDate },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const orderId = created.data.order?.id ?? created.data.id;
    for (const action of ["confirm", "pay"]) {
      const r = await req(`/api/orders/${orderId}/${action}`, { method: "POST", token: demoToken, body: {} });
      assert.equal(r.status, 200, `${action} -> ${r.status} ${JSON.stringify(r.data)}`);
    }
    return orderId;
  }
  const refundId = await makePaidOrder("2026-12-28");
  const refund = await req(`/api/orders/${refundId}/refund`, {
    method: "POST",
    token: demoToken,
    body: { reason: "临时有事" },
  });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  assert.equal(refund.data.status, "refund_requested");
  const disputeId = await makePaidOrder("2026-12-29");
  const dispute = await req(`/api/orders/${disputeId}/dispute`, {
    method: "POST",
    token: demoToken,
    body: { reason: "与商家有争议" },
  });
  assert.equal(dispute.status, 200, JSON.stringify(dispute.data));
  assert.equal(dispute.data.status, "disputed");
  // The two excluded orders really hold money (2 x ¥280): under the
  // old 4-status scope the donut would exceed the KPI by exactly this.
  const excluded = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM orders
       WHERE status IN ('disputed','refund_requested')`,
  );
  assert.ok(Number(excluded.rows[0].total) >= 56000, `excluded statuses must hold >= 56000 cents, got ${excluded.rows[0].total}`);
  const after = await req("/api/admin/analysis?period=day", { token: adminToken });
  assert.equal(after.status, 200, JSON.stringify(after.data));
  const statsAfter = await req("/api/admin/stats", { token: adminToken });
  assert.equal(statsAfter.status, 200, JSON.stringify(statsAfter.data));
  const channelSum = after.data.channels.reduce((a, c) => a + Number(c.amount), 0);
  assert.equal(channelSum, Number(after.data.kpis.revenue), "channel amounts must sum to analysis revenue");
  assert.equal(Number(after.data.kpis.revenue), Number(before.data.kpis.revenue), "refund_requested/disputed orders must not move analysis revenue");
  assert.equal(Number(statsAfter.data.revenue_cents), Number(statsBefore.data.revenue_cents), "refund_requested/disputed orders must not move stats revenue");
  assert.equal(Number(after.data.kpis.revenue), Number(statsAfter.data.revenue_cents), "analysis revenue must equal stats revenue_cents (donut centre = KPI)");
  const sql = await pool.query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE status IN ('paid','completed')",
  );
  assert.equal(Number(after.data.kpis.revenue), Number(sql.rows[0].total), "analysis revenue must match direct paid/completed SQL");
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

// ---- order-status colours (commit 2): WCAG contrast + coverage ----

const STATUSES = [
  "pending",
  "confirmed",
  "paid",
  "completed",
  "cancelled",
  "refunded",
  "refund_requested",
  "disputed",
];

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrastRatio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("status pills: all 8 statuses styled, 7 distinct colours, contrast >= 4.5:1", () => {
  // Resolve :root tokens to hex (only hex-valued tokens are collected).
  const tokens = new Map();
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    tokens.set(m[1], m[2].toLowerCase());
  }
  const resolve = (v) => {
    const m = /^var\(--([a-z0-9-]+)\)$/.exec(v.trim());
    assert.ok(m, `pill/bar colour must be a token, got ${v}`);
    const hex = tokens.get(m[1]);
    assert.ok(hex, `token --${m[1]} must be defined in :root`);
    return hex;
  };
  const pillRules = new Map();
  for (const m of css.matchAll(/\.pill\.([a-z0-9_,.-]+)\{([^}]*)\}/g)) {
    for (const sel of m[1].split(",")) {
      const status = sel.replace(/^\.pill\./, "");
      const bg = /background:([^;}]+);?/.exec(m[2]);
      const fg = /color:([^;}]+);?/.exec(m[2]);
      if (bg && fg) pillRules.set(status, { bg: bg[1], fg: fg[1] });
    }
  }
  const pairs = new Map();
  for (const status of STATUSES) {
    const rule = pillRules.get(status);
    assert.ok(rule, `.pill.${status} rule must exist (no status falls back to unstyled)`);
    const fg = resolve(rule.fg);
    const bg = resolve(rule.bg);
    const ratio = contrastRatio(fg, bg);
    assert.ok(
      ratio >= 4.5,
      `.pill.${status} contrast ${ratio.toFixed(2)}:1 < 4.5:1 (${fg} on ${bg})`,
    );
    pairs.set(status, `${bg}/${fg}`);
  }
  // 7 distinct pairs for 8 statuses: cancelled + refunded share the muted
  // grey by design (both mean "ended, do not emphasise"); every other
  // status has its own colour.
  assert.equal(pairs.get("cancelled"), pairs.get("refunded"), "cancelled/refunded must share one pair");
  assert.equal(new Set(pairs.values()).size, 7, `expected 7 distinct pill pairs, got ${new Set(pairs.values()).size}`);
});

test("status bars: all 8 statuses styled, bar matches the pill dark colour", () => {
  const tokens = new Map();
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    tokens.set(m[1], m[2].toLowerCase());
  }
  const resolve = (v) => {
    const m = /^var\(--([a-z0-9-]+)\)$/.exec(v.trim());
    assert.ok(m, `bar colour must be a token, got ${v}`);
    return tokens.get(m[1]);
  };
  const barRules = new Map();
  for (const m of css.matchAll(/\.bd-fill\.([a-z0-9_,.-]+)\{([^}]*)\}/g)) {
    for (const sel of m[1].split(",")) {
      const status = sel.replace(/^\.bd-fill\./, "");
      const bg = /background:([^;}]+);?/.exec(m[2]);
      if (bg) barRules.set(status, bg[1]);
    }
  }
  const pillRules = new Map();
  for (const m of css.matchAll(/\.pill\.([a-z0-9_,.-]+)\{([^}]*)\}/g)) {
    for (const sel of m[1].split(",")) {
      const status = sel.replace(/^\.pill\./, "");
      const bg = /background:([^;}]+);?/.exec(m[2]);
      const fg = /color:([^;}]+);?/.exec(m[2]);
      if (bg && fg) pillRules.set(status, { bg: bg[1], fg: fg[1] });
    }
  }
  // Recoloured statuses: the bar is the same dark colour as the pill text.
  for (const status of ["paid", "pending", "refund_requested", "disputed"]) {
    assert.ok(barRules.has(status), `.bd-fill.${status} rule must exist`);
    assert.equal(
      resolve(barRules.get(status)),
      resolve(pillRules.get(status).fg),
      `.bd-fill.${status} must match the .pill.${status} text colour`,
    );
  }
  // Kept statuses: the bar keeps its pre-existing grey/ink value.
  for (const [status, token] of [
    ["confirmed", "--gray-600"],
    ["completed", "--p-ink"],
    ["cancelled", "--gray-500"],
    ["refunded", "--gray-500"],
  ]) {
    assert.ok(barRules.has(status), `.bd-fill.${status} rule must exist`);
    assert.equal(
      barRules.get(status).trim(),
      `var(${token})`,
      `.bd-fill.${status} must keep ${token}`,
    );
  }
});
