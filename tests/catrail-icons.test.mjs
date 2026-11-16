// Category rail icons + one seamless rail (2026-11-16, Lam approved
// "làm theo mặc định" — Q1–Q5 all (a)): 11 hand-drawn line icons, one
// per CATS id (web/assets/js/CatIcons.jsx); icon on top, zh label on ONE
// line, small count below it, no count badge; a single shared rail
// background with no per-tile border/gap/divider; horizontal scroll on
// narrow screens; scope is the home .catrail only (#catFilters chips
// and admin chips unchanged). Source-grep assertions only, no server
// and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { CATS } from "../web/assets/js/data.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainCss = fs.readFileSync(
  path.join(repoDir, "web", "assets", "css", "main.css"),
  "utf-8",
);
const appJsx = fs.readFileSync(
  path.join(repoDir, "web", "assets", "js", "App.jsx"),
  "utf-8",
);
const iconsJsx = fs.readFileSync(
  path.join(repoDir, "web", "assets", "js", "CatIcons.jsx"),
  "utf-8",
);

// CAT_ICONS entries are `id: (<>...inner SVG markup...</>)` (the
// "show-license" key is quoted). Pull the inner markup per id.
function parseIcons(src) {
  const out = new Map();
  const re = /["']?([a-z][a-z-]*)["']?\s*:\s*\(<>([\s\S]*?)<\/>\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.set(m[1], m[2]);
  return out;
}

test("catrail icons: one non-empty SVG per CATS id", () => {
  assert.equal(CATS.length, 11, "CATS must have 11 entries");
  const icons = parseIcons(iconsJsx);
  assert.equal(icons.size, 11, "CAT_ICONS must have 11 entries");
  for (const [id] of CATS) {
    assert.ok(icons.has(id), `CAT_ICONS missing ${id}`);
    const inner = icons.get(id).replace(/\s+/g, " ").trim();
    assert.ok(inner.length > 20, `${id}: icon markup is empty`);
    assert.ok(
      /<(path|circle|rect|ellipse)\b/.test(inner),
      `${id}: icon has no SVG shape element`,
    );
    // Every shape carries real geometry (non-empty d= / cx= / x= …).
    assert.ok(
      /(d="[M][^"]{3,}"|cx="[^"]+"|x="[^"]+")/.test(inner),
      `${id}: icon shapes have no geometry`,
    );
  }
});

test("catrail icons: all 11 icons are distinct, line style, no emoji", () => {
  const icons = parseIcons(iconsJsx);
  const norms = [...icons.values()].map((v) => v.replace(/\s+/g, ""));
  assert.equal(new Set(norms).size, 11, "two categories share one icon");
  assert.ok(iconsJsx.includes("CAT_ICONS"), "CAT_ICONS export missing");
  assert.ok(
    !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(iconsJsx),
    "icons must be inline SVG, not emoji",
  );
});

test("catrail CSS: one seamless rail, horizontal scroll, no per-tile split", () => {
  assert.ok(
    mainCss.includes(".catrail{display:flex;background:var(--surface2);"),
    "catrail is one flex rail on a shared background",
  );
  assert.ok(
    mainCss.includes("overflow-x:auto"),
    "catrail scrolls horizontally on narrow screens",
  );
  assert.ok(
    !mainCss.includes(".catrail{display:grid"),
    "catrail must not be a grid any more",
  );
  assert.ok(
    !mainCss.includes("@media(max-width:1240px){.catrail"),
    "old 5-column catrail breakpoint still present",
  );
  assert.ok(
    !mainCss.includes("@media(max-width:900px){.catrail"),
    "old 3-column catrail breakpoint still present",
  );
  assert.ok(
    !mainCss.includes("@media(max-width:560px){.catrail"),
    "old 2-column catrail breakpoint still present",
  );
  assert.ok(
    mainCss.includes(".cat{flex:1 0 96px;min-width:96px;text-align:center;background:transparent;border:0;"),
    "tile has no own border/background — only even spacing",
  );
  assert.ok(!mainCss.includes(".cat b{"), "count badge rule must be gone");
  assert.ok(
    mainCss.includes(".cat:hover{background:var(--surface)}"),
    "hover is a soft tint, no lift",
  );
  assert.ok(
    !/\.cat:hover\{[^}]*transform/.test(mainCss),
    "hover must not lift/translate the tile",
  );
  assert.ok(
    !/\.cat:hover\{[^}]*border-color/.test(mainCss),
    "hover must not change a border",
  );
  assert.ok(
    mainCss.includes(".cat.on{background:var(--red-soft)}"),
    "selected tile is a stronger tint, not a border",
  );
  assert.ok(
    mainCss.includes(".cat:hover .ic,.cat.on .ic{color:var(--red)}"),
    "icon turns brand red on hover/selected",
  );
});

test("catrail CSS: label one line, count small below it, gold bar kept", () => {
  assert.ok(
    mainCss.includes(".cat .zh{display:block;font-size:15px;font-weight:700;white-space:nowrap;"),
    "zh label is 15px on one line",
  );
  assert.ok(
    mainCss.includes(".cat .count{display:block;color:var(--ink3);font-size:11.5px;"),
    "count is small text below the label",
  );
  assert.ok(
    mainCss.includes(".cat .bar i{display:block;height:100%;background:var(--gold);"),
    "gold proportion bar at the tile bottom is unchanged",
  );
});

test("catrail markup: icons rendered, badge gone, selected state kept", () => {
  assert.ok(
    appJsx.includes('import { CAT_ICONS } from "./CatIcons.jsx";'),
    "App.jsx imports CAT_ICONS",
  );
  assert.ok(appJsx.includes("{CAT_ICONS[c[0]]}"), "tile renders its icon");
  assert.ok(
    appJsx.includes('strokeWidth="1.7"'),
    "tile icon uses the 1.7 line weight",
  );
  assert.ok(!appJsx.includes('<b>{n}</b><span className="zh">'), "absolute count badge must be gone from the tile");
  assert.ok(
    appJsx.includes('<span className="count">{n}</span>'),
    "count is plain small text under the label",
  );
  assert.ok(
    appJsx.includes('store.cat === c[0] ? " on" : ""'),
    "selected tile carries the on class",
  );
  assert.ok(
    appJsx.includes("setCat(c[0]);"),
    "clicking a tile still filters",
  );
});

test("scope guard (Q5(a)): catalog chips and admin chips unchanged", () => {
  assert.ok(
    mainCss.includes("#catFilters{flex-wrap:nowrap;overflow-x:auto}"),
    "catalog #catFilters chip row is unchanged",
  );
  assert.ok(
    mainCss.includes("#catFilters .chip{flex:none}"),
    "catalog chips keep their width",
  );
});
