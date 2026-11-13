// tests/r1-admin-account.test.mjs: R1-2 (row 3) — admin account
// management: own profile (name/email), enable/disable accounts, OTP
// password change. Spawns server/server.mjs on TEST_PORT (default
// 3111) and talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
//
// Covered: profile validation + duplicate email (409); status changes
// are platform-admin only (shop-scoped admin -> 403, demo -> 403);
// disable -> login 401 + live token dead at once, re-enable -> login
// 200; cannot disable self (400), unknown user (404), bad status
// (400); password change by OTP to the admin's current email (no
// email -> 400, wrong code -> 400, same-as-current -> 400, correct
// code -> 200, single-use); audit rows for "管理账号" + "修改密码".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
  return req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
}
async function loginOk(username, password) {
  const r = await login(username, password);
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

let adminToken;
let adminId;
let admin2Id;
let shopBId;

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
  adminToken = await loginOk("admin", "admin123");
  const me = await req("/api/admin/users", { token: adminToken });
  adminId = me.data.users.find((u) => u.username === "admin").id;
  // Second admin, inserted directly: register fixes role=user.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,email,city,created_at) VALUES($1,$2,$3,'admin',$4,'南宁',$5) RETURNING id",
    ["r1admin2", pw, "子店管理员2", "r1admin2@example.com", new Date().toISOString()],
  );
  admin2Id = a2.rows[0].id;
  // Shop B owned by admin2, so admin2 becomes shop-scoped (R1-1).
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "桂演柳州分店", owner_id: admin2Id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopBId = shop.data.shop.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("admin profile: patch name/email; bad email 400; duplicate email 409", async () => {
  const r = await req("/api/admin/profile", {
    method: "PATCH",
    token: adminToken,
    body: { name: "平台管理员", email: "Admin1@Example.com" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.name, "平台管理员");
  // Stored lowercased, like the customer email change.
  assert.equal(r.data.user.email, "admin1@example.com");
  assert.equal(
    (await req("/api/admin/profile", { method: "PATCH", token: adminToken, body: { email: "not-an-email" } })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/profile", { method: "PATCH", token: adminToken, body: { email: "r1admin2@example.com" } })).status,
    409,
  );
  const demoToken = await loginOk("demo", "demo123");
  assert.equal(
    (await req("/api/admin/profile", { method: "PATCH", token: demoToken, body: { name: "X" } })).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/profile", { method: "PATCH", body: { name: "X" } })).status,
    401,
  );
});

test("status change is platform-admin only; self-disable 400; unknown 404; bad status 400", async () => {
  const t2 = await loginOk("r1admin2", "Admin1234");
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}/status`, { method: "PATCH", token: t2, body: { status: "disabled" } })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${adminId}/status`, { method: "PATCH", token: adminToken, body: { status: "disabled" } })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/users/99999/status", { method: "PATCH", token: adminToken, body: { status: "disabled" } })).status,
    404,
  );
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}/status`, { method: "PATCH", token: adminToken, body: { status: "frozen" } })).status,
    400,
  );
  const demoToken = await loginOk("demo", "demo123");
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}/status`, { method: "PATCH", token: demoToken, body: { status: "disabled" } })).status,
    403,
  );
});

test("disable -> login 401 + live token dead; re-enable -> login 200; audit row", async () => {
  const t2 = await loginOk("r1admin2", "Admin1234");
  const off = await req(`/api/admin/users/${admin2Id}/status`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "disabled" },
  });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.user.status, "disabled");
  // Login is refused, and it is NOT a wrong-password failure.
  assert.equal((await login("r1admin2", "Admin1234")).status, 401);
  // The token issued before the disable stops resolving at once: the
  // session join excludes disabled users, so the token reads as
  // anonymous — and admin endpoints answer anonymous with 403 (the
  // standing admin contract), not 401.
  assert.equal((await req("/api/admin/stats", { token: t2 })).status, 403);
  const logs = await req("/api/admin/audit-logs", { token: adminToken });
  assert.equal(logs.status, 200);
  assert.ok(logs.data.logs.some((l) => l.action === "管理账号" && String(l.detail || "").includes("r1admin2")));
  const on = await req(`/api/admin/users/${admin2Id}/status`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "active" },
  });
  assert.equal(on.status, 200);
  assert.equal(on.data.user.status, "active");
  await loginOk("r1admin2", "Admin1234");
});

test("change password needs an email first; OTP flow; wrong/same/reused code rejected", async () => {
  // A fresh admin with no email cannot start the OTP flow.
  const pw = hashPassword("Admin1234");
  const a3 = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','桂林',$4) RETURNING id",
    ["r1admin3", pw, "子店管理员3", new Date().toISOString()],
  );
  const admin3Id = a3.rows[0].id;
  const t3 = await loginOk("r1admin3", "Admin1234");
  assert.equal(
    (await req("/api/admin/change-password", { method: "POST", token: t3, body: { newPassword: "NewPass123", code: "000000" } })).status,
    400,
  );
  // Give admin3 an email, then run the OTP flow as the platform admin
  // (admin1@example.com, set in the profile test above).
  const sent = await req("/api/account/send-otp", {
    method: "POST",
    token: adminToken,
    body: { channel: "email", target: "admin1@example.com" },
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.match(sent.data.code, /^\d{6}$/);
  const code = sent.data.code;
  const verified = await req("/api/account/verify-otp", {
    method: "POST",
    token: adminToken,
    body: { channel: "email", target: "admin1@example.com", code },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.valid, true);
  // Same-as-current is rejected BEFORE the code is consumed.
  assert.equal(
    (await req("/api/admin/change-password", { method: "POST", token: adminToken, body: { newPassword: "admin123", code } })).status,
    400,
  );
  // Wrong code is rejected; the good code survives (not consumed).
  assert.equal(
    (await req("/api/admin/change-password", { method: "POST", token: adminToken, body: { newPassword: "NewAdmin123", code: "000000" } })).status,
    400,
  );
  const changed = await req("/api/admin/change-password", {
    method: "POST",
    token: adminToken,
    body: { newPassword: "NewAdmin123", code },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  // Single-use: the same code cannot change the password twice.
  assert.equal(
    (await req("/api/admin/change-password", { method: "POST", token: adminToken, body: { newPassword: "Another123", code } })).status,
    400,
  );
  assert.equal((await login("admin", "admin123")).status, 401);
  await loginOk("admin", "NewAdmin123");
  const logs = await req("/api/admin/audit-logs", { token: adminToken });
  assert.equal(logs.status, 200);
  assert.ok(logs.data.logs.some((l) => l.action === "修改密码"));
  // admin3 was only created for the no-email check; clean it up
  // (sessions + audit rows reference the user id, so delete those
  // first — audit_logs.user_id is a real FK).
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [admin3Id]);
  await pool.query("DELETE FROM audit_logs WHERE user_id=$1", [admin3Id]);
  await pool.query("DELETE FROM users WHERE id=$1", [admin3Id]);
  // Restore the platform admin password: this test changed it to
  // NewAdmin123 above, and later test files log in as admin/admin123
  // (the seeded password) against this same shared DB.
  await pool.query("UPDATE users SET password=$1 WHERE username='admin'", [hashPassword("admin123")]);
  await loginOk("admin", "admin123");
});
