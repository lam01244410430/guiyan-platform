// tests/p1-users-csv.test.mjs: P1 G2 — export the grouped user list as
// CSV. Spawns server/server.mjs on TEST_PORT (default 3142) and talks to
// it over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered (4 tests): (1) GET as admin returns 200 text/csv with a UTF-8
// BOM, the exact 9-column header, a dated filename, and a row per user;
// (2) ?q= filters to the matching users (one row for this file's unique
// username, header-only for a miss); (3) ?tag= filters to users carrying
// that tag (a user with a ¥12000 completed order carries 高价值） and a
// tag nobody has returns header-only; (4) non-admin -> 403, anonymous
// -> 403, and the export is audited as 导出报表.
//
// Test usernames are hyphen-free. All assertions filter by this file's
// own usernames — other test files share this DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3142);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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

async function reqText(path, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { headers });
  // BOM on raw bytes: Response.text() decodes UTF-8 and strips a
  // leading U+FEFF, so startsWith("\uFEFF") can never pass even though
  // the wire bytes are correct (same gotcha as the orders CSV test).
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    disposition: res.headers.get("content-disposition") || "",
    buf,
    text: new TextDecoder("utf-8").decode(buf),
  };
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

async function transition(token, orderId, action, body = {}) {
  return req(`/api/orders/${orderId}/${action}`, { method: "POST", token, body });
}

async function completeThrough(token, orderId) {
  // Seller-confirm: confirm goes through the platform admin; pay /
  // complete stay with the buyer token.
  assert.equal((await transition(adminToken, orderId, "confirm")).status, 200);
  assert.equal((await transition(token, orderId, "pay")).status, 200);
  assert.equal((await transition(token, orderId, "complete")).status, 200);
}

function parseCsv(r) {
  assert.deepEqual(
    [...r.buf.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "CSV must start with a UTF-8 BOM",
  );
  // TextDecoder strips the BOM, so the header starts at lines[0].
  const lines = r.text.split("\r\n");
  return lines.map((l) => l.split('","').map((c) => c.replace(/^"/, "").replace(/"$/, "")));
}

let adminToken;
let userToken;
let highUserId;

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
  userToken = await register("p1csvuser", "Test1234");
  // A 高价值 user: one completed ¥12000 order (spent >= ¥10000, outside
  // the 潜力会员 ¥1000–10000 band).
  const res = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "P1 csv big show", category: "show", city: "南宁",
      price: 1200000, unit: "张", stock: 10, shop_id: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const highToken = await register("p1csvhigh", "Test1234");
  const row = await pool.query("SELECT id FROM users WHERE username=$1", ["p1csvhigh"]);
  highUserId = row.rows[0].id;
  const o = await req("/api/orders", {
    method: "POST",
    token: highToken,
    body: { resourceId: res.data.resource.id, quantity: 1, booking_date: "2026-12-05" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  await completeThrough(highToken, o.data.id);
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("GET users.csv returns BOM CSV with the users-table columns and a dated filename", async () => {
  const r = await reqText("/api/admin/users.csv", { token: adminToken });
  assert.equal(r.status, 200, `users.csv -> ${r.status}`);
  assert.match(r.contentType, /text\/csv/);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  assert.equal(r.disposition, `attachment; filename="guiyan-users-${today}.csv"`);
  const rows = parseCsv(r);
  assert.deepEqual(rows[0], ["ID", "姓名", "账号", "角色", "城市", "渠道", "认证", "标签", "状态"]);
  assert.ok(rows.length > 10, `expected many user rows, got ${rows.length}`);
  const mine = rows.find((x) => x[2] === "p1csvuser");
  assert.ok(mine, "p1csvuser row missing");
  assert.equal(mine[1], "p1csvuser");
  assert.equal(mine[3], "user");
  assert.equal(mine[8], "启用");
});

test("?q= filters to the matching users", async () => {
  const hit = await reqText("/api/admin/users.csv?q=p1csvuser", { token: adminToken });
  assert.equal(hit.status, 200);
  const rows = parseCsv(hit);
  assert.equal(rows.length, 2, `expected header + 1 row, got ${rows.length}`);
  assert.equal(rows[1][2], "p1csvuser");
  const miss = await reqText("/api/admin/users.csv?q=p1csvnope999", { token: adminToken });
  assert.equal(miss.status, 200);
  assert.equal(parseCsv(miss).length, 1, "a miss must return header only");
});

test("?tag= filters to users carrying that tag", async () => {
  const tagged = await reqText("/api/admin/users.csv?tag=高价值", { token: adminToken });
  assert.equal(tagged.status, 200);
  const rows = parseCsv(tagged);
  assert.ok(rows.length >= 2, "expected at least one 高价值 user");
  const mine = rows.find((x) => x[2] === "p1csvhigh");
  assert.ok(mine, "p1csvhigh row missing from 高价值 export");
  assert.ok(mine[7].includes("高价值"), `tags cell ${mine[7]} lacks 高价值`);
  for (const row of rows.slice(1)) {
    assert.ok(row[7].includes("高价值"), `row ${row[2]} lacks 高价值 in ${row[7]}`);
  }
  const none = await reqText("/api/admin/users.csv?tag=不存在的标签", { token: adminToken });
  assert.equal(none.status, 200);
  assert.equal(parseCsv(none).length, 1, "an unmatched tag must return header only");
});

test("non-admin and anonymous cannot export; the export is audited", async () => {
  const r1 = await reqText("/api/admin/users.csv", { token: userToken });
  assert.equal(r1.status, 403, JSON.stringify(r1.status));
  const r2 = await reqText("/api/admin/users.csv");
  assert.equal(r2.status, 403, JSON.stringify(r2.status));
  const logs = await req("/api/admin/audit-logs", { token: adminToken });
  assert.equal(logs.status, 200, JSON.stringify(logs.data));
  const entry = (logs.data.logs || logs.data.auditLogs || []).find(
    (l) => l.action === "导出报表" && String(l.detail || "").endsWith("位用户"),
  );
  assert.ok(entry, `no 用户 export audit entry in ${JSON.stringify(logs.data).slice(0, 400)}`);
});
