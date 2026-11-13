// tests/r4-print.test.mjs: R4-2 (row 29) — paper ticket printing:
// POST /api/admin/tickets/print records the print event (one
// print_logs row per ticket + printed_at) and GET /api/admin/
// print-logs lists the log. Only `issued` tickets print: used/void
// -> 400; a ticket frozen in a pending partial refund -> 400 —
// that case is NOT tested here: pending_refund_tickets does not
// exist until R4-4, so there is no frozen ticket to print against
// (the endpoint reuses the same information_schema probe as
// verify, and R4-4 activates it by adding the column). Re-print
// of an already-printed issued ticket is allowed (paper-jam case:
// a second log row). Spawns server/server.mjs on TEST_PORT
// (default 3113) and talks to it over HTTP. DATABASE_URL must point
// at a FRESH disposable database (npm test is NOT idempotent on a
// reused DB).
//
// Covered: print by order_id -> printed 2, printed_at set, 2
// print_logs rows; re-print by ticket_ids -> a second log row;
// used ticket -> 400 (no new log row); void ticket (full-refund
// approval) -> 400; print-logs list filters (?ticket_id= /
// ?order_id=); cross-shop print -> 403 (scoped admin) and the
// scoped admin's print-logs list hides other shops' rows;
// non-admin print / print-logs -> 403, anonymous -> 403; i18n key
// counts (H5 367, miniprogram 169, equal sets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3113);
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

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
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

async function printLogCount(ticketId) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM print_logs WHERE ticket_id=$1",
    [ticketId],
  );
  return r.rows[0].n;
}

let adminToken;
let demoToken;
let plain280Id;
let shopAdminToken;
// The order printed by tests 1-2, shared by the list test.
let printOrderId;
let printTickets = [];

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
      name: "R4 print plain", category: "digital", city: "南宁",
      price: 28000, unit: "张", stock: 100, shop_id: 1,
    },
  });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  plain280Id = plain.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("print by order_id -> printed 2, printed_at set, one print_logs row per ticket", async () => {
  const { token } = await register("r4printbuyer", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 2, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  printOrderId = o.data.id;
  await payThrough(token, printOrderId);
  const list = await req(`/api/orders/${printOrderId}/tickets`, { token });
  assert.equal(list.data.tickets.length, 2);
  assert.ok(list.data.tickets.every((t) => t.printed_at === null));
  printTickets = list.data.tickets;
  const r = await req("/api/admin/tickets/print", {
    method: "POST",
    token: adminToken,
    body: { order_id: printOrderId },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.printed, 2);
  assert.equal(r.data.tickets.length, 2);
  assert.ok(r.data.tickets.every((t) => t.printed_at));
  assert.ok(r.data.tickets.every((t) => t.status === "issued"));
  for (const t of printTickets)
    assert.equal(await printLogCount(t.id), 1, "one log row per ticket");
  const row = await pool.query(
    "SELECT printed_by FROM print_logs WHERE ticket_id=$1",
    [printTickets[0].id],
  );
  assert.equal(row.rows[0].printed_by, 1, "printed_by is the admin");
  // No body / empty body / unknown order / ticketless order -> 400/404.
  assert.equal((await req("/api/admin/tickets/print", { method: "POST", token: adminToken, body: {} })).status, 400);
  assert.equal((await req("/api/admin/tickets/print", { method: "POST", token: adminToken, body: { ticket_ids: [] } })).status, 400);
  assert.equal((await req("/api/admin/tickets/print", { method: "POST", token: adminToken, body: { order_id: 99999 } })).status, 404);
  assert.equal((await req("/api/admin/tickets/print", { method: "POST", token: adminToken, body: { ticket_ids: [99999] } })).status, 404);
});

test("re-print by ticket_ids -> a second log row, printed_at refreshed", async () => {
  assert.ok(printTickets.length === 2, "test 1 must run first");
  const before = await printLogCount(printTickets[0].id);
  const r = await req("/api/admin/tickets/print", {
    method: "POST",
    token: adminToken,
    body: { ticket_ids: [printTickets[0].id] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.printed, 1);
  assert.equal(r.data.tickets.length, 1);
  assert.equal(r.data.tickets[0].id, printTickets[0].id);
  assert.ok(r.data.tickets[0].printed_at);
  assert.equal(await printLogCount(printTickets[0].id), before + 1);
  // The other ticket of the same order still has exactly 1 log row.
  assert.equal(await printLogCount(printTickets[1].id), 1);
});

test("used ticket -> 400; void ticket (full-refund approval) -> 400; no log rows written", async () => {
  const { token } = await register("r4printused", "Test1234");
  const o = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await payThrough(token, o.data.id);
  const list = await req(`/api/orders/${o.data.id}/tickets`, { token });
  const ticket = list.data.tickets[0];
  assert.equal((await req(`/api/verify/${ticket.code}`, { method: "POST", token: adminToken })).status, 200);
  const r = await req("/api/admin/tickets/print", {
    method: "POST",
    token: adminToken,
    body: { ticket_ids: [ticket.id] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, "票已核销");
  assert.equal(await printLogCount(ticket.id), 0, "a refused print writes no log row");

  // Void: a second order, full refund approved -> ticket void.
  const { token: token2 } = await register("r4printvoid", "Test1234");
  const o2 = await req("/api/orders", {
    method: "POST",
    token: token2,
    body: { resourceId: plain280Id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  await payThrough(token2, o2.data.id);
  const list2 = await req(`/api/orders/${o2.data.id}/tickets`, { token: token2 });
  const voidTicket = list2.data.tickets[0];
  assert.equal((await transition(token2, o2.data.id, "refund", { reason: "不去了" })).status, 200);
  assert.equal((await transition(adminToken, o2.data.id, "approveRefund")).status, 200);
  const r2 = await req("/api/admin/tickets/print", {
    method: "POST",
    token: adminToken,
    body: { ticket_ids: [voidTicket.id] },
  });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  assert.equal(r2.data.error, "票已作废");
  assert.equal(await printLogCount(voidTicket.id), 0);
});

test("print-logs list: 200, rows carry ticket + order; filters by ticket_id / order_id", async () => {
  assert.ok(printOrderId, "test 1 must run first");
  const all = await req("/api/admin/print-logs", { token: adminToken });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.ok(Array.isArray(all.data.print_logs));
  assert.ok(all.data.print_logs.length >= 3, "tests 1-2 wrote 3 log rows");
  assert.ok(all.data.print_logs.every((l) => l.ticket_id && l.code && l.order_id && l.printed_by && l.printed_at));
  const byTicket = await req(`/api/admin/print-logs?ticket_id=${printTickets[0].id}`, { token: adminToken });
  assert.equal(byTicket.status, 200, JSON.stringify(byTicket.data));
  assert.equal(byTicket.data.print_logs.length, 2, "ticket 0 was printed twice");
  assert.ok(byTicket.data.print_logs.every((l) => l.ticket_id === printTickets[0].id));
  const byOrder = await req(`/api/admin/print-logs?order_id=${printOrderId}`, { token: adminToken });
  assert.equal(byOrder.status, 200, JSON.stringify(byOrder.data));
  assert.equal(byOrder.data.print_logs.length, 3, "order holds 2 + 1 re-print rows");
  assert.ok(byOrder.data.print_logs.every((l) => l.order_id === printOrderId));
  const none = await req("/api/admin/print-logs?ticket_id=99999", { token: adminToken });
  assert.equal(none.status, 200, JSON.stringify(none.data));
  assert.deepEqual(none.data.print_logs, []);
});

test("cross-shop print -> 403; scoped admin's print-logs list hides other shops' rows", async () => {
  assert.ok(printOrderId, "test 1 must run first");
  // Shop B + its scoped admin (same direct-insert pattern as r1-shops).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["r4print-admin", pw, "R4 打印子店管理员", new Date().toISOString()],
  );
  const shop = await req("/api/admin/shops", {
    method: "POST", token: adminToken,
    body: { name: "R4 打印分店", owner_id: a2.rows[0].id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopAdminToken = await login("r4print-admin", "Admin1234");
  const before = await printLogCount(printTickets[1].id);
  const r = await req("/api/admin/tickets/print", {
    method: "POST",
    token: shopAdminToken,
    body: { ticket_ids: [printTickets[1].id] },
  });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(await printLogCount(printTickets[1].id), before, "a refused print writes no log row");
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", token: shopAdminToken, body: { order_id: printOrderId },
  })).status, 403);
  // The scoped admin's print-logs list is shop-scoped: the shop-1
  // rows from tests 1-2 are hidden, and filtering by the shop-1
  // order returns nothing.
  const scoped = await req("/api/admin/print-logs", { token: shopAdminToken });
  assert.equal(scoped.status, 200, JSON.stringify(scoped.data));
  assert.ok(scoped.data.print_logs.every((l) => l.order_id !== printOrderId));
  const scopedByOrder = await req(`/api/admin/print-logs?order_id=${printOrderId}`, { token: shopAdminToken });
  assert.equal(scopedByOrder.status, 200, JSON.stringify(scopedByOrder.data));
  assert.deepEqual(scopedByOrder.data.print_logs, []);
});

test("non-admin print / print-logs -> 403; anonymous print / print-logs -> 403", async () => {
  assert.ok(printTickets.length === 2, "test 1 must run first");
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", token: demoToken, body: { ticket_ids: [printTickets[1].id] },
  })).status, 403);
  assert.equal((await req("/api/admin/print-logs", { token: demoToken })).status, 403);
  assert.equal((await req("/api/admin/tickets/print", {
    method: "POST", body: { ticket_ids: [printTickets[1].id] },
  })).status, 403);
  assert.equal((await req("/api/admin/print-logs")).status, 403);
  // The failed attempts did not print anything extra.
  assert.equal(await printLogCount(printTickets[1].id), 1);
});

test("i18n 367/169: printTicket key on both sides, equal sets", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [367, 367, 367]);
  for (const l of data.LANGS)
    assert.ok("printTicket" in data.I18N[l], `printTicket missing in H5 ${l}`);
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
    assert.equal(blocks[lang].length, 169, `${lang} key count`);
    assert.ok(blocks[lang].includes("printTicket"), `printTicket missing in mini ${lang}`);
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
