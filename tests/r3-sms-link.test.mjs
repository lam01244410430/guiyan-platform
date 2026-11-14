// tests/r3-sms-link.test.mjs: R3-5 (rows 18, 25) — SMS tasks + account
// linking / 短信群发 + 关联账号. Spawns server/server.mjs on TEST_PORT
// (default 3111) and talks to it over HTTP. DATABASE_URL must point at
// a FRESH disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered: admin SMS task create/list/get + validation (bad template
// placeholders, unbalanced braces, >500 chars, empty template; bad
// audience rules, unknown keys, tier of another shop; create with a
// non-draft status -> 400); status flow draft -> queued ->
// waiting_provider (terminal — any later PATCH -> 400) and `sent` is
// unreachable (create or PATCH naming it -> 400); content frozen once
// queued; audience counts computed at creation (all = user count,
// tier = stored tier holders, compared against live DB counts);
// cross-shop -> 403, anon/non-admin -> 403; PATCH /api/account/social
// with a bad key -> 400, maoyan handle stored + returned + deletable
// by empty string; i18n key counts (H5 448, miniprogram 262, equal
// sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3111);
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

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function orderAs(token, body) {
  return req("/api/orders", { method: "POST", token, body });
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
}

async function plainOrder(token) {
  const o = await orderAs(token, {
    resourceId: plainResourceId, quantity: 1, booking_date: "2026-12-05",
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.amount, 28000);
  return o.data.id;
}

async function createTask(token, body) {
  return req("/api/admin/sms-tasks", { method: "POST", token, body });
}

async function patchTask(token, taskId, body) {
  return req(`/api/admin/sms-tasks/${taskId}`, { method: "PATCH", token, body });
}

async function getTask(token, taskId) {
  return req(`/api/admin/sms-tasks/${taskId}`, { token });
}

async function dbCount(sql, params = []) {
  const row = await pool.query(sql, params);
  return Number(row.rows[0].n);
}

async function silverTierId() {
  const tiers = await req("/api/shops/1/member-tiers");
  assert.equal(tiers.status, 200, JSON.stringify(tiers.data));
  const silver = (tiers.data.member_tiers || []).find((t) => t.name === "银卡会员");
  assert.ok(silver, "银卡会员 tier missing");
  return silver.id;
}

let adminToken;
let demoToken;
let plainResourceId;

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
  demoToken = await login("demo", "demo123");
  // A deterministic ¥280 plain resource for old-flow orders (price
  // 28000 cents, stock 100). Fresh registered users hold no tier, so
  // their orders are full price until they earn one.
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R3 sms plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plainResourceId = plain.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("admin sms-task create/list/get: empty list, draft + audience count, 404, anon/non-admin 403", async () => {
  // Empty list on a fresh DB; anonymous + demo -> 403 (never 401).
  const empty = await req("/api/admin/sms-tasks", { token: adminToken });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.sms_tasks, []);
  assert.equal((await req("/api/admin/sms-tasks")).status, 403);
  assert.equal((await req("/api/admin/sms-tasks", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/sms-tasks/99999", { token: adminToken })).status, 404);
  assert.equal((await createTask(demoToken, { name: "NOPE", template: "hi" })).status, 403);
  assert.equal((await createTask(undefined, { name: "NOPE", template: "hi" })).status, 403);

  // Create: always a draft, audience count computed at creation.
  const users = await dbCount("SELECT COUNT(*) AS n FROM users");
  assert.ok(users >= 139, `expected at least the 139 seed users, got ${users}`);
  const created = await createTask(adminToken, {
    name: "T1 新演出通知",
    template: "{{name}}您好，新演出已开票，券码{{code}}",
    audience: { type: "all" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.sms_task.name, "T1 新演出通知");
  assert.equal(created.data.sms_task.status, "draft");
  assert.equal(created.data.sms_task.status_label, "草稿");
  assert.deepEqual(created.data.sms_task.audience, { type: "all" });
  assert.equal(created.data.sms_task.audience_count, users);
  assert.equal(created.data.sms_task.shop_id, 1);

  // Detail round-trips; the list shows the one task.
  const detail = await getTask(adminToken, created.data.sms_task.id);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.sms_task.audience_count, users);
  const list = await req("/api/admin/sms-tasks", { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.sms_tasks.length, 1);
});

test("sms-task validation -> 400: bad template, bad audience, non-draft create status", async () => {
  const badTemplates = [
    "", // empty
    "x".repeat(501), // over 500 chars
    "您好{{foo}}", // unknown placeholder
    "您好{{name}", // unbalanced opening braces
    "您好{{name}}}", // trailing brace
    "您好{name}}", // single braces
  ];
  for (const template of badTemplates)
    assert.equal(
      (await createTask(adminToken, { name: "BAD", template, audience: { type: "all" } })).status,
      400,
      `template should fail: ${JSON.stringify(template.slice(0, 40))}`,
    );
  // A template with only the two allowed placeholders passes.
  const ok = await createTask(adminToken, {
    name: "T2 占位符", template: "{{name}}好，{{code}}", audience: { type: "all" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  const badAudiences = [
    { type: "everyone" }, // unknown type
    { type: "all", tier_id: 1 }, // tier_id meaningless for "all"
    { type: "tier" }, // tier without tier_id
    { type: "tier", tier_id: 99999 }, // unknown tier
    { type: "all", foo: 1 }, // unknown key
    "all", // not an object
    [1], // array, not an object
  ];
  for (const audience of badAudiences)
    assert.equal(
      (await createTask(adminToken, { name: "BAD", template: "hi {{name}}", audience })).status,
      400,
      `audience should fail: ${JSON.stringify(audience)}`,
    );

  // A task is always created as a draft — naming any other status
  // (including `sent`, which does not exist in this wave) is a 400.
  assert.equal((await createTask(adminToken, {
    name: "BAD", template: "hi", audience: { type: "all" }, status: "sent",
  })).status, 400);
  assert.equal((await createTask(adminToken, {
    name: "BAD", template: "hi", audience: { type: "all" }, status: "queued",
  })).status, 400);
  assert.equal((await createTask(adminToken, {
    name: "BAD", template: "hi", audience: { type: "all" }, status: "bogus",
  })).status, 400);
  // shop_id is validated too: an unknown shop -> 404.
  assert.equal((await createTask(adminToken, {
    name: "BAD", template: "hi", audience: { type: "all" }, shop_id: 99999,
  })).status, 404);
});

test("sms-task status flow: draft -> queued -> waiting_provider is terminal; sent is unreachable", async () => {
  const created = await createTask(adminToken, {
    name: "T3 状态流", template: "hi {{name}}", audience: { type: "all" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.sms_task.id;

  // `sent` is unreachable from draft, as is any unknown status.
  assert.equal((await patchTask(adminToken, id, { status: "sent" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { status: "bogus" })).status, 400);
  // A no-op PATCH (nothing to change) -> 400.
  assert.equal((await patchTask(adminToken, id, {})).status, 400);
  // shop_id is immutable after creation.
  assert.equal((await patchTask(adminToken, id, { shop_id: 2 })).status, 400);

  // Draft -> queued, with a content edit along the way (allowed in draft).
  const queued = await patchTask(adminToken, id, {
    name: "T3 状态流改名", status: "queued",
  });
  assert.equal(queued.status, 200, JSON.stringify(queued.data));
  assert.equal(queued.data.sms_task.status, "queued");
  assert.equal(queued.data.sms_task.status_label, "已排队");
  assert.equal(queued.data.sms_task.name, "T3 状态流改名");
  // Queued: content is frozen (name/template/audience all -> 400),
  // but the status may go back to draft.
  assert.equal((await patchTask(adminToken, id, { name: "X" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { template: "hi" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { audience: { type: "all" } })).status, 400);
  const back = await patchTask(adminToken, id, { status: "draft" });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.sms_task.status, "draft");
  // Draft again: changing the audience recomputes the count.
  const users = await dbCount("SELECT COUNT(*) AS n FROM users");
  const reaudience = await patchTask(adminToken, id, { audience: { type: "all" } });
  assert.equal(reaudience.status, 200, JSON.stringify(reaudience.data));
  assert.equal(reaudience.data.sms_task.audience_count, users);

  // Draft -> queued -> waiting_provider, then terminal: any later
  // PATCH (status or content) -> 400.
  assert.equal((await patchTask(adminToken, id, { status: "queued" })).status, 200);
  const waiting = await patchTask(adminToken, id, { status: "waiting_provider" });
  assert.equal(waiting.status, 200, JSON.stringify(waiting.data));
  assert.equal(waiting.data.sms_task.status, "waiting_provider");
  assert.equal(waiting.data.sms_task.status_label, "未发送 — 等待服务商");
  assert.equal((await patchTask(adminToken, id, { status: "draft" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { status: "queued" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { status: "sent" })).status, 400);
  assert.equal((await patchTask(adminToken, id, { name: "X" })).status, 400);
  // Non-admin cannot patch either (403, and the terminal task is untouched).
  assert.equal((await patchTask(demoToken, id, { status: "draft" })).status, 403);
  const still = await getTask(adminToken, id);
  assert.equal(still.data.sms_task.status, "waiting_provider");
});

test("audience counts are computed at creation: all = user count, tier = stored tier holders", async () => {
  // Earn a silver tier for a fresh user: 4 x ¥280 pays = ¥1120
  // spending, past the ¥1000 Silver threshold (same shape as the
  // R3-4 tier-upgrade test).
  const token = await register("smstier", "Test1234");
  for (let i = 0; i < 4; i++) {
    const o = await plainOrder(token);
    await payThrough(token, o);
  }
  const tier = await req("/api/account/tier", { token });
  assert.equal(tier.data.tier.name, "银卡会员");
  const silverId = await silverTierId();

  // The tier audience counts exactly the stored holders of that tier
  // (earlier test files may have left other silver holders behind,
  // so the expectation comes from the DB, not a fixed number).
  const holders = await dbCount(
    "SELECT COUNT(*) AS n FROM users WHERE tier_id=$1",
    [silverId],
  );
  assert.ok(holders >= 1, `expected at least the new silver holder, got ${holders}`);
  const tierTask = await createTask(adminToken, {
    name: "T4 银卡受众",
    template: "银卡会员专享 {{name}}",
    audience: { type: "tier", tier_id: silverId },
  });
  assert.equal(tierTask.status, 200, JSON.stringify(tierTask.data));
  assert.deepEqual(tierTask.data.sms_task.audience, { type: "tier", tier_id: silverId });
  assert.equal(tierTask.data.sms_task.audience_count, holders);

  // The all audience counts every user at creation time.
  const users = await dbCount("SELECT COUNT(*) AS n FROM users");
  const allTask = await createTask(adminToken, {
    name: "T4 全部受众", template: "hi {{name}}", audience: { type: "all" },
  });
  assert.equal(allTask.status, 200, JSON.stringify(allTask.data));
  assert.equal(allTask.data.sms_task.audience_count, users);
});

test("audience tier of another shop -> 400; cross-shop admin cannot create/patch/read shop-1 tasks", async () => {
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r3sms-admin", pw, "R3 短信子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R3 短信分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  const shopBId = shop.data.shop.id;
  const shopAdminToken = await login("r3sms-admin", "Admin1234");
  // A tier in shop B (created by the shop admin in their own shop).
  const tierB = await req("/api/admin/member-tiers", {
    method: "POST", token: shopAdminToken,
    body: { name: "分店银卡", min_spend_cents: 100000, discount_pct: 5 },
  });
  assert.equal(tierB.status, 200, JSON.stringify(tierB.data));
  const tierBId = tierB.data.member_tier.id;
  // A shop-B tier cannot be the audience of a shop-1 task.
  assert.equal((await createTask(adminToken, {
    name: "MISMATCH", template: "hi", audience: { type: "tier", tier_id: tierBId },
  })).status, 400);

  // A shop-1 task to attempt against (created by the platform admin).
  const t1 = await createTask(adminToken, {
    name: "T5 主店任务", template: "hi {{name}}", audience: { type: "all" },
  });
  assert.equal(t1.status, 200, JSON.stringify(t1.data));
  const t1Id = t1.data.sms_task.id;
  // Shop admin cannot create a task in shop 1 or patch / read a
  // shop-1 task (cross-shop -> 403).
  assert.equal((await createTask(shopAdminToken, { shop_id: 1, name: "XSHOP", template: "hi" })).status, 403);
  assert.equal((await patchTask(shopAdminToken, t1Id, { status: "queued" })).status, 403);
  assert.equal((await getTask(shopAdminToken, t1Id)).status, 403);
  // The shop admin CAN create in their own shop (no shop_id needed).
  const bTask = await createTask(shopAdminToken, {
    name: "T5 分店任务", template: "hi {{name}}", audience: { type: "all" },
  });
  assert.equal(bTask.status, 200, JSON.stringify(bTask.data));
  assert.equal(bTask.data.sms_task.shop_id, shopBId);
  // The platform admin CAN create into shop B explicitly.
  const pbTask = await createTask(adminToken, {
    name: "T5 平台代建分店任务", template: "hi", audience: { type: "all" }, shop_id: shopBId,
  });
  assert.equal(pbTask.status, 200, JSON.stringify(pbTask.data));
  assert.equal(pbTask.data.sms_task.shop_id, shopBId);
});

test("social: bad key -> 400; maoyan handle stored + returned; empty string deletes it", async () => {
  const token = await register("smslink", "Test1234");
  // Anonymous users cannot patch social links (401).
  assert.equal((await req("/api/account/social", {
    method: "PATCH", body: { maoyan: "x" },
  })).status, 401);
  // A bad key -> 400; an over-long handle -> 400.
  assert.equal((await req("/api/account/social", {
    method: "PATCH", token, body: { weibo: "x" },
  })).status, 400);
  assert.equal((await req("/api/account/social", {
    method: "PATCH", token, body: { maoyan: "x".repeat(101) },
  })).status, 400);
  // Maoyan stores alongside the existing keys, display-only: the
  // response returns the merged map, no verification of any kind.
  const saved = await req("/api/account/social", {
    method: "PATCH", token, body: { douyin: "sms_douyin", maoyan: "maoyan123" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.social.maoyan, "maoyan123");
  assert.equal(saved.data.social.douyin, "sms_douyin");
  // An empty string deletes just that link; the other key survives.
  const cleared = await req("/api/account/social", {
    method: "PATCH", token, body: { maoyan: "" },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.social.maoyan, undefined);
  assert.equal(cleared.data.social.douyin, "sms_douyin");
});

test("r3-sms-link i18n: H5 448 keys/language, miniprogram 262, equal sets", async () => {
  // i18n: 1 new socMaoyan key on H5 only (353 -> 354); the
  // miniprogram has no social-links UI at all (all soc* keys are
  // H5-only), so it stays at 157; R3-6 adds 6 stored-value keys on
  // both sides (354 -> 360, 157 -> 163); R4-1 adds 6 ticket keys H5 (360 -> 366), 5 mini (163 -> 168); R4-2 adds 1 print key (366 -> 367, 168 -> 169); R4-3 adds 7 batch keys mini-only (169 -> 176); R4-4 adds 5 partial-refund/pickup keys (367 -> 372, 176 -> 181); R6-1 adds 12 license keys (372 -> 384, 181 -> 193). R6-2 adds 13 library keys (384 -> 397, 193 -> 206). R6-3 adds 2 creative keys H5 (397 -> 399), 1 mini (206 -> 207). R6-4 adds 6 match keys (399 -> 405) + 5 filter-bar keys mini-only (207 -> 218). R6-5 adds 13 comment/message-type keys (405 -> 418, 218 -> 231). R6-6 adds 5 escrow keys (418 -> 423, 231 -> 236). R7-2 adds 4 voice keys H5 (423 -> 427), 5 mini (236 -> 241).; R7-3 adds 1 knowledge-graph key (427 -> 428, 241 -> 242).; R7-6 adds 20 context/itinerary keys (428 -> 448, 242 -> 262).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const l of data.LANGS)
    assert.ok("socMaoyan" in data.I18N[l], `socMaoyan missing in H5 ${l}`);
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
    assert.ok(!blocks[lang].includes("socMaoyan"), `socMaoyan must stay H5-only, found in mini ${lang}`);
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
