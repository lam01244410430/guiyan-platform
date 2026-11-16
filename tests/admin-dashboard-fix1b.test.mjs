// Dashboard fix1 vong B (2026-11-16, Lam duyet plan "lam theo mac dinh"):
// Q3 nut 查看订单 xuong dong rieng duoi thanh tien do, can phai;
// Q4 .bd-label khong xuong dong (5 chu tren mot dong);
// Q5 CHI bang 最近订单 tren dashboard can giua.
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const BUTTON =
  '<button type="button" className="btn-view bd-action" onClick={() => { setFilter(k); changeView("orders"); }}>查看订单</button>';

test("fix1b Q3: 查看订单 button is on its own row under the progress bar, not in the label row", () => {
  // The label row (label + count) must hold no button at all.
  const topStart = dashboardJsx.indexOf('<div className="bd-row-top">');
  const trackStart = dashboardJsx.indexOf('<div className="bd-track">', topStart);
  assert.ok(topStart !== -1 && trackStart !== -1, "breakdown row-top/track not found");
  const topRow = dashboardJsx.slice(topStart, trackStart);
  assert.ok(!topRow.includes("查看订单"), "查看订单 must not be in .bd-row-top");
  assert.ok(!topRow.includes("bd-action"), "no action button may sit in .bd-row-top");
  assert.ok(topRow.includes('<span className="bd-label">{STATUS[k]}</span>'), "label stays in the row");
  assert.ok(topRow.includes('<span className="bd-num">{n}</span>'), "count stays in the row");
  // The button lives in its own .bd-row-action div, after the track.
  const actionStart = dashboardJsx.indexOf('<div className="bd-row-action">', trackStart);
  assert.ok(actionStart !== -1, ".bd-row-action div not found after the track");
  const actionRow = dashboardJsx.slice(actionStart, actionStart + 400);
  assert.ok(actionRow.includes(BUTTON), "the action row must hold the 查看订单 button");
});

test("fix1b Q3: the button still opens the orders view filtered to its own status", () => {
  assert.equal(
    dashboardJsx.split(BUTTON).length - 1,
    1,
    "exactly one 查看订单 button in the breakdown",
  );
  assert.ok(
    BUTTON.includes("setFilter(k); changeView(\"orders\")"),
    "button must keep setFilter(k) + changeView(\"orders\")",
  );
  // Still gated to the problem rows with n > 0.
  assert.ok(
    dashboardJsx.includes('{isProblem && n > 0 ? ('),
    "button must stay gated to problem rows with n > 0",
  );
});

test("fix1b Q3: the action row is right-aligned under the bar", () => {
  assert.ok(
    css.includes(".bd-row-action{display:flex;justify-content:flex-end;margin-top:8px}"),
    "admin.css missing: .bd-row-action right-aligned row",
  );
});

test("fix1b Q4: status labels never wrap (5 chars on one line)", () => {
  assert.ok(
    css.includes(".bd-label{font-size:13.5px;font-weight:600;color:var(--p-muted);flex:none;width:72px;white-space:nowrap}"),
    "admin.css missing: .bd-label 72px + nowrap",
  );
  // Labels themselves are untouched — no rewording.
  assert.ok(
    dashboardJsx.includes('["refund_requested", "退款申请中"]'),
    "label 退款申请中 must stay",
  );
  assert.ok(
    dashboardJsx.includes('["disputed", "纠纷处理中"]'),
    "label 纠纷处理中 must stay",
  );
  // The count still sits at the right end of the label row.
  assert.ok(
    css.includes(".bd-num{text-align:right;"),
    ".bd-num must stay right-aligned",
  );
});

test("fix1b Q5: ONLY the 最近订单 table on the overview is centred", () => {
  // Exactly one wrap carries the marker, and it is the overview table's.
  assert.equal(
    dashboardJsx.split("tbl-wrap ov-recent").length - 1,
    1,
    "exactly one .ov-recent wrap (the 最近订单 table)",
  );
  const recentH2 = dashboardJsx.indexOf("<h2>最近订单</h2>");
  const marker = dashboardJsx.indexOf("tbl-wrap ov-recent");
  const firstTable = dashboardJsx.indexOf('className="orders-table"');
  assert.ok(recentH2 !== -1 && marker > recentH2 && marker < firstTable,
    ".ov-recent must wrap the 最近订单 table, not another table");
  // Both tables keep the shared class; the orders view table is untouched.
  assert.equal(
    dashboardJsx.split('className="orders-table"').length - 1,
    2,
    "both orders tables must keep the orders-table class",
  );
  assert.ok(
    css.includes(".tbl-wrap.ov-recent table th,.tbl-wrap.ov-recent table td{text-align:center}"),
    "admin.css missing: centred header + cells scoped to .ov-recent",
  );
  // No global centring rule that would also move the other 39 admin tables.
  assert.ok(!css.includes(".orders-table th{text-align:center}"), "no global orders-table centring");
  // Any orders-table th rule that centres text is banned, however it is
  // written — but width-only rules (e.g. the pagination-fit F3 trims)
  // are allowed: the guard is about centring, not about widths.
  assert.ok(!/table\.orders-table th[^{]*\{[^}]*text-align:\s*center/.test(css),
    "no global orders-table centring rule");
  assert.ok(!css.includes(".tbl-wrap table th,.tbl-wrap table td{text-align:center}"),
    "no all-tables centring rule");
});

test("fix1b test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-dashboard-fix1b.test.mjs"),
    "server/package.json test script must run tests/admin-dashboard-fix1b.test.mjs",
  );
});
