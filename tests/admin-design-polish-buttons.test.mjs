// Design polish Step 2 — one button system (admin): 3 sizes (sm/md/lg),
// 4 variants (primary / secondary / danger-soft / ghost), one gap token
// for every button group, and a scale press feedback instead of the old
// translateY jump. The five old class names stay so no call site changes.
// Lam 2026-11-16 16:45 (admin-overview round, plan §1.6, Q4(a)): the
// sizes/radii below follow the one template — 44px standard (36px dense),
// 4px radius, one focus ring — for every button and input.
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

test("buttons gap tokens: one sm token and one md/lg token", () => {
  assert.ok(css.includes("--btn-gap-sm:8px; --btn-gap:12px;"), "gap tokens must exist in :root");
  assert.ok(css.includes(".row-actions{display:flex;gap:var(--btn-gap-sm);white-space:nowrap}"), "row actions use the sm gap");
  assert.ok(css.includes(".contract-actions{display:flex;gap:var(--btn-gap);flex-wrap:wrap}"), "modal footers use the md/lg gap");
  assert.ok(css.includes(".search-row{margin-bottom:14px;display:flex;gap:var(--btn-gap);align-items:flex-end;flex-wrap:wrap}"), "filter rows use the md/lg gap");
  assert.ok(css.includes(".search-row .search-box{flex:0 1 340px;min-width:0}"), "search box keeps its 340px basis inside the flex filter row");
});

test("buttons sizes: lg primary, md filter, sm row actions", () => {
  // Lam 2026-11-16 16:45 (plan §1.6, Q4(a)): one 44px / 4px template —
  // lg + md are both 44px tall with a 4px radius, the dense row buttons
  // are 36px with the same 4px radius (was 9px radius, 40px md, 30px sm).
  assert.ok(css.includes(".btn-export{margin-left:auto;border:0;border-radius:4px;background:var(--p-action);color:var(--p-action-ink);font-weight:700;font-size:13.5px;padding:13px 18px;white-space:nowrap;min-height:44px}"), "btn-export is the lg primary (44px)");
  assert.ok(css.includes(".btn-md{border:1px solid var(--line2);border-radius:4px;background:var(--p-bg);color:var(--p-ink);font-weight:700;font-size:13.5px;padding:10px 16px;white-space:nowrap;min-height:44px}"), "btn-md is the md secondary (44px)");
  for (const rule of [
    ".btn-view,.mini{border:1px solid var(--line2);background:var(--p-bg);color:var(--p-ink);border-radius:4px;font-weight:700;font-size:12px;padding:6px 14px;white-space:nowrap;min-height:36px}",
    ".btn-approve{border:0;border-radius:4px;background:var(--p-action);color:var(--p-action-ink);font-weight:700;font-size:12px;padding:6px 14px;min-height:36px}",
    ".btn-reject{border:1px solid var(--line2);background:var(--signal-red-soft);color:var(--signal-red-deep);border-radius:4px;font-weight:700;font-size:12px;padding:6px 14px;min-height:36px}",
  ]) {
    assert.ok(css.includes(rule), "sm row button must be 36px: " + rule.slice(0, 20));
  }
  assert.ok(css.includes(".btn-resolve{border:1px solid var(--line2);background:var(--p-bg);border-radius:4px;padding:6px 14px;font-size:12px;font-weight:700;color:var(--p-ink);min-height:36px}"), "btn-resolve joins the sm size (was 13.5px)");
});

test("buttons line-height: pinned to 1 so min-height governs the size", () => {
  // Lam 2026-11-16 16:45 (plan §1.6, Q4(a)): the pin now also covers
  // .mini, which shares the .btn-view rule in the one template.
  assert.ok(
    css.includes(".btn-export,.btn-md,.btn-ghost,.btn-view,.mini,.btn-approve,.btn-reject,.btn-resolve{line-height:1}"),
    "button line-height must be pinned to 1 — body 1.6 pushed lg to 48px",
  );
});

test("buttons variants: primary / secondary / danger-soft / ghost all defined", () => {
  assert.ok(css.includes(".btn-md:hover{background:var(--p-surface)}"), "md secondary hovers grayer");
  // Lam 2026-11-16 16:45 (plan §1.6, Q4(a)): ghost follows the one
  // template — 4px radius, 44px tall (was 9px radius, 40px).
  assert.ok(css.includes(".btn-ghost{border:0;border-radius:4px;background:transparent;color:var(--p-ink);font-weight:700;font-size:13.5px;padding:10px 16px;white-space:nowrap;min-height:44px}"), "ghost variant exists for subtle inline actions");
  assert.ok(css.includes(".btn-reject:hover{background:var(--signal-red-soft-deep)}"), "danger-soft keeps its deeper hover");
  assert.ok(css.includes(".btn-export:disabled{opacity:.6;cursor:default}"), "disabled primary dims to .6");
});

test("buttons press: scale(.97) with a 160ms transition, no more jump", () => {
  assert.ok(!css.includes("translateY(2px)"), "the old translateY press jump must be gone");
  assert.ok(
    css.includes("transform:scale(.97)}"),
    "press feedback must scale to .97",
  );
  assert.ok(
    css.includes("transition:background-color 140ms var(--ease-out),border-color 140ms var(--ease-out),color 140ms var(--ease-out),transform 160ms var(--ease-out)}"),
    "press + hover transitions must name their properties with the ease-out token",
  );
  for (const cls of ["btn-view", "btn-md", "btn-ghost", "op-card button", "bell-btn", "menu-btn", "search-clear", "bell-view-all", "inline-mark"]) {
    assert.ok(css.includes(cls + ":active"), "press feedback must cover: " + cls);
  }
});

test("buttons filter action: the venues lookup uses the md size", () => {
  assert.ok(
    dashboardJsx.includes('<button type="button" className="btn-md" disabled={availBusy}'),
    "查空闲 must use btn-md, not the lg primary",
  );
});

test("buttons test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-design-polish-buttons.test.mjs"),
    "server/package.json test script must run tests/admin-design-polish-buttons.test.mjs",
  );
});
