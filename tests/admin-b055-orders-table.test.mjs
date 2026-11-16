// B-055 orders-table tests (live defect: the order-code cell overflowed
// into the user column — 21 unbreakable mono chars in a ~59px fixed-layout
// column with no overflow control). The fix: the code cell truncates with
// an ellipsis like its neighbours, all three long cells expand on click
// (Excel-style), and the five short-content columns get fixed narrow
// widths. Source-grep assertions only, no server and no database needed.
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

test("b055 code cell: OrderRow renders the order code through ExpandableCell with mono", () => {
  // The old bare code cell (mono font only, no overflow control) must be gone.
  assert.ok(
    !dashboardJsx.includes('<td className="code">{o.code}</td>'),
    "bare code cell must be gone from OrderRow",
  );
  assert.ok(
    dashboardJsx.includes("<ExpandableCell value={o.code} mono />"),
    "OrderRow must render the code through ExpandableCell with mono",
  );
  assert.ok(
    dashboardJsx.includes("<ExpandableCell value={o.user_name} />"),
    "OrderRow must render the user name through ExpandableCell",
  );
  assert.ok(
    dashboardJsx.includes("<ExpandableCell value={o.resource_name} />"),
    "OrderRow must render the resource name through ExpandableCell",
  );
});

test("b055 expandable cell: ellipsis class + title tooltip + click toggle + keyboard", () => {
  const cell = dashboardJsx.match(/function ExpandableCell\([\s\S]*?\n\}/);
  assert.ok(cell, "ExpandableCell component not found");
  const src = cell[0];
  assert.ok(
    src.includes('className={(mono ? "code " : "") + "cell-ellipsis expandable" + (expanded ? " expanded" : "")}'),
    "ExpandableCell must render cell-ellipsis (+ code for mono) and the expanded class when open",
  );
  assert.ok(src.includes("title={text}"), "ExpandableCell must carry title = the full value");
  assert.ok(src.includes("const text = value || \"\""), "ExpandableCell must fall back to an empty string");
  assert.ok(src.includes("useState(false)"), "ExpandableCell must hold its own expanded state");
  assert.ok(
    src.includes("onClick={() => setExpanded((v) => !v)}"),
    "clicking the cell must toggle expanded",
  );
  assert.ok(src.includes("tabIndex={0}"), "the cell must be focusable");
  assert.ok(src.includes("aria-expanded={expanded}"), "the cell must expose its expanded state");
  assert.ok(src.includes('e.key === "Enter" || e.key === " "'), "Enter/Space must toggle when focused");
  assert.ok(src.includes("e.preventDefault()"), "the Space key must not scroll the page when toggling");
});

test("b055 expandable cell: only the three plain-text cells expand; action cells untouched", () => {
  // Exactly three ExpandableCell usages, all inside OrderRow — no cell
  // that contains a button or a link may become a click-to-expand cell.
  const uses = dashboardJsx.split("<ExpandableCell value={").length - 1;
  assert.equal(uses, 3, "exactly 3 ExpandableCell usages (code, user, resource), found " + uses);
  // The status pill, the 协议 button and the 售后 action buttons stay as they are.
  assert.ok(
    dashboardJsx.includes('<span className={"pill " + o.status}>{STATUS[o.status] || o.status}</span>'),
    "status pill must stay",
  );
  assert.ok(
    dashboardJsx.includes('<button type="button" className="btn-view" onClick={() => onContract(o)}>协议 / 权益</button>'),
    "协议 button must stay",
  );
  assert.ok(dashboardJsx.includes('className="row-actions"'), "售后 row-actions must stay");
  assert.ok(
    dashboardJsx.includes('onClick={() => onReview(o.id, "approveRefund")}'),
    "售后 approve button must stay",
  );
});

test("b055 narrow columns: width rules present in CSS", () => {
  // Lam 2026-11-16 (admin-overview round, item 4): every admin table's
  // columns were re-sized from real content measured by CDP at 1440/1249
  // (measure2.json) — the orders table min-width grows 880px→1000px, the
  // five narrow columns take their CDP widths, and the selector is the
  // descendant `.tbl-wrap table th` (not `>`) so the same classes also
  // size the nested tables.
  for (const snippet of [
    ".tbl-wrap > table.orders-table{min-width:1000px}",
    ".tbl-wrap table th.col-status{width:120px}",
    ".tbl-wrap table th.col-escrow{width:96px}",
    ".tbl-wrap table th.col-contract{width:140px}",
    ".tbl-wrap table th.col-amount{width:88px}",
    ".tbl-wrap table th.col-date{width:104px}",
    "td.cell-ellipsis.expandable{cursor:pointer}",
    "td.cell-ellipsis.expanded{white-space:normal;word-break:break-all;overflow:visible}",
  ]) {
    assert.ok(css.includes(snippet), `admin.css missing: ${snippet}`);
  }
  // The old mono-only code rule stays (the font), the ellipsis lives in
  // .cell-ellipsis which the code cell now also carries.
  assert.ok(css.includes("td.code,.mono{font-family:var(--font-mono)}"), "td.code mono font must stay");
  assert.ok(
    css.includes("td.cell-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"),
    "cell-ellipsis rule must stay",
  );
});

test("b055 narrow columns: both orders table headers carry the classes", () => {
  // Both the overview 最近订单 table and the orders view table.
  assert.equal(
    dashboardJsx.split('className="orders-table"').length - 1,
    2,
    "exactly 2 orders tables must carry the orders-table class",
  );
  // Count per-header occurrences directly: each narrow class must appear
  // in exactly two <th> elements (overview + orders view).
  for (const pattern of [
    '<th scope="col" className="col-status">状态</th>',
    '<th scope="col" className="col-escrow">托管</th>',
    '<th scope="col" className="col-contract">协议</th>',
    '<th scope="col" className="num col-amount"',
    '<th scope="col" className="col-date"',
  ]) {
    const found = dashboardJsx.split(pattern).length - 1;
    assert.equal(found, 2, `expected 2 headers with ${pattern}, found ${found}`);
  }
  // Sort buttons and the action column are untouched in both headers.
  // Lam 2026-11-16 (admin-overview round, item 4): the 售后 column is
  // now col-actions-md (200px, CDP-measured) instead of col-actions.
  for (const snippet of [
    '<SortButton label="订单号" sortKey="code" tableId="overview"',
    '<SortButton label="订单号" sortKey="code" tableId="orders"',
    '<SortButton label="金额" sortKey="amount" tableId="overview"',
    '<SortButton label="金额" sortKey="amount" tableId="orders"',
    '<th scope="col" className="col-actions-md">售后</th>',
  ]) {
    assert.ok(dashboardJsx.includes(snippet), `orders header must keep: ${snippet}`);
  }
  assert.ok(
    css.includes(".tbl-wrap > table th.col-actions{width:170px}"),
    "action column width must stay 170px",
  );
});

test("b055 test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-b055-orders-table.test.mjs"),
    "server/package.json test script must run tests/admin-b055-orders-table.test.mjs",
  );
});
