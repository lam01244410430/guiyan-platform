import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { assert, text, safeUser, time } from "../lib/http.mjs";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export async function register(ctx) {
  const { p, req, b, send, get, run, audit } = ctx;
  if (p === "/api/auth/register" && req.method === "POST") {
    const username = typeof b.username === "string" ? b.username.trim() : "";
    assert(
      USERNAME_RE.test(username),
      "用户名需为3–20位字母、数字或下划线",
      400,
    );
    // Trimmed, like login (login hashes text(password), which trims).
    const password = typeof b.password === "string" ? b.password.trim() : "";
    assert(password.length >= 6, "密码至少6位", 400);
    assert(password.length <= 100, "密码不能超过100位", 400);
    const name = text(b.name, "姓名", 50);
    let email = null;
    if (b.email !== undefined && b.email !== null && String(b.email).trim() !== "") {
      assert(
        typeof b.email === "string" &&
          b.email.trim().length <= 100 &&
          EMAIL_RE.test(b.email.trim()),
        "邮箱格式不正确",
        400,
      );
      email = b.email.trim();
    }
    const existing = await get(
      "SELECT id FROM users WHERE username=?",
      username,
    );
    assert(!existing, "用户名已被注册", 409);
    // Role is FIXED to "user": any client-supplied role is ignored, so
    // sending role=admin can never create an admin.
    const inserted = await run(
      "INSERT INTO users(username,password,name,role,email,created_at) VALUES(?,?,?,?,?,?)",
      username,
      hashPassword(password),
      name,
      "user",
      email,
      time(),
    );
    const u = await get(
      "SELECT * FROM users WHERE id=?",
      inserted.lastInsertRowid,
    );
    // Auto-login, same session shape as login (7-day token).
    const newToken = randomBytes(32).toString("hex");
    await run(
      "INSERT INTO sessions VALUES(?,?,?)",
      newToken,
      u.id,
      new Date(Date.now() + 86400000 * 7).toISOString(),
    );
    await audit(u, "注册", "新用户注册");
    send({ token: newToken, user: safeUser(u) });
    return true;
  }
  return false;
}

export async function login(ctx) {
  const { p, req, b, send, get, run, audit } = ctx;
  if (p === "/api/auth/login" && req.method === "POST") {
    const u = await get(
      "SELECT * FROM users WHERE username=?",
      text(b.username, "账号", 40),
    );
    assert(u, "账号或密码不正确", 401);
    const [salt, expected] = u.password.split(":");
    const actual = scryptSync(text(b.password, "密码", 100), salt, 32);
    assert(
      timingSafeEqual(actual, Buffer.from(expected, "hex")),
      "账号或密码不正确",
      401,
    );
    const newToken = randomBytes(32).toString("hex");
    await run(
      "INSERT INTO sessions VALUES(?,?,?)",
      newToken,
      u.id,
      new Date(Date.now() + 86400000 * 7).toISOString(),
    );
    await audit(u, "登录", "演示账号登录");
    send({ token: newToken, user: safeUser(u) });
    return true;
  }
  return false;
}

export async function changePassword(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/auth/change-password" && req.method === "POST") {
    const u = needUser();
    // Current password must verify exactly like login (scrypt +
    // timingSafeEqual); a wrong one is 401 and changes nothing.
    const [salt, expected] = u.password.split(":");
    const actual = scryptSync(text(b.currentPassword, "当前密码", 100), salt, 32);
    assert(
      timingSafeEqual(actual, Buffer.from(expected, "hex")),
      "当前密码不正确",
      401,
    );
    const next = typeof b.newPassword === "string" ? b.newPassword.trim() : "";
    assert(next.length >= 6, "密码至少6位", 400);
    assert(next.length <= 100, "密码不能超过100位", 400);
    // New must differ from current (compared by hash, never plaintext).
    const same = scryptSync(next, salt, 32);
    assert(
      !timingSafeEqual(same, Buffer.from(expected, "hex")),
      "新密码不能与当前密码相同",
      400,
    );
    await run("UPDATE users SET password=? WHERE id=?", hashPassword(next), u.id);
    await audit(u, "修改密码", "修改密码");
    send({ ok: true });
    return true;
  }
  return false;
}

export async function logout(ctx) {
  const { p, req, send, run } = ctx;
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (p === "/api/auth/logout" && req.method === "POST") {
    if (token) await run("DELETE FROM sessions WHERE token=?", token);
    send({ ok: true });
    return true;
  }
  return false;
}
