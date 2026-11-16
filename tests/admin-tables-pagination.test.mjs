// Tables pagination-fit round (2026-11-17, Lam-approved plan, defaults (a)):
// Q1 shared 25/page pager on every list table; Q2/Q4 capped flexible
// columns on all 39 tables (max-width:max-content keeps exact widths);
// Q3 会员等级 capped + 店铺 1 line. Source-grep assertions only, no
// server and no database needed.
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
const pagerJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "Pager.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);

test("pager Q1: PAGE_SIZE is 25 and the pager hides at or below 25 rows", () => {
  assert.ok(pagerJsx.includes("export const PAGE_SIZE = 25;"), "PAGE_SIZE must be 25");
  assert.ok(pagerJsx.includes("if (!p || p.total <= PAGE_SIZE) return null;"),
    "pager must render nothing when total <= 25");
});

test("pager Q1: pager shows total + current page and prev/next controls", () => {
  assert.ok(pagerJsx.includes("共 {p.total} 条 · 第 {p.page}/{p.totalPages} 页"),
    "pager label must be 共 N 条 · 第 X/Y 页");
  assert.ok(pagerJsx.includes('aria-label="上一页"'), "prev button must exist");
  assert.ok(pagerJsx.includes('aria-label="下一页"'), "next button must exist");
  assert.ok(pagerJsx.includes('className="pager"'), "pager wrapper must exist");
  assert.ok(pagerJsx.includes("…"), "compact page numbers must use an ellipsis");
});

test("pager Q1: dashboard wires one pager per list table (29 sites)", () => {
  assert.ok(dashboardJsx.includes('import Pager, { PAGE_SIZE } from "./Pager.jsx";'),
    "AdminDashboard must import the shared Pager");
  assert.ok(dashboardJsx.includes("const [tablePages, setTablePages] = useState({});"),
    "one page state per table id must exist");
  assert.ok(dashboardJsx.includes("function tablePage(id, list) {"),
    "tablePage helper must exist");
  assert.ok(dashboardJsx.includes("function goTablePage(id, sig, page) {"),
    "goTablePage helper must exist");
  const pagers = dashboardJsx.match(/<Pager p=\{pg[A-Za-z]+\} onPage=\{\(pg\) => goTablePage\("[a-z-]+", pg[A-Za-z]+\.sig, pg\)\} \/>/g) || [];
  assert.equal(pagers.length, 29, "must be exactly 29 Pager usages, found " + pagers.length);
  const maps = dashboardJsx.match(/pg[A-Za-z]+\.rows\.map\(/g) || [];
  assert.equal(maps.length, 29, "must be exactly 29 paged row maps, found " + maps.length);
});

test("pager Q1: page resets to 1 when the rendered list changes", () => {
  // The signature covers the list length + first/last row keys, so a
  // search / filter / sort that changes the list resets the page.
  assert.ok(dashboardJsx.includes("const sig = total + \"|\" + rows.slice(0, 3).map(tableRowKey).join(\",\")"),
    "page signature must cover length + first/last row keys");
  assert.ok(dashboardJsx.includes("const page = stored && stored.sig === sig ? Math.min(stored.page, totalPages) : 1;"),
    "a changed signature must reset the page to 1");
  assert.ok(dashboardJsx.includes("rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)"),
    "rows must be sliced 25 per page");
});

test("pager Q1: pre-sliced preview tables keep their slice and get no pager", () => {
  assert.ok(dashboardJsx.includes("sortedOverview.slice(0, 8)"),
    "最近订单 preview must keep its 8-row slice");
  assert.ok(dashboardJsx.includes("sortedSeries.slice(0, 10)"),
    "trends preview must keep its 10-row slice");
  assert.ok(!dashboardJsx.includes("<Pager p={pgOverview"), "overview preview must get no pager");
  assert.ok(!dashboardJsx.includes("<Pager p={pgTrends"), "trends preview must get no pager");
  assert.ok(!dashboardJsx.includes("<Pager p={pgChannels"), "channels ranked rows must get no pager");
});

test("pager Q1: the 30 tbl-total footers are untouched", () => {
  const found = dashboardJsx.split('className="tbl-total"').length - 1;
  assert.equal(found, 30, "must be exactly 30 tbl-total footers, found " + found);
});

test("fit Q2/Q4: every thead th carries a width class (no flexible column left)", () => {
  // A th without a col-* width class absorbs all leftover width under
  // table-layout:fixed (measured: 资源 名称 took 740px at 1920px).
  const bare = dashboardJsx.match(/<th scope="col">/g) || [];
  assert.equal(bare.length, 0, "no th may lack a className, found " + bare.length);
  const numOnly = dashboardJsx.match(/<th scope="col" className="num"/g) || [];
  assert.equal(numOnly.length, 0, "no th may carry only the num class, found " + numOnly.length);
});

test("fit Q2: the named stretch columns are capped", () => {
  assert.ok(dashboardJsx.includes('<th scope="col" className="col-name" aria-sort={ariaSort("resources", "name")}>名称'),
    "资源 名称 must be capped with col-name");
  assert.ok(!dashboardJsx.includes('<th scope="col">规则名称</th>'),
    "自动发券 规则名称 must not stay uncapped");
  assert.ok(!dashboardJsx.includes('<th scope="col">任务名称</th>'),
    "短信群发 任务名称 must not stay uncapped");
  assert.ok(!dashboardJsx.includes('<th scope="col">短信模板</th>'),
    "短信群发 短信模板 must not stay uncapped");
  assert.ok(!dashboardJsx.includes('<th scope="col">优惠券</th>'),
    "no 优惠券 header may stay uncapped");
  assert.ok(!dashboardJsx.includes('<th scope="col">等级</th>'),
    "no 等级 header may stay uncapped");
});

test("fit Q2(b): tables keep exact column widths (max-width:max-content)", () => {
  assert.ok(css.includes(".tbl-wrap > table{table-layout:fixed;max-width:max-content}"),
    "top-level tables must cap at their natural width instead of stretching");
});

test("fit Q3: 会员等级 capped, 店铺 one line with ellipsis + title", () => {
  assert.ok(dashboardJsx.includes('<th scope="col" className="col-name">等级</th>'),
    "会员等级 等级 must be capped with col-name");
  assert.ok(dashboardJsx.includes('<th scope="col" className="col-wide">权益</th>'),
    "会员等级 权益 must be capped with col-wide");
  assert.ok(dashboardJsx.includes('<td className="cell-ellipsis" title={shopName(t.shop_id)}>{shopName(t.shop_id)}</td>'),
    "会员等级 店铺 cell must truncate with ellipsis + title instead of wrapping");
});

test("fit: pager styles are bottom-right, 4px radius, accent-outline current page", () => {
  assert.ok(css.includes(".pager{display:flex;justify-content:flex-end;"),
    "pager must sit bottom-right of its table");
  assert.ok(css.includes(".pager-btn{"), "pager buttons must be styled");
  assert.ok(css.includes(".pager-btn.on{background:var(--p-surface);border-color:var(--p-action);color:var(--p-action)}"),
    "current page must use the accent outline, never filled accent");
  assert.ok(css.includes(".pager-btn{border:1px solid var(--line2);background:var(--p-card);color:var(--p-ink);border-radius:4px;"),
    "pager buttons must follow the 4px control template");
});
