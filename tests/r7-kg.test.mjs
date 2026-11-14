// R7-3 (rows 46, 47, 48) — 知识图谱.
// Runs against a REAL PostgreSQL 16, never a mock.
//
//   DATABASE_URL=postgres://guiyan:guiyan@localhost:5433/guiyan_test
//   DEMO_PASSWORD=demo123
//   node --test tests/r7-kg.test.mjs
//
// The test spawns server/server.mjs on TEST_PORT (default 3137) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database (the server seeds 62 resources + demo users on
// first boot). Do not point it at any shared or production database.
//
// Covered (8 tests): (1) 刘三姐 neighbours include the honest
// set — 壮乡情 via related_to (shared genre 民族歌舞）, 广西文化艺术
// 中心 via held_at (R7-6 verified address), 八桂青年歌舞团 via
// performs, 刘三姐主题IP授权 via related_to, 民族歌舞 via belongs_to
// — each with its source; (2) the assistant answers 刘三姐的演员还有
// 什么戏 from the graph (kind kg): names the team, says honestly the
// team has no other show in the catalog, lists the same-genre show
// and the venue, and names its sources — the plan's test amended per
// Lam decision (c) + the R2-4 precedent (same-artist is honestly
// empty for 刘三姐, so the test asserts the empty answer instead of
// a fabricated show); (3) a node with no edges (catalog artist) ->
// empty list; (4) invalid kind -> 400; (5) unknown resource -> 404;
// (6) seeded graph matches the hand list exactly: 26 nodes
// (show 6 / artist 7 incl. 2 team nodes / venue 6 / ip 6 / genre 1)
// + the 7 edges with their sources — scoped to the seeded names, so
// earlier files' leftover resources (which get their own nodes on the
// next boot) cannot move the counts; (7) a draft resource's graph ->
// 404; (8) i18n counts H5 455 / miniprogram 269 with the kgRelated
// key present in zh/vi/en on both sides (th/ms/id stay 82).
//
// Fixture notes: resource ids are looked up by name (never
// hardcoded); the draft resource in (7) is created by this file and
// deleted again, so the shared seed is left untouched. Test
// usernames are hyphen-free ([A-Za-z0-9_], R4-4 lesson).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5433/guiyan_test",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3137);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;

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
let liusanId;
let artistId;

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
  const rows = await pool.query(
    "SELECT id, name FROM resources WHERE name IN ('民族歌舞剧《刘三姐》', '八桂丝竹·民族器乐组合')",
  );
  for (const row of rows.rows) {
    if (row.name === "民族歌舞剧《刘三姐》") liusanId = row.id;
    if (row.name === "八桂丝竹·民族器乐组合") artistId = row.id;
  }
  assert.ok(liusanId, "seed has 刘三姐");
  assert.ok(artistId, "seed has the catalog artist");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("刘三姐 neighbours include the honest set, each with its source", async () => {
  const r = await req(`/api/kg/related/${liusanId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byName = new Map((r.data.related || []).map((n) => [n.name, n]));
  // No exact-size assertion here: earlier files in the shared DB may
  // have created shows that the backfill links in on the next boot
  // (their own nodes, by design) — the exact seeded set is locked by
  // the hand-list test below, scoped to the seeded names.
  const expect = [
    ["壮乡情·民族歌舞专场", "show", "related_to", "out", "derived: shared genre 民族歌舞"],
    ["广西文化艺术中心", "venue", "held_at", "out", "R7-6 verified public address: 南宁市良庆区龙堤路25号"],
    ["八桂青年歌舞团", "artist", "performs", "in", "seed:resources.meta.team"],
    ["刘三姐主题IP授权", "ip", "related_to", "out", "seeded copyright: same-IP derivative by name"],
    ["民族歌舞", "genre", "belongs_to", "out", "seed:resources.meta.genre"],
  ];
  for (const [name, kind, relation, direction, source] of expect) {
    const n = byName.get(name);
    assert.ok(n, `missing neighbour ${name}: ${JSON.stringify(r.data.related)}`);
    assert.equal(n.kind, kind, name);
    assert.equal(n.relation, relation, name);
    assert.equal(n.direction, direction, name);
    assert.equal(n.source, source, name);
  }
});

test("assistant answers 刘三姐的演员还有什么戏 from the graph, honestly empty on same-artist", async () => {
  const q = encodeURIComponent("刘三姐的演员还有什么戏");
  const r = await req(`/api/assistant?q=${q}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.kind, "kg", JSON.stringify(r.data));
  const a = r.data.answer;
  assert.ok(a.includes("八桂青年歌舞团"), a);
  // Amended test (Lam decision (c), R2-4 precedent): the team appears
  // once in the seed, so the honest answer is that it has no other
  // show — never a fabricated one.
  assert.ok(a.includes("该团队在平台上没有其他演出"), a);
  assert.ok(a.includes("壮乡情"), a);
  assert.ok(a.includes("广西文化艺术中心"), a);
  assert.ok(a.includes("南宁市良庆区龙堤路25号"), a);
  assert.ok(a.includes("来源：平台种子数据 + 已核实公开地址（R7-6）"), a);
});

test("a node with no edges answers an empty list, never an invented link", async () => {
  const r = await req(`/api/kg/related/${artistId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.related, []);
});

test("invalid kind -> 400", async () => {
  const r = await req(`/api/kg/related/${liusanId}?kind=bogus`);
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test("unknown resource -> 404", async () => {
  const r = await req("/api/kg/related/999999");
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

test("seeded graph matches the hand list exactly: 26 nodes + 7 edges with sources", async () => {
  // Scoped to the SEEDED subgraph by name: earlier files in the shared
  // DB create their own resources, and the backfill (which runs on
  // every boot, by design) gives each of them a node — so a
  // whole-table count would count their leftovers too. The seeded
  // names are fixed (seed.mjs + catalog-content.mjs) and no test
  // fixture reuses one.
  const SEEDED_NAMES = [
    // 6 shows
    "民族歌舞剧《刘三姐》", "壮乡情·民族歌舞专场", "八桂弦歌·民族室内乐专场",
    "山水之间·桂林民谣音乐会", "邕城故事·城市小剧场", "铜鼓回响·壮乡舞蹈诗",
    // 5 artists
    "青年山歌演唱组合", "八桂丝竹·民族器乐组合", "柳江青年·民谣乐队",
    "山歌有约·壮乡歌舞团", "桂北声场·青年合唱团",
    // 6 venues
    "广西文化艺术中心", "南宁小剧场", "邕江艺术空间·黑匣子剧场",
    "漓江畔·山水露天舞台", "柳江青年艺术剧场", "海风文化客厅·多功能厅",
    // 6 ip (copyright)
    "刘三姐主题IP授权", "花山岩画主题舞美设计", "八桂纹样·视觉素材授权包",
    "山水舞台·原创配乐使用咨询", "数字山水·沉浸视觉内容包", "桂风雅集·演出策划文本合作",
    // 1 genre + 2 teams (ref_id NULL nodes)
    "民族歌舞", "八桂青年歌舞团", "壮乡艺术团",
  ];
  const nodes = await pool.query(
    "SELECT id, kind, name FROM kg_nodes WHERE name = ANY($1)",
    [SEEDED_NAMES],
  );
  assert.equal(nodes.rows.length, 26, JSON.stringify(nodes.rows.map((r) => r.name)));
  const byKind = {};
  for (const r of nodes.rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  assert.deepEqual(byKind, { artist: 7, genre: 1, ip: 6, show: 6, venue: 6 });
  const ids = nodes.rows.map((r) => r.id);
  const edges = await pool.query(
    `SELECT a.name AS from_name, e.relation, b.name AS to_name, e.source
       FROM kg_edges e
       JOIN kg_nodes a ON a.id = e.from_id
       JOIN kg_nodes b ON b.id = e.to_id
      WHERE e.from_id = ANY($1) AND e.to_id = ANY($1)`,
    [ids],
  );
  const got = edges.rows
    .map((r) => [r.from_name, r.relation, r.to_name, r.source].join(" | "))
    .sort();
  const want = [
    ["八桂青年歌舞团", "performs", "民族歌舞剧《刘三姐》", "seed:resources.meta.team"],
    ["壮乡艺术团", "performs", "壮乡情·民族歌舞专场", "seed:resources.meta.team"],
    ["民族歌舞剧《刘三姐》", "belongs_to", "民族歌舞", "seed:resources.meta.genre"],
    ["民族歌舞剧《刘三姐》", "held_at", "广西文化艺术中心", "R7-6 verified public address: 南宁市良庆区龙堤路25号"],
    ["民族歌舞剧《刘三姐》", "related_to", "刘三姐主题IP授权", "seeded copyright: same-IP derivative by name"],
    ["民族歌舞剧《刘三姐》", "related_to", "壮乡情·民族歌舞专场", "derived: shared genre 民族歌舞"],
    ["壮乡情·民族歌舞专场", "belongs_to", "民族歌舞", "seed:resources.meta.genre"],
  ]
    .map((row) => row.join(" | "))
    .sort();
  assert.deepEqual(got, want);
});

test("a draft resource's graph -> 404, and the fixture is deleted again", async () => {
  const created = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R7 KG draft show",
      category: "show",
      city: "南宁",
      price: 10000,
      unit: "张",
      stock: 5,
      shop_id: 1,
      status: "draft",
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const draftId = created.data.resource.id;
  assert.equal(created.data.resource.status, "draft");
  try {
    const r = await req(`/api/kg/related/${draftId}`);
    assert.equal(r.status, 404, JSON.stringify(r.data));
  } finally {
    await pool.query("DELETE FROM resources WHERE id=$1", [draftId]);
  }
});

test("r7-kg i18n: H5 455 keys/language in zh/vi/en + 82 in th/ms/id, miniprogram 269 + 82, equal sets", async () => {
  // i18n: R7-3 adds 1 knowledge-graph key (454 -> 455, 268 -> 269).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [455, 455, 455, 82, 82, 82]);
  for (const k of ["kgRelated"]) {
    for (const l of ["zh", "vi", "en"])
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
    assert.equal(blocks[lang].length, 269, `${lang} key count`);
    for (const k of ["kgRelated"])
      assert.ok(blocks[lang].includes(k), `${k} missing in mini ${lang}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
  const h5sets = data.LANGS.map((l) => new Set(Object.keys(data.I18N[l])));
  assert.ok(
    [...h5sets[0]].every((k) => h5sets[1].has(k) && h5sets[2].has(k)),
    "H5 i18n key sets must be equal across zh/vi/en",
  );
});
