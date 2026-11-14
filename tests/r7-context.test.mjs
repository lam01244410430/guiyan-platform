// tests/r7-context.test.mjs: R7-6 (rows 51, 55) — 情境推荐 + 行程.
// Spawns server/server.mjs on TEST_PORT (default 3136) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database.
//
// Covered (8 tests): (1) Saturday evening in Nanning (time_of_day=
// evening + city=南宁) boosts an evening show by exactly +18 (+10
// evening performance + +8 city) with a 晚场 reason naming the real
// 19:30 start time; (2) no context params -> the old behaviour —
// no `context` echo, and a fresh user with no signals scores exactly
// the old formula (preference +20, own city +6) with the old reason
// text; (3) invalid time_of_day / companion -> 400, anonymous -> 401;
// (4) city param boosts only that city (+8); (5) companion rules use
// real data — family +6 on a 90-minute show, couple +6 on an evening
// show, friends +6 on a 800-capacity show, alone changes nothing;
// (6) the 刘三姐 itinerary template has eat/parking/sleep sections,
// names the verified place 中山路夜市, and contains no merchant link
// or phone number; (7) a show with no template -> itinerary null,
// unknown resource -> 404; (8) i18n counts H5 443 / miniprogram 256
// with the 20 new keys present in zh/vi/en on both sides.
//
// Fixture notes: the evening performance is created by this file on
// its own admin-created Nanning show resource (Saturday 2026-12-12
// 19:30, on_sale) — the R2 performance was cancelled by its own test,
// so nothing here relies on another file's leftovers. Scores are
// asserted as deltas against the same user's no-context call, so other
// files' seed-state changes cannot move them. Test usernames are
// hyphen-free ([A-Za-z0-9_], R4-4 lesson).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3136);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

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

let adminToken;
let freshToken;
let freshToken2;
let liusanId;
let zhuangId;
let eveningResourceId;

// The endpoint caps limit at 20 (route default is 10). Ask for the max:
// in a populated DB 22 Nanning shows tie at 26, so the default 10-row
// list hides later fixtures entirely.
async function recs(token, qs = "") {
  const r = await req(`/api/recommendations${qs}${qs ? "&" : "?"}limit=20`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

function scoreOf(data, resourceId) {
  const row = (data.recommendations || []).find((x) => x.resourceId === resourceId);
  assert.ok(row, `resource ${resourceId} missing from recommendations`);
  return row;
}

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD || "demo123",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
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
  // A fresh user with no views/favorites/orders: preference 'show',
  // city 南宁 — the no-context scores below are then exactly the old
  // formula (preference +20, own city +6) with no signal terms.
  await pool.query(
    "INSERT INTO users(username,password,name,role,city,preference,created_at) VALUES($1,$2,$3,'user','南宁','show',$4)",
    ["r7ctxuser", hashPassword("Test1234"), "R7情境用户", new Date().toISOString()],
  );
  freshToken = await login("r7ctxuser", "Test1234");
  // A second fresh user whose preference and city match nothing:
  // every resource then scores 0 with the default reason (the
  // public endpoint caps at 20 rows, so a 0-score row is only
  // visible when nothing outranks it).
  await pool.query(
    "INSERT INTO users(username,password,name,role,city,preference,created_at) VALUES($1,$2,$3,'user','不存在的城市','xyz',$4)",
    ["r7ctxuser2", hashPassword("Test1234"), "R7情境用户二", new Date().toISOString()],
  );
  freshToken2 = await login("r7ctxuser2", "Test1234");
  const rows = await pool.query(
    "SELECT id, name FROM resources WHERE name IN ('民族歌舞剧《刘三姐》', '壮乡情·民族歌舞专场')",
  );
  for (const row of rows.rows) {
    if (row.name === "民族歌舞剧《刘三姐》") liusanId = row.id;
    if (row.name === "壮乡情·民族歌舞专场") zhuangId = row.id;
  }
  assert.ok(liusanId, "seed has 刘三姐");
  assert.ok(zhuangId, "seed has 壮乡情");
  // This file's own evening show: a new Nanning show resource + an
  // approved show + a Saturday 2026-12-12 19:30 on-sale performance.
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R7 晚场测试 show", category: "show", city: "南宁",
      price: 28000, unit: "张", stock: 10, shop_id: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  eveningResourceId = res.data.resource.id;
  const show = await req("/api/shows", {
    method: "POST",
    token: adminToken,
    body: { resource_id: eveningResourceId, title: "R7 周六晚场" },
  });
  assert.equal(show.status, 200, JSON.stringify(show.data));
  const approved = await req(`/api/admin/shows/${show.data.show.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "approved" },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const perf = await req(`/api/shows/${show.data.show.id}/performances`, {
    method: "POST",
    token: adminToken,
    body: { start_at: "2026-12-12T19:30:00", price_cents: 28000 },
  });
  assert.equal(perf.status, 200, JSON.stringify(perf.data));
  const onSale = await req(`/api/admin/performances/${perf.data.performance.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "on_sale" },
  });
  assert.equal(onSale.status, 200, JSON.stringify(onSale.data));
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("Saturday evening in Nanning -> evening show +18 with a 晚场 reason", async () => {
  const plain = await recs(freshToken);
  const ctx = await recs(freshToken, "?time_of_day=evening&city=南宁");
  const after = scoreOf(ctx, eveningResourceId);
  // 44 = preference +20, own city +6, evening performance +10,
  // requested city +8. The fixture cannot be looked up in the plain
  // list: 21 earlier Nanning shows tie at 26 ahead of it and the
  // endpoint caps at 20 rows — so the +18 is shown with two controls
  // instead of a plain-vs-context delta on the same row.
  assert.equal(after.score, 44, JSON.stringify(after));
  assert.ok(after.reason.includes("晚场演出（19:30 开演）"), after.reason);
  assert.ok(after.reason.includes("位于南宁"), after.reason);
  assert.deepEqual(ctx.context, {
    time_of_day: "evening",
    city: "南宁",
    companion: null,
  });
  // Same-response control: 刘三姐 is a Nanning show with no evening
  // performance, so it scores 34 (20+6+8) — the fixture's +10 over
  // it is exactly the evening-performance rule.
  const control = scoreOf(ctx, liusanId);
  assert.equal(control.score, 34, JSON.stringify(control));
  assert.equal(after.score - control.score, 10);
  // City rule on the control: 34 with the city param, 26 without.
  assert.equal(scoreOf(plain, liusanId).score, 26);
  assert.equal(control.score - scoreOf(plain, liusanId).score, 8);
  // Total context contribution to a Nanning show with an evening slot.
  assert.equal(after.score - scoreOf(plain, liusanId).score, 18);
});

test("no context params -> old behaviour, no context echo", async () => {
  const plain = await recs(freshToken);
  assert.ok(!("context" in plain), JSON.stringify(Object.keys(plain)));
  // Fresh user, no signals: 刘三姐 = preference +20 + own city +6.
  const liu = scoreOf(plain, liusanId);
  assert.equal(liu.score, 26, JSON.stringify(liu));
  assert.equal(
    liu.reason,
    "符合你的兴趣偏好（演出类型/观演偏好） · 与你的所在城市相同（活跃城市/区域）",
  );
  // A resource matching nothing, no signals: 0 + default reason.
  // (Checked with the no-match user: the endpoint caps at 20 rows,
  // so a 0-score row is only visible when nothing outranks it.)
  const zero = await recs(freshToken2);
  assert.ok(!("context" in zero), JSON.stringify(Object.keys(zero)));
  assert.ok((zero.recommendations || []).length > 0, "recommendations are non-empty");
  assert.equal(zero.recommendations[0].score, 0, JSON.stringify(zero.recommendations[0]));
  assert.equal(zero.recommendations[0].reason, "发现更多广西文化资源");
  // The plain call is deterministic.
  const again = await recs(freshToken);
  assert.deepEqual(again, plain);
});

test("invalid time_of_day / companion -> 400; anonymous -> 401", async () => {
  assert.equal(
    (await req("/api/recommendations?time_of_day=noon", { token: freshToken })).status,
    400,
  );
  assert.equal(
    (await req("/api/recommendations?companion=dog", { token: freshToken })).status,
    400,
  );
  assert.equal((await req("/api/recommendations")).status, 401);
  // An empty city is ignored, not an error.
  assert.equal(
    (await req("/api/recommendations?city=", { token: freshToken })).status,
    200,
  );
});

test("city param boosts only that city (+8)", async () => {
  const plain = await recs(freshToken);
  const ctx = await recs(freshToken, "?city=柳州");
  // 壮乡情 (the only 柳州 show): preference +20, +8 with the city
  // param = 28. Its plain 20 cannot be looked up in the plain list
  // (22 Nanning shows at 26 outrank it, endpoint caps at 20 rows);
  // the plain 20 is the old formula pinned by the no-context test.
  assert.equal(scoreOf(ctx, zhuangId).score, 28);
  assert.ok(scoreOf(ctx, zhuangId).reason.includes("位于柳州"));
  // 刘三姐 (南宁) is untouched by a 柳州 param.
  assert.equal(scoreOf(ctx, liusanId).score, scoreOf(plain, liusanId).score);
  assert.equal(scoreOf(ctx, liusanId).score, 26);
});

test("companion rules use real data (family/couple/friends/alone)", async () => {
  const plain = await recs(freshToken);
  // Family: 刘三姐 is a 90-minute show -> +6 with the duration named.
  const fam = await recs(freshToken, "?companion=family");
  assert.equal(scoreOf(fam, liusanId).score - scoreOf(plain, liusanId).score, 6);
  assert.ok(scoreOf(fam, liusanId).reason.includes("全场演出（90 分钟），适合全家同行"));
  // Couple: the evening show has a 19:30 performance -> +6.
  // 32 = base 26 + 6; the plain list cannot show this resource (see
  // test 1), so the +6 is shown against 刘三姐 in the same response
  // (26: no evening performance, no couple boost).
  const cpl = await recs(freshToken, "?companion=couple");
  assert.equal(scoreOf(cpl, eveningResourceId).score, 32);
  assert.equal(scoreOf(cpl, liusanId).score, 26);
  assert.equal(scoreOf(cpl, eveningResourceId).score - scoreOf(cpl, liusanId).score, 6);
  assert.ok(scoreOf(cpl, eveningResourceId).reason.includes("晚场演出，适合双人同行"));
  // Friends: 刘三姐 capacity is 800 (>= 200) -> +6.
  const fri = await recs(freshToken, "?companion=friends");
  assert.equal(scoreOf(fri, liusanId).score - scoreOf(plain, liusanId).score, 6);
  assert.ok(scoreOf(fri, liusanId).reason.includes("场地可容纳多人，适合结伴同行"));
  // Alone: no adjustment anywhere.
  const alo = await recs(freshToken, "?companion=alone");
  assert.deepEqual(
    (alo.recommendations || []).map((x) => [x.resourceId, x.score]),
    (plain.recommendations || []).map((x) => [x.resourceId, x.score]),
  );
});

test("itinerary for 刘三姐: eat/parking/sleep, no merchant links", async () => {
  const r = await req(`/api/resources/${liusanId}/itinerary`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const it = r.data.itinerary;
  assert.ok(it, "刘三姐 has a hand-entered itinerary template");
  assert.equal(it.venue_name, "广西文化艺术中心");
  assert.ok(it.venue_address.includes("龙堤路25号"), it.venue_address);
  assert.ok(Array.isArray(it.eat) && it.eat.length > 0, JSON.stringify(it.eat));
  assert.ok(it.eat.some((e) => e.name === "中山路夜市"), JSON.stringify(it.eat));
  assert.ok(typeof it.parking === "string" && it.parking.length > 0, it.parking);
  assert.ok(Array.isArray(it.sleep) && it.sleep.length > 0, JSON.stringify(it.sleep));
  assert.ok(it.note.includes("手工录入"), it.note);
  // No merchant links, no phone numbers, no prices anywhere.
  const flat = JSON.stringify(it);
  assert.ok(!flat.includes("http"), flat);
  assert.ok(!/\d{3,4}-\d{7,8}|\b\d{11}\b/.test(flat), flat);
});

test("itinerary for a show with no template -> null; unknown -> 404", async () => {
  const r = await req(`/api/resources/${zhuangId}/itinerary`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.itinerary, null);
  assert.equal((await req("/api/resources/999999/itinerary")).status, 404);
});

test("r7-context i18n: H5 448 keys/language, miniprogram 262, equal sets", async () => {
  const NEW_KEYS = [
    "ctxTitle", "ctxTime", "ctxCity", "ctxCityPh", "ctxCompanion",
    "ctxApply", "ctxAny", "ctxMorning", "ctxAfternoon", "ctxEvening",
    "ctxNight", "ctxAlone", "ctxCouple", "ctxFamily", "ctxFriends",
    "itinTitle", "itinEat", "itinParking", "itinSleep", "itinNote",
  ];
  assert.equal(NEW_KEYS.length, 20);
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of NEW_KEYS) {
    for (const l of data.LANGS)
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  }
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
    blocks[lang] = [
      ...block.matchAll(/^    ([A-Za-z0-9_]+):/gm),
    ].map((m) => m[1]);
  }
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 262, `${lang} key count`);
    for (const k of NEW_KEYS)
      assert.ok(blocks[lang].includes(k), `${k} missing in mini ${lang}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n sets differ across languages",
  );
});
