// Guiyan P3 bugs tests (B-038, B-039, B-040, B-041, B-030, P3-1, P3-2) — run
// against a REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/wechat-mini.test.mjs: spawn server/server.mjs on TEST_PORT
// (default 3109) and talk to it over HTTP. DATABASE_URL must point at a
// FRESH, disposable database (the server seeds 62 resources + demo users on
// first boot). Do not point it at any shared or production database.
//
// Booking dates 2026-12-26..30 are used throughout: seed orders only cover
// 2026-12-01..06, api-pg uses 2026-12-20, wave4 uses 2026-12-21..25, so
// these dates start clean on every resource. Each test registers its own
// fresh user, so tests do not depend on each other or on earlier files.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error("DATABASE_URL is required, e.g. from .env.local");
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3109);
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

let proc;

async function req(p, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

async function registerFresh() {
  const suffix = randomBytes(4).toString("hex");
  const username = `p3_${suffix}`;
  const password = "p3test123";
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: `P3 ${suffix}` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { username, password, token: r.json.token, user: r.json.user };
}

async function listByCategory(category) {
  const r = await req(`/api/resources?category=${category}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(
    Array.isArray(r.json.resources) && r.json.resources.length > 0,
    `no ${category} resources`,
  );
  return r.json.resources;
}

async function pickShow(minStock = 1) {
  const shows = await listByCategory("show");
  const s = shows.find((r) => r.stock >= minStock);
  assert.ok(s, `need a show with stock >= ${minStock}`);
  return s;
}

async function createOrder(token, resourceId, quantity, bookingDate) {
  const r = await req("/api/orders", {
    method: "POST",
    body: { resourceId, quantity, booking_date: bookingDate },
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  return r.json;
}

async function paidOrder(token, resourceId, quantity, bookingDate) {
  const created = await createOrder(token, resourceId, quantity, bookingDate);
  const confirm = await req(`/api/orders/${created.id}/confirm`, {
    method: "POST",
    token,
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  const pay = await req(`/api/orders/${created.id}/pay`, {
    method: "POST",
    token,
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.status, "paid");
  return created;
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: the rule engine answers, never the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[p3bugs-server] ${d}`));
  proc.stderr.on("data", (d) =>
    process.stderr.write(`[p3bugs-server:err] ${d}`),
  );
  await waitHealthy();
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

const RAW_ORDER_CODES = [
  "pending",
  "confirmed",
  "paid",
  "completed",
  "cancelled",
  "refunded",
  "refund_requested",
  "disputed",
];

// --- B-038a: inbox messages use Chinese labels ---------------------------

test("p3bugs B-038a: pay notification says 已支付, never the raw code", async () => {
  const { token } = await registerFresh();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, "2026-12-26");
  const inbox = await req("/api/messages", { token });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.json));
  assert.ok(
    Array.isArray(inbox.json.messages) && inbox.json.messages.length > 0,
    "expected inbox messages after pay",
  );
  const latest = inbox.json.messages[0];
  assert.equal(latest.title, "订单状态更新");
  assert.ok(
    latest.content.includes("→ 已支付"),
    `pay message should say 已支付: ${latest.content}`,
  );
  assert.ok(
    !latest.content.includes("→ paid"),
    `pay message must not contain raw code: ${latest.content}`,
  );
  assert.ok(
    inbox.json.messages.every((m) => !m.content.includes("→ paid")),
    "no inbox message may contain the raw paid code",
  );
  assert.ok(
    inbox.json.messages.some((m) => m.content.includes(order.code)),
    "pay message should carry the order code",
  );
});

test("p3bugs B-038a regression: approveRefund message keeps 已模拟退款", async () => {
  const { token } = await registerFresh();
  const admin = await adminLogin();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, "2026-12-27");
  const refund = await req(`/api/orders/${order.id}/refund`, {
    method: "POST",
    token,
    body: { reason: "临时有事" },
  });
  assert.equal(refund.status, 200, JSON.stringify(refund.json));
  const approve = await req(`/api/orders/${order.id}/approveRefund`, {
    method: "POST",
    token: admin,
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  const inbox = await req("/api/messages", { token });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.json));
  const decision = inbox.json.messages.find(
    (m) => m.title === "订单售后处理结果",
  );
  assert.ok(decision, "expected an 订单售后处理结果 message");
  assert.ok(
    decision.content.includes("已模拟退款"),
    `decision message should keep 已模拟退款: ${decision.content}`,
  );
});

// --- B-038b/c + B-039 + B-040 + B-041 + B-030 + P3-1: i18n + file reads ----

test("p3bugs B-038b: H5 i18n is 418 keys/language with the 3 demand keys", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [418, 418, 418]);
  for (const k of ["dmPending", "dmApproved", "dmRejected"]) {
    for (const l of data.LANGS)
      assert.ok(k in data.I18N[l], `${k} missing in ${l}`);
  }
});

function miniI18nCounts() {
  // The miniprogram i18n file is CommonJS under a type:module root, so
  // Node require() returns an empty namespace — count keys by reading the
  // file text (same approach as the rebuild's dead-key grep). Verified
  // against a vm evaluation of the same file: identical counts.
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
  return blocks;
}

test("p3bugs B-038c: miniprogram i18n is 231 keys/language, STATUS_KEY covers 8 states", async () => {
  const blocks = miniI18nCounts();
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 231, `${lang} key count`);
    assert.ok(blocks[lang].includes("stRefundRequested"), `${lang} lacks stRefundRequested`);
    assert.ok(blocks[lang].includes("stDisputed"), `${lang} lacks stDisputed`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
  for (const page of [
    "miniprogram/pages/orders/orders.js",
    "miniprogram/pages/detail/detail.js",
  ]) {
    const src = fs.readFileSync(path.resolve(repoDir, page), "utf8");
    assert.ok(
      src.includes("refund_requested: 'stRefundRequested'"),
      `${page} STATUS_KEY lacks refund_requested`,
    );
    assert.ok(
      src.includes("disputed: 'stDisputed'"),
      `${page} STATUS_KEY lacks disputed`,
    );
  }
});

test("p3bugs B-039: catBoth shows one name in zh, bilingual in vi/en", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  try {
    data.langState.lang = "zh";
    assert.equal(data.catBoth("show"), "演出剧目");
    assert.ok(!data.catBoth("show").includes(" · "));
    data.langState.lang = "vi";
    assert.ok(data.catBoth("show").includes(" · "));
    assert.ok(data.catBoth("show").startsWith("演出剧目"));
    data.langState.lang = "en";
    assert.ok(data.catBoth("show").includes(" · "));
    assert.ok(data.catBoth("show").startsWith("演出剧目"));
  } finally {
    data.langState.lang = "zh";
  }
});

test("p3bugs B-040: admin badge never says 仅查看 · 只读", async () => {
  const src = fs.readFileSync(
    path.resolve(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
    "utf8",
  );
  assert.ok(!src.includes("仅查看 · 只读"), "badge must not say 仅查看 · 只读");
  assert.ok(!src.includes("canWrite"), "canWrite must be gone");
  assert.ok(
    src.includes("管理操作 · 审计留痕"),
    "badge must say 管理操作 · 审计留痕",
  );
});

test("p3bugs B-041: seatgrid is a real grid with dynamic columns", async () => {
  const css = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "css", "main.css"),
    "utf8",
  );
  assert.ok(
    css.includes(".seatgrid{display:grid;gap:3px}"),
    ".seatgrid must use display:grid",
  );
  assert.ok(
    !/\.seatgrid\{[^}]*flex-wrap/.test(css),
    ".seatgrid must not use flex-wrap anymore",
  );
  const app = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "App.jsx"),
    "utf8",
  );
  assert.ok(
    app.includes("gridTemplateColumns"),
    "App.jsx must set gridTemplateColumns for the seat grid",
  );
  assert.ok(
    app.includes("meta.seatCols"),
    "seat grid columns must come from the venue's real seatCols",
  );
});

test("p3bugs B-030: admin page subtitle uses filtered counts", async () => {
  const src = fs.readFileSync(
    path.resolve(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
    "utf8",
  );
  const sub = src.match(/id="pageSub">([\s\S]*?)<\/span>/);
  assert.ok(sub, "pageSub render not found");
  assert.ok(
    sub[1].includes("filteredOrders.length"),
    "orders subtitle must use filteredOrders.length",
  );
  assert.ok(
    sub[1].includes("filteredResources.length"),
    "resources subtitle must use filteredResources.length",
  );
  assert.ok(
    sub[1].includes("filteredDemands.length"),
    "demands subtitle must use filteredDemands.length",
  );
});

test("p3bugs P3-1: deposit label says 元, never 分", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const text = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "data.js"),
    "utf8",
  );
  assert.ok(text.includes('metaDeposit:"押金（元，模拟）"'));
  assert.ok(!text.includes("押金（分"));
  assert.equal(data.I18N.zh.metaDeposit, "押金（元，模拟）");
  assert.equal(data.I18N.vi.metaDeposit, "Tiền đặt cọc (¥, mô phỏng)");
  assert.equal(data.I18N.en.metaDeposit, "Deposit (¥, simulated)");
});

// --- P3-2: assistant groups the two new states ---------------------------

test("p3bugs P3-2: myRefund groups refund_requested orders", async () => {
  const { token } = await registerFresh();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, "2026-12-28");
  const refund = await req(`/api/orders/${order.id}/refund`, {
    method: "POST",
    token,
    body: { reason: "临时有事" },
  });
  assert.equal(refund.status, 200, JSON.stringify(refund.json));
  assert.equal(refund.json.status, "refund_requested");
  const r = await req("/api/assistant?q=" + encodeURIComponent("怎么退款"), {
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.kind, "myRefund");
  assert.ok(r.json.answer.includes("已申请退款"), r.json.answer);
  assert.ok(r.json.answer.includes(order.code), r.json.answer);
  assert.ok(!r.json.answer.includes("refund_requested"), r.json.answer);
});

test("p3bugs P3-2: myRefund groups disputed orders", async () => {
  const { token } = await registerFresh();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, "2026-12-29");
  const dispute = await req(`/api/orders/${order.id}/dispute`, {
    method: "POST",
    token,
    body: { reason: "与商家有争议" },
  });
  assert.equal(dispute.status, 200, JSON.stringify(dispute.json));
  assert.equal(dispute.json.status, "disputed");
  const r = await req("/api/assistant?q=" + encodeURIComponent("怎么退款"), {
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.kind, "myRefund");
  assert.ok(r.json.answer.includes("申诉处理中"), r.json.answer);
  assert.ok(r.json.answer.includes(order.code), r.json.answer);
  assert.ok(!r.json.answer.includes("disputed"), r.json.answer);
});

test("p3bugs P3-2: myOrders answers use Chinese labels, no raw codes", async () => {
  const { token } = await registerFresh();
  const s = await pickShow(1);
  const order = await paidOrder(token, s.id, 1, "2026-12-30");
  const r = await req("/api/assistant?q=" + encodeURIComponent("我的订单"), {
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.kind, "myOrders");
  assert.ok(r.json.answer.includes(order.code), r.json.answer);
  for (const code of RAW_ORDER_CODES) {
    assert.ok(
      !r.json.answer.includes(code),
      `myOrders answer must not contain raw code ${code}: ${r.json.answer}`,
    );
  }
});
