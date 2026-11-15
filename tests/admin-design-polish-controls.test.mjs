// Design polish Step 1 — one shared control system (admin): every text /
// number / date / select / textarea control gets the same 44px base, one
// focus ring, a custom select chevron, hidden number spinners and a styled
// date indicator. The five old scattered rules are folded into the base +
// variants; the login card keeps its own look. Source-grep assertions only,
// no server and no database needed.
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

test("controls base: one shared rule for input/select/textarea at 44px", () => {
  assert.ok(
    css.includes("input,select,textarea{font:inherit;font-size:13.5px;color:var(--p-ink);background:var(--p-bg);border:1px solid var(--line2);border-radius:9px;outline:none}"),
    "shared control base must exist",
  );
  assert.ok(css.includes("input,select{height:44px;padding:0 12px}"), "base height must be 44px");
  assert.ok(css.includes("textarea{height:auto;min-height:88px;padding:10px 12px;resize:vertical}"), "textarea keeps auto height + vertical resize");
  assert.ok(css.includes("input:disabled,select:disabled,textarea:disabled{opacity:.6;cursor:default}"), "disabled controls dim to .6");
});

test("controls focus: one ring for every control, same as login/search had", () => {
  assert.ok(
    css.includes("input:focus,select:focus,textarea:focus{border-color:var(--p-action);box-shadow:0 0 0 3px rgba(35,35,35,0.12)}"),
    "unified focus ring must exist",
  );
  // No control keeps its own divergent focus rule.
  assert.ok(!css.includes(".search-input input:focus"), "search focus must come from the base rule");
  assert.ok(!css.includes(".login-card input:focus"), "login focus must come from the base rule");
});

test("controls select: custom chevron, native dropdown kept", () => {
  assert.ok(css.includes("select{appearance:none;-webkit-appearance:none;"), "select must hide the native arrow");
  assert.ok(css.includes("background-position:right 12px center;background-size:12px;padding-right:32px}"), "chevron sits 12px from the right with room for it");
  assert.ok(css.includes("data:image/svg+xml"), "chevron is an inline SVG, not an asset file");
  assert.ok(css.includes("select:disabled{background-image:url(\"data:image/svg+xml"), "disabled select gets a dimmer chevron");
  // No custom dropdown is built: selects stay native <select> elements.
  assert.ok(!dashboardJsx.includes("custom-select") && !dashboardJsx.includes("CustomSelect"), "dropdowns stay native selects");
});

test("controls number: tabular numerals, native spinners hidden", () => {
  assert.ok(css.includes("input[type=\"number\"]{font-variant-numeric:tabular-nums}"), "numbers use tabular figures");
  assert.ok(css.includes("input[type=\"number\"]::-webkit-outer-spin-button"), "webkit spinners hidden");
  assert.ok(css.includes("input[type=\"number\"]{-moz-appearance:textfield;appearance:textfield}"), "firefox spinner hidden");
});

test("controls date: picker indicator styled, 4 date inputs covered by the base", () => {
  assert.ok(css.includes("input[type=\"date\"]::-webkit-calendar-picker-indicator{opacity:.55;cursor:pointer}"), "date indicator must be muted, not raw native");
  for (const snippet of [
    '<input type="date" className="field-sm" value={availDate}',
    '<input type="date" value={licForm.start_at}',
    '<input type="date" value={licForm.end_at}',
    '<input type="date" value={eventDate}',
  ]) {
    assert.ok(dashboardJsx.includes(snippet), "date input must exist: " + snippet);
  }
});

test("controls sm variant: 36px for dense rows, used on the venues filter row", () => {
  assert.ok(css.includes(".field-sm{height:36px;padding:0 10px;font-size:13px}"), "sm variant must be 36px");
  assert.ok(css.includes("select.field-sm{padding-right:28px}"), "sm select keeps room for the chevron");
  assert.ok(dashboardJsx.includes('<select className="field-sm" value={availVenueId}'), "venues filter select uses field-sm");
});

test("controls cleanup: the five old scattered rules are folded, login keeps its look", () => {
  assert.ok(css.includes(".login-card input{width:100%;border:1px solid var(--line2);border-radius:9px;padding:12px 14px;font-size:15px;background:var(--p-bg);color:var(--p-ink);margin-bottom:14px;outline:none;height:auto}"), "login input keeps its own look (height:auto preserves it under the 44px base)");
  assert.ok(css.includes(".modal-form input{width:100%;margin-top:4px}"), "modal form keeps only width + margin");
  assert.ok(css.includes(".tag-rule input[type=\"text\"],.tag-rule input[type=\"number\"],.tag-rule select{height:36px;max-width:220px}"), "fieldset editors use the sm geometry");
  assert.ok(css.includes(".op-row input{flex:1}"), "operator row keeps only flex:1");
  assert.ok(css.includes(".search-input input{width:100%;height:44px;padding:0 38px 0 36px;font-size:15px}"), "search keeps only its icon padding + larger text");
  assert.ok(!css.includes(".tag-filter{"), "the tag-filter rule is gone — filter selects use the base select");
  assert.ok(!dashboardJsx.includes("tag-filter"), "no JSX still references the removed class");
});

test("controls test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-design-polish-controls.test.mjs"),
    "server/package.json test script must run tests/admin-design-polish-controls.test.mjs",
  );
});
