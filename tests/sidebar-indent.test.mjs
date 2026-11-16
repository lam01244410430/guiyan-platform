// tests/sidebar-indent.test.mjs: sidebar premium items indent under their
// 经营分析 group label (Lam 2026-11-17). No server needed: all checks are
// source-level, same shape as tests/perf-datetime.test.mjs.
//
// Covered: the `nav-sub` class is on the 7 premium buttons only (the
// premium .map block in Sidebar.jsx) and on no main button; the CSS
// indents .nav-sub to padding-left 26px (+12px vs the 14px group label)
// inside a desktop-only @media(min-width:861px) block, appearing exactly
// once in admin.css (no leak into any max-width drawer block); the drawer
// grid at <=560px (3 columns, centred buttons, 12px 4px padding) is
// unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");

test("nav-sub class is on premium buttons only, never on main buttons", () => {
  const src = read("admin/assets/js/Sidebar.jsx");
  const [before, after] = src.split('className="nav-group"');
  assert.ok(before !== undefined && after !== undefined, "Sidebar.jsx must render the nav-group label");
  assert.ok(!before.includes("nav-sub"), "main buttons (before the nav-group label) must not carry nav-sub");
  assert.equal((after.match(/nav-sub/g) || []).length, 1, "nav-sub must appear exactly once, in the premium map");
  assert.ok(
    after.includes('className={"nav-sub" + (view === v.id ? " on" : "")}'),
    "premium buttons must keep the active state: nav-sub + ' on' when active",
  );
});

test("CSS indents premium buttons +12px on desktop only, exactly once", () => {
  const css = read("admin/assets/css/admin.css");
  assert.ok(
    css.includes("@media(min-width:861px){.sidebar nav button.nav-sub{padding-left:26px}}"),
    "premium buttons must be padding-left 26px (+12px vs the 14px label) inside a desktop-only min-width:861px block",
  );
  assert.equal((css.match(/nav-sub/g) || []).length, 1, ".nav-sub must appear exactly once in admin.css (no drawer leak)");
});

test("drawer grid at <=560px is unchanged", () => {
  const css = read("admin/assets/css/admin.css");
  assert.ok(
    css.includes(".sidebar nav button{flex-direction:column;align-items:center;gap:6px;padding:12px 4px;font-size:12px;text-align:center}"),
    "drawer buttons must stay centred with 12px 4px padding at <=560px",
  );
  assert.ok(
    css.includes(".sidebar .nav-group{padding:6px 4px 2px}"),
    "drawer group label padding must stay 6px 4px 2px at <=560px",
  );
  assert.ok(
    css.includes(".sidebar .nav-div,.sidebar .nav-group{grid-column:1/-1}"),
    "drawer divider + group label must still span the full grid row",
  );
});
