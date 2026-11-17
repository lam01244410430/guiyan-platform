// tests/p1-trackA.test.mjs: P1 Track A — M4 H5 bottom nav + G4 split
// submit/refresh reporting (Lam 2026-11-17, plan guiyan-p1-gap-plan.md).
// No server needed: all checks are source-level, same shape as
// tests/header-overflow.test.mjs.
//
// M4 covered: BottomNav exported from chrome.jsx and rendered inside
// Header (so index + brand + user all get it); 4 tabs 发现 / 资源 / 需求 /
// 我的 with the right hrefs per variant; hand-drawn inline SVG line
// icons (no icon library); hidden on desktop, fixed to the bottom at
// <=860px, active tab red + bold, body padded so the bar never covers
// content, AI button/panel + toast lifted above the bar; i18n keys in
// zh/vi/en (counts 484 -> 488).
//
// G4 covered: reportSaveRefresh + quietGet helpers; the 8 loaders take a
// `quiet` flag and resolve a boolean instead of toasting; every admin
// save site reports the submit and the refresh separately (split
// message "提交成功…；刷新失败，请重试/手动刷新"); no swallowed refresh
// catch remains except the logout one; the customer web needed no
// change (its optimistic updates already keep the submit toast).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");
const count = (s, sub) => s.split(sub).length - 1;

// Slice the @media block that contains the given needle: find the needle,
// then the last @media before it and the next @media after it. (main.css
// has several @media(max-width:860px) blocks, so a plain indexOf would
// land on the ai-grid one.)
function mediaBlockContaining(css, needle) {
  const at = css.indexOf(needle);
  assert.ok(at >= 0, `main.css must contain ${needle}`);
  const start = css.lastIndexOf("@media", at);
  assert.ok(start >= 0, "a @media must precede " + needle);
  const next = css.indexOf("@media", at + 1);
  return css.slice(start, next < 0 ? undefined : next);
}

// ---------------- M4: BottomNav in chrome.jsx ----------------

test("M4: BottomNav is exported from chrome.jsx and rendered inside Header", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  assert.ok(chrome.includes("export function BottomNav({ variant })"), "BottomNav must be exported from chrome.jsx");
  assert.ok(chrome.includes("<BottomNav variant={variant} />"), "Header must render BottomNav (all 3 variants share Header)");
  assert.ok(chrome.includes('id="bottomNav"'), "nav must carry id=bottomNav for probes");
});

test("M4: 4 tabs with the right hrefs per variant", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  assert.ok(chrome.includes('["#top", "bnDiscover", "discover"]'), "index variant: 发现 -> #top");
  assert.ok(chrome.includes('["#catalog", "bnResources", "resources"]'), "index variant: 资源 -> #catalog");
  assert.ok(chrome.includes('["#demands", "bnDemands", "demands"]'), "index variant: 需求 -> #demands");
  assert.ok(chrome.includes('["user.html", "bnMine", "mine"]'), "我的 -> user.html in both variants");
  assert.ok(chrome.includes('["index.html", "bnDiscover", "discover"]'), "brand/user variant: 发现 -> index.html");
  assert.ok(chrome.includes('["index.html#catalog", "bnResources", "resources"]'), "brand/user variant: 资源 -> index.html#catalog");
  assert.ok(chrome.includes('["index.html#demands", "bnDemands", "demands"]'), "brand/user variant: 需求 -> index.html#demands");
  assert.ok(chrome.includes('if (variant === "user") return "mine"'), "user page opens with 我的 active");
  assert.ok(chrome.includes('className={"bn-tab" + (active === id ? " on" : "")}'), "active tab gets .on");
});

test("M4: hand-drawn inline SVG line icons, no icon library", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  for (const icon of ["BnDiscoverIcon", "BnResourcesIcon", "BnDemandsIcon", "BnMineIcon"]) {
    assert.ok(chrome.includes("function " + icon + "()"), icon + " must exist");
  }
  assert.equal(count(chrome, 'strokeWidth="1.7"'), 4, "all 4 icons use stroke 1.7 like the catrail icons");
  assert.ok(!/from ["'].*(lucide|react-icons|heroicons|font-awesome|@mdi)/.test(chrome), "no icon library import");
});

test("M4: nav hidden on desktop, fixed bottom at <=860px, active tab red+bold", () => {
  const css = read("web/assets/css/main.css");
  assert.ok(css.includes(".bottomnav{display:none}"), ".bottomnav must be hidden by default (desktop)");
  const block = mediaBlockContaining(css, ".bottomnav{display:flex");
  assert.ok(block.startsWith("@media(max-width:860px){"), "the bottomnav block must be the <=860px one");
  assert.ok(block.includes(".bottomnav{display:flex;position:fixed;left:0;right:0;bottom:0;"), "nav must be fixed to the bottom at <=860px");
  assert.ok(block.includes("height:56px"), "nav height is 56px");
  assert.ok(block.includes(".bottomnav .bn-tab.on{color:var(--red);font-weight:700}"), "active tab is red + bold");
  assert.ok(block.includes(".bottomnav .bn-tab{flex:1;"), "4 tabs share the width equally");
  assert.ok(block.includes("white-space:nowrap"), "labels stay on one line");
  assert.ok(block.includes("body{padding-bottom:56px}"), "page content gets bottom padding so the nav never covers it");
});

test("M4: AI button/panel and toast are lifted above the nav at <=860px", () => {
  const css = read("web/assets/css/main.css");
  const block = mediaBlockContaining(css, ".bottomnav{display:flex");
  assert.ok(block.includes(".ai-fab{bottom:76px}"), "AI button lifts above the 56px nav");
  assert.ok(block.includes(".ai-panel{bottom:144px}"), "AI panel lifts above the nav + button");
  assert.ok(block.includes(".toast{bottom:82px}"), "toast lifts above the nav");
  // The bottomnav block sits after the <=560px AI rules in the file, so
  // the lifted offsets win at every narrow width (not just 561-860px).
  const ai560 = css.indexOf(".ai-fab{right:12px;bottom:12px}");
  const nav860 = css.indexOf(".bottomnav{display:flex");
  assert.ok(ai560 >= 0 && nav860 > ai560, "bottomnav rules must come after the <=560px AI rules");
});

test("M4: i18n keys bnDiscover/bnResources/bnDemands/bnMine in zh/vi/en (488 keys)", async () => {
  const data = await import(path.resolve(repoDir, "web", "assets", "js", "data.js"));
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [488, 488, 488, 82, 82, 82]);
  const want = {
    zh: ["发现", "资源", "需求", "我的"],
    vi: ["Khám phá", "Tài nguyên", "Nhu cầu", "Của tôi"],
    en: ["Discover", "Resources", "Demands", "Mine"],
  };
  const keys = ["bnDiscover", "bnResources", "bnDemands", "bnMine"];
  for (const [lang, values] of Object.entries(want)) {
    keys.forEach((k, i) => assert.equal(data.I18N[lang][k], values[i], `${k} in ${lang}`));
  }
});

// ---------------- G4: split submit/refresh reporting ----------------

test("G4: reportSaveRefresh + quietGet helpers exist with the split message", () => {
  const admin = read("admin/assets/js/AdminDashboard.jsx");
  assert.ok(admin.includes("function reportSaveRefresh(okMsg, jobs) {"), "reportSaveRefresh helper must exist");
  assert.ok(admin.includes("function quietGet(url, apply) {"), "quietGet helper must exist");
  assert.ok(admin.includes('toast(okMsg + "；刷新失败，请重试/手动刷新")'), "refresh failure must toast the SPLIT message, never a generic error");
  assert.ok(admin.includes("toast(okMsg);"), "success toast shows immediately, before the refresh settles");
});

test("G4: the 8 refresh loaders take a quiet flag and resolve a boolean", () => {
  const admin = read("admin/assets/js/AdminDashboard.jsx");
  for (const loader of [
    "loadAlerts", "loadAudit", "loadEventAggregates", "loadMemberInsights",
    "loadAlertRules", "loadFinanceLedger", "loadComments", "loadResPerfs",
  ]) {
    assert.ok(admin.includes(`function ${loader}(`) && admin.includes(`${loader}(`), loader + " must exist");
    assert.ok(new RegExp(`function ${loader}\\([^)]*quiet[^)]*\\)`).test(admin), loader + " must accept a quiet flag");
  }
  assert.ok(admin.includes("return true;"), "quiet loaders resolve true on success");
  assert.ok(admin.includes("return false;"), "quiet loaders resolve false on failure, never throw");
});

test("G4: every save site reports through reportSaveRefresh (43 sites)", () => {
  const admin = read("admin/assets/js/AdminDashboard.jsx");
  const sites = count(admin, "reportSaveRefresh(") - 1; // minus the definition
  assert.ok(sites >= 43, `expected >=43 reportSaveRefresh call sites, got ${sites}`);
});

test("G4: no swallowed refresh catch remains except the logout one", () => {
  const admin = read("admin/assets/js/AdminDashboard.jsx");
  assert.equal(count(admin, ".catch(function () {})"), 1, "the only empty catch left must be the logout one");
  assert.ok(admin.includes('apiPost("/api/auth/logout", {}).catch(function () {});'), "the remaining empty catch is the logout fire-and-forget");
  assert.equal(count(admin, 'apiGet("/api/admin/stats").then(setStats).catch(function () {})'), 0, "stats refresh must not be swallowed");
  assert.equal(count(admin, 'apiGet("/api/admin/orders").then(function (r) { setOrders(r.orders || []); }).catch(function () {})'), 0, "orders refresh must not be swallowed");
  assert.equal(count(admin, 'apiGet("/api/admin/users").then(function (u) { setUsers(u.users || []); }).catch(function () {})'), 0, "users refresh must not be swallowed");
});

test("G4: bare loadAudit() remains only at the two initial view loads", () => {
  const admin = read("admin/assets/js/AdminDashboard.jsx");
  assert.equal(count(admin, "loadAudit();"), 2, "only the two initial view loads may call loadAudit() bare");
  assert.ok(!admin.includes("loadAudit();\n      toast("), "no save may toast right after a bare loadAudit()");
});

test("G4: customer web needed no change (optimistic updates keep the submit toast)", () => {
  const app = read("web/assets/js/App.jsx");
  const user = read("web/assets/js/UserDashboard.jsx");
  assert.ok(!app.includes("reportSaveRefresh"), "App.jsx must not use the admin helper");
  assert.ok(!user.includes("reportSaveRefresh"), "UserDashboard.jsx must not use the admin helper");
  assert.ok(app.includes("o.status = map[act]; rerender();"), "App.jsx keeps its optimistic local update");
});
