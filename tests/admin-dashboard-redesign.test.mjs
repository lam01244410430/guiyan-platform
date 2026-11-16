// Admin dashboard redesign — dark theme, shared components, and the
// new chart/dashboard structure (source-grep + contrast math, no
// server needed). The light-mode pill/bar contrast lives in
// tests/admin-overview.test.mjs; this file covers the D3 dark mode
// (7 dark pill pairs, each >= 4.5:1 — computed here, not asserted
// from a screenshot) and the D2 accent/money/down/warn contrasts in
// both themes.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  THEME_KEY,
  getThemeChoice,
  getEffectiveTheme,
  resolveTheme,
  _resetThemeCache,
} from "../admin/assets/js/theme.mjs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const trendJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "TrendChart.jsx"),
  "utf-8",
);
const donutJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "DonutChart.jsx"),
  "utf-8",
);
const tooltipJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "Tooltip.jsx"),
  "utf-8",
);
const rankedJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "RankedList.jsx"),
  "utf-8",
);
const headerJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AppHeader.jsx"),
  "utf-8",
);
const dashboardHtml = fs.readFileSync(
  path.join(repoDir, "admin", "dashboard.html"),
  "utf-8",
);

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

// ---- token maps: light :root, then the dark block overriding it ----
function parseTokens(block) {
  const tokens = new Map();
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    tokens.set(m[1], m[2].toLowerCase());
  }
  return tokens;
}
const darkStart = css.indexOf(':root[data-theme="dark"]{');
// NOTE: the header comment mentions :root[data-theme="dark"] without
// the brace — search with "{" so the slice starts at the real rule.
const lightRoot = css.slice(css.indexOf(":root{"), darkStart);
const darkEnd = css.indexOf("\n}", darkStart);
const darkRoot = css.slice(darkStart, darkEnd);
const lightTokens = parseTokens(lightRoot);
const darkTokens = parseTokens(darkRoot);
const mergedTokens = new Map([...lightTokens, ...darkTokens]);

function resolve(v) {
  const t = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(t);
  assert.ok(m, `colour must be a hex literal or a token, got ${v}`);
  const hex = mergedTokens.get(m[1]);
  assert.ok(hex, `token --${m[1]} must be defined in :root or the dark block`);
  return hex;
}

// ---- rule maps: light rules, plus the :root[data-theme="dark"] overrides ----
function parseRules(pattern) {
  const light = new Map();
  const dark = new Map();
  for (const m of css.matchAll(pattern)) {
    const isDark = !!m[1];
    const target = isDark ? dark : light;
    for (const sel of m[2].split(",")) {
      const status = sel.replace(/^\.?(?:pill|bd-fill)\./, "");
      const bg = /background:([^;}]+);?/.exec(m[3]);
      const fg = /color:([^;}]+);?/.exec(m[3]);
      if (bg || fg) target.set(status, { bg: bg && bg[1], fg: fg && fg[1] });
    }
  }
  return { light, dark };
}
const pillRules = parseRules(/(?:(:root\[data-theme="dark"\] ))?\.pill\.([a-z0-9_,.-]+)\{([^}]*)\}/g);
const barRules = parseRules(/(?:(:root\[data-theme="dark"\] ))?\.bd-fill\.([a-z0-9_,.-]+)\{([^}]*)\}/g);

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

test("theme module: shared key, default light, pure resolve", () => {
  assert.equal(THEME_KEY, "guiyan-theme", "admin must share the customer site's theme key");
  _resetThemeCache();
  assert.equal(getThemeChoice(), "light", "no stored choice (node: no localStorage) defaults to light");
  assert.equal(getEffectiveTheme(), "light");
  assert.equal(resolveTheme("dark", "light"), "dark");
  assert.equal(resolveTheme("light", "dark"), "light");
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("bogus", "dark"), "light", "an unknown choice falls back to light");
});

test("dark pill pairs: all 8 statuses styled, 7 distinct colours, contrast >= 4.5:1", () => {
  const pairs = new Map();
  for (const status of STATUSES) {
    const rule = pillRules.dark.get(status) || pillRules.light.get(status);
    assert.ok(rule, `.pill.${status} rule must exist in the light or dark rules`);
    assert.ok(rule.bg && rule.fg, `.pill.${status} must set both background and color`);
    const fg = resolve(rule.fg);
    const bg = resolve(rule.bg);
    const ratio = contrastRatio(fg, bg);
    assert.ok(
      ratio >= 4.5,
      `dark .pill.${status} contrast ${ratio.toFixed(2)}:1 < 4.5:1 (${fg} on ${bg})`,
    );
    pairs.set(status, `${bg}/${fg}`);
  }
  assert.equal(pairs.get("cancelled"), pairs.get("refunded"), "cancelled/refunded must share one pair");
  assert.equal(new Set(pairs.values()).size, 7, `expected 7 distinct dark pill pairs, got ${new Set(pairs.values()).size}`);
  // Recorded dark pairs (2026-11-16): pending 4.83, confirmed 13.59,
  // paid 10.12, completed 14.76, refund_requested 5.17, disputed 4.87,
  // cancelled/refunded 5.10.
  const completedRule = pillRules.dark.get("completed") || pillRules.light.get("completed");
  assert.ok(
    contrastRatio(resolve(completedRule.fg), resolve(completedRule.bg)) >= 14,
    "completed must be the highest-contrast dark pair",
  );
});

test("dark status bars: recoloured bars read on the dark card", () => {
  // Dark mode breaks the light invariant (bar == pill text): the pill
  // keeps its light chip (dark text on it), while the bar must read
  // on the DARK card — so the dark bars are lighter fills, one per
  // status, each reading on the dark card (commit 1's dark overrides).
  const card = mergedTokens.get("p-card");
  const fills = new Set();
  for (const status of ["paid", "pending", "refund_requested", "disputed"]) {
    const bar = barRules.dark.get(status);
    assert.ok(bar && bar.bg, `dark .bd-fill.${status} rule must exist`);
    const fill = resolve(bar.bg);
    fills.add(fill);
    assert.ok(
      contrastRatio(fill, card) >= 3,
      `dark .bd-fill.${status} ${fill} must read on the dark card ${card}`,
    );
  }
  assert.equal(fills.size, 4, "the 4 dark bar fills must be distinct");
});

test("accent / money / down / warn / tip contrasts in both themes", () => {
  const light = (name) => lightTokens.get(name);
  const dark = (name) => mergedTokens.get(name);
  const check = (fg, bg, min, label) => {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= min, `${label} contrast ${ratio.toFixed(2)}:1 < ${min}:1 (${fg} on ${bg})`);
  };
  // Light: accent text on card/page, white on accent/money/down,
  // money/down text on card, ink on warn, white on tip.
  check(light("p-accent"), light("p-card"), 4.5, "light accent on card");
  check("#ffffff", light("p-accent"), 4.5, "light white on accent");
  check(light("p-money"), light("p-card"), 4.5, "light money on card");
  check("#ffffff", light("p-money"), 4.5, "light white on money");
  check(light("p-down"), light("p-card"), 4.5, "light down on card");
  check("#17171a", light("p-warn"), 4.5, "light ink on warn");
  check("#ffffff", light("p-tip"), 4.5, "light white on tip");
  // Dark: the same pairs with the dark token values.
  check(dark("p-accent"), dark("p-card"), 4.5, "dark accent on card");
  check(dark("p-money"), dark("p-card"), 4.5, "dark money on card");
  check(dark("p-down"), dark("p-card"), 4.5, "dark down on card");
  check("#17171a", dark("p-warn"), 4.5, "dark ink on warn");
  check("#ffffff", dark("p-tip"), 4.5, "dark white on tip");
  // Dark action button: white on the dark accent is only 2.75:1, so
  // dark buttons use dark ink text (6.52:1) — see admin.css.
  check(dark("p-action-ink"), dark("p-action"), 4.5, "dark action ink on action");
});

test("donut palette: one muted colour per channel, 4 distinct hues, rank order pinned", () => {
  const lightShades = [1, 2, 3, 4].map((i) => lightTokens.get("donut-" + i));
  const darkShades = [1, 2, 3, 4].map((i) => darkTokens.get("donut-" + i));
  assert.equal(new Set(lightShades).size, 4, "light donut colours must be 4 distinct colours");
  assert.equal(new Set(darkShades).size, 4, "dark donut colours must be 4 distinct colours");
  assert.deepEqual(lightShades, ["#0f7f57", "#3e63dd", "#c9a24b", "#8a7a5c"],
    "light donut colours by rank: money green, accent blue, gold, warm grey");
  assert.deepEqual(darkShades, ["#34c48b", "#7b96ff", "#d9a521", "#a89a7d"],
    "dark donut colours by rank: money green, accent blue, gold, warm grey");
  // Recorded (2026-11-16): light vs white 5.01/5.21/2.40/4.18,
  // dark vs #141417 8.24/6.70/8.19/6.64. The gold is a non-text
  // fill below 3:1 on white; ranks 1-2 are close in lightness but
  // far apart in hue (green vs blue) — hover + the ranked
  // legend disambiguate them.
  assert.ok(contrastRatio(lightShades[0], "#ffffff") >= 4.5, "rank 1 light colour must read on white");
  assert.ok(contrastRatio(darkShades[0], "#141417") >= 4.5, "rank 1 dark colour must read on dark card");
  assert.ok(contrastRatio(lightShades[1], "#ffffff") >= 4.5, "rank 2 light colour must read on white");
  assert.ok(contrastRatio(lightShades[3], "#ffffff") >= 3, "rank 4 light colour must read on white");
  for (const s of darkShades) assert.ok(contrastRatio(s, "#141417") >= 3, "every dark donut colour must read on the dark card");
});

// ---- source-grep: the new components and their wiring ----

test("shared Tooltip: dark, hover + focus, viewport-clamped", () => {
  assert.ok(tooltipJsx.includes('role="tooltip"'), "Tooltip must expose role=tooltip");
  assert.ok(tooltipJsx.includes("onMouseEnter"), "Tooltip must show on hover");
  assert.ok(tooltipJsx.includes("onFocus"), "Tooltip must show on keyboard focus");
  assert.ok(tooltipJsx.includes("getBoundingClientRect"), "Tooltip must measure its anchor to clamp to the viewport");
  assert.ok(tooltipJsx.includes("window.innerWidth"), "Tooltip must clamp against the viewport width");
  assert.ok(tooltipJsx.includes('className="tooltip"'), "Tooltip must use the shared .tooltip style");
  assert.ok(dashboardJsx.includes('import Tooltip from "./Tooltip.jsx"'), "AdminDashboard must import Tooltip");
  assert.ok(dashboardJsx.includes("<Tooltip"), "AdminDashboard must use Tooltip");
});

test("shared RankedList: ranked rows with a 3px share bar", () => {
  assert.ok(rankedJsx.includes('className="rk-list"'), "RankedList must use .rk-list");
  assert.ok(rankedJsx.includes('className="rk-bar"'), "RankedList must render the 3px share bar");
  assert.ok(rankedJsx.includes('className="rk-fill"'), "RankedList must render the share fill");
  assert.ok(rankedJsx.includes('className="rk-rank"'), "RankedList must show the rank");
  assert.ok(dashboardJsx.includes('import RankedList from "./RankedList.jsx"'), "AdminDashboard must import RankedList");
  assert.ok(dashboardJsx.includes("<RankedList"), "AdminDashboard must use RankedList for the breakdowns");
});

test("theme toggle: AppHeader button + pre-paint bootstrap", () => {
  assert.ok(headerJsx.includes('import { getEffectiveTheme, toggleTheme, subscribeTheme } from "./theme.mjs"'), "AppHeader must use the admin theme module");
  assert.ok(headerJsx.includes('className="theme-btn"'), "AppHeader must render the theme toggle button");
  assert.ok(headerJsx.includes("toggleTheme()"), "the toggle must flip the theme");
  assert.ok(headerJsx.includes("切换到浅色") && headerJsx.includes("切换到深色"), "the toggle must label both directions");
  assert.ok(dashboardHtml.includes('localStorage.getItem("guiyan-theme")'), "dashboard.html must bootstrap from the shared key");
  assert.ok(dashboardHtml.includes('setAttribute("data-theme"'), "dashboard.html must set data-theme before first paint");
});

test("TrendChart: previous line, partial tail, compact ticks, chips, keyboard", () => {
  for (const needle of ["prevSeries", "prev-line", "line-tail", "dot-partial", "bar-prev", "bar-partial", "chart-legend", "chart-chips", "summarizeSeries", "本期", "上期", "日均", "onKeyDown", "ArrowLeft", "ArrowRight"]) {
    assert.ok(trendJsx.includes(needle), `TrendChart must contain ${needle}`);
  }
  assert.ok(trendJsx.includes("metric") && trendJsx.includes("onMetricChange"), "TrendChart must accept a controlled metric");
  assert.ok(trendJsx.includes("fmtCompactTick"), "TrendChart Y ticks must use the compact formatter");
  assert.ok(trendJsx.includes("（未完）"), "the partial bucket must be labelled unfinished");
  assert.ok(dashboardJsx.includes("prevSeries={seriesData.prevSeries}"), "overview + trends must pass prevSeries");
  assert.ok(dashboardJsx.includes("metric={chartMetric}"), "overview + trends must pass the lifted metric");
});

test("DonutChart: per-channel colours, ranked legend, <0.1% shares", () => {
  for (const needle of ["DONUT_SHADES", "pctText", '"<0.1%"', "donut-rank", "donut-bar", "var(--donut-1)", "var(--donut-4)"]) {
    assert.ok(donutJsx.includes(needle), `DonutChart must contain ${needle}`);
  }
  assert.ok(!donutJsx.includes("DONUT_COLORS"), "the old 7-colour brand array must be gone");
  assert.ok(!donutJsx.includes("--brand-"), "the donut must not reference any brand token");
});

test("AdminDashboard: lifted metric, KPI strip, states, problem actions", () => {
  for (const needle of [
    "chartMetric",
    "setChartMetric",
    "Sparkline",
    "SortChips",
    "查看订单",
    "is-stale",
    "page-note",
    "overviewError",
    "pill-updated",
    'className="skel"',
    "formatDelta",
    "updatedAt",
    "setFilter(k); changeView(\"orders\")",
  ]) {
    assert.ok(dashboardJsx.includes(needle), `AdminDashboard must contain ${needle}`);
  }
  assert.ok(dashboardJsx.includes('id="ovKpiRevenue"'), "revenue tile must keep its id");
  assert.ok(!dashboardJsx.includes("stats.revenue_cents"), "the KPI strip must not read the cumulative stats revenue");
  assert.ok(dashboardJsx.includes("窗口内订单"), "analysis orders must be labelled windowed, not historical");
  assert.ok(dashboardJsx.includes("历史全部订单，不随上方周期变化"), "the breakdown must state it is cumulative, not windowed");
});

test("dashboard reads the windowed payload, never the cumulative stats, for KPIs + donut", () => {
  assert.ok(dashboardJsx.includes("seriesData.totals"), "KPI strip must read the windowed totals");
  assert.ok(dashboardJsx.includes("seriesData.previous"), "KPI strip must read the previous window");
  assert.ok(dashboardJsx.includes("analysis.kpis.revenue"), "donut centre must be the windowed analysis revenue");
  assert.ok(!dashboardJsx.includes("total={stats ? stats.revenue_cents : 0}"), "donut must not use the cumulative stats revenue anymore");
});

test("test file is wired into the npm test chain", () => {
  const serverPkg = JSON.parse(
    fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
  );
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-dashboard-redesign.test.mjs"),
    "server/package.json test script must run tests/admin-dashboard-redesign.test.mjs",
  );
});

test("dark mode: buttons inherit ink, never the UA black (KPI tile regression)", () => {
  // CDP probe 2026-11-16: the KPI tile value (<b> inside a <button
  // class="ov-kpi"> with no colour of its own) computed to rgb(0,0,0)
  // in dark mode — the UA ButtonText is black on the #141417 card.
  // The base button rule must carry the ink colour so every button
  // text defaults to ink in both themes.
  assert.ok(
    css.includes("button{font:inherit;color:var(--p-ink);cursor:pointer}"),
    "base button rule must set color:var(--p-ink)",
  );
});
