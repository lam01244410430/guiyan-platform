// Admin redesign palette tests (Item 1: palette + tokens + scrollbar) —
// pure source-grep assertions, no server and no database needed. The
// admin dashboard is pure white + neutral gray scale with a mint accent
// used sparingly; the old cream / orange / dark-green brand tokens must
// be gone from admin CSS. Customer web + mini-program keep their own
// brand and are not covered here.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(repoDir, "admin", "assets", "css", "admin.css"), "utf-8");
const dashboardHtml = fs.readFileSync(path.join(repoDir, "admin", "dashboard.html"), "utf-8");
const loginHtml = fs.readFileSync(path.join(repoDir, "admin", "index.html"), "utf-8");
const sidebarJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "Sidebar.jsx"),
  "utf-8",
);

const FONT_LINK =
  "css2?family=Funnel+Display:wght@400..700&family=Funnel+Sans:wght@400..600&family=DM+Mono:wght@400;500&display=swap";

test("admin redesign palette: dealt :root tokens present verbatim", () => {
  const lines = [
    "--p-bg: #ffffff; --p-surface: #f3f3f3; --p-ink: #232323; --p-muted: #686868;",
    "--p-accent: #a1ffcb; --p-accent-ink: #232323; --p-action: #232323; --p-action-ink: #ffffff;",
    "--p-inv-bg: #232323; --p-inv-surface: #303030; --p-inv-ink: #ffffff; --p-inv-muted: #a4a4a4;",
    "--p-inv-accent: #a1ffcb; --p-inv-accent-ink: #232323; --p-inv-action: #a1ffcb; --p-inv-action-ink: #232323;",
    '--font-display: "Funnel Display", system-ui, sans-serif;',
    '--font-text: "Funnel Sans", system-ui, sans-serif;',
    '--font-mono: "DM Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;',
    "--display-weight: 400; --display-tracking: -0.03em; --display-tracking-xl: -0.04em;",
    "--ly-scale: 0.98;",
  ];
  for (const line of lines) assert.ok(css.includes(line), `missing :root line: ${line}`);
});

test("admin redesign palette: no forbidden brand tokens remain in admin CSS", () => {
  for (const token of [
    "--pine",
    "--gold",
    "--gold-soft",
    "--red",
    "--jade",
    "--surface2",
    "--font-body",
    "--tracking-display",
  ]) {
    assert.ok(!css.includes(token), `forbidden token remains in admin.css: ${token}`);
  }
});

test("admin redesign palette: no forbidden hex values remain in admin CSS", () => {
  const lower = css.toLowerCase();
  for (const hex of [
    "#f3ecdf",
    "#c8452c",
    "#0b3d36",
    "#c9a24b",
    "#f7f3ec",
    "#1c1710",
    "#5d5344",
    "#8a7d68",
    "#ddd2bf",
    "#fdf3d7",
  ]) {
    assert.ok(!lower.includes(hex), `forbidden hex remains in admin.css: ${hex}`);
  }
});

test("admin redesign palette: Funnel font link in admin HTML, no Noto Serif SC", () => {
  for (const [name, html] of [
    ["dashboard.html", dashboardHtml],
    ["index.html", loginHtml],
  ]) {
    assert.ok(html.includes(FONT_LINK), `Funnel font link missing in admin/${name}`);
    assert.ok(!html.includes("Noto Serif SC"), `Noto Serif SC remains in admin/${name}`);
  }
  assert.ok(!css.includes("Noto Serif SC"), "Noto Serif SC remains in admin.css");
  assert.ok(!css.includes("Noto Sans SC"), "Noto Sans SC remains in admin.css");
});

test("admin redesign palette: admin type uses the dealt fonts, sidebar is inverse", () => {
  assert.ok(css.includes("font-family:var(--font-display)"), "headings must use --font-display");
  assert.ok(css.includes("font-family:var(--font-text)"), "body must use --font-text");
  assert.ok(css.includes("font-family:var(--font-mono)"), "codes must use --font-mono");
  assert.ok(
    css.includes("--sidebar-bg:var(--p-inv-bg)"),
    "sidebar background must be the inverse token --p-inv-bg (#232323)",
  );
  assert.ok(
    css.includes("--sidebar-active-bg:var(--p-inv-surface)"),
    "sidebar active background must be the inverse token --p-inv-surface (#303030)",
  );
});

test("admin redesign palette: thin scrollbar CSS present and wired to the sidebar", () => {
  for (const snippet of [
    ".thin-scroll",
    "scrollbar-width:thin",
    "scrollbar-color:",
    "::-webkit-scrollbar{width:6px;height:6px}",
    "::-webkit-scrollbar-track{background:transparent}",
    "::-webkit-scrollbar-thumb",
  ]) {
    assert.ok(css.includes(snippet), `scrollbar CSS missing: ${snippet}`);
  }
  assert.ok(
    sidebarJsx.includes('className="thin-scroll"'),
    "sidebar nav must carry the thin-scroll class",
  );
});

test("admin redesign palette: signal tokens defined, mint used sparingly", () => {
  assert.ok(css.includes("--signal-red:#d92d20"), "plain-red signal token missing");
  assert.ok(css.includes("--signal-yellow:#f59e0b"), "plain-amber signal token missing");
  // Mint is the selected/active accent only: the chips selected state
  // (background + border) is its single use on light surfaces.
  // (Match with the closing paren so --p-accent-ink is not counted.)
  const mintUses = (css.match(/var\(--p-accent\)/g) || []).length;
  assert.equal(mintUses, 2, `mint --p-accent must be used exactly twice, found ${mintUses}`);
  assert.ok(
    css.includes(".chips button.on{background:var(--p-accent);border-color:var(--p-accent);"),
    "mint must be the selected-chip accent",
  );
});
