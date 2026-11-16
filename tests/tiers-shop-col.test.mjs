// Tiers shop-col round (2026-11-17, Lam approved 02:52): the 会员等级 shop
// cell showed "桂演平…" on live — truncated in all 4 rows. Fix: widen the
// shop column ONLY for the tiers table via a scoped class; the shared
// .col-shop (88px, ~10 tables) must stay untouched.
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

test("tiers shop-col Q1: the 会员等级 table carries its own tiers-table class", () => {
  assert.equal(
    dashboardJsx.split('<table className="tiers-table">').length - 1,
    1,
    "exactly one tiers-table table in AdminDashboard.jsx",
  );
  // The class sits on the tiers table: the thead right after it holds 等级/店铺.
  const idx = dashboardJsx.indexOf('<table className="tiers-table">');
  const head = dashboardJsx.slice(idx, idx + 600);
  assert.ok(head.includes('>等级</th>'), "tiers thead must start with 等级");
  assert.ok(head.includes('className="col-shop">店铺</th>'), "tiers thead must hold 店铺 col-shop");
});

test("tiers shop-col Q1: scoped width fits 桂演平台总店 on one line without ellipsis", () => {
  // 6 CJK chars at 13px ≈ 78px text + 28px cell padding (14px each side)
  // = 106px minimum; the scoped width must clear that with a small slack.
  const m = css.match(/\.tbl-wrap > table\.tiers-table th\.col-shop\{width:(\d+)px\}/);
  assert.ok(m, "scoped .tiers-table .col-shop width rule not found");
  const w = Number(m[1]);
  assert.ok(w >= 106, `scoped width ${w}px must be >= 106px (78px text + 28px padding)`);
  assert.ok(w <= 120, `scoped width ${w}px must be <= 120px (no ballooning the table)`);
});

test("tiers shop-col Q3: the shared .col-shop stays 88px for every other table", () => {
  assert.equal(
    css.split(".tbl-wrap table th.col-shop{width:88px}").length - 1,
    1,
    "shared .col-shop rule must stay exactly 88px, once",
  );
  // No other unscoped col-shop width rule may exist: match each rule with
  // its selector prefix and keep only the ones outside .tiers-table.
  const unscoped = [...css.matchAll(/([^\n;{}]*?)th\.col-shop\{width:(\d+)px\}/g)]
    .filter((x) => !x[1].includes("tiers-table"))
    .map((x) => Number(x[2]));
  assert.deepEqual(
    unscoped,
    [88],
    "the only unscoped col-shop width must be the shared 88px",
  );
});

test("tiers shop-col Q1: the shop cell keeps ellipsis + title as fallback", () => {
  assert.ok(
    dashboardJsx.includes(
      '<td className="cell-ellipsis" title={shopName(t.shop_id)}>{shopName(t.shop_id)}</td>',
    ),
    "tiers shop cell must keep .cell-ellipsis + title fallback",
  );
});
