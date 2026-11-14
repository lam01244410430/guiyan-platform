// tests/r6-matches.test.mjs: R6-4 (rows 70, 71) — search extension +
// rule-based auto-match. Spawns server/server.mjs on TEST_PORT (default
// 3121) and talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) seeded Nanning artist demand (id 1, budget ¥20000,
// approved) matches only same-city + same-category + within-budget
// resources, rating desc then price asc, with all three reasons;
// (2) over-budget / wrong-city / wrong-category resources are excluded;
// (3) pending demand can match (own venue demand, Liuzhou);
// (4) rejected demand -> 400 with a reason; (5) anonymous -> 401,
// missing demand -> 404; (6) ?min_price=&max_price= agree with the
// server (yuan -> cents), bad values -> 400; (7) ?region= is a city
// alias, conflict -> 400; (8) ?min_rating= uses the approved-only
// rating; (9) matchesSearch client filters agree with the server rules.
// i18n key counts (H5 455 + 82 th/ms/id, miniprogram 269 + 82 th/ms/id) are asserted here too:
// 6 new match keys on both sides (372 + 6 = 378, 181 + 11 = 192 — the
// mini side also gains the 5 price/rating filter-bar keys).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { matchesSearch } from "../web/assets/js/search.js";

const PORT = Number(process.env.TEST_PORT || 3121);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;
let adminToken;
let demoToken;

// R6-4 fixtures, created via the admin API in before(): one in-budget
// Nanning artist resource, one over-budget, one wrong-city, one
// wrong-category, one Liuzhou venue (for the pending demand).
const FIX = {
  inBudget: { name: "R64 测试艺人南宁价内", category: "artist", city: "南宁", price: 10000 },
  overBudget: { name: "R64 测试艺人南宁超预算", category: "artist", city: "南宁", price: 9999000 },
  wrongCity: { name: "R64 测试艺人桂林价内", category: "artist", city: "桂林", price: 10000 },
  wrongCat: { name: "R64 测试演出南宁价内", category: "show", city: "南宁", price: 10000 },
  venueLiuzhou: { name: "R64 测试场馆柳州价内", category: "venue", city: "柳州", price: 10000 },
};
const ids = {};
let rejectedDemandId;
let pendingDemandId;

async function req(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function createResource(admin, f) {
  const r = await req("/api/admin/resources", {
    method: "POST",
    token: admin,
    body: { ...f, unit: "场", description: "R64 test fixture", status: "published" },
  });
  assert.equal(r.status, 200, `create ${f.name} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.id;
}

async function matches(token, demandId) {
  return req(`/api/demands/${demandId}/matches`, { token });
}

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  adminToken = await login("admin", "admin123");
  demoToken = await login("demo", "demo123");
  for (const [key, f] of Object.entries(FIX)) ids[key] = await createResource(adminToken, f);
  const ins = await pool.query(
    "INSERT INTO demands(user_id,title,category,budget,city,description,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [2, "R64 拒绝需求测试", "artist", 1000000, "南宁", "R64 test fixture", "rejected", new Date().toISOString()],
  );
  rejectedDemandId = ins.rows[0].id;
  // Own pending demand (venue, ¥15000, 柳州） — the seeded pending
  // demand (id 3) cannot be used: an earlier test file approves it on
  // the shared DB, so its status is no longer pending by the time this
  // file runs.
  const pend = await pool.query(
    "INSERT INTO demands(user_id,title,category,budget,city,description,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [2, "R64 待审核需求测试", "venue", 1500000, "柳州", "R64 test fixture", "pending", new Date().toISOString()],
  );
  pendingDemandId = pend.rows[0].id;
});

after(async () => {
  await pool.query("DELETE FROM resources WHERE name LIKE 'R64%'").catch(() => {});
  await pool.query("DELETE FROM demands WHERE title LIKE 'R64%'").catch(() => {});
  await pool.end().catch(() => {});
  if (child) child.kill("SIGTERM");
});

test("r6-4 matches: seeded Nanning artist demand returns only same-city same-category within-budget, rating desc price asc", async () => {
  // Demand 1: artist, ¥20000 (2000000 cents), 南宁， approved.
  const r = await matches(demoToken, 1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.demand.id, 1);
  assert.equal(r.data.demand.status, "approved");
  const ms = r.data.matches;
  assert.ok(ms.length > 0, "demand 1 must match at least the in-budget fixture");
  for (const m of ms) {
    assert.equal(m.category, "artist", `match ${m.id} category`);
    assert.equal(m.city, "南宁", `match ${m.id} city`);
    assert.ok(m.price <= 2000000, `match ${m.id} price ${m.price} over budget`);
    assert.deepEqual(m.reasons, ["same_city", "same_category", "within_budget"]);
  }
  const got = new Set(ms.map((m) => m.id));
  assert.ok(got.has(ids.inBudget), "in-budget Nanning artist must match");
  assert.ok(!got.has(ids.overBudget), "over-budget resource must not match");
  assert.ok(!got.has(ids.wrongCity), "wrong-city resource must not match");
  assert.ok(!got.has(ids.wrongCat), "wrong-category resource must not match");
  for (let k = 0; k + 1 < ms.length; k++) {
    const a = ms[k], b = ms[k + 1];
    assert.ok(a.rating + 1e-9 >= b.rating, `rating desc at ${k}: ${a.rating} < ${b.rating}`);
    if (Math.abs(a.rating - b.rating) < 1e-9)
      assert.ok(a.price <= b.price, `price asc on rating tie at ${k}`);
  }
});

test("r6-4 matches: pending demand can match (venue demand, Liuzhou)", async () => {
  // Own pending demand: venue, ¥15000 (1500000 cents), 柳州.
  const r = await matches(demoToken, pendingDemandId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.demand.status, "pending");
  const ms = r.data.matches;
  assert.ok(ms.length > 0, "pending demand must match at least the Liuzhou venue fixture");
  assert.ok(ms.some((m) => m.id === ids.venueLiuzhou), "Liuzhou venue fixture must match");
  for (const m of ms) {
    assert.equal(m.category, "venue");
    assert.equal(m.city, "柳州");
    assert.ok(m.price <= 1500000, `match ${m.id} price ${m.price} over budget`);
  }
});

test("r6-4 matches: rejected demand -> 400 with a reason", async () => {
  const r = await matches(demoToken, rejectedDemandId);
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /拒绝/);
});

test("r6-4 matches: anonymous -> 401; missing demand -> 404", async () => {
  assert.equal((await matches(undefined, 1)).status, 401);
  const r = await matches(demoToken, 999999);
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

test("r6-4 search: price filters agree with the server (yuan -> cents)", async () => {
  const r = await req("/api/resources?min_price=100&max_price=300");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.resources.length > 0);
  for (const x of r.data.resources)
    assert.ok(x.price >= 10000 && x.price <= 30000, `price ${x.price} outside [10000,30000]`);
  const got = new Set(r.data.resources.map((x) => x.id));
  assert.ok(got.has(ids.inBudget), "¥100 fixture must be in the price window");
  assert.ok(!got.has(ids.overBudget), "¥99999 fixture must be outside the price window");
  assert.equal((await req("/api/resources?min_price=abc")).status, 400);
  assert.equal((await req("/api/resources?min_price=-1")).status, 400);
  assert.equal((await req("/api/resources?min_price=300&max_price=100")).status, 400);
});

test("r6-4 search: region is a city alias; conflict -> 400", async () => {
  const r = await req("/api/resources?region=%E5%8D%97%E5%AE%81");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.resources.length > 0);
  assert.ok(r.data.resources.every((x) => x.city === "南宁"));
  const same = await req("/api/resources?city=%E5%8D%97%E5%AE%81&region=%E5%8D%97%E5%AE%81");
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.resources.length, r.data.resources.length);
  const clash = await req("/api/resources?city=%E5%8D%97%E5%AE%81&region=%E6%A1%82%E6%9E%97");
  assert.equal(clash.status, 400, JSON.stringify(clash.data));
  const all = await req("/api/resources");
  const allRegion = await req("/api/resources?region=all");
  assert.equal(allRegion.status, 200);
  assert.equal(allRegion.data.resources.length, all.data.resources.length);
});

test("r6-4 search: rating floor uses the approved-only rating", async () => {
  const r = await req("/api/resources?min_rating=4");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.resources.length > 0, "at least one resource must rate >= 4");
  for (const x of r.data.resources) {
    assert.ok(x.rating >= 4, `resource ${x.id} rating ${x.rating} below floor`);
    assert.ok(x.review_count > 0, `resource ${x.id} has no approved reviews`);
  }
  assert.equal((await req("/api/resources?min_rating=6")).status, 400);
  assert.equal((await req("/api/resources?min_rating=abc")).status, 400);
  const zero = await req("/api/resources?min_rating=0");
  assert.equal(zero.status, 200);
  const all = await req("/api/resources");
  assert.equal(zero.data.resources.length, all.data.resources.length);
});

test("r6-4 search.js: client filters agree with the server rules; i18n 455+82/269+82", async () => {
  const res = (name, price, rating, reviewCount, city) => ({
    name, description: "民歌", city, category: "演出剧目", tags: [],
    price, rating, reviewCount,
  });
  const inRange = res("刘三姐", 280, 4.5, 3, "南宁");
  assert.equal(matchesSearch(inRange, "", { minPrice: 100, maxPrice: 300 }), true);
  assert.equal(matchesSearch(inRange, "", { minPrice: 300 }), false);
  assert.equal(matchesSearch(inRange, "", { maxPrice: 200 }), false);
  // min > max counts as no price filter (same rule as the server client).
  assert.equal(matchesSearch(inRange, "", { minPrice: 300, maxPrice: 100 }), true);
  // Rating needs a real approved rating: no reviews (or none) never match.
  assert.equal(matchesSearch(inRange, "", { minRating: 4 }), true);
  assert.equal(matchesSearch(inRange, "", { minRating: 5 }), false);
  assert.equal(matchesSearch(res("刘三姐", 280, 4.5, 0, "南宁"), "", { minRating: 4 }), false);
  assert.equal(matchesSearch(res("刘三姐", 280, undefined, undefined, "南宁"), "", { minRating: 4 }), false);
  assert.equal(matchesSearch(inRange, "", { minRating: 0 }), true);
  // Region is the city alias; 'all' means no filter.
  assert.equal(matchesSearch(inRange, "", { region: "南宁" }), true);
  assert.equal(matchesSearch(inRange, "", { region: "桂林" }), false);
  assert.equal(matchesSearch(inRange, "", { region: "all" }), true);
  // Filters compose with the text query (AND).
  assert.equal(matchesSearch(inRange, "民歌", { minPrice: 100, maxPrice: 300 }), true);
  assert.equal(matchesSearch(inRange, "民歌", { minPrice: 300 }), false);

  // i18n: H5 455 keys/language in zh/vi/en + 82 in th/ms/id, miniprogram 269 + 82, equal sets per side.
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [455, 455, 455, 82, 82, 82]);
  for (const k of ["matchReasonCity", "matchReasonCat", "matchReasonBudget", "matchNoteServer", "matchRejected", "matchLoading"])
    for (const l of ["zh", "vi", "en"])
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  const text = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"),
    "utf8",
  );
  const blocks = {};
  for (const lang of ["zh", "vi", "en"]) {
    const start = text.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const end = text.indexOf("\n  }", start);
    const block = text.slice(start, end);
    blocks[lang] = [...block.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    assert.equal(blocks[lang].length, 269, `miniprogram ${lang} key count`);
  }
  assert.deepEqual([...blocks.zh].sort(), [...blocks.vi].sort());
  assert.deepEqual([...blocks.zh].sort(), [...blocks.en].sort());
  for (const k of ["priceMinPh", "priceMaxPh", "ratingAll", "rating4", "rating45", "matchReasonCity", "matchReasonCat", "matchReasonBudget", "matchNoteServer", "matchRejected", "matchLoading"])
    assert.ok(blocks.zh.includes(k), `${k} missing in miniprogram zh`);
});
