// tests/header-overflow.test.mjs: customer header no longer overflows the
// viewport at 600/700/1100/1249 (Lam 2026-11-17).
// No server needed: all checks are source-level, same shape as
// tests/header-breadcrumb-groups.test.mjs.
//
// Covered: the header hamburger breakpoint moved 860 -> 1250 (nav collapses
// before the row can overflow); .topbar-in wraps at <=900px (not just
// <=560px); the 861-900 dead zone (nav hidden, no hamburger) is gone;
// the 大字模式 button STAYS (Lam first asked to remove it 11:51, then
// deferred it 11:57 "chưa cần" — this test locks the kept button in);
// brand 桂演 + tag stay; header buttons keep pill 999px + 44px height.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");

// The first @media(max-width:900px) block in main.css is the header one
// (later 900px blocks are hero-stats / foot-grid / brand). Slice from it to
// the next @media to inspect only the header rules.
function header900Block() {
  const css = read("web/assets/css/main.css");
  const start = css.indexOf("@media(max-width:900px){");
  assert.ok(start >= 0, "main.css must have a @media(max-width:900px) header rule");
  const next = css.indexOf("@media", start + 1);
  return css.slice(start, next < 0 ? undefined : next);
}

test("hamburger breakpoint is 1250, not 860 (nav collapses before overflow)", () => {
  const css = read("web/assets/css/main.css");
  assert.ok(css.includes("@media (max-width:1250px){"), "main.css must have a 1250px header media query");
  assert.ok(!css.includes("@media (max-width:860px){"), "the old 860px header media query must be gone");
  const block1250 = css.slice(
    css.indexOf("@media (max-width:1250px){"),
    css.indexOf("@media", css.indexOf("@media (max-width:1250px){") + 1),
  );
  assert.ok(block1250.includes(".menuBtn{display:inline-flex"), "menuBtn must show at <=1250px");
  assert.ok(
    block1250.includes(".mainnav{display:none;position:absolute"),
    "mainnav must hide into the absolute dropdown at <=1250px",
  );
  assert.ok(block1250.includes(".mainnav.open{display:flex"), "mainnav.open must show the dropdown");
});

test("topbar wraps at <=900px (not just <=560px)", () => {
  const block = header900Block();
  assert.ok(block.includes(".mainnav{display:none"), "nav stays hidden at <=900px");
  assert.ok(
    block.includes(".topbar-in{flex-wrap:wrap;height:auto"),
    ".topbar-in must wrap at <=900px",
  );
});

test("no dead zone 861-900: hamburger covers every width where nav hides", () => {
  const css = read("web/assets/css/main.css");
  // nav hides at <=900px (header 900 rule) and at <=1250px (dropdown rule);
  // the hamburger shows at <=1250px, so every width with a hidden nav has
  // a hamburger — there is no width left with neither.
  assert.ok(css.includes("@media (max-width:1250px){"), "hamburger rule must exist");
  assert.ok(header900Block().includes(".mainnav{display:none"), "nav must hide at <=900px");
});

test("大字模式 button stays (Lam deferred its removal 11:57, 'chưa cần')", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  assert.ok(chrome.includes("largetextbtn"), "Header must still render .largetextbtn");
  assert.ok(chrome.includes("setLargeTextState"), "Header must keep its largeText state");
  assert.ok(chrome.includes("isLargeText"), "isLargeText() helper must stay");
  assert.ok(chrome.includes("applyLargeText"), "applyLargeText() helper must stay");
});

test("large-text plumbing stays for voice-order (helpers, key, CSS, i18n)", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  assert.ok(chrome.includes("export function isLargeText()"), "isLargeText() must stay exported");
  assert.ok(chrome.includes("export function applyLargeText(on)"), "applyLargeText() must stay exported");
  assert.ok(chrome.includes('"guiyan-large-text"'), "guiyan-large-text storage key must stay");
  const app = read("web/assets/js/App.jsx");
  assert.ok(app.includes("isLargeText()"), "App.jsx must still pass large_text to voice-order");
  const css = read("web/assets/css/main.css");
  assert.ok(css.includes("html.large-text .topbar-in"), "html.large-text CSS rule must stay");
  const data = read("web/assets/js/data.js");
  assert.equal(
    (data.match(/largeText:/g) || []).length,
    3,
    "largeText i18n key must stay in the 3 full languages (zh/vi/en)",
  );
});

test("brand and the other header controls are untouched", () => {
  const chrome = read("web/assets/js/chrome.jsx");
  assert.ok(chrome.includes('className="brand"'), "brand link must stay");
  assert.ok(chrome.includes("桂演"), "brand 桂演 must stay");
  for (const cls of ["menuBtn", "mainnav", "langsel", "themebtn", "wxbtn", "cartbtn", "user-chip", "user-menu"]) {
    assert.ok(chrome.includes(cls), `Header must still render ${cls}`);
  }
});

test("header buttons keep pill 999px + 44px height", () => {
  const css = read("web/assets/css/main.css");
  assert.ok(css.includes(".user-chip{display:inline-flex"), "user-chip rule must stay");
  assert.ok(css.includes("border-radius:999px;height:44px"), "header pill buttons must stay 999px / 44px");
  assert.ok(css.includes(".cartbtn{display:inline-flex"), "cartbtn rule must stay");
});
