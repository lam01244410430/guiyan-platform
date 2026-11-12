// Guiyan OTP tests for contact changes (email + phone) — run against a
// REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/account-tabs.test.mjs: spawn server/server.mjs on TEST_PORT
// (default 3106) and talk to it over HTTP. DATABASE_URL must point at a
// FRESH, disposable database. Fresh users are created per test via
// register with a unique username, so earlier tests cannot interfere.
//
// Delivery is SIMULATED (no email/SMS provider): send-otp returns the
// 6-digit code in its response and the UI shows it as a demo code. The
// tests read the code from the response, exactly like the UI does.
// Time-travel (expiry, resend cooldown) is done with direct pg UPDATEs
// of verification_codes — there is no HTTP way to age a code.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error("DATABASE_URL is required, e.g. from .env.local");
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3106);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const pool = new pg.Pool({ connectionString: DATABASE_URL });

let proc;

async function req(p, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text };
}

async function login(username = "demo", password = process.env.DEMO_PASSWORD) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

async function registerFresh() {
  const suffix = randomBytes(4).toString("hex");
  const username = `otp_${suffix}`;
  const password = "otptest123";
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: `Otp ${suffix}` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { username, password, token: r.json.token, user: r.json.user };
}

async function getOtp(token, channel, target) {
  const r = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel, target },
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.code, /^\d{6}$/);
  return r.json.code;
}

// verify-otp always answers 200 with {valid} (a wrong code must be
// counted server-side, and a 400 would roll the count back — see
// server/routes/account.mjs). Raw returns the body; the strict one
// asserts the code verified.
async function verifyOtpRaw(token, channel, target, code) {
  const r = await req("/api/account/verify-otp", {
    method: "POST",
    body: { channel, target, code },
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

async function verifyOtp(token, channel, target, code) {
  const v = await verifyOtpRaw(token, channel, target, code);
  assert.equal(v.valid, true, JSON.stringify(v));
  return v;
}

// Age a code's created_at so the 60s resend cooldown has passed.
async function ageCode(userId, channel, target, msAgo = 61000) {
  await pool.query(
    "UPDATE verification_codes SET created_at=$1 WHERE user_id=$2 AND channel=$3 AND target=$4",
    [new Date(Date.now() - msAgo).toISOString(), userId, channel, target],
  );
}

// Expire a code outright (sets expires_at in the past).
async function expireCode(userId, channel, target) {
  await pool.query(
    "UPDATE verification_codes SET expires_at=$1 WHERE user_id=$2 AND channel=$3 AND target=$4",
    [new Date(Date.now() - 1000).toISOString(), userId, channel, target],
  );
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: OTP tests never call the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[otp-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[otp-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("OTP server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc) proc.kill();
  return pool.end();
});

test("otp: send-otp (email) returns a 6-digit code, normalized target, 300s expiry", async () => {
  const me = await registerFresh();
  const r = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "email", target: "  Otp@Example.COM  " },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.channel, "email");
  assert.equal(r.json.target, "otp@example.com");
  assert.match(r.json.code, /^\d{6}$/);
  assert.equal(r.json.expires_in_seconds, 300);
});

test("otp: send-otp (phone) returns a 6-digit code with spaces stripped", async () => {
  const me = await registerFresh();
  const r = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "phone", target: "+84 912 345 678" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.channel, "phone");
  assert.equal(r.json.target, "+84912345678");
  assert.match(r.json.code, /^\d{6}$/);
});

test("otp: send-otp rejects bad channel, bad formats and anonymous calls", async () => {
  const me = await registerFresh();
  for (const body of [
    { channel: "sms", target: "x@example.com" },
    { channel: "email", target: "not-an-email" },
    { channel: "email", target: "" },
    { channel: "phone", target: "123" },
    { channel: "phone", target: "abc123456789" },
    { channel: "phone", target: "+1234567890123456" },
  ]) {
    const r = await req("/api/account/send-otp", {
      method: "POST",
      body,
      token: me.token,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.status}`);
  }
  const anon = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "email", target: "x@example.com" },
  });
  assert.equal(anon.status, 401);
});

test("otp: email change without a code is 400; wrong code is 400 and changes nothing", async () => {
  const me = await registerFresh();
  const noCode = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "nocode@example.com" },
    token: me.token,
  });
  assert.equal(noCode.status, 400, JSON.stringify(noCode.json));
  const code = await getOtp(me.token, "email", "wrong@example.com");
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  // verify-otp answers 200 with valid:false (never 400 — the wrong
  // attempt must be counted, and a 400 would roll the count back).
  const v = await verifyOtpRaw(me.token, "email", "wrong@example.com", wrong);
  assert.equal(v.valid, false);
  assert.match(v.error, /验证码不正确/);
  assert.equal(v.attempts_left, 4);
  // PATCH with an unverified code is rejected; nothing changed. A wrong
  // code matches no stored row for the target ("不存在或已使用"); the
  // real code without verify is a different error ("请先验证验证码").
  const r = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "wrong@example.com", code: wrong },
    token: me.token,
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /不存在或已使用/);
  const unverified = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "wrong@example.com", code },
    token: me.token,
  });
  assert.equal(unverified.status, 400, JSON.stringify(unverified.json));
  assert.match(unverified.json.error, /请先验证验证码/);
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.email, null);
});

test("otp: correct code applies the email change and the code is single-use", async () => {
  const me = await registerFresh();
  const code = await getOtp(me.token, "email", "once@example.com");
  await verifyOtp(me.token, "email", "once@example.com", code);
  const ok = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "once@example.com", code },
    token: me.token,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.user.email, "once@example.com");
  // Same code again: already consumed.
  const reuse = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "once2@example.com", code },
    token: me.token,
  });
  assert.equal(reuse.status, 400, JSON.stringify(reuse.json));
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.email, "once@example.com");
});

test("otp: expired code is 400", async () => {
  const me = await registerFresh();
  const code = await getOtp(me.token, "email", "old@example.com");
  await expireCode(me.user.id, "email", "old@example.com");
  const v = await verifyOtpRaw(me.token, "email", "old@example.com", code);
  assert.equal(v.valid, false);
  assert.match(v.error, /已过期/);
  const r = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "old@example.com", code },
    token: me.token,
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.email, null);
});

test("otp: 5 wrong attempts kill the code — even the right code then fails", async () => {
  const me = await registerFresh();
  const code = await getOtp(me.token, "email", "tries@example.com");
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  for (let i = 0; i < 5; i++) {
    const v = await verifyOtpRaw(me.token, "email", "tries@example.com", wrong);
    assert.equal(v.valid, false, `attempt ${i + 1}: ${JSON.stringify(v)}`);
    assert.equal(v.attempts_left, 4 - i, `attempt ${i + 1}`);
  }
  const right = await verifyOtpRaw(me.token, "email", "tries@example.com", code);
  assert.equal(right.valid, false);
  assert.match(right.error, /尝试次数过多/);
  const patch = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "tries@example.com", code },
    token: me.token,
  });
  assert.equal(patch.status, 400, JSON.stringify(patch.json));
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.email, null);
});

test("otp: resend within 60s is 429; a new code invalidates the old one", async () => {
  const me = await registerFresh();
  const code1 = await getOtp(me.token, "email", "again@example.com");
  const fast = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "email", target: "again@example.com" },
    token: me.token,
  });
  assert.equal(fast.status, 429, JSON.stringify(fast.json));
  // Age the first code past the cooldown, then request a second one.
  await ageCode(me.user.id, "email", "again@example.com");
  const code2 = await getOtp(me.token, "email", "again@example.com");
  assert.notEqual(code2, code1);
  // The old code no longer verifies (superseded by the new send).
  const stale = await verifyOtpRaw(me.token, "email", "again@example.com", code1);
  assert.equal(stale.valid, false);
  // The new code verifies and applies.
  await verifyOtp(me.token, "email", "again@example.com", code2);
  const ok = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "again@example.com", code: code2 },
    token: me.token,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("otp: 5 sends/hour per target — the 6th send is 429", async () => {
  const me = await registerFresh();
  const target = "hourly@example.com";
  for (let i = 0; i < 5; i++) {
    await getOtp(me.token, "email", target);
    await ageCode(me.user.id, "email", target);
  }
  const sixth = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "email", target },
    token: me.token,
  });
  assert.equal(sixth.status, 429, JSON.stringify(sixth.json));
});

test("otp: phone change round-trips and reads back on login", async () => {
  const me = await registerFresh();
  const code = await getOtp(me.token, "phone", "+84 912 345 678");
  await verifyOtp(me.token, "phone", "+84 912 345 678", code);
  const r = await req("/api/account/phone", {
    method: "PATCH",
    body: { phone: "+84 912 345 678", code },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.phone, "+84912345678");
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.phone, "+84912345678");
});

test("otp: phone change without a code is 400; wrong code is 400", async () => {
  const me = await registerFresh();
  const noCode = await req("/api/account/phone", {
    method: "PATCH",
    body: { phone: "+84911111111" },
    token: me.token,
  });
  assert.equal(noCode.status, 400, JSON.stringify(noCode.json));
  const code = await getOtp(me.token, "phone", "+84912222222");
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  const v = await verifyOtpRaw(me.token, "phone", "+84912222222", wrong);
  assert.equal(v.valid, false);
  const r = await req("/api/account/phone", {
    method: "PATCH",
    body: { phone: "+84912222222", code: wrong },
    token: me.token,
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.phone, null);
});

test("otp: duplicate phone is rejected with 409 at send and at patch", async () => {
  const a = await registerFresh();
  const codeA = await getOtp(a.token, "phone", "+84913333333");
  await verifyOtp(a.token, "phone", "+84913333333", codeA);
  const ok = await req("/api/account/phone", {
    method: "PATCH",
    body: { phone: "+84913333333", code: codeA },
    token: a.token,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const b = await registerFresh();
  const sendClash = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "phone", target: "+84 913 333 333" },
    token: b.token,
  });
  assert.equal(sendClash.status, 409, JSON.stringify(sendClash.json));
  const codeB = await getOtp(b.token, "phone", "+84914444444");
  const clash = await req("/api/account/phone", {
    method: "PATCH",
    body: { phone: "+84913333333", code: codeB },
    token: b.token,
  });
  assert.equal(clash.status, 409, JSON.stringify(clash.json));
  assert.match(clash.json.error, /手机号已被使用/);
  const freshB = await login(b.username, b.password);
  assert.equal(freshB.user.phone, null);
});
