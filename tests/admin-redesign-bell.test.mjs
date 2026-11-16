// Admin redesign bell tests (Item 2: notification bell + inline
// warning marks) — unit tests for the plain-JS helpers in
// admin/assets/js/bellUtils.js plus source-grep assertions, no server
// and no database needed. The bell reuses the alerts + audit state
// the alerts view already loads; no new endpoints.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  alertKey,
  alertSeverity,
  bellBadge,
  bellReadKey,
  loadBellReadKeys,
  lowStockResourceIds,
  markBellRead,
  orderMarkLevel,
  resourceMarkLevel,
  BELL_ALERT_LIMIT,
  BELL_AUDIT_LIMIT,
} from "../admin/assets/js/bellUtils.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headerJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AppHeader.jsx"),
  "utf-8",
);
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

test("bell severity: scan_abuse is critical even though the server sends severity warning", () => {
  assert.equal(
    alertSeverity({ auto: true, rule_kind: "scan_abuse", severity: "warning" }),
    "critical",
  );
});

test("bell severity: low_stock and sales_drop are warning", () => {
  assert.equal(alertSeverity({ auto: true, rule_kind: "low_stock", severity: "warning" }), "warning");
  assert.equal(alertSeverity({ auto: true, rule_kind: "sales_drop", severity: "warning" }), "warning");
});

test("bell severity: manual alerts use their severity field, missing severity defaults to warning", () => {
  assert.equal(alertSeverity({ id: 1, severity: "critical", title: "x" }), "critical");
  assert.equal(alertSeverity({ id: 1, severity: "error", title: "x" }), "critical");
  assert.equal(alertSeverity({ id: 1, severity: "warning", title: "x" }), "warning");
  assert.equal(alertSeverity({ id: 1, severity: "info", title: "x" }), "info");
  assert.equal(alertSeverity({ id: 1, title: "x" }), "warning");
  assert.equal(alertSeverity(null), "warning");
});

test("bell badge: counts unread alerts only, critical beats warning", () => {
  const alerts = [
    { auto: true, rule_kind: "scan_abuse", id: "auto:scan_abuse:platform" },
    { auto: true, rule_kind: "low_stock", id: "auto:low_stock:platform:7" },
    { id: 3, severity: "warning", title: "manual" },
  ];
  assert.deepEqual(bellBadge(alerts, new Set()), { count: 3, level: "critical" });
  assert.deepEqual(bellBadge(alerts, new Set(["auto:scan_abuse:platform"])), { count: 2, level: "warning" });
  assert.deepEqual(
    bellBadge(alerts, new Set(alerts.map((a) => alertKey(a)))),
    { count: 0, level: null },
  );
});

test("bell badge: warning-only, info never counts, read keys work as an array too", () => {
  const alerts = [
    { auto: true, rule_kind: "low_stock", id: "auto:low_stock:platform:7" },
    { id: 9, severity: "info", title: "pending" },
  ];
  assert.deepEqual(bellBadge(alerts, new Set()), { count: 1, level: "warning" });
  assert.deepEqual(bellBadge(alerts, ["auto:low_stock:platform:7"]), { count: 0, level: null });
  assert.deepEqual(bellBadge([], new Set()), { count: 0, level: null });
  // Audit events are never passed to the badge: it counts alerts only.
  assert.deepEqual(bellBadge([{ id: 1, severity: "info", title: "x" }], new Set()), { count: 0, level: null });
});

test("bell alertKey: id wins, title is the fallback for id-less computed alerts", () => {
  assert.equal(alertKey({ id: "auto:low_stock:platform:7" }), "auto:low_stock:platform:7");
  assert.equal(alertKey({ id: 12, title: "t" }), "12");
  assert.equal(alertKey({ title: "刘三姐库存仅剩2" }), "title:刘三姐库存仅剩2");
  assert.equal(alertKey(null), "");
});

test("bell read state: key is per account", () => {
  assert.equal(bellReadKey(1), "guiyan-bell-read-1");
  assert.equal(bellReadKey(42), "guiyan-bell-read-42");
  assert.notEqual(bellReadKey(1), bellReadKey(2));
  assert.ok(bellReadKey(1).startsWith("guiyan-bell-read-"));
});

test("bell low-stock ids: parsed from auto alert ids only", () => {
  const alerts = [
    { id: "auto:low_stock:platform:7" },
    { id: "auto:low_stock:3:11" },
    { id: "auto:sales_drop:platform" },
    { id: "auto:scan_abuse:platform" },
    { title: "某资源库存仅剩2" },
  ];
  assert.deepEqual(lowStockResourceIds(alerts), new Set([7, 11]));
  assert.deepEqual(lowStockResourceIds([]), new Set());
});

test("inline marks: disputed is critical, refund_requested is warning, other orders have none", () => {
  assert.equal(orderMarkLevel({ status: "disputed" }), "critical");
  assert.equal(orderMarkLevel({ status: "refund_requested" }), "warning");
  assert.equal(orderMarkLevel({ status: "paid" }), null);
  assert.equal(orderMarkLevel({ status: "cancelled" }), null);
  assert.equal(orderMarkLevel(null), null);
});

test("inline marks: low-stock resource rows warn, booking/draft/healthy rows do not", () => {
  const ids = new Set([7]);
  // Auto alert id alone is enough, whatever the stock number says.
  assert.equal(resourceMarkLevel({ id: 7, status: "draft", category: "show", stock: 99 }, ids, 5), "warning");
  // Same condition as the read-time computed alert: published,
  // non-booking (category != venue), stock <= threshold.
  assert.equal(resourceMarkLevel({ id: 8, status: "published", category: "show", stock: 5 }, new Set(), 5), "warning");
  assert.equal(resourceMarkLevel({ id: 8, status: "published", category: "show", stock: 6 }, new Set(), 5), null);
  // Booking resources (category venue) get quota alerts per date, not
  // a row mark — no clean resource target.
  assert.equal(resourceMarkLevel({ id: 9, status: "published", category: "venue", stock: 1 }, new Set(), 5), null);
  // Draft resources never fire the computed low-stock alert.
  assert.equal(resourceMarkLevel({ id: 10, status: "draft", category: "show", stock: 1 }, new Set(), 5), null);
  assert.equal(resourceMarkLevel(null, new Set(), 5), null);
});

test("bell read state: localStorage round-trip per account, missing store is empty", () => {
  const store = new Map();
  const stub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const prev = globalThis.localStorage;
  globalThis.localStorage = stub;
  try {
    assert.deepEqual(loadBellReadKeys(1), new Set());
    const alerts = [{ id: "auto:scan_abuse:platform" }, { title: "库存仅剩2" }];
    const next = markBellRead(1, alerts);
    assert.ok(next.has("auto:scan_abuse:platform"));
    assert.ok(next.has("title:库存仅剩2"));
    assert.deepEqual(loadBellReadKeys(1), next);
    // Another account sees nothing.
    assert.deepEqual(loadBellReadKeys(2), new Set());
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
});

test("bell header: button + count badge + dropdown (alerts + audit, view-all) + read marking + close keys", () => {
  assert.equal(BELL_ALERT_LIMIT, 10, "dropdown lists at most 10 alerts");
  assert.equal(BELL_AUDIT_LIMIT, 5, "dropdown lists at most 5 audit events");
  for (const snippet of [
    'className="bell-btn"',
    'className="bell-wrap"',
    'aria-label="通知"',
    'className={"bell-badge " + badgeState.level}',
    'className="bell-dropdown thin-scroll"',
    'list.slice(0, BELL_ALERT_LIMIT)',
    'logs.slice(0, BELL_AUDIT_LIMIT)',
    "查看全部",
    "onViewAlerts",
    "markBellRead(userId, list)",
    "loadBellReadKeys(userId)",
    '"Escape"',
    "bellRef.current.contains(e.target)",
  ]) {
    assert.ok(headerJsx.includes(snippet), `AppHeader missing: ${snippet}`);
  }
  // Badge colour comes from the severity mapping, not a hardcoded count.
  assert.ok(headerJsx.includes("bellBadge(list, readKeys)"), "badge must come from bellBadge()");
  // Audit rows are plain activity: no warning styling class on them.
  assert.ok(headerJsx.includes('className="bell-audit"'), "audit rows must use the plain bell-audit class");
  assert.ok(!headerJsx.includes('bell-audit warning'), "audit rows must never carry warning styling");
});

test("bell header CSS: badge and dropdown use the signal tokens, inline marks exist", () => {
  // D7 (dashboard redesign 2026-11-16): warning badge/mark text is
  // INK #17171a on the warn fill (6.06:1) — white on warn is 2.95:1.
  // The two warning rules therefore carry color:#17171a inside the
  // same rule; the critical rules keep white text from the base rule.
  for (const snippet of [
    ".bell-btn",
    ".bell-badge.critical{background:var(--signal-red)}",
    ".bell-badge.warning{background:var(--signal-yellow);color:#17171a}",
    ".bell-dropdown",
    ".bell-dot.critical{background:var(--signal-red)}",
    ".bell-dot.warning{background:var(--signal-yellow)}",
    ".inline-mark.critical{background:var(--signal-red)}",
    ".inline-mark.warning{background:var(--signal-yellow);color:#17171a}",
  ]) {
    assert.ok(css.includes(snippet), `admin.css missing: ${snippet}`);
  }
});

test("bell wiring: dashboard passes alerts + audit + user id to the header and loads them on mount", () => {
  for (const snippet of [
    "alerts={alerts}",
    "auditLogs={auditLogs}",
    "userId={myId}",
    "onViewAlerts={() => changeView(\"alerts\")}",
    "setMyId(u.id ?? null)",
    "loadAlerts(); loadAudit(); loadedRef.current.alerts = true;",
    'from "./bellUtils.js"',
    "lowStockResourceIds(alerts)",
  ]) {
    assert.ok(dashboardJsx.includes(snippet), `AdminDashboard missing: ${snippet}`);
  }
  // The bell must work on every view, so the mount effect — not only
  // the alerts-view effect — loads the data.
  assert.ok(
    dashboardJsx.includes("loadAlerts(); loadAudit();"),
    "alerts + audit must load on mount for the bell",
  );
});

test("inline marks: order rows and resource rows render the mark and route to the alerts view", () => {
  assert.ok(dashboardJsx.includes("orderMarkLevel(o)"), "OrderRow must use orderMarkLevel()");
  assert.ok(
    dashboardJsx.includes('className={"inline-mark " + mark}'),
    "order row must render the inline mark",
  );
  assert.ok(
    dashboardJsx.includes("resourceMarkLevel(r, lowStockIds, threshold)"),
    "resource row must use resourceMarkLevel()",
  );
  assert.ok(
    dashboardJsx.includes('className={"inline-mark " + resourceMarkLevel(r, lowStockIds, threshold)}'),
    "resource row must render the inline mark",
  );
  assert.ok(
    dashboardJsx.includes('onClick={() => changeView("alerts")}'),
    "clicking a mark must go to the alerts view",
  );
});

test("alerts view stays intact: full alert + audit tables, no standalone alert table elsewhere", () => {
  for (const snippet of [
    "预警列表",
    "操作审计",
    "filteredAlerts",
    "filteredAudit",
    "预警规则",
    "pgAlertRules.rows.map",
  ]) {
    assert.ok(dashboardJsx.includes(snippet), `alerts view missing: ${snippet}`);
  }
  // Exactly one "预警列表" heading: the alerts view is the only place
  // with an alert table. The analysis view keeps only a count line
  // with a link to the alerts view (no table removed, none added).
  assert.equal(
    dashboardJsx.split("预警列表").length - 1,
    1,
    "only the alerts view may carry an alert list",
  );
  assert.ok(dashboardJsx.includes("前往预警中心"), "analysis summary must still link to the alerts view");
});

test("bell test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-redesign-bell.test.mjs"),
    "server/package.json test script must run tests/admin-redesign-bell.test.mjs",
  );
});
