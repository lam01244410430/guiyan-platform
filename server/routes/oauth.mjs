// WeChat mini-program sign-in (POST /api/auth/wechat-mini).
//
// Two layers, both through this one endpoint:
//   - One-tap sign-in: {code} only. The server exchanges the code at
//     jscode2session for the openid, looks up oauth_accounts, and returns
//     a normal 7-day session when the openid is linked. When it is not
//     linked, the endpoint answers 200 {linked:false} (not an error) so
//     the mini-program can open the link form instead of failing.
//   - Link an existing account: {code, username, password} (or {code}
//     with a Bearer session). The password is verified exactly like
//     login, then the openid is linked to that user (idempotent; a 409
//     when the openid already belongs to another user).
//
// Honesty note: wx.login proves only "this device opened with WeChat
// account X" (openid). No phone, email or real name is ever read here;
// the display name comes from the linked Guiyan account.
//
// Secrets: WECHAT_MINI_APPID / WECHAT_MINI_APPSECRET come from the
// environment only — never committed, never logged. Without them the
// endpoint fails cleanly with 503 (no jscode2session call is attempted).
// The AppSecret is supplied by Lam at deploy time.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { assert, text, safeUser, time } from "../lib/http.mjs";

const JSCODE_URL = "https://api.weixin.qq.com/sns/jscode2session";
const PROVIDER = "wechat-mini";

async function exchangeCode(code) {
  const appid = process.env.WECHAT_MINI_APPID;
  const secret = process.env.WECHAT_MINI_APPSECRET;
  if (!appid || !secret) {
    const e = new Error("微信登录未配置");
    e.status = 503;
    throw e;
  }
  const url =
    `${JSCODE_URL}?appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    const e = new Error("微信服务暂时不可用");
    e.status = 503;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errcode || !data.openid) {
    const e = new Error("微信登录失败，请重试");
    e.status = 401;
    throw e;
  }
  // unionid is returned when the account is bound to an Open Platform
  // account; the link key is the openid, so unionid is not stored.
  return { openid: data.openid };
}

async function issueSession(ctx, user) {
  const token = randomBytes(32).toString("hex");
  await ctx.run(
    "INSERT INTO sessions VALUES(?,?,?)",
    token,
    user.id,
    new Date(Date.now() + 86400000 * 7).toISOString(),
  );
  return { token, user: safeUser(user) };
}

export async function wechatMini(ctx) {
  const { p, req, b, send, get, run, audit, session } = ctx;
  if (p !== "/api/auth/wechat-mini" || req.method !== "POST") return false;
  const code = typeof b.code === "string" ? b.code.trim() : "";
  assert(code, "缺少微信登录凭证", 400);
  assert(code.length <= 128, "微信登录凭证无效", 400);

  // Identify the Guiyan user first (Bearer session, then username +
  // password verified exactly like login) so a wrong password fails
  // here without ever calling WeChat. The code is exchanged after.
  let user = session || null;
  if (!user && b.username !== undefined) {
    const username = text(b.username, "账号", 40);
    const password = text(b.password, "密码", 100);
    const u = await get("SELECT * FROM users WHERE username=?", username);
    assert(u, "账号或密码不正确", 401);
    const [salt, expected] = u.password.split(":");
    const actual = scryptSync(password, salt, 32);
    assert(
      timingSafeEqual(actual, Buffer.from(expected, "hex")),
      "账号或密码不正确",
      401,
    );
    user = u;
  }
  const { openid } = await exchangeCode(code);

  if (user) {
    const existing = await get(
      "SELECT * FROM oauth_accounts WHERE provider=? AND provider_user_id=?",
      PROVIDER,
      openid,
    );
    if (existing && existing.user_id !== user.id)
      assert(false, "该微信已关联其他账号", 409);
    if (!existing) {
      await run(
        "INSERT INTO oauth_accounts(provider,provider_user_id,user_id,created_at) VALUES(?,?,?,?)",
        PROVIDER,
        openid,
        user.id,
        time(),
      );
      await audit(user, "关联微信", "关联微信小程序 openid");
    }
    const out = await issueSession(ctx, user);
    send({ ...out, linked: true });
    return true;
  }

  const link = await get(
    "SELECT * FROM oauth_accounts WHERE provider=? AND provider_user_id=?",
    PROVIDER,
    openid,
  );
  if (!link) {
    send({ linked: false });
    return true;
  }
  const u = await get("SELECT * FROM users WHERE id=?", link.user_id);
  assert(u, "账号不存在", 401);
  await audit(u, "微信登录", "微信小程序一键登录");
  const out = await issueSession(ctx, u);
  send({ ...out, linked: true });
  return true;
}
