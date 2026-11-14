// tests/admin-redesign-rbac.test.mjs: admin redesign Item 5 —
// Oracle-style RBAC (Q1(a)): root / admin / user, server-enforced.
// API part spawns server/server.mjs on TEST_PORT (default 3291) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
// The UI part is source-grep only, no server needed.
//
// Covered: fresh seed has id 1 role "root" (and the users list shows
// it); root grants admin -> 200 + role becomes admin + audit row
// 授予管理员; root revokes -> 200 + role user + audit row 收回管理员;
// non-root (platform) admin granting / revoking -> 403, role
// unchanged; role "root" in the body -> 400, any other role -> 400;
// unknown target 404, anonymous 401; changing your own role -> 403
// (root self + non-root admin self); changing the root account's
// role -> 403; plain user -> 403 on stats/users/orders (spot-check);
// root still passes every admin gate (stats/users/orders -> 200);
// backfill: a DB with id 1 role "admin" is promoted to "root" by a
// fresh server boot (probe server on TEST_PORT + 10); Item 4 guards
// still hold after the role conversion (edit/delete/disable root as
// a non-root admin -> 403); source-grep: isAdminRole/isRootUser
// helpers + permission matrix, zero old-style `role === "admin"`
// gates left in server/, role-based isRootUser + grant/revoke
// buttons only for root + my-account card shows role, AdminLogin
// admits root.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const PORT = Number(process.env.TEST_PORT || 3291);
const BASE = `http://127.0.0.1:${PORT}`;
const PROBE_PORT = PORT + 10;
const PROBE_BASE = `http://127.0.0.1:${PROBE_PORT}`;
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

async function roleOf(userId) {
  const list = await req("/api/admin/users", { token: rootToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const row = list.data.users.find((u) => u.id === userId);
  assert.ok(row, `user ${userId} must be listed`);
  return row.role;
}

let rootToken;
let rootId;
let admin2Token;
let admin2Id;
let grantUserId;
let revokeUserId;
let plainUserId;
let plainToken;

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
  const rootLogin = await login("admin", "admin123");
  assert.equal(rootLogin.status, 200, JSON.stringify(rootLogin.data));
  // Fresh seed: the default admin (id 1) is role "root", not "admin".
  assert.equal(rootLogin.data.user.role, "root");
  rootToken = rootLogin.data.token;
  rootId = rootLogin.data.user.id;
  assert.equal(rootId, 1);
  // Second PLATFORM admin (role admin, NO shop — unlike the CRUD
  // test's shop-scoped admin2, this one passes assertPlatformAdmin
  // but is NOT root, so it exercises the root-only gate).
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,email,city,created_at) VALUES($1,$2,$3,'admin',$4,'南宁',$5) RETURNING id",
    ["rbacadmin2", pw, "普通管理员RBAC", "rbacadmin2@example.com", new Date().toISOString()],
  );
  admin2Id = a2.rows[0].id;
  admin2Token = await loginOk("rbacadmin2", "Admin1234");
  // Regular users for the grant / revoke / 403 tests, created
  // through the Item 4 endpoint itself (role forced "user").
  async function mk(username) {
    const r = await req("/api/admin/users", {
      method: "POST",
      token: rootToken,
      body: {
        username, password: "Rbac1234", name: "RBAC用户",
        city: "南宁", email: `${username}@example.com`, phone: "+8613800000001",
      },
    });
    assert.equal(r.status, 201, `create ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.user.id;
  }
  grantUserId = await mk("rbacgrant1");
  revokeUserId = await mk("rbacrevoke1");
  plainUserId = await mk("rbacplain1");
  plainToken = await loginOk("rbacplain1", "Rbac1234");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  // Clean up everything this file created (sessions + audit rows
  // reference user ids first — audit_logs.user_id is a real FK).
  const ids = [grantUserId, revokeUserId, plainUserId, admin2Id];
  await pool.query("DELETE FROM orders WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_logs WHERE detail LIKE '%rbac%'");
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
});

test("seed: id 1 is root on a fresh DB, and the users list shows it", async () => {
  const list = await req("/api/admin/users", { token: rootToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const root = list.data.users.find((u) => u.id === 1);
  assert.ok(root, "id 1 must be listed");
  assert.equal(root.username, "admin");
  assert.equal(root.role, "root");
  // The seeded demo user is still a plain user.
  const demo = list.data.users.find((u) => u.username === "demo");
  assert.ok(demo, "demo must be listed");
  assert.equal(demo.role, "user");
});

test("root grants admin: 200 + role admin + audit row 授予管理员", async () => {
  assert.equal(await roleOf(grantUserId), "user");
  const r = await req(`/api/admin/users/${grantUserId}/role`, {
    method: "PATCH",
    token: rootToken,
    body: { role: "admin" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, "admin");
  assert.equal(r.data.user.id, grantUserId);
  assert.equal(await roleOf(grantUserId), "admin");
  const logs = await req("/api/admin/audit-logs", { token: rootToken });
  assert.equal(logs.status, 200);
  assert.ok(
    logs.data.logs.some((l) => l.action === "授予管理员" && String(l.detail || "").includes("rbacgrant1")),
    "grant must write a 授予管理员 audit row naming the target",
  );
  // A freshly granted admin can use the admin API at once.
  const t = await loginOk("rbacgrant1", "Rbac1234");
  assert.equal((await req("/api/admin/stats", { token: t })).status, 200);
});

test("root revokes admin: 200 + role user + audit row 收回管理员", async () => {
  // Grant first inside this test so it does not depend on test order.
  const g = await req(`/api/admin/users/${revokeUserId}/role`, {
    method: "PATCH",
    token: rootToken,
    body: { role: "admin" },
  });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(await roleOf(revokeUserId), "admin");
  const r = await req(`/api/admin/users/${revokeUserId}/role`, {
    method: "PATCH",
    token: rootToken,
    body: { role: "user" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, "user");
  assert.equal(await roleOf(revokeUserId), "user");
  const logs = await req("/api/admin/audit-logs", { token: rootToken });
  assert.equal(logs.status, 200);
  assert.ok(
    logs.data.logs.some((l) => l.action === "收回管理员" && String(l.detail || "").includes("rbacrevoke1")),
    "revoke must write a 收回管理员 audit row naming the target",
  );
});

test("non-root admin granting / revoking: 403, role unchanged", async () => {
  // admin2 is a platform admin (passes the admin gates) but NOT
  // root — granting and revoking are root-only. Make sure the revoke
  // target is an admin first, whatever order the tests run in.
  if ((await roleOf(grantUserId)) !== "admin") {
    const g = await req(`/api/admin/users/${grantUserId}/role`, {
      method: "PATCH",
      token: rootToken,
      body: { role: "admin" },
    });
    assert.equal(g.status, 200, JSON.stringify(g.data));
  }
  assert.equal(
    (await req(`/api/admin/users/${plainUserId}/role`, { method: "PATCH", token: admin2Token, body: { role: "admin" } })).status,
    403,
  );
  assert.equal(await roleOf(plainUserId), "user");
  assert.equal(
    (await req(`/api/admin/users/${grantUserId}/role`, { method: "PATCH", token: admin2Token, body: { role: "user" } })).status,
    403,
  );
  assert.equal(await roleOf(grantUserId), "admin");
});

test("role endpoint: root role 400, other values 400, unknown 404, anon 401", async () => {
  assert.equal(
    (await req(`/api/admin/users/${plainUserId}/role`, { method: "PATCH", token: rootToken, body: { role: "root" } })).status,
    400,
  );
  assert.equal(await roleOf(plainUserId), "user");
  assert.equal(
    (await req(`/api/admin/users/${plainUserId}/role`, { method: "PATCH", token: rootToken, body: { role: "superuser" } })).status,
    400,
  );
  assert.equal(
    (await req(`/api/admin/users/${plainUserId}/role`, { method: "PATCH", token: rootToken, body: {} })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/users/999999/role", { method: "PATCH", token: rootToken, body: { role: "admin" } })).status,
    404,
  );
  assert.equal(
    (await req(`/api/admin/users/${plainUserId}/role`, { method: "PATCH", body: { role: "admin" } })).status,
    401,
  );
});

test("own role and root's role can never change: 403", async () => {
  // Root cannot demote itself (self IS root, so both guards agree).
  assert.equal(
    (await req(`/api/admin/users/${rootId}/role`, { method: "PATCH", token: rootToken, body: { role: "user" } })).status,
    403,
  );
  assert.equal(await roleOf(rootId), "root");
  // A non-root admin cannot change its own role either.
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}/role`, { method: "PATCH", token: admin2Token, body: { role: "user" } })).status,
    403,
  );
  assert.equal(await roleOf(admin2Id), "admin");
  // A non-root admin cannot touch the root account's role.
  assert.equal(
    (await req(`/api/admin/users/${rootId}/role`, { method: "PATCH", token: admin2Token, body: { role: "user" } })).status,
    403,
  );
  assert.equal(await roleOf(rootId), "root");
});

test("plain user 403 on admin endpoints; root + non-root admin 200", async () => {
  for (const p of ["/api/admin/stats", "/api/admin/users", "/api/admin/orders"]) {
    assert.equal((await req(p, { token: plainToken })).status, 403, `user must get 403 on ${p}`);
    assert.equal((await req(p, { token: rootToken })).status, 200, `root must get 200 on ${p}`);
    assert.equal((await req(p, { token: admin2Token })).status, 200, `non-root admin must get 200 on ${p}`);
  }
  assert.equal((await req("/api/admin/stats")).status, 403, "anonymous must not get 200 on stats");
});

test("backfill: a DB with id 1 role=admin is promoted to root on boot", async () => {
  // Simulate an old DB: demote id 1 back to "admin" directly.
  await pool.query("UPDATE users SET role='admin' WHERE id=1");
  const before = await pool.query("SELECT role FROM users WHERE id=1");
  assert.equal(before.rows[0].role, "admin");
  // A fresh server boot runs the Item 5 backfill in postgres.mjs.
  const probe = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PROBE_PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${PROBE_BASE}/api/health`);
        if (res.ok) { up = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(up, "probe server must come up");
    const afterBoot = await pool.query("SELECT role FROM users WHERE id=1");
    assert.equal(afterBoot.rows[0].role, "root");
  } finally {
    probe.kill("SIGTERM");
  }
  // The main server sees root again too (role resolves per request).
  assert.equal(await roleOf(rootId), "root");
});

test("Item 4 guards still hold after the role conversion", async () => {
  // A non-root admin still cannot edit / delete / disable root.
  assert.equal(
    (await req(`/api/admin/users/${rootId}`, { method: "PATCH", token: admin2Token, body: { name: "想改root" } })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${rootId}`, { method: "DELETE", token: admin2Token })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${rootId}/status`, { method: "PATCH", token: admin2Token, body: { status: "disabled" } })).status,
    403,
  );
  assert.equal(await roleOf(rootId), "root");
});

// ---- UI + code-shape checks (source-grep only, no server needed) ----
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}
const rolesMjs = read("server/lib/roles.mjs");
const accountMjs = read("server/routes/admin-account.mjs");
const dashboardJsx = read("admin/assets/js/AdminDashboard.jsx");
const loginJsx = read("admin/assets/js/AdminLogin.jsx");
const indexMjs = read("server/index.mjs");
const serverPkg = JSON.parse(read("server/package.json"));

test("roles helper + matrix exist; zero old-style admin gates left in server/", () => {
  assert.ok(rolesMjs.includes("export function isAdminRole(role)"), "isAdminRole must exist");
  assert.ok(rolesMjs.includes("export function isRootUser(user)"), "isRootUser must exist");
  assert.ok(rolesMjs.includes("role === \"root\" || user.id === 1"), "defensive OR (role root or id 1) must be documented");
  assert.ok(rolesMjs.includes("PERMISSION MATRIX"), "the permission matrix must be recorded in code");
  assert.ok(rolesMjs.includes("root-only"), "matrix must name the root-only endpoints");
  // Every admin gate in server/ must go through isAdminRole /
  // isRootUser — a bare `role === "admin"` gate would lock root out.
  // (The two `b.role === "admin"` hits left in admin-account.mjs
  // are body-value checks in the role endpoint, not gates.)
  const GATE_FORMS = [
    'session?.role === "admin"', 'session?.role !== "admin"',
    'session.role === "admin"', 'u.role === "admin"',
    'owner.role === "admin"', 'target.role === "admin"',
    'target.role !== "admin"', 'ctx.session?.role === "admin"',
    "role<>'admin'",
  ];
  const serverFiles = [
    ...fs.readdirSync(path.join(repo, "server/routes")).map((f) => `server/routes/${f}`),
    "server/index.mjs", "server/seed.mjs", "server/postgres.mjs",
    "server/lib/profiles.mjs",
  ];
  for (const rel of serverFiles) {
    const src = read(rel);
    for (const form of GATE_FORMS) {
      assert.ok(!src.includes(form), `${rel} must not contain the old-style gate ${form}`);
    }
  }
  assert.ok(accountMjs.includes("export async function patchAdminUserRole"), "patchAdminUserRole must exist");
  assert.ok(accountMjs.includes('p.match(/^\\/api\\/admin\\/users\\/(\\d+)\\/role$/)'), "role endpoint must match PATCH /api/admin/users/:id/role");
  assert.ok(accountMjs.includes("assertRoot(me)"), "role endpoint must use the root-only gate");
  assert.ok(indexMjs.includes("if (await patchAdminUserRole(ctx)) return;"), "role endpoint must be wired in server/index.mjs");
  assert.ok(read("server/seed.mjs").includes('"root"'), "seed must create the default admin with role root");
  assert.ok(read("server/postgres.mjs").includes("UPDATE users SET role='root' WHERE id=1 AND role='admin'"), "the id-1 backfill must exist in postgres.mjs");
});

test("UI: role-based root, grant/revoke buttons only for root, card shows role", () => {
  assert.ok(
    dashboardJsx.includes('function isRootUser(usr) { return !!usr && (usr.role === "root" || usr.id === 1); }'),
    "isRootUser must be role-based (defensive OR id === 1)",
  );
  assert.ok(
    dashboardJsx.includes('const isRoot = !!me && (me.role === "root" || me.id === 1);'),
    "the caller-side isRoot check must be role-based",
  );
  assert.ok(dashboardJsx.includes("doChangeUserRole"), "grant/revoke handler must exist");
  assert.ok(dashboardJsx.includes("授予管理"), "grant button must exist");
  assert.ok(dashboardJsx.includes("收回管理"), "revoke button must exist");
  assert.ok(dashboardJsx.includes('"/api/admin/users/" + usr.id + "/role"'), "role change must call PATCH /api/admin/users/:id/role");
  // The buttons render only inside an isRoot branch — a non-root
  // caller sees NO role buttons at all.
  const grantBlock = dashboardJsx.match(/\{isRoot \? \(([\s\S]*?)\) : null\}/);
  assert.ok(grantBlock, "grant/revoke buttons must sit in an {isRoot ? ... : null} branch");
  assert.ok(grantBlock[1].includes("授予管理") && grantBlock[1].includes("收回管理"), "both buttons must be inside the isRoot branch");
  // The my-account card already shows the caller's own role (Item 4);
  // with Item 5 it shows "root" for id 1.
  assert.ok(dashboardJsx.includes("{meRow.role}"), "my-account card must show the caller's role");
});

test("AdminLogin admits root; RBAC test wired into the npm test chain", () => {
  assert.ok(loginJsx.includes('u.role === "root"'), "AdminLogin must let root skip the form");
  assert.ok(loginJsx.includes('d.user.role !== "root"'), "AdminLogin must not turn root away at login");
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-redesign-rbac.test.mjs"),
    "server/package.json test script must run tests/admin-redesign-rbac.test.mjs",
  );
});
