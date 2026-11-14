// tests/admin-redesign-users-crud.test.mjs: admin redesign Item 4 —
// the 账号 view merged into 用户 + user CRUD (Q2(a) + Q7(a)).
// API part spawns server/server.mjs on TEST_PORT (default 3288) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH
// disposable database (npm test is NOT idempotent on a reused DB).
// The UI part is source-grep only, no server needed.
//
// Covered: create (201, role forced "user" even when role=admin is
// sent, no token; duplicate username 409; short password / bad
// username / bad phone 400); edit (200 on a regular user, email
// stored lowercased; edit admin/root/self -> 403; bad email/phone
// 400; username/role in the body -> 400; unknown user 404); delete
// (200 on a data-less regular user + audit row; delete admin/root/
// self -> 403; delete a user with orders -> 400, no cascade-delete;
// unknown user 404); status guards (disable root/self -> 403);
// shop-scoped admin -> 403 on every write; 账号 nav/view gone
// (27 views), read-only my-account card, root row grayed, edit /
// create / delete UI present.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const PORT = Number(process.env.TEST_PORT || 3288);
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
let adminEmail;
let demoId;
let shopToken;
let admin2Id;
let editUserId;
let deleteUserId;
let toggleUserId;
let orderUserId;

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
  const list = await req("/api/admin/users", { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  adminId = list.data.users.find((u) => u.username === "admin").id;
  adminEmail = list.data.users.find((u) => u.username === "admin").email;
  demoId = list.data.users.find((u) => u.username === "demo").id;
  // Second admin, inserted directly: register fixes role=user.
  const pw = hashPassword("Admin1234");
  const a2 = await pool.query(
    "INSERT INTO users(username,password,name,role,email,city,created_at) VALUES($1,$2,$3,'admin',$4,'桂林',$5) RETURNING id",
    ["crudadmin2", pw, "子店管理员CRUD", "crudadmin2@example.com", new Date().toISOString()],
  );
  admin2Id = a2.rows[0].id;
  // Shop owned by admin2, so admin2 becomes shop-scoped (R1-1).
  const shop = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "桂演桂林分店", owner_id: admin2Id },
  });
  assert.equal(shop.status, 200, JSON.stringify(shop.data));
  shopToken = await loginOk("crudadmin2", "Admin1234");
  // Regular users for the edit / delete / toggle tests, created
  // through the new endpoint itself.
  async function mk(username) {
    const r = await req("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: {
        username, password: "Crud1234", name: "待处理用户",
        city: "南宁", email: `${username}@example.com`, phone: "+8613800000001",
      },
    });
    assert.equal(r.status, 201, `create ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.user.id;
  }
  editUserId = await mk("crudedit1");
  deleteUserId = await mk("cruddel1");
  toggleUserId = await mk("crudtog1");
  orderUserId = await mk("crudord1");
  // Give crudord1 exactly one order (direct insert — the point is
  // the delete guard, not the order flow). Resource 1 exists in the
  // seed; the code must be unique in this shared DB.
  const res = await req("/api/admin/resources", { token: adminToken });
  const resourceId = res.data.resources[0].id;
  await pool.query(
    "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,created_at) VALUES($1,$2,$3,1,28000,'2026-11-09','paid','H5',$4)",
    ["CRUD-ORDER-1", orderUserId, resourceId, new Date().toISOString()],
  );
});

after(async () => {
  if (child) child.kill("SIGTERM");
  // Clean up everything this file created (sessions + audit rows
  // reference user ids first — audit_logs.user_id is a real FK).
  // cruddel1 was already deleted through the API in its test.
  const ids = [editUserId, toggleUserId, orderUserId, admin2Id];
  await pool.query("DELETE FROM orders WHERE code='CRUD-ORDER-1'");
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM shops WHERE owner_id=$1", [admin2Id]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
});

test("create user: 201, role forced user, no token; duplicate 409; bad input 400; non-platform-admin 403", async () => {
  const r = await req("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: {
      username: "crudnew1", password: "Crud1234", name: "新建用户",
      city: "柳州", email: "CrudNew1@Example.com", phone: "+8613800000002",
      role: "admin",
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // Role is FORCED to user even though role=admin was sent, and
  // there is no auto-login: no token comes back.
  assert.equal(r.data.user.role, "user");
  assert.equal(r.data.token, undefined);
  assert.equal(r.data.user.username, "crudnew1");
  assert.equal(r.data.user.email, "crudnew1@example.com");
  assert.equal(r.data.user.password, undefined);
  const createdId = r.data.user.id;
  // The new user can log in, but as a plain user they cannot reach
  // the admin API at all.
  const t = await loginOk("crudnew1", "Crud1234");
  assert.equal((await req("/api/admin/users", { token: t })).status, 403);
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: adminToken, body: { username: "crudnew1", password: "Crud1234", name: "重复" } })).status,
    409,
  );
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: adminToken, body: { username: "ab", password: "Crud1234", name: "太短" } })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: adminToken, body: { username: "crudnew2", password: "12345", name: "密码短" } })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: adminToken, body: { username: "crudnew3", password: "Crud1234", name: "电话错", phone: "123" } })).status,
    400,
  );
  // Shop-scoped admin and plain user cannot create users.
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: shopToken, body: { username: "crudnew4", password: "Crud1234", name: "越权" } })).status,
    403,
  );
  const demoToken = await loginOk("demo", "demo123");
  assert.equal(
    (await req("/api/admin/users", { method: "POST", token: demoToken, body: { username: "crudnew5", password: "Crud1234", name: "越权" } })).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/users", { method: "POST", body: { username: "crudnew6", password: "Crud1234", name: "匿名" } })).status,
    401,
  );
  // Clean up the user this test created (it never logged in as an
  // admin, owns nothing, so the API delete accepts it — but the
  // login above left a session row AND a "登录" audit row, and both
  // block deletion, so drop them first, like the R1-2 cleanup
  // pattern).
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [createdId]);
  await pool.query("DELETE FROM audit_logs WHERE user_id=$1", [createdId]);
  assert.equal(
    (await req(`/api/admin/users/${createdId}`, { method: "DELETE", token: adminToken })).status,
    200,
  );
});

test("edit user: 200 on a regular user; edit admin/root/self 403; bad email/phone 400; username/role 400; unknown 404", async () => {
  const r = await req(`/api/admin/users/${editUserId}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "已编辑用户", city: "桂林", email: "CrudEdit@Example.com", phone: "+8613800000009" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.name, "已编辑用户");
  assert.equal(r.data.user.city, "桂林");
  // Email is stored lowercased, like the profile edit.
  assert.equal(r.data.user.email, "crudedit@example.com");
  assert.equal(r.data.user.phone, "+8613800000009");
  // Username, role and id are never editable through this endpoint.
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: { role: "admin" } })).status,
    400,
  );
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: { username: "renamed" } })).status,
    400,
  );
  // Admin accounts, the default admin (id 1) and the caller's own
  // row are all refused with 403.
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}`, { method: "PATCH", token: adminToken, body: { name: "X" } })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${adminId}`, { method: "PATCH", token: adminToken, body: { name: "X" } })).status,
    403,
  );
  // Duplicate email -> 409 (admin's email, read live above — or the
  // second admin's, if the admin has no email yet).
  const clashEmail = adminEmail || "crudadmin2@example.com";
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: { email: clashEmail } })).status,
    409,
  );
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: { email: "not-an-email" } })).status,
    400,
  );
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: { phone: "123" } })).status,
    400,
  );
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: adminToken, body: {} })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/users/99999", { method: "PATCH", token: adminToken, body: { name: "X" } })).status,
    404,
  );
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: shopToken, body: { name: "X" } })).status,
    403,
  );
  const demoToken = await loginOk("demo", "demo123");
  assert.equal(
    (await req(`/api/admin/users/${editUserId}`, { method: "PATCH", token: demoToken, body: { name: "X" } })).status,
    403,
  );
});

test("delete user: 200 on a data-less user + audit row; admin/root/self 403; user with orders 400; unknown 404", async () => {
  const r = await req(`/api/admin/users/${deleteUserId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  // The deletion is written to the audit log (against the caller).
  const logs = await req("/api/admin/audit-logs", { token: adminToken });
  assert.equal(logs.status, 200);
  assert.ok(logs.data.logs.some((l) => l.action === "管理账号" && String(l.detail || "").includes("cruddel1")));
  // Deleting again is a 404, not a second delete.
  assert.equal(
    (await req(`/api/admin/users/${deleteUserId}`, { method: "DELETE", token: adminToken })).status,
    404,
  );
  // Admin accounts, the default admin (id 1) and the caller's own
  // row are all refused with 403.
  assert.equal(
    (await req(`/api/admin/users/${admin2Id}`, { method: "DELETE", token: adminToken })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${adminId}`, { method: "DELETE", token: adminToken })).status,
    403,
  );
  // A user with orders is refused with 400 — no cascade-delete.
  // crudord1 owns exactly one order (inserted in before()).
  const blocked = await req(`/api/admin/users/${orderUserId}`, {
    method: "DELETE",
    token: adminToken,
  });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /订单/);
  // The seeded demo user owns orders too (and more), so it is also
  // blocked — and still there afterwards.
  assert.equal(
    (await req(`/api/admin/users/${demoId}`, { method: "DELETE", token: adminToken })).status,
    400,
  );
  const stillThere = await req("/api/admin/users", { token: adminToken });
  assert.ok(stillThere.data.users.some((u) => u.username === "demo"));
  assert.equal(
    (await req("/api/admin/users/99999", { method: "DELETE", token: adminToken })).status,
    404,
  );
  assert.equal(
    (await req(`/api/admin/users/${toggleUserId}`, { method: "DELETE", token: shopToken })).status,
    403,
  );
});

test("status toggle guards: disable root/self 403; disable + re-enable a regular user 200", async () => {
  assert.equal(
    (await req(`/api/admin/users/${adminId}/status`, { method: "PATCH", token: adminToken, body: { status: "disabled" } })).status,
    403,
  );
  assert.equal(
    (await req(`/api/admin/users/${toggleUserId}/status`, { method: "PATCH", token: shopToken, body: { status: "disabled" } })).status,
    403,
  );
  const off = await req(`/api/admin/users/${toggleUserId}/status`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "disabled" },
  });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.user.status, "disabled");
  const on = await req(`/api/admin/users/${toggleUserId}/status`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "active" },
  });
  assert.equal(on.status, 200);
  assert.equal(on.data.user.status, "active");
});

// --- UI source-grep tests (no server needed) ---
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const sidebarJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "Sidebar.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const accountMjs = fs.readFileSync(
  path.join(repoDir, "server", "routes", "admin-account.mjs"),
  "utf-8",
);
const indexMjs = fs.readFileSync(
  path.join(repoDir, "server", "index.mjs"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

test("account view removed: 27 nav views, no account entry, section, titles or handlers", () => {
  const viewsBlock = sidebarJsx.match(/const VIEWS = \[([\s\S]*?)\n\];/);
  assert.ok(viewsBlock, "VIEWS array not found in Sidebar.jsx");
  const ids = viewsBlock[1].match(/\{ id: "/g) || [];
  assert.equal(ids.length, 27, "nav must have exactly 27 views after removing 账号, found " + ids.length);
  assert.ok(!sidebarJsx.includes('id: "account"'), "account nav entry must be gone");
  assert.ok(!sidebarJsx.includes('label: "账号"'), "account nav label must be gone");
  assert.ok(!sidebarJsx.includes("account: (<>"), "account nav icon must be gone");
  assert.ok(!dashboardJsx.includes('id="view-account"'), "account view section must be gone");
  assert.ok(!dashboardJsx.includes('account: ["账号"'), "account titles entry must be gone");
  assert.ok(!dashboardJsx.includes('changeView("account")'), "no code may switch to the account view");
  for (const dead of ["acctName", "acctEmail", "acctBusy", "acctOtp", "acctNewPw", "acctPwBusy",
    "saveAcctProfile", "sendAcctOtp", "doAcctChangePassword"]) {
    assert.ok(!dashboardJsx.includes(dead), "account handler/state must be gone: " + dead);
  }
  // The server endpoints stay for out-of-dashboard/manual use — the
  // dashboard only stops exposing them.
  assert.ok(accountMjs.includes('"/api/admin/profile"'), "PATCH /api/admin/profile must stay on the server");
  assert.ok(accountMjs.includes('"/api/admin/change-password"'), "POST /api/admin/change-password must stay on the server");
  assert.ok(accountMjs.includes("no longer exposes"), "change-password must carry the Q2(a) note");
});

test("my-account card: read-only, at the top of the users view, no edit controls", () => {
  assert.ok(dashboardJsx.includes('id="my-account-card"'), "my-account card must exist");
  assert.ok(dashboardJsx.includes("<h2>我的账号</h2>"), "card must be titled 我的账号");
  // The card sits inside the users section, before the search row.
  const usersSec = dashboardJsx.match(/id="view-users">([\s\S]*?)<div className="search-row">/);
  assert.ok(usersSec, "users section + search row not found");
  assert.ok(usersSec[1].includes('id="my-account-card"'), "card must sit at the top of the users view, before the search row");
  // The card shows the signed-in admin's row and nothing editable:
  // no input, no button, no click handler inside the card block.
  const card = dashboardJsx.match(/id="my-account-card">([\s\S]*?)<\/div>\s*\) : null\}/);
  assert.ok(card, "my-account card block not found");
  assert.ok(!card[1].includes("<input"), "read-only card must have no inputs");
  assert.ok(!card[1].includes("<button"), "read-only card must have no buttons");
  assert.ok(!card[1].includes("onClick"), "read-only card must have no click handlers");
  for (const field of ["{meRow.username}", "{meRow.name", "{meRow.email", "{meRow.role}", "shopName(meRow.shop_id)"]) {
    assert.ok(card[1].includes(field), "card must show: " + field);
  }
  assert.ok(card[1].includes("仅查看"), "card must say it is read-only");
});

test("root row locked + CRUD buttons and modals present in the users view", () => {
  // The default admin (id 1) is identified in the UI by id — the
  // `root` role value arrives in Item 5, which replaces this check.
  assert.ok(dashboardJsx.includes("function isRootUser(usr) { return !!usr && usr.id === 1; }"), "isRootUser must check id === 1");
  assert.ok(dashboardJsx.includes("Item 5 replaces this with role === \"root\""), "the interim id === 1 check must be documented");
  assert.ok(
    dashboardJsx.includes('<tr key={usr.username} className={isRootUser(usr) ? "row-locked" : undefined}>'),
    "root row must render with the row-locked class",
  );
  // Edit/delete buttons exist, and only for plain users (never admin
  // rows, never the caller's own row, never the root row).
  assert.ok(dashboardJsx.includes("onClick={() => openUserEditForm(usr)}>编辑</button>"), "edit button must exist");
  assert.ok(dashboardJsx.includes("onClick={() => setUserDeleteTarget(usr)}>删除</button>"), "delete button must exist");
  assert.ok(dashboardJsx.includes('usr.role !== "admin"'), "edit/delete must be hidden on admin rows");
  assert.ok(dashboardJsx.includes("usr.id !== me.id && !isRootUser(usr)"), "action buttons must be hidden on self + root rows");
  // Create button + modal, edit modal (4 fields only), delete confirm.
  assert.ok(dashboardJsx.includes('onClick={openUserCreateForm}>新建用户</button>'), "create button must exist");
  assert.ok(dashboardJsx.includes("<h3>新建用户</h3>"), "create modal must exist");
  assert.ok(dashboardJsx.includes("<h3>编辑用户</h3>"), "edit modal must exist");
  assert.ok(dashboardJsx.includes("<h3>删除用户</h3>"), "delete confirm must exist");
  assert.ok(dashboardJsx.includes("onClick={() => doDeleteUser(userDeleteTarget)}"), "delete confirm button must exist");
  assert.ok(dashboardJsx.includes('"确认删除"'), "delete confirm button must say 确认删除");
  const editModal = dashboardJsx.match(/<h3>编辑用户<\/h3>([\s\S]*?)<div className="contract-actions">/);
  assert.ok(editModal, "edit modal body not found");
  for (const label of ["姓名", "城市", "邮箱", "手机号"]) {
    assert.ok(editModal[1].includes(label), "edit modal must have field: " + label);
  }
  assert.ok(!editModal[1].includes("账号"), "edit modal must not offer a username field");
  assert.ok(!editModal[1].includes("角色"), "edit modal must not offer a role field");
  // The status toggle keeps working for non-root, non-self rows.
  assert.ok(dashboardJsx.includes("onClick={() => doToggleUserStatus(usr)}"), "status toggle must stay");
});

test("CRUD server: endpoints + guards + delete-block rule present in code", () => {
  assert.ok(accountMjs.includes('if (p !== "/api/admin/users" || req.method !== "POST") return false;'), "POST /api/admin/users must exist");
  assert.ok(accountMjs.includes("const m = p.match(/^\\/api\\/admin\\/users\\/(\\d+)$/);"), "user-by-id routes must exist");
  assert.ok(accountMjs.includes("export async function createAdminUser"), "createAdminUser must exist");
  assert.ok(accountMjs.includes("export async function patchAdminUser"), "patchAdminUser must exist");
  assert.ok(accountMjs.includes("export async function deleteAdminUser"), "deleteAdminUser must exist");
  assert.ok(accountMjs.includes("const ROOT_ADMIN_ID = 1;"), "root must be identified by id 1 (interim)");
  assert.ok(accountMjs.includes("Item 5 switches to role === \"root\""), "the interim root check must be documented server-side");
  assert.ok(accountMjs.includes("USER_REFERENCES"), "delete must check every user-referencing table");
  assert.ok(accountMjs.includes("NEVER"), "delete must document the no-cascade-delete rule");
  assert.ok(accountMjs.includes('["orders", "user_id", "订单"]'), "orders must block deletion");
  assert.ok(accountMjs.includes("该用户已有"), "delete-blocked message must name the blocking data");
  for (const fn of ["createAdminUser", "patchAdminUser", "deleteAdminUser"]) {
    assert.ok(indexMjs.includes(`if (await ${fn}(ctx)) return;`), fn + " must be wired in server/index.mjs");
  }
  assert.ok(css.includes("tr.row-locked td{color:var(--p-muted)"), "locked row must use the Item 1 gray tokens");
  assert.ok(css.includes(".my-account-card{"), "my-account card CSS must exist");
  assert.ok(css.includes(".modal-form{"), "CRUD modal form CSS must exist");
});

test("users CRUD test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/admin-redesign-users-crud.test.mjs"),
    "server/package.json test script must run tests/admin-redesign-users-crud.test.mjs",
  );
});
