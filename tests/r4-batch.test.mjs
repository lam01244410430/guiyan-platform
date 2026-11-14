// tests/r4-batch.test.mjs: R4-3 (rows 31, 78) — PDA + phone
// scanning: POST /api/verify/batch verifies up to 50 codes in ONE
// transaction, one result per code (used/already_used/not_found/
// void/refund_pending); a bad code never throws the batch;
// re-sending the same batch returns already_used (idempotent, no
// double-use); every attempt writes a verify_logs row. Spawns
// server/server.mjs on TEST_PORT (default 3114) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable
// database (npm test is NOT idempotent on a reused DB).
//
// Covered: mixed batch (fresh -> used, already-used ->
// already_used, unknown -> not_found, void -> void, all in one
// 200 response); idempotent re-send (already_used, no double-use,
// verify_logs grows by exactly the new attempts); >50 codes ->
// 400; empty array / non-array body -> 400; duplicate codes inside
// one batch (first used, second already_used); anonymous -> 401;
// non-admin -> 403; i18n key counts (H5 372, miniprogram 181,
// equal sets).
// NOT covered: a frozen ticket in a batch -> refund_pending —
// pending_refund_tickets does not exist until R4-4, so there is
// no frozen ticket to verify against (the endpoint reuses the
// same information_schema probe as verify, and R4-4 activates it
// by adding the column).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3114);
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

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id };
}

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function payThrough(token, orderId) {
  assert.equal((await transition(token, orderId, "confirm")).status, 200);
  const pay = await transition(token, orderId, "pay");
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  return pay.data;
}

async function logCount(result, code) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM verify_logs WHERE result=$1 AND ($2::text IS NULL OR code=$2)",
    [result, code || null],
  );
  return r.rows[0].n;
}

async function totalLogCount() {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM verify_logs");
  return r.rows[0].n;
}

let adminToken;
let demoToken;
let plain280Id;
// Tickets of the 3-unit order, shared by the batch tests below.
let plainTickets = [];
let voidCode;
let mixedBatch;

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
  const plain = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R4 batch plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plain280Id = plain.data.resource.id;
  const { token } = await register("r4batchbuyer", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 3, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await payThrough(token, o.data.id);
  const list = await req(`/api/orders/${o.data.id}/tickets`, { token });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.tickets.length, 3);
  plainTickets = list.data.tickets.map((t) => t.code);
  // A void ticket: pay a 1-unit order, then refund + approve.
  const { token: token2 } = await register("r4batchrefund", "Test1234");
  const o2 = await req("/api/orders", {
    method: "POST",
    token: token2,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  await payThrough(token2, o2.data.id);
  const list2 = await req(`/api/orders/${o2.data.id}/tickets`, { token: token2 });
  assert.equal(list2.data.tickets.length, 1);
  voidCode = list2.data.tickets[0].code;
  assert.equal((await transition(token2, o2.data.id, "refund", { reason: "不去了" })).status, 200);
  assert.equal((await transition(adminToken, o2.data.id, "approveRefund")).status, 200);
  const after = await req(`/api/orders/${o2.data.id}/tickets`, { token: token2 });
  assert.equal(after.data.tickets[0].status, "void");
  mixedBatch = [plainTickets[1], plainTickets[0], "GY00000000", voidCode];
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("mixed batch: fresh -> used, already-used -> already_used, unknown -> not_found, void -> void, one 200", async () => {
  assert.ok(plainTickets.length === 3, "before() must run first");
  // plainTickets[0] is verified first via the single endpoint, so
  // it enters the batch already used.
  assert.equal((await req(`/api/verify/${plainTickets[0]}`, { method: "POST", token: adminToken })).status, 200);
  const before = {
    used: await logCount("used", plainTickets[1]),
    already: await logCount("already_used", plainTickets[0]),
    notFound: await logCount("not_found", "GY00000000"),
    void: await logCount("void", voidCode),
  };
  const r = await req("/api/verify/batch", {
    method: "POST",
    token: adminToken,
    body: { codes: mixedBatch },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.results.length, 4);
  // Input order is preserved in the results.
  assert.deepEqual(
    r.data.results.map((x) => x.code),
    mixedBatch,
  );
  const byCode = {};
  for (const x of r.data.results) byCode[x.code] = x;
  assert.equal(byCode[plainTickets[1]].result, "used");
  assert.equal(byCode[plainTickets[1]].ticket.status, "used");
  assert.equal(byCode[plainTickets[1]].order.resource_name, "R4 batch plain");
  assert.equal(byCode[plainTickets[0]].result, "already_used");
  assert.equal(byCode[plainTickets[0]].ticket.status, "used");
  assert.equal(byCode[plainTickets[0]].order.resource_name, "R4 batch plain");
  assert.equal(byCode.GY00000000.result, "not_found");
  assert.equal(byCode.GY00000000.ticket, null);
  assert.equal(byCode.GY00000000.order, null);
  assert.equal(byCode[voidCode].result, "void");
  assert.equal(byCode[voidCode].ticket.status, "void");
  assert.equal(byCode[voidCode].order.resource_name, "R4 batch plain");
  // Every attempt wrote a verify_logs row.
  assert.equal(await logCount("used", plainTickets[1]), before.used + 1);
  assert.equal(await logCount("already_used", plainTickets[0]), before.already + 1);
  assert.equal(await logCount("not_found", "GY00000000"), before.notFound + 1);
  assert.equal(await logCount("void", voidCode), before.void + 1);
});

test("idempotent re-send: same batch -> already_used, no double-use, logs grow by exactly the new attempts", async () => {
  const beforeTotal = await totalLogCount();
  const before = await req(`/api/admin/tickets?code=${plainTickets[1]}`, { token: adminToken });
  assert.equal(before.status, 200, JSON.stringify(before.data));
  const verifiedAt = before.data.tickets[0].verified_at;
  const r = await req("/api/verify/batch", {
    method: "POST",
    token: adminToken,
    body: { codes: mixedBatch },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byCode = {};
  for (const x of r.data.results) byCode[x.code] = x;
  assert.equal(byCode[plainTickets[1]].result, "already_used");
  assert.equal(byCode[plainTickets[0]].result, "already_used");
  assert.equal(byCode.GY00000000.result, "not_found");
  assert.equal(byCode[voidCode].result, "void");
  // Exactly 4 new log rows — one per re-sent code, no more.
  assert.equal(await totalLogCount(), beforeTotal + 4);
  // No double-use: verified_at is unchanged.
  const after = await req(`/api/admin/tickets?code=${plainTickets[1]}`, { token: adminToken });
  assert.equal(after.data.tickets[0].status, "used");
  assert.equal(after.data.tickets[0].verified_at, verifiedAt);
});

test(">50 codes -> 400, no verify_logs rows written", async () => {
  const beforeTotal = await totalLogCount();
  const codes = Array.from({ length: 51 }, (_, i) => `GY${String(i).padStart(8, "0")}`);
  const r = await req("/api/verify/batch", {
    method: "POST",
    token: adminToken,
    body: { codes },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(await totalLogCount(), beforeTotal);
});

test("empty array -> 400; non-array body -> 400", async () => {
  const beforeTotal = await totalLogCount();
  assert.equal((await req("/api/verify/batch", {
    method: "POST", token: adminToken, body: { codes: [] },
  })).status, 400);
  assert.equal((await req("/api/verify/batch", {
    method: "POST", token: adminToken, body: { codes: "GY00000000" },
  })).status, 400);
  assert.equal((await req("/api/verify/batch", {
    method: "POST", token: adminToken, body: {},
  })).status, 400);
  assert.equal(await totalLogCount(), beforeTotal);
});

test("duplicate codes inside one batch: first used, second already_used", async () => {
  const code = plainTickets[2];
  const beforeUsed = await logCount("used", code);
  const beforeAlready = await logCount("already_used", code);
  const r = await req("/api/verify/batch", {
    method: "POST",
    token: adminToken,
    body: { codes: [code, code] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.results.length, 2);
  assert.equal(r.data.results[0].result, "used");
  assert.equal(r.data.results[1].result, "already_used");
  assert.equal(await logCount("used", code), beforeUsed + 1);
  assert.equal(await logCount("already_used", code), beforeAlready + 1);
});

test("anonymous batch -> 401, no verify_logs rows written", async () => {
  const beforeTotal = await totalLogCount();
  assert.equal((await req("/api/verify/batch", {
    method: "POST", body: { codes: ["GY00000000"] },
  })).status, 401);
  assert.equal(await totalLogCount(), beforeTotal);
});

test("non-admin batch -> 403, no verify_logs rows written", async () => {
  const beforeTotal = await totalLogCount();
  assert.equal((await req("/api/verify/batch", {
    method: "POST", token: demoToken, body: { codes: ["GY00000000"] },
  })).status, 403);
  assert.equal(await totalLogCount(), beforeTotal);
});

test("i18n 384/193: 7 new batch keys mini-only, equal sets", async () => {
  // R4-3 adds 7 batch/queue/scan keys on the mini-program only
  // (169 -> 176); H5 stayed 367 then — the admin batch UI labels are
  // hardcoded Chinese per the admin rule. R4-4 moves both sides to
  // 384/193 (5 partial-refund/pickup keys); R6-1 adds 12 license keys (372 -> 384, 181 -> 193).
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [384, 384, 384]);
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
    assert.equal(blocks[lang].length, 193, `${lang} key count`);
    for (const k of ["verifyBatchTitle", "verifyScan", "verifyBatchPaste", "verifyBatchSync", "verifyQueueTitle", "verifyQueueEmpty", "verifyAdminOnly"])
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
