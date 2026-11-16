// tests/perf-datetime.test.mjs: booking-popup showtime stamp, short form.
// No server needed: shortDateTime() is a pure helper in web/assets/js/data.js.
//
// Covered: ISO with +08:00 offset -> "YYYY-MM-DD HH:mm" (seconds +
// offset dropped); ISO without offset -> same; date-only passes
// through; empty/null/undefined -> ""; App.jsx renders the perf row
// through shortDateTime(pf.start_at) and no raw {pf.start_at} render
// remains (the raw 25-char string wrapped the 156px first column of
// .perf-row to two lines, making the perf row taller than the tier row).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shortDateTime } from "../web/assets/js/data.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");

test("shortDateTime: ISO with timezone offset drops seconds + offset", () => {
  assert.equal(shortDateTime("2026-12-20T19:30:00+08:00"), "2026-12-20 19:30");
});

test("shortDateTime: ISO without offset keeps date + hour:minute", () => {
  assert.equal(shortDateTime("2026-12-05T19:30:00"), "2026-12-05 19:30");
  assert.equal(shortDateTime("2026-12-06T09:05:59"), "2026-12-06 09:05");
});

test("shortDateTime: date-only and empty inputs pass through safely", () => {
  assert.equal(shortDateTime("2026-12-05"), "2026-12-05");
  assert.equal(shortDateTime(""), "");
  assert.equal(shortDateTime(null), "");
  assert.equal(shortDateTime(undefined), "");
});

test("booking popup: perf row renders shortDateTime(pf.start_at), no raw start_at", () => {
  const src = read("web/assets/js/App.jsx");
  assert.ok(src.includes("{shortDateTime(pf.start_at)}"), "perf row must use shortDateTime(pf.start_at)");
  assert.ok(!src.includes("{pf.start_at}"), "no raw {pf.start_at} render may remain");
});

test("booking popup: short stamp fits the 156px first column of .perf-row", () => {
  const css = read("web/assets/css/main.css");
  assert.ok(css.includes(".perf-list .perf-row{display:grid;grid-template-columns:156px auto 1fr}"), "perf-row first column is 156px");
  assert.equal(shortDateTime("2026-12-20T19:30:00+08:00").length, 16, "short stamp is 16 chars vs 25 raw");
});
