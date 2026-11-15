// Design polish Step 4 — customer account-page inputs: the same control
// geometry as the admin system (44px base, one focus ring, custom select
// chevron, hidden number spinners, 36px sm refund row) with the customer
// night-theatre tokens only — never the admin palette. The theme toggle,
// auth card, booking form, home search and chat inputs are untouched.
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
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

test("account controls base: 44px, customer tokens, one focus ring", () => {
  assert.ok(
    mainCss.includes(".db-profile .row input,.db-profile .row select,#ordersTable .db-actions input{font-size:13.5px;color:var(--ink);background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-sm);outline:none}"),
    "account controls share one base with customer tokens",
  );
  assert.ok(mainCss.includes(".db-profile .row input,.db-profile .row select{height:44px;padding:0 12px}"), "account base height is 44px");
  assert.ok(
    mainCss.includes(".db-profile .row input:focus,.db-profile .row select:focus,#ordersTable .db-actions input:focus{border-color:var(--red);box-shadow:0 0 0 3px rgba(176,58,30,0.14)}"),
    "account focus ring is the customer red, not the admin ink",
  );
  assert.ok(mainCss.includes(".db-profile .row input:disabled,.db-profile .row select:disabled,#ordersTable .db-actions input:disabled{opacity:.6;cursor:default}"), "disabled account controls dim to .6");
});

test("account controls tokens: no admin palette anywhere in the customer CSS", () => {
  assert.ok(!mainCss.includes("#232323"), "admin action ink must not leak into the customer CSS");
  assert.ok(!mainCss.includes("#a1ffcb"), "admin mint accent must not leak into the customer CSS");
  assert.ok(!mainCss.includes("--p-action") && !mainCss.includes("--p-surface"), "admin token names must not appear in the customer CSS");
});

test("account controls select: custom chevron in the ink2 tone", () => {
  assert.ok(mainCss.includes(".db-profile .row select{appearance:none;-webkit-appearance:none;"), "account selects hide the native arrow");
  assert.ok(mainCss.includes("stroke='%235d5344'"), "chevron uses the customer ink2 tone");
  assert.ok(mainCss.includes("background-position:right 12px center;background-size:12px;padding-right:32px}"), "chevron sits 12px from the right with room for it");
});

test("account controls number: tabular numerals, native spinners hidden", () => {
  assert.ok(mainCss.includes(".db-profile .row input[type=\"number\"]{font-variant-numeric:tabular-nums}"), "age input uses tabular figures");
  assert.ok(mainCss.includes(".db-profile .row input[type=\"number\"]::-webkit-outer-spin-button"), "webkit spinners hidden on the account page");
  assert.ok(mainCss.includes(".db-profile .row input[type=\"number\"]{-moz-appearance:textfield;appearance:textfield}"), "firefox spinner hidden on the account page");
});

test("account refund row: inline widths gone, sm size + CSS widths instead", () => {
  assert.ok(!userJsx.includes("style={{ width: 150 }}"), "refund reason inline width must be gone");
  assert.ok(!userJsx.includes("style={{ width: 52 }}"), "refund quantity inline width must be gone");
  assert.ok(userJsx.includes('<input type="text" className="field-sm" maxLength={500}'), "refund reason uses the sm size");
  assert.ok(userJsx.includes('<input type="number" className="field-sm" min={1} max={remaining}'), "refund quantity uses the sm size");
  assert.ok(mainCss.includes(".field-sm{height:36px;padding:0 10px;font-size:13px}"), "customer sm variant is 36px");
  assert.ok(mainCss.includes("#ordersTable .db-actions input[type=\"text\"]{width:150px}"), "refund reason width lives in CSS now");
  assert.ok(mainCss.includes("#ordersTable .db-actions input[type=\"number\"]{width:64px}"), "refund quantity width lives in CSS now");
  assert.ok(mainCss.includes("#ordersTable .db-actions .mini{height:36px}"), "refund-row buttons match the 36px inputs");
});

test("account refund row: rules target the orders table, no dead selector", () => {
  assert.ok(!mainCss.includes(".order .row input"), "the old .order .row selector matched nothing in the orders tab");
  assert.ok(!mainCss.includes(".order .row .mini"), "the old .order .row mini selector matched nothing in the orders tab");
  assert.ok(mainCss.includes("#ordersTable .db-actions input"), "refund-row rules must target #ordersTable .db-actions");
});

test("account buttons: OTP-send / save buttons match the 44px input height", () => {
  assert.ok(mainCss.includes(".db-profile .row .v .btn{height:44px;padding-top:0;padding-bottom:0}"), "account row buttons align to the input height");
});

test("account large-text: elderly large-text mode still wins", () => {
  assert.ok(
    mainCss.includes("html.large-text .db-profile .row input,html.large-text .db-profile .row select,html.large-text #ordersTable .db-actions input{font-size:17px}"),
    "large-text override must cover the account controls",
  );
});

test("account untouched: theme toggle, auth, booking, home search keep their rules", () => {
  assert.ok(mainCss.includes(".theme-seg{display:inline-flex;gap:4px;background:var(--surface2);border:1px solid var(--line);border-radius:99px;padding:4px}"), "theme toggle untouched");
  assert.ok(mainCss.includes(".auth-card input,.auth-card select,.auth-card textarea{width:100%;box-sizing:border-box;border:1px solid var(--line2);border-radius:12px;padding:11px 13px;font-size:14px;background:var(--surface);color:var(--ink);font-family:inherit}"), "auth card untouched");
  assert.ok(mainCss.includes(".bookrow input,.bookrow select{border:1px solid var(--line2);border-radius:10px;padding:11px 12px;background:var(--surface);color:var(--ink);width:100%}"), "booking form untouched");
  assert.ok(mainCss.includes(".filters .q{flex:1;min-width:170px;border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:99px;padding:9px 16px;font-size:13.5px;outline:none}"), "home search pill untouched");
});

test("account test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/customer-account-inputs.test.mjs"),
    "server/package.json test script must run tests/customer-account-inputs.test.mjs",
  );
});
