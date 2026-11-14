// tests/r7-auto-tags.test.mjs: R7-5 (rows 50, 53) — deep portrait +
// auto-tagging. Spawns server/server.mjs on TEST_PORT (default 3122)
// and talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) 3 folk-genre views grant 喜欢民族音乐; (2) fewer than 3
// grant nothing; (3) manual user_tags rows are untouched by auto
// evaluation; (4) GET /api/admin/users?tag= finds the auto-tagged user
// and excludes the untagged one; (5) a disabled auto rule grants
// nothing; (6) a paid show order grants an order_category auto rule;
// (7) PATCH /api/admin/tag-rules rejects bad auto rules with 400;
// (8) re-evaluation never duplicates the auto-tag row;
// (9) B-053: saving the default rule set keeps the auto rule intact
// (no `conditions` injected — the server validator refuses them —
// and the signal survives), and an auto rule with `conditions: []`
// is rejected with 400.
//
// Genre grounding (verified in code, never invented): the only genre
// value in the seed is meta.genre "民族歌舞" (resources 2 刘三姐 and
// 3 壮乡情); there is no category or genre named 民族音乐 for shows.
// The default auto rule therefore counts view events of genre 民族歌舞
// and grants the tag 喜欢民族音乐 (the approved R7-5 example text).
//
// Tests run in file order (node:test default): test 8 re-uses test 1's
// user, and tests 5–7 restore the default rules in `finally` so later
// tests see the same rules. This file runs LAST in `npm test`.
//
// i18n key counts (H5 455, miniprogram 269) are asserted by
// tests/r4-tickets.test.mjs, tests/r2-pickup.test.mjs and
// tests/p3bugs.test.mjs — this file adds NO customer-visible string
// (the tag text is data, the admin labels are hardcoded Chinese), so
// the counts stay 455/269.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3122);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

const FOLK_TAG = "喜欢民族音乐";
// The two seed resources with meta.genre "民族歌舞" (verified in
// server/seed.mjs): 2 刘三姐, 3 壮乡情.
const FOLK_SHOWS = [2, 2, 3];

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

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function userId(username) {
  const row = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
  return row.rows[0].id;
}

async function view(token, resourceId) {
  const r = await req(`/api/resources/${resourceId}/view`, { method: "POST", token });
  assert.equal(r.status, 200, `view ${resourceId} -> ${r.status} ${JSON.stringify(r.data)}`);
}

async function viewFolkShows(token) {
  for (const id of FOLK_SHOWS) await view(token, id);
}

async function adminUsers(adminToken, qs = "") {
  const r = await req(`/api/admin/users${qs}`, { token: adminToken });
  assert.equal(r.status, 200, `admin users ${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.users;
}

async function tagsOf(adminToken, id) {
  const users = await adminUsers(adminToken);
  const u = users.find((x) => x.id === id);
  assert.ok(u, `user ${id} must be in GET /api/admin/users`);
  return u.tags;
}

async function storedTags(id) {
  const rows = await pool.query(
    "SELECT tag, source FROM user_tags WHERE user_id=$1 ORDER BY tag, source",
    [id],
  );
  return rows.rows;
}

async function getTagRules(adminToken) {
  const r = await req("/api/admin/tag-rules", { token: adminToken });
  assert.equal(r.status, 200, `tag-rules GET -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.tagRules;
}

async function patchTagRules(adminToken, tagRules) {
  return req("/api/admin/tag-rules", {
    method: "PATCH",
    token: adminToken,
    body: { tagRules },
  });
}

async function restoreTagRules(adminToken, defaults) {
  const r = await patchTagRules(adminToken, defaults);
  assert.equal(r.status, 200, `restore tag-rules -> ${r.status} ${JSON.stringify(r.data)}`);
}

let adminToken;
let view1Token;
let view1Id;

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: "demo123",
      ADMIN_PASSWORD: "admin123",
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
  view1Token = await register("r7tagview1", "Test1234");
  view1Id = await userId("r7tagview1");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("R7-5: 3 folk-genre views grant 喜欢民族音乐", async () => {
  await viewFolkShows(view1Token);
  const tags = await tagsOf(adminToken, view1Id);
  assert.ok(tags.includes(FOLK_TAG), `tags must include ${FOLK_TAG}: ${JSON.stringify(tags)}`);
  const filtered = await adminUsers(adminToken, `?tag=${encodeURIComponent(FOLK_TAG)}`);
  assert.ok(
    filtered.some((u) => u.id === view1Id),
    `?tag= filter must find the auto-tagged user ${view1Id}`,
  );
  const rows = await storedTags(view1Id);
  assert.deepEqual(
    rows.filter((r) => r.tag === FOLK_TAG),
    [{ tag: FOLK_TAG, source: "auto" }],
  );
});

test("R7-5: fewer than 3 folk-genre views grant nothing", async () => {
  const token = await register("r7tagview2", "Test1234");
  const id = await userId("r7tagview2");
  await view(token, 2);
  await view(token, 2);
  const tags = await tagsOf(adminToken, id);
  assert.ok(!tags.includes(FOLK_TAG), `2 views must not grant ${FOLK_TAG}: ${JSON.stringify(tags)}`);
  const filtered = await adminUsers(adminToken, `?tag=${encodeURIComponent(FOLK_TAG)}`);
  assert.ok(
    !filtered.some((u) => u.id === id),
    "?tag= filter must exclude the user with only 2 views",
  );
  assert.deepEqual(await storedTags(id), []);
});

test("R7-5: manual tags are untouched by auto evaluation", async () => {
  const token = await register("r7tagmanual", "Test1234");
  const id = await userId("r7tagmanual");
  await pool.query(
    "INSERT INTO user_tags(user_id,tag,source,created_at) VALUES($1,$2,'manual',NOW())",
    [id, "手动标签"],
  );
  await viewFolkShows(token);
  const tags = await tagsOf(adminToken, id);
  assert.ok(tags.includes(FOLK_TAG), `auto tag must be granted: ${JSON.stringify(tags)}`);
  assert.ok(tags.includes("手动标签"), `manual tag must survive: ${JSON.stringify(tags)}`);
  const rows = await storedTags(id);
  assert.equal(
    rows.filter((r) => r.tag === "手动标签" && r.source === "manual").length,
    1,
    `manual row must stay exactly one: ${JSON.stringify(rows)}`,
  );
  assert.equal(
    rows.filter((r) => r.tag === FOLK_TAG && r.source === "manual").length,
    0,
    "auto evaluation must never write a source='manual' row",
  );
});

test("R7-5: ?tag= filter finds auto-tagged users, excludes untagged ones", async () => {
  const token = await register("r7tagfilter", "Test1234");
  const id = await userId("r7tagfilter");
  await viewFolkShows(token);
  const filtered = await adminUsers(adminToken, `?tag=${encodeURIComponent(FOLK_TAG)}`);
  const ids = filtered.map((u) => u.id);
  assert.ok(ids.includes(view1Id), "?tag= must include test 1 user");
  assert.ok(ids.includes(id), "?tag= must include the newly tagged user");
  const view2Id = await userId("r7tagview2");
  assert.ok(!ids.includes(view2Id), "?tag= must exclude the 2-view user");
});

test("R7-5: a disabled auto rule grants nothing, then defaults restore", async () => {
  const defaults = await getTagRules(adminToken);
  assert.ok(defaults.some((r) => r.id === "folk" && r.mode === "auto"));
  try {
    const disabled = defaults.map((r) =>
      r.id === "folk" ? { ...r, enabled: false } : r,
    );
    const saved = await patchTagRules(adminToken, disabled);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const token = await register("r7tagoff", "Test1234");
    const id = await userId("r7tagoff");
    await viewFolkShows(token);
    const tags = await tagsOf(adminToken, id);
    assert.ok(!tags.includes(FOLK_TAG), `disabled rule must not grant: ${JSON.stringify(tags)}`);
    assert.deepEqual(await storedTags(id), []);
  } finally {
    await restoreTagRules(adminToken, defaults);
  }
  assert.deepEqual(await getTagRules(adminToken), defaults);
});

test("R7-5: a paid show order grants an order_category auto rule", async () => {
  const defaults = await getTagRules(adminToken);
  const orderRule = {
    id: "ordshow",
    name: "已购演出",
    enabled: true,
    mode: "auto",
    signal: { kind: "order_category", category: "show", threshold: 1 },
  };
  try {
    const saved = await patchTagRules(adminToken, [...defaults, orderRule]);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const token = await register("r7tagorder", "Test1234");
    const id = await userId("r7tagorder");
    const o = await req("/api/orders", {
      method: "POST",
      token,
      body: { resourceId: 2, quantity: 1, booking_date: "2026-12-05" },
    });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.amount, 28000);
    for (const action of ["confirm", "pay"]) {
      const r = await req(`/api/orders/${o.data.id}/${action}`, { method: "POST", token });
      assert.equal(r.status, 200, `${action} -> ${r.status} ${JSON.stringify(r.data)}`);
    }
    const tags = await tagsOf(adminToken, id);
    assert.ok(tags.includes("已购演出"), `paid show order must grant 已购演出: ${JSON.stringify(tags)}`);
    assert.ok(!tags.includes(FOLK_TAG), "no views means no folk tag");
  } finally {
    await restoreTagRules(adminToken, defaults);
  }
  assert.deepEqual(await getTagRules(adminToken), defaults);
});

test("R7-5: PATCH tag-rules rejects bad auto rules with 400", async () => {
  const defaults = await getTagRules(adminToken);
  const base = {
    id: "t1",
    name: "测试自动标签",
    enabled: true,
    mode: "auto",
    signal: { kind: "view_genre", genre: "民族歌舞", threshold: 3 },
  };
  const bad = [
    { ...base, mode: "bogus" },
    { ...base, signal: undefined },
    { ...base, signal: { kind: "nope", genre: "民族歌舞", threshold: 3 } },
    { ...base, signal: { kind: "view_category", category: "nope", threshold: 1 } },
    { ...base, signal: { kind: "view_genre", genre: "民族歌舞", threshold: 0 } },
    {
      ...base,
      conditions: [{ field: "spent", op: "gte", value: 0 }],
    },
    // B-053: an empty conditions array is still conditions — the
    // validator requires it to be absent (undefined) on auto rules,
    // so the admin UI must never inject `conditions: []` on save.
    { ...base, conditions: [] },
  ];
  try {
    for (const rules of bad) {
      const r = await patchTagRules(adminToken, [rules]);
      assert.equal(r.status, 400, `${JSON.stringify(rules)} -> ${r.status} ${JSON.stringify(r.data)}`);
    }
    // Rules are unchanged after the rejected PATCHes.
    assert.deepEqual(await getTagRules(adminToken), defaults);
    // A valid auto rule is accepted (then restored below).
    const ok = await patchTagRules(adminToken, [...defaults, base]);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.tagRules.find((r) => r.id === "t1").mode, "auto");
  } finally {
    await restoreTagRules(adminToken, defaults);
  }
  assert.deepEqual(await getTagRules(adminToken), defaults);
});

test("B-053: saving the default rule set keeps the auto rule intact", async () => {
  const defaults = await getTagRules(adminToken);
  const folk = defaults.find((r) => r.id === "folk");
  assert.ok(folk && folk.mode === "auto", `folk must be an auto rule: ${JSON.stringify(folk)}`);
  assert.equal("conditions" in folk, false, "stored auto rule must carry no conditions key");
  // Save exactly what the admin UI loads (the B-053 save path): the
  // whole default set, unchanged. The UI must not inject conditions
  // into the auto rule, and the signal must survive the round-trip.
  const saved = await patchTagRules(adminToken, defaults);
  assert.equal(saved.status, 200, `save defaults -> ${saved.status} ${JSON.stringify(saved.data)}`);
  const folkSaved = saved.data.tagRules.find((r) => r.id === "folk");
  assert.equal(folkSaved.mode, "auto");
  assert.equal("conditions" in folkSaved, false, "saved auto rule must carry no conditions key");
  assert.deepEqual(folkSaved.signal, { kind: "view_genre", genre: "民族歌舞", threshold: 3 });
  const highSaved = saved.data.tagRules.find((r) => r.id === "high");
  assert.equal(highSaved.mode, "manual");
  assert.equal(highSaved.conditions.length, 1, "manual rules keep their conditions");
  // Stored state matches what was saved.
  assert.deepEqual(await getTagRules(adminToken), defaults);
});

test("R7-5: re-evaluation never duplicates the auto-tag row", async () => {
  await viewFolkShows(view1Token);
  const rows = await storedTags(view1Id);
  assert.equal(
    rows.filter((r) => r.tag === FOLK_TAG && r.source === "auto").length,
    1,
    `exactly one auto row after 6 views: ${JSON.stringify(rows)}`,
  );
  const tags = await tagsOf(adminToken, view1Id);
  assert.equal(
    tags.filter((t) => t === FOLK_TAG).length,
    1,
    `tag must appear exactly once: ${JSON.stringify(tags)}`,
  );
});
