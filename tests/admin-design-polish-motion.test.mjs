// Design polish Step 3 — motion system (admin): custom easing tokens,
// dropdown/modal entrances from scale(.95) + opacity 0, drawer curve,
// short named-property transitions only. Never ease-in, never
// transition:all, never scale(0); every UI motion stays under 300ms;
// reduced-motion disables it all. Source-grep assertions only, no server
// and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);
// Comments describe the rules in words ("never transition:all") — strip
// them before asserting on actual declarations.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("motion tokens: custom easings in :root, ease-out unchanged", () => {
  assert.ok(
    stripped.includes("--ease-out:cubic-bezier(0.23,1,0.32,1); --ease-in-out:cubic-bezier(0.77,0,0.175,1); --ease-drawer:cubic-bezier(0.32,0.72,0,1);"),
    "all three custom easing tokens must exist with the exact curves",
  );
  assert.ok(stripped.includes("--duration-enter:200ms; --duration-exit:140ms;"), "enter/exit durations stay 200/140ms");
});

test("motion bell: dropdown enters from its trigger, never from center", () => {
  assert.ok(stripped.includes("transform-origin:top right;transition:transform 200ms var(--ease-out),opacity 200ms var(--ease-out)}"), "bell dropdown scales from top-right in 200ms");
  assert.ok(stripped.includes("@starting-style{.bell-dropdown{opacity:0;transform:scale(.95)}}"), "bell enters from scale(.95) + opacity 0");
});

test("motion modal: overlay fades, sheet scales from center", () => {
  assert.ok(stripped.includes(".contract-overlay{position:fixed;inset:0;background:var(--overlay);z-index:60;display:flex;align-items:center;justify-content:center;padding:22px;transition:opacity 200ms var(--ease-out)}"), "overlay fades in 200ms");
  assert.ok(stripped.includes("@starting-style{.contract-overlay{opacity:0}}"), "overlay starts transparent");
  assert.ok(stripped.includes("box-shadow:var(--shadow-menu);transition:transform 200ms var(--ease-out),opacity 200ms var(--ease-out)}"), "sheet transitions transform + opacity in 200ms");
  assert.ok(stripped.includes("@starting-style{.contract-sheet{opacity:0;transform:scale(.95)}}"), "sheet enters from scale(.95) + opacity 0, centered");
});

test("motion drawer + rows: drawer curve, hover is color-only and short", () => {
  assert.ok(stripped.includes("transition:transform var(--duration-enter) var(--ease-drawer)"), "drawer slides on the drawer curve");
  assert.ok(stripped.includes("tbody tr{transition:background-color 140ms var(--ease-out)}"), "row hover is a 140ms color-only transition");
  assert.ok(stripped.includes(".toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,80px);"), "toast keeps its slide-up entrance");
});

test("motion bans: no ease-in, no transition:all, no scale(0) in declarations", () => {
  assert.ok(!stripped.includes("transition:all") && !stripped.includes("transition: all"), "no transition:all anywhere");
  assert.ok(!/(?<![-\w])ease-in(?![-\w])/.test(stripped), "no bare ease-in timing function (the --ease-in-out token name is not a use)");
  assert.ok(!stripped.includes("scale(0)"), "nothing animates from scale(0)");
  for (const m of stripped.matchAll(/transition:([^;{}]+)/g)) {
    assert.ok(!m[1].includes(" all ") && !m[1].trim().startsWith("all"), "transition lists named properties only: " + m[0]);
  }
});

test("motion speed: every literal duration is 300ms or under", () => {
  const durations = [...stripped.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(durations.length > 0, "durations must exist to check");
  for (const d of durations) {
    assert.ok(d <= 300, "UI motion over 300ms found: " + d + "ms");
  }
});

test("motion reduced: one rule disables every transition and animation", () => {
  assert.ok(
    stripped.includes("@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}"),
    "reduced-motion rule must stay intact",
  );
});

test("motion test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-design-polish-motion.test.mjs"),
    "server/package.json test script must run tests/admin-design-polish-motion.test.mjs",
  );
});
