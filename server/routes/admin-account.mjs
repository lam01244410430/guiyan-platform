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
import { assert, text, safeUser } from "../lib/http.mjs";
import { hashPassword } from "./auth.mjs";
import { consumeVerifiedCode } from "./account.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_STATUSES = ["active", "disabled"];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
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
  if (id === me.id && b.status === "disabled")
    assert(false, "不能停用自己的账号", 400);
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
