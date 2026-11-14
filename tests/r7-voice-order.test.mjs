// tests/r7-voice-order.test.mjs: R7-7 (rows 56, 57, 44) — voice ticket
// purchase + elderly-friendly + dialect frame.
//
// Spawns server/server.mjs on TEST_PORT (default 3108) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) a correct command parses (quantity + show + date) into
// a DRAFT order (pending, full price, channel 语音购票); (2) nothing is
// charged or turned paid before confirmation — pay from pending is a
// 400, and the draft only reaches paid through the normal
// confirm -> pay simulated flow; (3) parse failure -> 400 with no order
// created, and anonymous -> 401; (4) a known show with no performance
// that day -> 400, no order; (5) insufficient stock -> 409, no order;
// (6) the dialect frame: GET /api/voice/dialects lists 4 dialects, all
// recognition:false; a yue request parses exactly like putonghua and
// only the placeholder differs; an unknown dialect -> 400; (7) the
// large-text flag does not affect ordering logic, and the toggle exists
// (H5 localStorage key + mini-program storage key + i18n key);
// (8) i18n counts H5 455 / miniprogram 269 with the 7 new keys present
// on both sides.
//
// Dates use the server UTC calendar day: "今晚" is tonight,
// 2026-11-14 (the day this wave runs). The two test shows are created
// in the before hook and exist only in this disposable DB.
//
// i18n key counts (H5 455, miniprogram 269, equal sets) are asserted by
// the 22+ count files — this file asserts the behaviour plus the 7 new
// keys' presence. The 7 new keys are presence-checked here, not just
// counted: voiceTitle, voicePh, voiceDraft, voiceDialect,
// voiceDialectNote, largeText, voiceSteps.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5447/guiyan_test",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3108);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// "Tonight" on the server UTC calendar day (same basis as the
// parser's date words); tomorrow has no performance on purpose.
const TONIGHT = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const PERF_START = `${TONIGHT}T19:30:00`;
const SMALL_START = `${TONIGHT}T20:00:00`;

let proc;
let adminToken;
let mainShowResourceId;
let showId;
let smallShowId;

async function req(p, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text };
}

async function login(username = "demo", password = process.env.DEMO_PASSWORD) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

async function registerUser(username) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password: "Test1234", name: "R77 Voice" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

async function createShow(token, body) {
  return req("/api/shows", { method: "POST", token, body });
}
async function reviewShow(token, id, body) {
  return req(`/api/admin/shows/${id}`, { method: "PATCH", token, body });
}
async function createPerf(token, showIdArg, body) {
  return req(`/api/shows/${showIdArg}/performances`, {
    method: "POST",
    token,
    body,
  });
}
async function patchPerf(token, id, body) {
  return req(`/api/admin/performances/${id}`, {
    method: "PATCH",
    token,
    body,
  });
}
async function createTier(token, perfId, body) {
  return req(`/api/performances/${perfId}/ticket-types`, {
    method: "POST",
    token,
    body,
  });
}

async function voiceOrder(token, body) {
  return req("/api/voice-order", { method: "POST", token, body });
}

async function orderCount(token) {
  const r = await req("/api/orders", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.orders.length;
}

async function getOrder(token, id) {
  const r = await req(`/api/orders/${id}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.order;
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: r7-voice-order never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[r7-voice-server] ${d}`));
  proc.stderr.on("data", (d) =>
    process.stderr.write(`[r7-voice-server:err] ${d}`),
  );
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("r7-voice-order server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
  adminToken = await adminLogin();
  // Create our OWN show resource. In the full suite the shared DB
  // already holds shop-1 show resources from earlier files, and the
  // first one in list order can be a draft (R6-5 left one) -- a show
  // built on it is created fine, but createOrder then 404s with
  // "resource does not exist or is delisted". A dedicated published
  // resource keeps this file independent of shared seed state.
  const cr = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R77 voice show",
      category: "show",
      city: "南宁",
      price: 28000,
      unit: "张",
      stock: 100,
      shop_id: 1,
    },
  });
  assert.equal(cr.status, 200, JSON.stringify(cr.json));
  mainShowResourceId = cr.json.resource.id;
  // Main show: 刘三姐, one on-sale performance tonight 19:30, one
  // tier (普通票 ¥280, quota 10). No pickup points (the voice default
  // for pickup is covered by the first-point rule, not by seed data).
  const s = await createShow(adminToken, {
    resource_id: mainShowResourceId,
    title: "刘三姐",
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  showId = s.json.show.id;
  assert.equal(
    (await reviewShow(adminToken, showId, { status: "approved" })).status,
    200,
  );
  const p = await createPerf(adminToken, showId, {
    start_at: PERF_START,
    price_cents: 28000,
  });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(
    (await patchPerf(adminToken, p.json.performance.id, { status: "on_sale" }))
      .status,
    200,
  );
  const t = await createTier(adminToken, p.json.performance.id, {
    name: "普通票",
    price_cents: 28000,
    quota: 10,
  });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  // Small show: a quota-2 tier for the sold-out test. Its core
  // ("刘三姐小") is longer than the main show's ("刘三姐"), so a
  // command naming it matches this show, never the main one.
  const s2 = await createShow(adminToken, {
    resource_id: mainShowResourceId,
    title: "刘三姐小专场",
  });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  smallShowId = s2.json.show.id;
  assert.equal(
    (await reviewShow(adminToken, smallShowId, { status: "approved" }))
      .status,
    200,
  );
  const p2 = await createPerf(adminToken, smallShowId, {
    start_at: SMALL_START,
    price_cents: 20000,
  });
  assert.equal(p2.status, 200, JSON.stringify(p2.json));
  assert.equal(
    (await patchPerf(adminToken, p2.json.performance.id, { status: "on_sale" }))
      .status,
    200,
  );
  const t2 = await createTier(adminToken, p2.json.performance.id, {
    name: "小票",
    price_cents: 20000,
    quota: 2,
  });
  assert.equal(t2.status, 200, JSON.stringify(t2.json));
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("r7-voice-order: correct command parses into a pending draft at full price", async () => {
  const token = await registerUser("r77voice1");
  const r = await voiceOrder(token, { text: "买 2 张刘三姐今晚的票" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.source, "voice");
  assert.equal(r.json.parsed.quantity, 2);
  assert.equal(r.json.parsed.show_id, showId);
  assert.equal(r.json.parsed.show_title, "刘三姐");
  assert.equal(r.json.parsed.date, TONIGHT);
  assert.equal(r.json.parsed.start_at, PERF_START);
  assert.equal(r.json.parsed.ticket_type_name, "普通票");
  assert.equal(r.json.parsed.unit_price_cents, 28000);
  assert.equal(r.json.order.status, "pending");
  assert.equal(r.json.order.amount, 56000);
  assert.equal(r.json.order.channel, "语音购票");
  assert.ok(r.json.note.includes("模拟支付，未扣款"));
  const o = await getOrder(token, r.json.order.id);
  assert.equal(o.status, "pending");
  assert.equal(o.amount, 56000);
  assert.equal(o.quantity, 2);
});

test("r7-voice-order: nothing is charged or turned paid before confirmation", async () => {
  const token = await registerUser("r77voice2");
  const r = await voiceOrder(token, { text: "买 1 张刘三姐今晚的票" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.order.id;
  // Pay straight from pending is rejected — the draft cannot become
  // paid without the manual confirm step.
  const payEarly = await req(`/api/orders/${id}/pay`, {
    method: "POST",
    token,
  });
  assert.equal(payEarly.status, 400, JSON.stringify(payEarly.json));
  assert.equal((await getOrder(token, id)).status, "pending");
  // The normal flow still works: confirm, then simulated pay.
  const confirm = await req(`/api/orders/${id}/confirm`, {
    method: "POST",
    token,
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.status, "confirmed");
  const pay = await req(`/api/orders/${id}/pay`, { method: "POST", token });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.status, "paid");
  assert.equal(pay.json.simulated, true);
  assert.equal(pay.json.note, "模拟支付，未扣款");
});

test("r7-voice-order: parse failure -> 400, no order created; anonymous -> 401", async () => {
  const token = await registerUser("r77voice3");
  assert.equal(await orderCount(token), 0);
  // No show, no date: unparseable.
  const g = await voiceOrder(token, { text: "你好" });
  assert.equal(g.status, 400, JSON.stringify(g.json));
  // Unknown show: never guessed.
  const u = await voiceOrder(token, { text: "买 2 张不存在的剧今晚的票" });
  assert.equal(u.status, 400, JSON.stringify(u.json));
  assert.ok(u.json.error.includes("未找到该演出"));
  // Known show but no date: the date is part of the parse.
  const nd = await voiceOrder(token, { text: "买 2 张刘三姐的票" });
  assert.equal(nd.status, 400, JSON.stringify(nd.json));
  // Empty text -> 400; anonymous -> 401.
  assert.equal((await voiceOrder(token, { text: "   " })).status, 400);
  assert.equal(
    (await voiceOrder(undefined, { text: "买 2 张刘三姐今晚的票" })).status,
    401,
  );
  assert.equal(await orderCount(token), 0);
});

test("r7-voice-order: known show, no performance that day -> 400, no order", async () => {
  const token = await registerUser("r77voice4");
  assert.equal(await orderCount(token), 0);
  const r = await voiceOrder(token, { text: "买 1 张刘三姐明天的票" });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.ok(r.json.error.includes("无在售场次"));
  assert.ok(r.json.error.includes(TOMORROW));
  assert.equal(await orderCount(token), 0);
});

test("r7-voice-order: insufficient stock -> 409, no order", async () => {
  const token = await registerUser("r77voice5");
  assert.equal(await orderCount(token), 0);
  // The small show's tier has quota 2: buy both, then one more fails.
  const full = await voiceOrder(token, { text: "买 2 张刘三姐小今晚的票" });
  assert.equal(full.status, 200, JSON.stringify(full.json));
  assert.equal(full.json.parsed.show_id, smallShowId);
  assert.equal(full.json.order.amount, 40000);
  assert.equal(await orderCount(token), 1);
  const over = await voiceOrder(token, { text: "买 1 张刘三姐小今晚的票" });
  assert.equal(over.status, 409, JSON.stringify(over.json));
  assert.equal(await orderCount(token), 1);
});

test("r7-voice-order: dialect frame — list, same parse, placeholder only", async () => {
  const d = await req("/api/voice/dialects");
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.dialects.length, 4);
  assert.equal(d.json.default, "putonghua");
  for (const entry of d.json.dialects) {
    assert.equal(entry.recognition, false, `${entry.code} must not claim recognition`);
    assert.ok(entry.placeholder.includes("刘三姐"));
  }
  assert.ok(d.json.note.includes("方言识别未接入"));
  const token = await registerUser("r77voice6");
  // The same command in a dialect parses identically — only the
  // placeholder differs. The dialect never changes the order.
  const r = await voiceOrder(token, {
    text: "买 1 张刘三姐今晚的票",
    dialect: "yue",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.dialect, "yue");
  assert.equal(r.json.parsed.quantity, 1);
  assert.equal(r.json.parsed.show_title, "刘三姐");
  assert.equal(r.json.parsed.date, TONIGHT);
  assert.equal(r.json.order.status, "pending");
  assert.equal(r.json.order.amount, 28000);
  assert.ok(r.json.placeholder.includes("粤语"));
  assert.ok(r.json.placeholder.includes("方言识别未接入"));
  const bad = await voiceOrder(token, {
    text: "买 1 张刘三姐今晚的票",
    dialect: "klingon",
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
});

test("r7-voice-order: large-text flag does not affect ordering logic", async () => {
  const token = await registerUser("r77voice7");
  const r = await voiceOrder(token, {
    text: "买 1 张刘三姐今晚的票",
    large_text: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.order.status, "pending");
  assert.equal(r.json.order.amount, 28000);
  assert.equal(r.json.parsed.unit_price_cents, 28000);
  // The toggle itself exists on both clients: H5 stores it in
  // localStorage under guiyan-large-text, the mini-program under the
  // same key in wx storage, and both sides have the i18n label.
  const chrome = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "chrome.jsx"),
    "utf8",
  );
  assert.ok(chrome.includes("guiyan-large-text"));
  assert.ok(chrome.includes("largeText"));
  const appJs = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "app.js"),
    "utf8",
  );
  assert.ok(appJs.includes("guiyan-large-text"));
  const meJs = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "pages", "me", "me.js"),
    "utf8",
  );
  assert.ok(meJs.includes("largeText"));
});

test("r7-voice-order i18n: H5 455 keys/language, miniprogram 269, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [455, 455, 455]);
  for (const k of [
    "voiceTitle",
    "voicePh",
    "voiceDraft",
    "voiceDialect",
    "voiceDialectNote",
    "largeText",
    "voiceSteps",
  ]) {
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
    blocks[lang] = [...block.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map(
      (m) => m[1],
    );
  }
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 269, `${lang} key count`);
    for (const k of [
      "voiceTitle",
      "voicePh",
      "voiceDraft",
      "voiceDialect",
      "voiceDialectNote",
      "largeText",
      "voiceSteps",
    ])
      assert.ok(blocks[lang].includes(k), `${lang} lacks ${k}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
});
