// tests/header-breadcrumb-groups.test.mjs: admin breadcrumb shows the view's
// real sidebar group as parent (Lam 2026-11-17), not 总览 for every view.
// No server needed: all checks are source-level, same shape as
// tests/perf-datetime.test.mjs.
//
// Covered: the PREMIUM_VIEWS set in AdminDashboard.jsx matches exactly the
// 7 `group: "premium"` ids in Sidebar.jsx (the single source of truth for
// groups, so a new premium view cannot drift silently); the crumbParent
// rule gives "经营分析" to premium views except analysis (its own label
// IS the group name — no "经营分析 / 经营分析"), and "" to main views;
// AppHeader renders `{parent} / {label}` when a parent is set and the bare
// label otherwise, with no hardcoded 总览 parent left; AdminDashboard passes
// crumbParent into AppHeader; titles/subtitles (incl. 总览 / 运营数据一览)
// and the .crumbs CSS are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");

function premiumIdsFromSidebar() {
  const src = read("admin/assets/js/Sidebar.jsx");
  const ids = [...src.matchAll(/\{\s*id:\s*"([^"]+)"[^}]*group:\s*"premium"/g)].map((m) => m[1]);
  assert.equal(ids.length, 7, "Sidebar.jsx must list exactly 7 premium views");
  return new Set(ids);
}

function premiumSetFromDashboard() {
  const src = read("admin/assets/js/AdminDashboard.jsx");
  const m = src.match(/const PREMIUM_VIEWS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "AdminDashboard.jsx must define PREMIUM_VIEWS");
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

test("PREMIUM_VIEWS matches exactly the 7 premium ids in Sidebar.jsx", () => {
  const fromSidebar = premiumIdsFromSidebar();
  const fromDashboard = premiumSetFromDashboard();
  assert.deepEqual(
    [...fromDashboard].sort(),
    [...fromSidebar].sort(),
    "PREMIUM_VIEWS must equal the premium group in Sidebar.jsx",
  );
});

test("crumbParent rule: premium except analysis -> 经营分析, main -> empty", () => {
  const src = read("admin/assets/js/AdminDashboard.jsx");
  assert.ok(
    src.includes('(view !== "analysis" && PREMIUM_VIEWS.has(view)) ? "经营分析" : ""'),
    "crumbParent must be 经营分析 for premium views except analysis, else empty",
  );
  assert.ok(!src.includes("经营分析 / 经营分析"), "analysis must never render a duplicated parent");
});

test("AppHeader: parent + label when set, bare label otherwise, no 总览 parent", () => {
  const src = read("admin/assets/js/AppHeader.jsx");
  assert.ok(
    src.includes('{crumbParent ? (<>{crumbParent} <span aria-hidden="true">/</span> {viewLabel}</>) : viewLabel}'),
    "crumbs nav must render parent / label when set, bare label otherwise",
  );
  assert.ok(!src.includes("总览 <span"), "no hardcoded 总览 parent may remain in the crumbs nav");
  assert.ok(
    src.includes("crumbParent,"),
    "AppHeader must accept the crumbParent prop",
  );
});

test("AdminDashboard passes crumbParent into AppHeader", () => {
  const src = read("admin/assets/js/AdminDashboard.jsx");
  assert.ok(src.includes("crumbParent={crumbParent}"), "AppHeader must receive crumbParent={crumbParent}");
});

test("titles/subtitles and .crumbs CSS untouched", () => {
  const dash = read("admin/assets/js/AdminDashboard.jsx");
  assert.ok(dash.includes('overview: ["总览", "运营数据一览"]'), "overview title + subtitle must stay");
  assert.ok(dash.includes('orders: ["全部订单", "可处理售后"]'), "orders title + subtitle must stay");
  const css = read("admin/assets/css/admin.css");
  assert.ok(css.includes(".crumbs{"), ".crumbs CSS must stay (the nav is kept, only its parent changes)");
});
