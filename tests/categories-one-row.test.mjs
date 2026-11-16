// Categories in one row (2026-11-16): home .catrail is 11 columns / 1 row
// on desktop (>=1240px; 5 cols <=1240, 3 <=900, 2 <=560), the #catFilters
// chip row is one row with horizontal scroll instead of wrapping, and the
// admin resources view gets a one-row category chip filter (All + 11)
// that filters on r.category like home. Tile/chip content is unchanged.
// CATS has 11 entries (the 11th is show-license); the first version of
// this file said 10 and the catrail wrapped the last tile — fixed 2026-11-16.
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainCss = fs.readFileSync(
  path.join(repoDir, "web", "assets", "css", "main.css"),
  "utf-8",
);
const adminCss = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const adminJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);

// Basis (2026-11-16, Lam "làm theo mặc định", Q1–Q5 all (a)): the
// grid-tile catrail is replaced by the icon + seamless rail — one flex
// row on a shared background, horizontal scroll on narrow screens, no
// 5/3/2-column breakpoints, no absolute count badge, zh label 15px on
// one line. The gold proportion bar is the only tile chrome kept.
test("home categories: one seamless icon rail, one row, scrolls on narrow screens", () => {
  assert.ok(mainCss.includes(".catrail{display:flex;background:var(--surface2);"), "catrail is one flex rail on a shared background");
  assert.ok(mainCss.includes("overflow-x:auto"), "catrail scrolls horizontally instead of wrapping");
  assert.ok(!mainCss.includes(".catrail{display:grid"), "catrail must not be a grid any more");
  assert.ok(!mainCss.includes("@media(max-width:1240px){.catrail"), "old 5-column catrail breakpoint still present");
  assert.ok(!mainCss.includes("@media(max-width:900px){.catrail"), "old 3-column catrail breakpoint still present");
  assert.ok(!mainCss.includes("@media(max-width:560px){.catrail"), "old 2-column catrail breakpoint still present");
  assert.ok(mainCss.includes(".cat .zh{display:block;font-size:15px;font-weight:700;white-space:nowrap;"), "tile name is 15px on one line");
  assert.ok(mainCss.includes(".cat .bar{display:block;height:3px;border-radius:99px;background:var(--line);margin-top:10px;overflow:hidden}"), "tile gold bar is kept (display:block: .bar is a span, the old generic .cat span rule is gone)");
  assert.ok(!mainCss.includes(".cat b{"), "tile count badge rule must be gone");
  assert.ok(mainCss.includes(".cat .count{display:block;color:var(--ink3);font-size:11.5px;"), "count is small text below the label");
});

test("home catalog chip row: one row, horizontal scroll, chips keep width", () => {
  assert.ok(mainCss.includes("#catFilters{flex-wrap:nowrap;overflow-x:auto}"), "catFilters does not wrap and scrolls horizontally");
  assert.ok(mainCss.includes("#catFilters .chip{flex:none}"), "chips keep their natural width instead of shrinking");
});

test("admin resources: category chip filter state + logic", () => {
  assert.ok(adminJsx.includes('const [resCatFilter, setResCatFilter] = useState("all");'), "category filter state defaults to all");
  assert.ok(
    adminJsx.includes('(resCatFilter === "all" || r.category === resCatFilter)'),
    "filteredResources filters on r.category like home",
  );
  assert.ok(adminJsx.includes('className="chips res-cat-row"'), "chip row reuses the admin .chips style in one row");
  assert.ok(adminJsx.includes('aria-label="按分类筛选"'), "chip row is labelled");
  assert.ok(adminJsx.includes('data-c="all"'), "All chip carries data-c=all");
  assert.ok(adminJsx.includes("{CATS.map(([id, name]) => ("), "chip row renders all 11 categories from CATS");
  assert.ok(adminJsx.includes("onClick={() => setResCatFilter(id)}"), "a category chip sets the filter");
});

test("admin category chip row CSS: one row, horizontal scroll", () => {
  assert.ok(adminCss.includes(".res-cat-row{flex-wrap:nowrap;overflow-x:auto}"), "admin chip row does not wrap and scrolls horizontally");
  assert.ok(adminCss.includes(".res-cat-row button{flex:none}"), "admin chips keep their natural width");
});
