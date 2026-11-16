// Account layout (2026-11-16) — left vertical nav + right content frame.
// The 10 account tabs are one vertical column on the left (240px, no
// separators, active = black fill, inbox badge kept); each tab's content
// sits in one square frame on the right. At <=860px the nav becomes a
// horizontal scrollable row above the content. The white design
// (Lam 2026-11-16): the shared light tokens are fresh white #ffffff +
// neutral light grey #f3f3f3 — NO warm paper on home, the account page
// or the brand page; red/gold/pine accents and the dark hero stay.
// Dark mode is untouched.
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userJsx = fs.readFileSync(
  path.join(repoDir, "web", "assets", "js", "UserDashboard.jsx"),
  "utf-8",
);
const mainCss = fs.readFileSync(
  path.join(repoDir, "web", "assets", "css", "main.css"),
  "utf-8",
);

test("account layout JSX: tabs + content wrapped in layout + frame", () => {
  assert.ok(userJsx.includes('<div className="acct-layout">'), "tabs + content sit in .acct-layout");
  assert.ok(userJsx.includes('<div className="acct-frame">'), "tab content sits in .acct-frame");
  assert.ok(
    userJsx.indexOf('className="acct-layout"') < userJsx.indexOf('className="acct-tabs"'),
    "layout opens before the tab list",
  );
  assert.ok(
    userJsx.indexOf('className="acct-frame"') < userJsx.indexOf('{acctTab === "info"'),
    "frame opens before the first tab panel",
  );
  assert.ok(userJsx.includes('role="tablist"'), "tab list keeps its tablist role");
  assert.ok(userJsx.includes('className="pill paid"'), "inbox badge keeps its pill class");
  assert.ok(!userJsx.includes('marginLeft: 6'), "badge no longer carries an inline left margin");
});

test("account tabs: still 10 tabs, logic untouched", () => {
  const tabs = userJsx.match(/\["(info|password|email|phone|social|orders|favs|demands|inbox|settings)",/g);
  assert.ok(tabs && tabs.length === 10, "ACCT_TABS still lists exactly the 10 tabs");
  assert.ok(userJsx.includes("readTabFromUrl"), "?tab= deep links still read from the URL");
  assert.ok(userJsx.includes("switchTab(id)"), "tab switching still goes through switchTab");
});

test("account layout CSS: vertical nav 240px, no separators, black active", () => {
  assert.ok(mainCss.includes(".acct-layout{display:flex;gap:24px;align-items:flex-start}"), "layout is a 2-column flex row");
  assert.ok(
    mainCss.includes(".acct-tabs{display:flex;flex-direction:column;gap:2px;flex:none;width:240px;margin:0}"),
    "tabs are a vertical 240px column",
  );
  assert.ok(
    mainCss.includes(".acct-tab{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;text-align:left;border:0;background:transparent;color:var(--ink);border-radius:4px;padding:11px 14px;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap}"),
    "tabs are full-width left-aligned rows with no border",
  );
  assert.ok(mainCss.includes(".acct-tab.on{background:var(--ink);color:var(--bg)}"), "active tab keeps the black fill");
  assert.ok(mainCss.includes(".acct-tab .pill{margin-left:auto}"), "inbox badge is pushed to the row's right edge");
  assert.ok(
    mainCss.includes(".acct-frame{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:24px}"),
    "content frame is a bordered square on the right",
  );
  assert.ok(mainCss.includes(".acct-tab:hover{background:var(--surface2)}"), "tab hover is the light grey surface");
});

test("white design: shared light tokens are white/neutral grey, no warm paper", () => {
  // One token change covers home + account + brand (they share main.css).
  assert.ok(
    mainCss.includes("--bg:#ffffff; --bg2:#f3f3f3; --surface:#ffffff; --surface2:#f3f3f3;"),
    "light tokens: page/surface are fresh white #ffffff, fills are grey #f3f3f3",
  );
  assert.ok(mainCss.includes("--line:#dcdcdc; --line2:#c9c9c9;"), "light borders are neutral grey");
  assert.ok(!mainCss.includes("--bg:#f7f3ec"), "warm paper page background is gone");
  assert.ok(!mainCss.includes("--surface:#fffdf8"), "warm surface is gone");
  assert.ok(!mainCss.includes("--bg2:#efe8db"), "warm bg2 is gone");
  assert.ok(!mainCss.includes("--surface2:#f3ecdf"), "warm surface2 is gone");
  assert.ok(!mainCss.includes("--line:#ddd2bf"), "warm line is gone");
  assert.ok(!mainCss.includes("--line2:#cbbd9f"), "warm line2 is gone");
  assert.ok(mainCss.includes("--acct-bg") === false, "no separate account-area tokens — the shared tokens cover it");
});

test("white design: accents and the dark hero are kept", () => {
  assert.ok(mainCss.includes("--red:#b03a1e"), "red accent kept");
  assert.ok(mainCss.includes("--gold:#a97e1c"), "gold accent kept");
  assert.ok(mainCss.includes("--jade:#0d6e5f"), "pine accent kept");
  assert.ok(mainCss.includes("--night:#12100d"), "dark hero kept");
  assert.ok(mainCss.includes(".hero{position:relative;background:var(--night);color:var(--cream);overflow:hidden}"), "hero still renders on the dark night surface");
});

test("account layout responsive: nav becomes a scrollable row at <=860px", () => {
  assert.ok(mainCss.includes("@media(max-width:860px){"), "an 860px breakpoint exists");
  assert.ok(mainCss.includes(".acct-layout{flex-direction:column;gap:16px}"), "layout stacks below 860px");
  assert.ok(
    mainCss.includes(".acct-tabs{flex-direction:row;flex-wrap:nowrap;overflow-x:auto;width:100%}"),
    "tabs become one horizontal scrollable row below 860px",
  );
  assert.ok(mainCss.includes(".acct-frame{width:100%;box-sizing:border-box;padding:20px}"), "frame goes full-width below 860px");
});

test("dark mode tokens are untouched by the white design", () => {
  assert.ok(
    mainCss.includes("--bg:#100e0b; --bg2:#171410; --surface:#1c1915; --surface2:#242019;"),
    "manual dark theme keeps its own tokens",
  );
  assert.ok(mainCss.includes('@media (prefers-color-scheme:dark){'), "system dark mode block still exists");
});
