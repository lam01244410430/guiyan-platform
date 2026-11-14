// Admin account management (Roadmap 82 Wave R1-2, 2026-11-13) — admin
// profile + enable/disable + OTP password change (xlsx row 3). An admin
// edits ONLY their own profile here; account status is a platform-admin
// action (a shop-scoped admin manages their own shop's resources,
// never accounts). Password change reuses the customer OTP flow
// (POST /api/account/send-otp + verify-otp + consumeVerifiedCode) with
// the code sent to the admin's CURRENT email — delivery is simulated,
// same as the customer flow, and the code is never claimed as a real
// message. A disabled account cannot log in (auth.mjs) and any live
// session stops resolving at once (index.mjs excludes disabled users
// from the session join).
import { scryptSync, timingSafeEqual } from "node:crypto";
import { assert, text, safeUser, time } from "../lib/http.mjs";
import { isAdminRole, isRootUser } from "../lib/roles.mjs";
import { hashPassword } from "./auth.mjs";
import { consumeVerifiedCode } from "./account.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_STATUSES = ["active", "disabled"];
// Admin redesign Item 4 (2026-11-15) — user CRUD (Q7(a)): the 账号
// view merged into 用户, so the admin account endpoints live here
// next to the R1-2 status endpoint.
// Admin redesign Item 5 (2026-11-15) — Oracle-style RBAC (Q1(a)):
// the default admin (id 1) is now role "root" (seed.mjs + backfill
// in postgres.mjs); every interim `id === 1` check is replaced by
// the role-based `isRootUser()` (roles.mjs), which treats
// role === "root" OR id === 1 as root, so an old DB stays safe even
// before the backfill runs.
// Same username rule as registration (auth.mjs); same phone rule as
// the customer phone change (account.mjs).
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PHONE_RE = /^\+?\d{9,15}$/;

function assertAdmin(session) {
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
}

// Admin redesign Item 5 — root-only gate (Q1(a)): ONLY the root
// account grants / revokes the admin role or touches the root
// account. A non-root admin gets 403 here, same as a plain user.
function assertRoot(session) {
  assert(isRootUser(session), "只有最高管理员可执行此操作", 403);
}

// Platform admin = role admin with NO shop (shop_id NULL).
function assertPlatformAdmin(session) {
  assertAdmin(session);
  assert(
    session.shop_id === null || session.shop_id === undefined,
    "只有平台管理员可管理账号",
    403,
  );
}

export async function patchAdminProfile(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p !== "/api/admin/profile" || req.method !== "PATCH") return false;
  const u = needUser();
  assertAdmin(u);
  const updates = {};
  let hasField = false;
  if ("name" in b) {
    hasField = true;
    updates.name = text(b.name, "姓名", 50);
  }
  if ("email" in b) {
    hasField = true;
    // Same rules as the customer email change (account.mjs): trim +
    // lowercase, format, length; uniqueness by SELECT -> 409 (no
    // UNIQUE index, same precedent). No OTP here: the OTP step guards
    // the password change, not the profile edit.
    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    assert(
      email.length > 0 && email.length <= 100 && EMAIL_RE.test(email),
      "邮箱格式不正确",
      400,
    );
    const clash = await get(
      "SELECT id FROM users WHERE LOWER(email)=? AND id<>?",
      email,
      u.id,
    );
    assert(!clash, "邮箱已被使用", 409);
    updates.email = email;
  }
  assert(hasField, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE users SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    u.id,
  );
  const fresh = await get("SELECT * FROM users WHERE id=?", u.id);
  await audit(u, "管理账号", `修改 ${keys.join("、")}`);
  send({ user: safeUser(fresh) });
  return true;
}

export async function patchAdminUserStatus(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/users\/(\d+)\/status$/);
  if (!m || req.method !== "PATCH") return false;
  const me = needUser();
  assertPlatformAdmin(me);
  const id = Number(m[1]);
  const target = await get("SELECT * FROM users WHERE id=?", id);
  assert(target, "用户不存在", 404);
  assert(ACCOUNT_STATUSES.includes(b.status), "账号状态错误", 400);
  // Admin redesign Item 4: the root account (role "root", defensive
  // id === 1 — Item 5) can never be disabled, and nobody disables
  // their own account. Both are 403 (a permission refusal), not 400:
  // the R1-2 self-disable check was 400 and is changed here per the
  // approved redesign.
  assert(!isRootUser(target), "默认管理员账号不可停用", 403);
  if (id === me.id && b.status === "disabled")
    assert(false, "不能停用自己的账号", 403);
  await run("UPDATE users SET status=? WHERE id=?", b.status, id);
  await audit(
    me,
    "管理账号",
    `${b.status === "disabled" ? "停用" : "启用"} ${target.username}`,
  );
  const fresh = await get("SELECT * FROM users WHERE id=?", id);
  send({ user: safeUser(fresh) });
  return true;
}

export async function adminChangePassword(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p !== "/api/admin/change-password" || req.method !== "POST") return false;
  // Admin redesign Item 4 (Q2(a)): the dashboard no longer exposes
  // this endpoint — profile + password change left the dashboard UI
  // with the 账号 view — but the endpoint itself stays, for
  // out-of-dashboard / manual use. There is no self-serve password
  // reset flow inside the dashboard yet; that is a later decision.
  const u = needUser();
  assertAdmin(u);
  // Validate the new password BEFORE consuming the code (OTP lesson:
  // validate first, write after — a throw after the consume would
  // burn a good code without changing anything).
  const next = typeof b.newPassword === "string" ? b.newPassword.trim() : "";
  assert(next.length >= 6, "密码至少6位", 400);
  assert(next.length <= 100, "密码不能超过100位", 400);
  const [salt, expected] = u.password.split(":");
  const same = scryptSync(next, salt, 32);
  assert(
    !timingSafeEqual(same, Buffer.from(expected, "hex")),
    "新密码不能与当前密码相同",
    400,
  );
  // The OTP was sent to the admin's CURRENT email (send-otp lowercases
  // the target); an admin with no email sets one in their profile
  // first. The code must already be verified (verify-otp) or the
  // consume below rejects it.
  assert(u.email, "请先在个人资料中设置邮箱", 400);
  await consumeVerifiedCode(ctx, u.id, "email", u.email.toLowerCase(), b.code);
  await run("UPDATE users SET password=? WHERE id=?", hashPassword(next), u.id);
  await audit(u, "修改密码", "修改密码");
  send({ ok: true });
  return true;
}

// Admin redesign Item 4 — create a user (Q7(a)). Platform-admin
// only; role is FORCED to "user" even if a role is sent (granting
// admin is a separate root-only action, Item 5). Same username /
// password / email rules as registration (auth.mjs); scrypt hashing
// exactly like registration; no auto-login (no token is returned).
export async function createAdminUser(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p !== "/api/admin/users" || req.method !== "POST") return false;
  const me = needUser();
  assertPlatformAdmin(me);
  const username = typeof b.username === "string" ? b.username.trim() : "";
  assert(
    USERNAME_RE.test(username),
    "用户名需为3–20位字母、数字或下划线",
    400,
  );
  const password = typeof b.password === "string" ? b.password.trim() : "";
  assert(password.length >= 6, "密码至少6位", 400);
  assert(password.length <= 100, "密码不能超过100位", 400);
  const name = text(b.name, "姓名", 50);
  let city = null;
  if (b.city !== undefined && b.city !== null && String(b.city).trim() !== "") {
    city = String(b.city).trim();
    assert(city.length <= 30, "城市不能超过30字", 400);
  }
  let email = null;
  if (b.email !== undefined && b.email !== null && String(b.email).trim() !== "") {
    assert(
      typeof b.email === "string" &&
        b.email.trim().length <= 100 &&
        EMAIL_RE.test(b.email.trim()),
      "邮箱格式不正确",
      400,
    );
    email = b.email.trim().toLowerCase();
  }
  let phone = null;
  if (b.phone !== undefined && b.phone !== null && String(b.phone).trim() !== "") {
    phone = String(b.phone).trim();
    assert(PHONE_RE.test(phone), "手机号格式不正确", 400);
  }
  const existing = await get("SELECT id FROM users WHERE username=?", username);
  assert(!existing, "用户名已被注册", 409);
  const inserted = await run(
    "INSERT INTO users(username,password,name,role,city,email,phone,created_at) VALUES(?,?,?,?,?,?,?,?)",
    username,
    hashPassword(password),
    name,
    "user",
    city,
    email,
    phone,
    time(),
  );
  const u = await get("SELECT * FROM users WHERE id=?", inserted.lastInsertRowid);
  await audit(me, "管理账号", `新建用户 ${username}`);
  send({ user: safeUser(u) }, 201);
  return true;
}

// Admin redesign Item 4 — edit a regular user (Q7(a)): 姓名/城市/
// 邮箱/手机号 only. Platform-admin only; the target must be a plain
// user — an admin-role account (and the root account — Item 5,
// role-based `isRootUser()`) is never editable here, and neither is
// the caller's own row (own profile editing left the dashboard with
// the 账号 view; only root manages admin accounts).
// username/id/role are never editable through this endpoint: sending
// any of them is a 400 (role changes are a separate root-only action,
// Item 5). Email follows the profile rules (trim + lowercase,
// duplicate -> 409); phone must match ^\+?\d{9,15}$ when non-empty.
// An empty city/phone clears the field.
export async function patchAdminUser(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  const me = needUser();
  assertPlatformAdmin(me);
  const id = Number(m[1]);
  const target = await get("SELECT * FROM users WHERE id=?", id);
  assert(target, "用户不存在", 404);
  assert(!isAdminRole(target.role), "管理员账号不可通过此接口修改", 403);
  assert(!isRootUser(target), "默认管理员账号不可修改", 403);
  assert(target.id !== me.id, "不能修改自己的账号", 403);
  assert(
    !("username" in b) && !("role" in b) && !("id" in b),
    "不允许修改账号、角色或编号",
    400,
  );
  const updates = {};
  let hasField = false;
  if ("name" in b) {
    hasField = true;
    updates.name = text(b.name, "姓名", 50);
  }
  if ("city" in b) {
    hasField = true;
    const city = typeof b.city === "string" ? b.city.trim() : "";
    assert(city.length <= 30, "城市不能超过30字", 400);
    updates.city = city;
  }
  if ("email" in b) {
    hasField = true;
    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    assert(
      email.length > 0 && email.length <= 100 && EMAIL_RE.test(email),
      "邮箱格式不正确",
      400,
    );
    const clash = await get(
      "SELECT id FROM users WHERE LOWER(email)=? AND id<>?",
      email,
      id,
    );
    assert(!clash, "邮箱已被使用", 409);
    updates.email = email;
  }
  if ("phone" in b) {
    hasField = true;
    const phone = typeof b.phone === "string" ? b.phone.trim() : "";
    assert(phone === "" || PHONE_RE.test(phone), "手机号格式不正确", 400);
    updates.phone = phone;
  }
  assert(hasField, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE users SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM users WHERE id=?", id);
  await audit(me, "管理账号", `修改用户 ${target.username} ${keys.join("、")}`);
  send({ user: safeUser(fresh) });
  return true;
}

// Every table that references users(id) (schema.mjs). A user with a
// row in ANY of them cannot be deleted: this endpoint NEVER
// cascade-deletes — the data stays, so the account stays, and the
// admin resolves the data first (e.g. a user with orders keeps the
// account). Checking every FK up front also means the DELETE below
// can never trip a foreign-key violation.
const USER_REFERENCES = [
  ["sessions", "user_id", "登录会话"],
  ["resources", "owner_id", "资源"],
  ["orders", "user_id", "订单"],
  ["demands", "user_id", "需求"],
  ["comments", "user_id", "评价"],
  ["messages", "user_id", "站内消息"],
  ["messages", "sender_id", "站内消息"],
  ["favorites", "user_id", "收藏"],
  ["events", "user_id", "行为记录"],
  ["user_tags", "user_id", "用户标签"],
  ["audit_logs", "user_id", "审计记录"],
  ["verification_codes", "user_id", "验证码"],
  ["oauth_accounts", "user_id", "第三方账号"],
  ["shops", "owner_id", "店铺"],
  ["shows", "created_by", "演出"],
  ["coupon_redemptions", "user_id", "优惠券核销"],
  ["coupon_gifts", "user_id", "赠券"],
  ["stored_value_accounts", "user_id", "储值账户"],
  ["tickets", "verified_by", "票务核销"],
  ["verify_logs", "verified_by", "核销记录"],
  ["print_logs", "printed_by", "打印记录"],
];

// Admin redesign Item 4 — delete a user (Q7(a)). Platform-admin
// only; only a plain role=user account, never an admin (and never
// the root account — Item 5, role-based `isRootUser()`), never the
// caller themself. If the user owns any
// referential data (orders/demands/comments/favorites/tickets or any
// other row in USER_REFERENCES) the delete is refused with 400 —
// no cascade-delete. Otherwise the row is hard-deleted and the
// deletion is written to the audit log (against the caller).
export async function deleteAdminUser(ctx) {
  const { p, req, send, needUser, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (!m || req.method !== "DELETE") return false;
  const me = needUser();
  assertPlatformAdmin(me);
  const id = Number(m[1]);
  const target = await get("SELECT * FROM users WHERE id=?", id);
  assert(target, "用户不存在", 404);
  assert(!isAdminRole(target.role), "管理员账号不可删除", 403);
  assert(!isRootUser(target), "默认管理员账号不可删除", 403);
  assert(target.id !== me.id, "不能删除自己的账号", 403);
  for (const [table, col, label] of USER_REFERENCES) {
    const row = await get(
      `SELECT 1 AS x FROM ${table} WHERE ${col}=? LIMIT 1`,
      id,
    );
    assert(!row, `该用户已有${label}，无法删除`, 400);
  }
  await run("DELETE FROM users WHERE id=?", id);
  await audit(me, "管理账号", `删除用户 ${target.username}`);
  send({ ok: true });
  return true;
}

// Admin redesign Item 5 — grant / revoke the admin role (Q1(a)).
// ROOT-ONLY: a non-root admin gets 403 here (granting roles is the
// one power reserved to root), a plain user 403, anonymous 401
// (needUser). Body {role: "admin" | "user"} only: "root" is never
// grantable (root is only id 1) -> 400, any other value -> 400.
// The caller's own role can never change through this endpoint
// (no self-demotion) -> 403, and neither can the root account's
// role -> 403. On success (200) the role is updated and the change
// is written to the audit log (action 授予管理员 / 收回管理员).
// NOTE: this endpoint deliberately does NOT use assertPlatformAdmin
// — root is the platform admin by construction (id 1, shop_id NULL),
// and the root check alone is the gate.
export async function patchAdminUserRole(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/users\/(\d+)\/role$/);
  if (!m || req.method !== "PATCH") return false;
  const me = needUser();
  assertRoot(me);
  const id = Number(m[1]);
  const target = await get("SELECT * FROM users WHERE id=?", id);
  assert(target, "用户不存在", 404);
  assert(target.id !== me.id, "不能修改自己的角色", 403);
  assert(!isRootUser(target), "默认管理员账号的角色不可修改", 403);
  assert(
    b.role === "admin" || b.role === "user",
    b.role === "root" ? "不能授予最高管理员角色" : "角色只能为 admin 或 user",
    400,
  );
  await run("UPDATE users SET role=? WHERE id=?", b.role, id);
  const granting = b.role === "admin";
  await audit(
    me,
    granting ? "授予管理员" : "收回管理员",
    granting
      ? `授予 ${target.username} 管理员权限`
      : `收回 ${target.username} 管理员权限`,
  );
  const fresh = await get("SELECT * FROM users WHERE id=?", id);
  send({ user: safeUser(fresh) });
  return true;
}
