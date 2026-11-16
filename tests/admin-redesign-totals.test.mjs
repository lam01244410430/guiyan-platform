// Admin redesign totals tests (Item 3: header badge removed, totals moved
// from the title subtitle to a footer line under each list table, long
// names truncated with ellipsis + title tooltip) — source-grep
// assertions only, no server and no database needed. The audit log
// itself stays in the 预警中心 view; only the badge text goes.
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
const headerJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AppHeader.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

// The 30 footer lines Item 3 adds (one directly under each list table,
// bottom-left, outside the <table> element).
const ALL_FOOTERS = [
  "共 {overviewMatches.length} 单",
  "共 {filteredOrders.length} 单",
  "共 {filteredUsers.length} 人",
  "共 {filteredResources.length} 项",
  "共 {templates.length} 个模板",
  "共 {filteredShops.length} 家店铺",
  "共 {filteredShows.length} 场演出",
  "共 {filteredVenueList.length} 个场馆",
  "共 {memberTiers.length} 个等级",
  "共 {coupons.length} 张优惠券",
  "共 {flashSales.length} 场抢购",
  "共 {couponRules.length} 条规则",
  "共 {smsTasks.length} 条短信任务",
  "共 {licenses.length} 条授权",
  "共 {storedValuePlans.length} 种储值方案",
  "共 {verifyHistory.length} 条核销记录",
  "共 {filteredDemands.length} 条",
  "共 {comments.length} 条评价",
  "共 {filteredSeries.length} 个周期",
  "共 {filteredChannels.length} 条渠道",
  "共 {(analysis.shows || []).length} 场演出",
  "共 {(analysis.promos.coupons || []).length} 张优惠券",
  "共 {(analysis.promos.flash_sales || []).length} 场抢购",
  "共 {(analysis.members.tiers || []).length} 个等级",
  "共 {alertRules.length} 条规则",
  "共 {filteredAudit.length} 条审计记录",
  "共 {eventAggregates.length} 条聚合记录",
  "共 {memberInsights ? memberInsights.suggestions.length : 0} 条建议",
  "共 {memberInsights ? memberInsights.users.length : 0} 位会员",
  "共 {financeLedger.length} 条流水",
];

test("totals badge: header badge literal absent everywhere, bell badge untouched", () => {
  assert.ok(!dashboardJsx.includes("管理操作 · 审计留痕"), "badge text must be gone from AdminDashboard.jsx");
  assert.ok(!headerJsx.includes("管理操作 · 审计留痕"), "badge text must be gone from AppHeader.jsx");
  assert.ok(!dashboardJsx.includes("badge="), "no badge prop may be passed to AppHeader");
  assert.ok(!headerJsx.includes('className="badge"'), "AppHeader must not render a badge element");
  assert.ok(!headerJsx.includes("badge,"), "AppHeader must not take a badge prop");
  // Item 2's notification bell is a different badge and must survive.
  assert.ok(headerJsx.includes('className="bell-btn"'), "bell button must stay");
  assert.ok(headerJsx.includes("bellBadge(list, readKeys)"), "bell badge must still come from bellBadge()");
});

test("totals badge CSS: .badge rules gone, .bell-badge rules intact", () => {
  assert.ok(!css.includes(".badge{"), "admin.css must not define .badge anymore");
  assert.ok(!css.includes(".app-header .badge"), "admin.css must not style .app-header .badge anymore");
  assert.ok(css.includes(".bell-badge.critical{background:var(--signal-red)}"), "bell critical badge CSS must stay");
  assert.ok(css.includes(".bell-badge.warning{background:var(--signal-yellow)}"), "bell warning badge CSS must stay");
});

test("totals subtitle: pageSub carries no total, titles map carries no total", () => {
  const sub = dashboardJsx.match(/id="pageSub">([\s\S]*?)<\/span>/);
  assert.ok(sub, "pageSub render not found");
  assert.ok(!sub[1].includes("共"), "pageSub must not carry a total");
  assert.ok(sub[1].includes("titles[view][1]"), "pageSub must render the plain subtitle");
  const titles = dashboardJsx.match(/const titles = \{([\s\S]*?)\n  \};/);
  assert.ok(titles, "titles map not found");
  assert.ok(!titles[1].includes("共 "), "no titles subtitle may carry a total");
  // The trailing notes stay: the subtitle still says what the view is for.
  for (const note of ["可处理售后", "按店铺管理", "通过审核后可售票", "仅平台管理员可创建/修改"]) {
    assert.ok(titles[1].includes(note), "titles must keep the note: " + note);
  }
});

test("totals footer: filtered totals under the four main list tables", () => {
  for (const total of [
    "共 {filteredOrders.length} 单",
    "共 {filteredUsers.length} 人",
    "共 {filteredResources.length} 项",
    "共 {filteredDemands.length} 条",
  ]) {
    assert.ok(
      dashboardJsx.includes('<div className="tbl-total">' + total + "</div>"),
      "missing footer div: " + total,
    );
  }
});

test("totals footer: totals under every other list table", () => {
  const main = new Set([
    "共 {filteredOrders.length} 单",
    "共 {filteredUsers.length} 人",
    "共 {filteredResources.length} 项",
    "共 {filteredDemands.length} 条",
  ]);
  for (const total of ALL_FOOTERS) {
    if (main.has(total)) continue;
    assert.ok(
      dashboardJsx.includes('<div className="tbl-total">' + total + "</div>"),
      "missing footer div: " + total,
    );
  }
});

test("totals footer: exactly 30 footer lines, one per list table", () => {
  const found = dashboardJsx.split('className="tbl-total"').length - 1;
  assert.equal(found, 30, "must be exactly 30 tbl-total footers, found " + found);
  for (const total of ALL_FOOTERS) {
    assert.ok(dashboardJsx.includes(total), "missing footer text: " + total);
  }
});

test("totals footer: every footer sits directly under its table, outside it", () => {
  // Each footer must follow its table's close + the tbl-wrap close,
  // i.e. it is a sibling of the .tbl-wrap div, never inside <table>.
  // Dashboard redesign: 29 of the 30 footers still sit under a table;
  // the channels footer sits under the ranked list instead (the
  // 渠道复盘 table became ranked rows — see the test below).
  const placed = dashboardJsx.match(/<\/table>\s*<\/div>\s*<div className="tbl-total">/g) || [];
  assert.equal(placed.length, 29, "29 footers must sit directly under a table, found " + placed.length);
  // Going backwards from every footer, the nearest table tag must be
  // its own table's </table> — never an unclosed <table>.
  const parts = dashboardJsx.split('className="tbl-total"');
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const tail = before.slice(before.lastIndexOf("</table>"));
    assert.ok(tail.includes("</div>"), "footer " + i + " must follow the tbl-wrap close");
    assert.ok(!tail.slice("</table>".length).includes("<table"), "footer " + i + " must not sit inside a table");
  }
});

test("totals footer: the channels count line sits under the ranked list, not a table", () => {
  // Dashboard redesign (D5): the 渠道复盘 table became ranked rows
  // (RankedList) with sort chips; its count line stays a tbl-total
  // div so the total stays 30, but it follows the list, not a table.
  const channelsSec = dashboardJsx.split("渠道复盘")[1].split("资源销量")[0];
  assert.ok(channelsSec.includes("<RankedList"), "channels breakdown must render a RankedList");
  assert.ok(channelsSec.includes('className="tbl-total"'), "channels count line must exist");
  assert.ok(
    channelsSec.indexOf("<RankedList") < channelsSec.indexOf('className="tbl-total"'),
    "channels count line must come after the ranked list",
  );
  assert.ok(
    !channelsSec.includes("<table"),
    "channels breakdown must not render a table anymore",
  );
});

test("totals report lines kept: breakdown, series sum, ranking note, alerts summary, promo discount", () => {
  // These "共 …" lines are report/summary text, not table totals —
  // the approved design keeps them where they are.
  for (const snippet of [
    '<div className="bd-total">共 {total} 单</div>',
    "共 {analysisSeriesCount} 笔",
    "共 {q ? filteredRanking.length : analysis.ranking.length} 项资源",
    "共 {analysis.alerts.length} 条预警",
    "共减免 {fmtMoney(analysis.promos.total_discount_cents)}",
  ]) {
    assert.ok(dashboardJsx.includes(snippet), "report line must stay: " + snippet);
  }
  // The ranking table has no separate footer: its count already sits
  // directly under the table as that definition note.
  assert.ok(!dashboardJsx.includes('tbl-total">共 {q ? filteredRanking.length'), "ranking must not gain a second count line");
});

test("totals search: SearchBox resultCount kept as-is", () => {
  // The filtered-result count shown while searching is different from
  // the table total, so SearchBox resultCount must not move.
  for (const snippet of [
    "resultCount={q ? overviewMatches.length : null}",
    "resultCount={q ? filteredOrders.length : null}",
    "resultCount={q ? filteredUsers.length : null}",
    "resultCount={q ? filteredResources.length : null}",
    "resultCount={q ? filteredDemands.length : null}",
    "resultCount={q ? filteredShops.length : null}",
  ]) {
    assert.ok(dashboardJsx.includes(snippet), "SearchBox resultCount must stay: " + snippet);
  }
});

test("totals fixed layout + ellipsis CSS present", () => {
  for (const snippet of [
    ".tbl-wrap > table{table-layout:fixed}",
    "td.cell-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "span.cell-ellipsis{display:inline-block;vertical-align:middle;max-width:calc(100% - 26px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".tbl-wrap table table td.cell-ellipsis{max-width:220px}",
    ".tbl-total{margin-top:10px;font-size:13.5px;color:var(--p-muted)}",
  ]) {
    assert.ok(css.includes(snippet), `admin.css missing: ${snippet}`);
  }
});

test("totals action columns: explicit widths so buttons never overflow", () => {
  for (const snippet of [
    ".tbl-wrap > table th.col-actions{width:170px}",
    ".tbl-wrap > table th.col-actions-wide{width:250px}",
    ".tbl-wrap > table th.col-actions-xwide{width:320px}",
    ".tbl-wrap > table th.col-wide{width:260px}",
  ]) {
    assert.ok(css.includes(snippet), `admin.css missing: ${snippet}`);
  }
  // The widest action column is the shows table (4 buttons).
  assert.ok(dashboardJsx.includes('className="col-actions-xwide"'), "shows table needs the xwide action column");
  // Lam 2026-11-16 (admin-overview round, CDP-sized columns): 7 tables
  // use col-actions-wide — users, resources, shops, venues, comments
  // plus the nested performances table inside shows, and (showtimes-
  // final) the direct-performances table inside resources: it mirrors
  // the shows nested table (same 3 buttons 上架/取消/票种), so it takes
  // the same 250px wide column. (Was 6 before showtimes-final.)
  const wide = dashboardJsx.split('className="col-actions-wide"').length - 1;
  assert.equal(wide, 7, "users/resources/shops/venues/comments + nested performances + direct performances need the wide action column, found " + wide);
  // Lam 2026-11-16 (admin-overview round, CDP-sized columns): only 5
  // tables still use the plain col-actions — the small nested tables
  // (seat templates, ticket tiers, pickup points, nested seat templates)
  // plus (showtimes-final) the ticket-tiers table nested inside the new
  // direct-performances manager, mirroring the shows-view tier table.
  // (Was 4 before showtimes-final.)
  const narrow = dashboardJsx.split('className="col-actions"').length - 1;
  assert.equal(narrow, 5, "single/double-button action columns need col-actions, found " + narrow);
  // SortButton headers are untouched: still inside <th>, still wired.
  assert.ok(dashboardJsx.includes('aria-sort={ariaSort("orders", "code")}'), "sortable headers must stay");
  assert.ok(dashboardJsx.includes('<SortButton label="订单号" sortKey="code" tableId="orders"'), "SortButton must stay in the orders header");
});

test("totals ellipsis: name cells carry ellipsis class + title tooltip", () => {
  for (const snippet of [
    // B-055: OrderRow's long cells moved into ExpandableCell (ellipsis +
    // title tooltip live in the component, plus click-to-expand).
    '<ExpandableCell value={o.user_name} />',
    '<ExpandableCell value={o.resource_name} />',
    '<td className="cell-ellipsis" title={usr.name || ""}>{usr.name || ""}</td>',
    '<td className="cell-ellipsis" title={d.title}>{d.title}</td>',
    '<td className="cell-ellipsis" title={s.title}>{s.title}</td>',
    '<td className="cell-ellipsis" title={v.name}>{v.name}</td>',
    '<td className="cell-ellipsis" title={v.address || "—"}>{v.address || "—"}</td>',
    '<td className="cell-ellipsis" title={r.name}>{r.name}</td>',
    '<td className="cell-ellipsis" title={c.name}>{c.name}</td>',
    '<td className="cell-ellipsis" title={c.resource_name || ""}>{c.resource_name || ""}</td>',
    '<td className="cell-ellipsis" title={l.resource_name}>{l.resource_name}</td>',
    '<td className="cell-ellipsis" title={t.template}>{t.template}</td>',
    '<td className="cell-ellipsis" title={tt.name}>{tt.name}</td>',
    '<td className="cell-ellipsis" title={pt.name}>{pt.name}</td>',
  ]) {
    assert.ok(dashboardJsx.includes(snippet), `missing ellipsis name cell: ${snippet}`);
  }
});

test("totals ellipsis: resource name keeps its inline ! mark beside the truncated name", () => {
  // The name truncates inside a span; the Item 2 warning mark is a
  // sibling AFTER the span, so a long name can never clip it away.
  assert.ok(
    dashboardJsx.includes('<span className="cell-ellipsis" title={r.name}>{r.name}</span>{resourceMarkLevel(r, lowStockIds, threshold) ? ('),
    "resource name must truncate in a span with the ! mark after it",
  );
  assert.ok(
    dashboardJsx.includes('className={"inline-mark " + resourceMarkLevel(r, lowStockIds, threshold)}'),
    "resource row must still render the inline mark",
  );
});

test("totals audit log intact in the alerts view", () => {
  for (const snippet of [
    "预警列表",
    "操作审计",
    "filteredAlerts",
    "filteredAudit",
    "预警规则",
    "仅显示最近 60 条，最新在前",
  ]) {
    assert.ok(dashboardJsx.includes(snippet), `alerts view missing: ${snippet}`);
  }
  assert.ok(
    dashboardJsx.includes('<div className="tbl-total">共 {filteredAudit.length} 条审计记录</div>'),
    "audit table must have its footer total",
  );
});

test("totals test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-redesign-totals.test.mjs"),
    "server/package.json test script must run tests/admin-redesign-totals.test.mjs",
  );
});
