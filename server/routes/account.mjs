// Guiyan account endpoints (account tabs, 2026-11-12) — the logged-in
// user edits ONLY their own row (session.id; no userId is ever read from
// the client). All three sensitive changes are audited. No rate limit
// yet (Wave 5 #29); the only guard here is the login + audit trail.
import { randomInt } from "node:crypto";
import { assert, text, int, time, safeUser } from "../lib/http.mjs";
import { validKey } from "../storage.mjs";

// Avatar files: JPEG/PNG/WebP only (the generic storage upload accepts
// anything — avatars must not). The server always generates the key, so
// a client can never overwrite another user's avatar by naming a key.
const AVATAR_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const AVATAR_MAX_BYTES = 200000;

export async function patchProfile(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/account/profile" && req.method === "PATCH") {
    const u = needUser();
    const updates = {};
    let hasField = false;
    if ("name" in b) {
      hasField = true;
      updates.name = text(b.name, "姓名", 50);
    }
    if ("city" in b) {
      hasField = true;
      updates.city =
        typeof b.city === "string" && b.city.trim() === ""
          ? null
          : text(b.city, "城市", 20);
    }
    if ("age" in b) {
      hasField = true;
      updates.age =
        b.age === null
          ? null
          : int(b.age, "年龄", 1, 120);
    }
    if ("gender" in b) {
      hasField = true;
      assert(
        b.gender === "" || b.gender === "男" || b.gender === "女",
        "性别无效",
        400,
      );
      updates.gender = b.gender;
    }
    assert(hasField, "未提供可修改的字段", 400);
    // username / role / channel / preference / verified / created_at are
    // never writable here — a client sending them is silently ignored.
    const keys = Object.keys(updates);
    const sets = keys.map((k) => `${k}=?`).join(", ");
    await run(
      `UPDATE users SET ${sets} WHERE id=?`,
      ...keys.map((k) => updates[k]),
      u.id,
    );
    const fresh = await get("SELECT * FROM users WHERE id=?", u.id);
    await audit(u, "修改资料", `修改 ${keys.join("、")}`);
    send({ user: safeUser(fresh) });
    return true;
  }
  return false;
}

// Same format check as register (auth.mjs) — kept local so this file
// does not import from the auth routes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// OTP for contact changes (2026-11-12, Lam) — SIMULATED delivery: the
// project has no email/SMS provider and no budget for one, so the server
// generates the code and returns it in the send-otp response; the UI
// shows it as a demo code labelled 模拟，未真实发送. Never claim a real
// email/SMS was sent. Registration stays unverified — OTP applies only
// to changing the email / phone of a signed-in account.
// Rules (decided 2026-11-12): 6 digits, 5-minute expiry, single-use,
// max 5 wrong attempts per code, 60s resend cooldown per (user, channel,
// target), max 5 sends/hour per target. A new send invalidates the
// previous unused code for the same (user, channel, target).
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const PHONE_RE = /^\+?\d{9,15}$/;

function normalizeContactTarget(channel, raw) {
  if (channel === "email") {
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    assert(
      email.length > 0 && email.length <= 100 && EMAIL_RE.test(email),
      "邮箱格式不正确",
      400,
    );
    return email;
  }
  const phone = typeof raw === "string" ? raw.replace(/\s+/g, "") : "";
  assert(
    phone.length > 0 && PHONE_RE.test(phone),
    "手机号格式不正确",
    400,
  );
  return phone;
}

async function assertTargetFree(get, channel, target, userId) {
  // Same SELECT (not UNIQUE index) precedent as email: live data was
  // never checked for duplicates. Email comparison is case-insensitive
  // because register stores the case as typed; phone is stored
  // normalized (no spaces), so a plain comparison is enough.
  const clash =
    channel === "email"
      ? await get(
          "SELECT id FROM users WHERE LOWER(email)=? AND id<>?",
          target,
          userId,
        )
      : await get(
          "SELECT id FROM users WHERE phone=? AND id<>?",
          target,
          userId,
        );
  assert(!clash, channel === "email" ? "邮箱已被使用" : "手机号已被使用", 409);
}

export async function sendOtp(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/account/send-otp" && req.method === "POST") {
    const u = needUser();
    const channel = b?.channel;
    assert(channel === "email" || channel === "phone", "验证渠道无效", 400);
    const target = normalizeContactTarget(channel, b?.target);
    await assertTargetFree(get, channel, target, u.id);
    const now = Date.now();
    // Resend cooldown: the latest code for this (user, channel, target).
    const latest = await get(
      "SELECT * FROM verification_codes WHERE user_id=? AND channel=? AND target=? ORDER BY id DESC LIMIT 1",
      u.id,
      channel,
      target,
    );
    if (latest && Date.parse(latest.created_at) > now - OTP_RESEND_MS) {
      assert(false, "操作过于频繁，请稍后再试", 429);
    }
    // Hourly cap per target (any user — a target belongs to one user at
    // a time; the duplicate check above already rejected other owners).
    const sent = await get(
      "SELECT COUNT(*) AS n FROM verification_codes WHERE channel=? AND target=? AND created_at>?",
      channel,
      target,
      new Date(now - 3600000).toISOString(),
    );
    assert(
      (sent?.n ?? 0) < OTP_MAX_SENDS_PER_HOUR,
      "发送次数过多，请稍后再试",
      429,
    );
    // A new code invalidates the previous unused one for the same target,
    // so only the latest code can ever verify.
    await run(
      "UPDATE verification_codes SET used_at=? WHERE user_id=? AND channel=? AND target=? AND used_at IS NULL",
      time(),
      u.id,
      channel,
      target,
    );
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
    await run(
      "INSERT INTO verification_codes(user_id,channel,target,code,expires_at,attempts,used_at,created_at) VALUES(?,?,?,?,?,0,NULL,?)",
      u.id,
      channel,
      target,
      code,
      expiresAt,
      time(),
    );
    await audit(u, "发送验证码", `${channel}:${target}`);
    // The code IS returned: delivery is simulated (see the header
    // comment), so there is no channel to send it through.
    send({
      channel,
      target,
      code,
      expires_in_seconds: OTP_TTL_MS / 1000,
    });
    return true;
  }
  return false;
}

// Verify a code WITHOUT applying any change. This endpoint ALWAYS
// answers 200 with {valid, error?, attempts_left} — never a thrown
// 400 — and that is deliberate, not a contract quirk: every write
// request in this codebase runs inside ONE transaction, and a response
// >= 400 (or any throw) ROLLBACKs the whole request (see
// createRequestHandler in index.mjs + db.request in postgres.mjs).
// A wrong code must increment `attempts`, and that increment only
// survives if the request commits — so verification answers 200 and
// the caller (UI, PATCH) reads `valid`. A matching code is marked
// `verified_at` here; PATCH later consumes it (sets `used_at`) and
// applies the change. A wrong guess increments the LATEST unused code
// for the target — including a guess with a stale (superseded) code —
// which is the intended brute-force behaviour: any 5 wrong guesses
// kill the current code.
export async function verifyOtp(ctx) {
  const { p, req, b, send, needUser, get, run } = ctx;
  if (p === "/api/account/verify-otp" && req.method === "POST") {
    const u = needUser();
    const channel = b?.channel;
    assert(channel === "email" || channel === "phone", "验证渠道无效", 400);
    const target = normalizeContactTarget(channel, b?.target);
    assert(
      typeof b.code === "string" && /^\d{6}$/.test(b.code),
      "验证码格式不正确",
      400,
    );
    const row = await get(
      "SELECT * FROM verification_codes WHERE user_id=? AND channel=? AND target=? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
      u.id,
      channel,
      target,
    );
    if (!row) {
      send({ valid: false, error: "验证码不存在或已使用，请重新获取", attempts_left: 0 });
      return true;
    }
    if (row.verified_at) {
      send({ valid: true, attempts_left: OTP_MAX_ATTEMPTS - row.attempts });
      return true;
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      send({ valid: false, error: "验证码已过期，请重新获取", attempts_left: 0 });
      return true;
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      send({ valid: false, error: "验证码尝试次数过多，请重新获取", attempts_left: 0 });
      return true;
    }
    if (row.code !== b.code) {
      await run(
        "UPDATE verification_codes SET attempts=? WHERE id=?",
        row.attempts + 1,
        row.id,
      );
      send({
        valid: false,
        error: "验证码不正确",
        attempts_left: OTP_MAX_ATTEMPTS - (row.attempts + 1),
      });
      return true;
    }
    await run(
      "UPDATE verification_codes SET verified_at=? WHERE id=?",
      time(),
      row.id,
    );
    send({ valid: true, attempts_left: OTP_MAX_ATTEMPTS - row.attempts });
    return true;
  }
  return false;
}

// Consume a code that verify-otp already marked verified. Pure check +
// one write (used_at) right before the caller applies the change, so a
// throw here happens BEFORE any write and nothing is lost to a
// rollback. A code that was never verified, already used, or expired
// cannot be consumed.
export async function consumeVerifiedCode(ctx, userId, channel, target, code) {
  const { get, run } = ctx;
  assert(
    typeof code === "string" && /^\d{6}$/.test(code),
    "验证码格式不正确",
    400,
  );
  const row = await get(
    "SELECT * FROM verification_codes WHERE user_id=? AND channel=? AND target=? AND code=? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
    userId,
    channel,
    target,
    code,
  );
  assert(row, "验证码不存在或已使用，请重新获取", 400);
  if (Date.parse(row.expires_at) <= Date.now()) {
    assert(false, "验证码已过期，请重新获取", 400);
  }
  assert(row.verified_at, "请先验证验证码", 400);
  await run("UPDATE verification_codes SET used_at=? WHERE id=?", time(), row.id);
}

export async function patchEmail(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/account/email" && req.method === "PATCH") {
    const u = needUser();
    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    assert(
      email.length > 0 && email.length <= 100 && EMAIL_RE.test(email),
      "邮箱格式不正确",
      400,
    );
    // Uniqueness is enforced by SELECT, not a UNIQUE index (live data
    // was never checked for duplicates — see the design note). The
    // comparison is case-insensitive: register stores the case as typed.
    // The duplicate check runs BEFORE code verification so a 409 does
    // not burn the code.
    const clash = await get(
      "SELECT id FROM users WHERE LOWER(email)=? AND id<>?",
      email,
      u.id,
    );
    assert(!clash, "邮箱已被使用", 409);
    // OTP required since 2026-11-12 (Lam): email changes no longer
    // apply immediately — the code proves the user holds the new address
    // (simulated delivery: the code is shown in the UI, see sendOtp).
    assert(
      typeof b.code === "string" && b.code.length > 0,
      "请先获取验证码",
      400,
    );
    await consumeVerifiedCode(ctx, u.id, "email", email, b.code);
    await run("UPDATE users SET email=? WHERE id=?", email, u.id);
    const fresh = await get("SELECT * FROM users WHERE id=?", u.id);
    await audit(u, "修改邮箱", email);
    send({ user: safeUser(fresh) });
    return true;
  }
  return false;
}

// Phone change (2026-11-12, Lam) — mirrors patchEmail exactly, with the
// phone format rule (spaces stripped, optional leading +, 9–15 digits)
// and its own audit action. No phone column existed before this change.
export async function patchPhone(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/account/phone" && req.method === "PATCH") {
    const u = needUser();
    const phone =
      typeof b.phone === "string" ? b.phone.replace(/\s+/g, "") : "";
    assert(
      phone.length > 0 && PHONE_RE.test(phone),
      "手机号格式不正确",
      400,
    );
    const clash = await get(
      "SELECT id FROM users WHERE phone=? AND id<>?",
      phone,
      u.id,
    );
    assert(!clash, "手机号已被使用", 409);
    assert(
      typeof b.code === "string" && b.code.length > 0,
      "请先获取验证码",
      400,
    );
    await consumeVerifiedCode(ctx, u.id, "phone", phone, b.code);
    await run("UPDATE users SET phone=? WHERE id=?", phone, u.id);
    const fresh = await get("SELECT * FROM users WHERE id=?", u.id);
    await audit(u, "修改手机号", phone);
    send({ user: safeUser(fresh) });
    return true;
  }
  return false;
}

// Account tabs step 5: social links (Q2 default — douyin / wechat /
// xiaohongshu only; Weibo has no presence in the repo and is not added).
// Stored as one JSON column; text only, display only — no OAuth, no
// ownership verification (see the "仅展示，不验证归属" note in the UI).
const SOCIAL_KEYS = ["douyin", "wechat", "xiaohongshu"];

export async function patchSocial(ctx) {
  const { p, req, b, send, needUser, get, run, audit } = ctx;
  if (p === "/api/account/social" && req.method === "PATCH") {
    const u = needUser();
    assert(b && typeof b === "object" && !Array.isArray(b), "请求格式不正确", 400);
    for (const key of Object.keys(b)) {
      assert(SOCIAL_KEYS.includes(key), `不支持的社交账号: ${key}`, 400);
      assert(
        typeof b[key] === "string" && b[key].length <= 100,
        "社交账号格式不正确",
        400,
      );
    }
    // Merge with the stored value; an empty string deletes that link.
    // A corrupt stored value falls back to {} instead of failing.
    let stored = {};
    try {
      stored = JSON.parse((await get("SELECT social_links FROM users WHERE id=?", u.id))?.social_links || "{}");
    } catch {
      stored = {};
    }
    const merged = { ...stored };
    for (const key of SOCIAL_KEYS) {
      if (key in b) {
        if (b[key] === "") delete merged[key];
        else merged[key] = b[key];
      }
    }
    await run("UPDATE users SET social_links=? WHERE id=?", JSON.stringify(merged), u.id);
    await audit(u, "更新社交账号", Object.keys(merged).join(",") || "清空");
    send({ social: merged });
    return true;
  }
  return false;
}

export async function uploadAvatar(ctx) {
  const { p, req, b, send, needUser, get, run, audit, storage } = ctx;
  if (p === "/api/account/avatar" && req.method === "POST") {
    const u = needUser();
    const ext = AVATAR_TYPES[b.content_type];
    assert(ext, "仅支持 JPG/PNG/WebP 图片", 400);
    assert(
      typeof b.content_base64 === "string" &&
        b.content_base64.length > 0,
      "文件内容不能为空",
      400,
    );
    const body = Buffer.from(b.content_base64, "base64");
    assert(
      body.length > 0 && body.length <= AVATAR_MAX_BYTES,
      "文件大小须在 200KB 以内",
      400,
    );
    assert(storage, "对象存储未配置", 503);
    const key = `avatars/${u.id}/${Date.now()}-${Math.random().toString(16).slice(2, 6)}.${ext}`;
    assert(validKey(key), "文件路径无效", 400);
    const old = await get("SELECT avatar FROM users WHERE id=?", u.id);
    await storage.put(key, body, b.content_type);
    await run("UPDATE users SET avatar=? WHERE id=?", key, u.id);
    // Best effort: a missing old object must not fail the new upload.
    if (old?.avatar && old.avatar !== key) {
      try {
        await storage.remove(old.avatar);
      } catch {
        // stale key stays in the bucket; the row already points at the new one
      }
    }
    await audit(u, "更换头像", key);
    send({ ok: true, avatarKey: key });
    return true;
  }
  return false;
}
