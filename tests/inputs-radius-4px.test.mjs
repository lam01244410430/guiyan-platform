// Inputs restyle (2026-11-16): ONE input radius token for both webs —
// 4px, applied to EVERY input/select/textarea (rectangle with only
// slightly rounded corners). Lam 2026-11-16 16:45 (plan §1.6, Q4(a) +
// Q6(a)): buttons and chips/tags now follow the same one 44px / 4px
// template instead of keeping their own radii; cards keep --r-lg.
// Number spinners are hidden GLOBALLY on the customer side
// (same as admin) — keyboard entry still works. --r-sm / --radius-sm
// are NOT changed (they are also used by non-inputs).
// EXCEPTION (Lam 2026-11-16 20:13): header buttons are now uniformly
// ROUND/pill — the 4px rule is overridden ONLY for the header, so the
// header language select (.langsel) is a 999px pill, not 4px. Every
// other input/select/textarea stays 4px (var(--input-r)); all other
// buttons, inputs and popups stay 4px.
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

test("input radius token: 4px on both webs, old radius tokens untouched", () => {
  assert.ok(mainCss.includes("--input-r:4px;"), "customer defines --input-r:4px");
  assert.ok(adminCss.includes("--input-r:4px;"), "admin defines --input-r:4px");
  assert.ok(mainCss.includes("--r-sm:9px;"), "--r-sm stays 9px (also used by non-inputs)");
  assert.ok(adminCss.includes("--radius-sm:9px;"), "--radius-sm stays 9px (also used by non-inputs)");
});

test("customer inputs: one global 4px rule covers every input/select/textarea", () => {
  assert.ok(mainCss.includes("input,select,textarea{border-radius:var(--input-r)}"), "global input radius rule exists");
  assert.ok(mainCss.includes(".filters select{margin-left:auto;border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:var(--input-r);"), "catalog filter select is 4px");
  assert.ok(mainCss.includes(".filters .q{flex:1;min-width:170px;border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:var(--input-r);"), "catalog search input is 4px");
  assert.ok(mainCss.includes(".hero-search{margin:30px 0 0;max-width:680px;display:flex;background:#fffdf8;border-radius:var(--input-r);"), "hero search box is 4px");
  assert.ok(mainCss.includes(".bookrow input,.bookrow select{border:1px solid var(--line2);border-radius:var(--input-r);"), "booking inputs (incl. the date input) are 4px");
  assert.ok(mainCss.includes(".auth-card input,.auth-card select,.auth-card textarea{width:100%;box-sizing:border-box;border:1px solid var(--line2);border-radius:var(--input-r);"), "auth card inputs are 4px");
  assert.ok(mainCss.includes(".chat-form input{flex:1;background:#262219;border:1px solid rgba(245,238,221,.2);border-radius:var(--input-r);"), "chat input is 4px");
  assert.ok(mainCss.includes(".ai-form input{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--input-r);"), "assistant input is 4px");
  // NOTE: .langsel is NOT asserted here — it is the one input exception
  // (header pill, Lam 2026-11-16 20:13); see the test below.
  assert.ok(mainCss.includes(".preview-controls input[type=\"color\"]{width:38px;height:28px;padding:0;border:1px solid var(--line2);border-radius:var(--input-r);"), "color input is 4px");
});

test("header language select is the ONE pill input (Lam 2026-11-16 20:13)", () => {
  // Lam 2026-11-16 20:13: header buttons are now uniformly ROUND/pill,
  // overriding the 4px rule ONLY for the header — so .langsel (the header
  // language select) is border-radius:999px. Every other
  // input/select/textarea stays 4px (var(--input-r)).
  assert.ok(mainCss.includes(".langsel{position:relative;display:flex;align-items:center;flex:none;background:var(--surface);border:1px solid var(--line2);border-radius:999px;"), "header language select is a 999px pill");
  assert.ok(!mainCss.includes(".langsel{position:relative;display:flex;align-items:center;flex:none;background:var(--surface);border:1px solid var(--line2);border-radius:var(--input-r);"), "header language select is no longer 4px");
});

test("customer inputs: no input keeps a pill/large radius", () => {
  assert.ok(!mainCss.includes(".filters .q{flex:1;min-width:170px;border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:99px;"), "search input is no longer a 99px pill");
  assert.ok(!mainCss.includes(".filters select{margin-left:auto;border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:99px;"), "filter select is no longer a 99px pill");
  assert.ok(!mainCss.includes(".hero-search{margin:30px 0 0;max-width:680px;display:flex;background:#fffdf8;border-radius:14px;"), "hero search is no longer 14px");
  assert.ok(!mainCss.includes(".auth-card input,.auth-card select,.auth-card textarea{width:100%;box-sizing:border-box;border:1px solid var(--line2);border-radius:12px;"), "auth card is no longer 12px");
  assert.ok(!mainCss.includes(".bookrow input,.bookrow select{border:1px solid var(--line2);border-radius:10px;"), "booking inputs are no longer 10px");
});

test("customer number spinners are hidden globally, not just on the account page", () => {
  assert.ok(mainCss.includes("input[type=\"number\"]::-webkit-outer-spin-button,input[type=\"number\"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}"), "webkit spinners hidden globally");
  assert.ok(mainCss.includes("input[type=\"number\"]{-moz-appearance:textfield;appearance:textfield}"), "firefox spinners hidden globally");
  assert.ok(mainCss.includes("input[type=\"number\"]{font-variant-numeric:tabular-nums}"), "number inputs keep tabular numerals");
  assert.ok(!mainCss.includes(".db-profile .row input[type=\"number\"]::-webkit-outer-spin-button"), "the old account-scoped spinner rule is gone");
});

test("admin inputs: shared control system + login input use the 4px token", () => {
  assert.ok(
    adminCss.includes("input,select,textarea{font:inherit;font-size:13.5px;color:var(--p-ink);background:var(--p-bg);border:1px solid var(--line2);border-radius:var(--input-r);outline:none}"),
    "admin shared control system is 4px",
  );
  assert.ok(
    adminCss.includes(".login-card input{width:100%;border:1px solid var(--line2);border-radius:var(--input-r);padding:12px 14px;"),
    "admin login input is 4px",
  );
  assert.ok(
    adminCss.includes("input[type=\"checkbox\"]{width:16px;height:16px;padding:0;border:0;border-radius:0;"),
    "admin checkboxes keep their native box",
  );
});

test("buttons and chips follow the 4px template, cards keep their own radius", () => {
  // Lam 2026-11-16 16:45 (plan §1.6, Q4(a) + Q6(a)): customer buttons
  // and chips are 4px now (were 99px pills); admin buttons and chips
  // are 4px now (were 9px); only cards keep their own radius.
  assert.ok(mainCss.includes(".btn{display:inline-flex;align-items:center;gap:8px;border-radius:4px;"), "customer buttons follow the 4px template");
  assert.ok(mainCss.includes(".chip{border:1px solid var(--line2);background:var(--surface);color:var(--ink2);border-radius:4px;"), "customer chips follow the 4px rule");
  assert.ok(mainCss.includes(".card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);"), "customer cards keep their radius");
  assert.ok(adminCss.includes(".btn-export{margin-left:auto;border:0;border-radius:4px;"), "admin buttons follow the 4px template");
  assert.ok(adminCss.includes(".chips button{border:1px solid var(--line2);background:var(--p-bg);border-radius:4px;"), "admin chips follow the 4px rule");
});
