// Admin redesign palette tests (Item 1: palette + tokens + scrollbar) —
// pure source-grep assertions, no server and no database needed. The
// admin dashboard is pure white + neutral gray scale with one accent
// (#3e63dd, the primary action colour) and one money green (#0f7f57);
// the old cream / orange / dark-green brand tokens must be gone from
// admin CSS. Customer web + mini-program keep their own brand and are
// not covered here.
//
// 2026-11-16 dashboard redesign (Lam-approved, D2 + prep §1 token
// mapping): the dealt palette of the 2026-11-15 design-polish round
// was replaced — mint #a1ffcb is gone as the accent, black #232323 is
// gone as the action colour, --p-bg split into page #f8f8f6 / card
// #ffffff, --p-inv-bg split into sidebar side #f3f3f1 / toast+skip-link
// tip #1f2530, and the dead tokens (--p-inv-surface, --p-inv-action,
// --p-inv-action-ink, --p-inv-accent-ink, --ly-scale) were deleted.
// The expectations below pin the NEW palette, not the old one.
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
  // Dashboard redesign palette (2026-11-16, Lam-approved): page/card
  // split, ink #17171a, accent #3e63dd as the action colour, tip
  // #1f2530 for toast/skip-link. The 2026-11-15 values (page #ffffff,
  // ink #232323, mint accent #a1ffcb, black action #232323, inverse
  // #232323/#303030) are superseded — see the header comment.
  const lines = [
    "--p-bg: #f8f8f6; --p-card: #ffffff; --p-surface: #f1f1ef;",
    "--p-ink: #17171a; --p-ink-2: #48484d; --p-muted: #66666d;",
    "--p-accent: #3e63dd; --p-accent-ink: #17171a;",
    "--p-money: #0f7f57; --p-up: #0f7f57; --p-down: #d23f45; --p-warn: #c98a00;",
    "--p-tip: #1f2530; --p-live: #12a150;",
    "--p-action: #3e63dd; --p-action-ink: #ffffff;",
    "--p-inv-bg: #1f2530; --p-inv-ink: #ffffff;",
    "--p-inv-accent: #3e63dd;",
    '--font-display: "Funnel Display", system-ui, sans-serif;',
    '--font-text: "Funnel Sans", system-ui, sans-serif;',
    '--font-mono: "DM Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;',
    "--display-weight: 400; --display-tracking: -0.03em; --display-tracking-xl: -0.04em;",
  ];
  for (const line of lines) assert.ok(css.includes(line), `missing :root line: ${line}`);
  // Dead tokens deleted by the redesign (prep §1.4) must stay gone.
  for (const dead of ["--ly-scale", "--p-inv-surface", "--p-inv-action", "--p-inv-accent-ink"]) {
    assert.ok(!css.includes(dead), `dead token remains in admin.css: ${dead}`);
  }
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
  // Lam-approved exception (admin-overview round, plan §2): the order-status
  // palette reuses the customer brand pine/gold/cinnabar, but ONLY as
  // --brand-* tokens in :root — never as raw hex anywhere else. Strip the
  // token lines before the ban check so the exception stays scoped.
  const withoutBrandTokens = lower
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--brand-"))
    .join("\n");
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
    assert.ok(
      !withoutBrandTokens.includes(hex),
      `forbidden hex remains in admin.css: ${hex}`,
    );
  }
});

test("admin redesign palette: status-palette brand hexes occur only in :root --brand-* tokens", () => {
  // Scope guard for the exception above: every approved status-palette hex
  // must live on a --brand-* token line, never scattered in a rule.
  const lines = css.toLowerCase().split("\n");
  for (const hex of [
    "#0b3d36",
    "#dcefe9",
    "#a97e1c",
    "#f1e5c3",
    "#7c5e14",
    "#e9d8a6",
    "#6b5312",
    "#b03a1e",
    "#f6e3d8",
  ]) {
    for (const line of lines) {
      if (line.includes(hex)) {
        assert.ok(
          line.trimStart().startsWith("--brand-"),
          `status hex ${hex} outside a --brand-* token line: ${line.trim()}`,
        );
      }
    }
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

test("admin redesign palette: admin type uses the dealt fonts, sidebar is a light side panel", () => {
  assert.ok(css.includes("font-family:var(--font-display)"), "headings must use --font-display");
  assert.ok(css.includes("font-family:var(--font-text)"), "body must use --font-text");
  assert.ok(css.includes("font-family:var(--font-mono)"), "codes must use --font-mono");
  // Redesign 2026-11-16 (prep §1): --p-inv-bg split — the sidebar is
  // NO LONGER the dark inverse panel (#232323); it is a light side
  // panel #f3f3f1, and its selected state is an accent tint with INK
  // text (never accent text on tint — contrast rule #5).
  assert.ok(
    css.includes("--sidebar-bg:#f3f3f1"),
    "sidebar background must be the light side token #f3f3f1",
  );
  assert.ok(
    css.includes("--sidebar-active-bg:rgba(62,99,221,0.08)"),
    "sidebar active background must be the accent tint",
  );
  assert.ok(
    css.includes(".sidebar nav button.on{background:var(--sidebar-active-bg);color:var(--sidebar-text)}"),
    "sidebar selected item must use ink text on the accent tint",
  );
});

test("admin redesign palette: thin scrollbar CSS present and wired to the sidebar", () => {
  for (const snippet of [
    ".thin-scroll",
    "::-webkit-scrollbar{width:6px;height:6px}",
    "::-webkit-scrollbar-track{background:transparent}",
    "::-webkit-scrollbar-thumb",
  ]) {
    assert.ok(css.includes(snippet), `scrollbar CSS missing: ${snippet}`);
  }
  // No standard scrollbar properties: Chromium ignores ::-webkit-scrollbar
  // whenever one is set on the element, so the 6px rule would never apply
  // (item 1 CDP FAIL, 2026-11-15 — the .thin-scroll rule used to set them).
  for (const prop of ["scrollbar-width", "scrollbar-color"]) {
    assert.ok(!css.includes(prop), `standard ${prop} must not be in admin.css (kills webkit 6px)`);
  }
  assert.ok(
    sidebarJsx.includes('className="thin-scroll"'),
    "sidebar nav must carry the thin-scroll class",
  );
});

test("admin redesign palette: signal tokens defined, accent is the primary action colour (D2)", () => {
  // Signal tokens follow the down/warn tokens of the redesign palette.
  assert.ok(css.includes("--signal-red:#d23f45"), "plain-red signal token missing");
  assert.ok(css.includes("--signal-yellow:#c98a00"), "plain-amber signal token missing");
  // Mint is gone as the accent: #3e63dd is now the primary action
  // colour (D2) — used for buttons, focus, sort active and checkbox
  // accent-color via --p-action, not sparingly.
  const actionUses = (css.match(/var\(--p-action\)/g) || []).length;
  assert.ok(actionUses >= 10, `accent action --p-action must be used widely, found ${actionUses}`);
  assert.ok(
    css.includes(".chips button.on{background:var(--p-accent-tint);border-color:var(--p-accent-ring);color:var(--p-accent-ink)}"),
    "selected chips must use the accent tint + ring with ink text (never accent text on tint)",
  );
});

test("admin redesign palette: header buttons stay 4px (pill is customer-web only, Lam 2026-11-16 ~20:13)", () => {
  // Lam 2026-11-16 ~20:13 pill decision covers the CUSTOMER-web
  // header only. The admin AppHeader buttons keep the 4px control
  // pattern like every other admin button, input and popup, so this
  // test pins 4px (and explicitly forbids pill) on all five rules.
  for (const rule of [
    ".app-header .home-link{",
    ".bell-btn{",
    ".theme-btn{",
    ".op-card button{",
    ".menu-btn{",
  ]) {
    const line = css.split("\n").find((l) => l.includes(rule));
    assert.ok(line, `header rule missing: ${rule}`);
    assert.ok(line.includes("border-radius:4px"), `admin header button must stay 4px: ${rule}`);
    assert.ok(!line.includes("border-radius:999px"), `admin header button must not be pill: ${rule}`);
  }
});
