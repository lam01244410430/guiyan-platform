import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { assert, text, safeUser } from "../lib/http.mjs";

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
