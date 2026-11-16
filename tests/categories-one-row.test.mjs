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

test("home categories: 11 columns in one row on desktop", () => {
  assert.ok(mainCss.includes(".catrail{display:grid;grid-template-columns:repeat(11,1fr);gap:12px}"), "catrail is 11 columns on desktop");
  assert.ok(mainCss.includes("@media(max-width:1240px){.catrail{grid-template-columns:repeat(5,1fr)}}"), "catrail drops to 5 columns at <=1240px");
  assert.ok(mainCss.includes("@media(max-width:900px){.catrail{grid-template-columns:repeat(3,1fr)}}"), "catrail drops to 3 columns at <=900px");
  assert.ok(mainCss.includes("@media(max-width:560px){.catrail{grid-template-columns:repeat(2,1fr)}}"), "catrail drops to 2 columns at <=560px");
  assert.ok(mainCss.includes(".cat .zh{font-size:21px;font-weight:900;display:block}"), "tile name is unchanged");
  assert.ok(mainCss.includes(".cat .bar{height:3px;border-radius:99px;background:var(--surface2);margin-top:12px;overflow:hidden}"), "tile gold bar is unchanged");
  assert.ok(mainCss.includes(".cat b{position:absolute;top:14px;right:14px;"), "tile count badge is unchanged");
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
