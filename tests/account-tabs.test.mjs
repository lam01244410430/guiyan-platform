// Guiyan account-tabs tests — run against a REAL PostgreSQL 16, never a
// mock. Same harness shape as tests/wave4.test.mjs: spawn server/server.mjs
// on TEST_PORT (default 3105) and talk to it over HTTP. DATABASE_URL must
// point at a FRESH, disposable database (the server seeds 62 resources +
// demo users on first boot). Do not point it at any shared or production
// database.
//
// Run order inside `npm test`: api-pg.test.mjs, wave3.test.mjs and
// wave4.test.mjs run BEFORE this file, so these tests must never assert
// exact seed counts for orders/stock — earlier tests create orders and
// move stock. Expectations are computed from the live database (via the
// API) instead. Fresh users are created per test via register with a
// unique username, so earlier tests cannot interfere with them.
//
// The tab frame itself is pure UI (no API) — it is checked by build +
// live browser, not here.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sortRows, compareValues, cycleDirection } from "../web/assets/js/sortUtils.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error("DATABASE_URL is required, e.g. from .env.local");
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const storageConfigured = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_ENDPOINT_URL_S3 &&
    process.env.AWS_REGION,
);

const PORT = Number(process.env.TEST_PORT || 3105);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);

// 1x1 transparent PNG (valid image, ~70 bytes) for avatar upload tests.
const PNG_1X1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";

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
  const username = `tab_${suffix}`;
  const password = "tabtest123";
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: `Tab ${suffix}` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { username, password, token: r.json.token, user: r.json.user };
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: account-tabs never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[acctabs-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[acctabs-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("account-tabs server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

// --- Step 1: orders table (Shopee-format) — data comes from GET /api/orders ---

test("account-tabs step 1: GET /api/orders rows carry every field the table renders", async () => {
  const { token } = await login();
  const r = await req("/api/orders", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.orders) && r.json.orders.length > 0);
  for (const o of r.json.orders) {
    for (const f of ["code", "resource_name", "image", "category", "city", "unit", "quantity", "amount", "booking_date", "status", "refund_reason", "refund_decision", "created_at"]) {
      assert.ok(f in o, `order ${o.id} missing field ${f}`);
    }
    assert.equal(typeof o.amount, "number");
    assert.equal(typeof o.quantity, "number");
  }
});

test("account-tabs step 1: orders arrive newest-first (id DESC)", async () => {
  const { token } = await login();
  const r = await req("/api/orders", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ids = r.json.orders.map((o) => o.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
});

test("account-tabs step 1: per-status counts sum to the total (filter tabs)", async () => {
  const { token } = await login();
  const r = await req("/api/orders", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const counts = {};
  for (const o of r.json.orders) counts[o.status] = (counts[o.status] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, r.json.orders.length);
  for (const s of Object.keys(counts)) {
    assert.ok(
      ["pending", "confirmed", "paid", "completed", "cancelled", "refunded", "refund_requested", "disputed"].includes(s),
      `unknown status ${s}`,
    );
  }
});

test("account-tabs step 1: sortUtils (copied from admin) sorts amounts numerically", async () => {
  const rows = [{ amount: 30000 }, { amount: 10000 }, { amount: 20000 }];
  assert.deepEqual(
    sortRows(rows, (o) => o.amount, "asc").map((o) => o.amount),
    [10000, 20000, 30000],
  );
  assert.deepEqual(
    sortRows(rows, (o) => o.amount, "desc").map((o) => o.amount),
    [30000, 20000, 10000],
  );
  assert.equal(rows[0].amount, 30000, "sortRows must not mutate");
  assert.equal(compareValues("visitor2", "visitor10") < 0, true);
  assert.equal(cycleDirection(null), "asc");
  assert.equal(cycleDirection("asc"), "desc");
  assert.equal(cycleDirection("desc"), null);
});

// --- Step 2: profile edit + avatar ---

test("account-tabs step 2: PATCH /api/account/profile updates own row", async () => {
  const me = await registerFresh();
  const r = await req("/api/account/profile", {
    method: "PATCH",
    body: { name: "Tab Renamed", city: "桂林", age: 29, gender: "女" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.name, "Tab Renamed");
  assert.equal(r.json.user.city, "桂林");
  assert.equal(r.json.user.age, 29);
  assert.equal(r.json.user.gender, "女");
  // Read back through a fresh login: the change persisted.
  const again = await login(me.username, me.password);
  assert.equal(again.user.name, "Tab Renamed");
  assert.equal(again.user.city, "桂林");
  assert.equal(again.user.age, 29);
  assert.equal(again.user.gender, "女");
});

test("account-tabs step 2: PATCH profile rejects invalid values", async () => {
  const me = await registerFresh();
  for (const body of [
    { name: "" },
    { name: "x".repeat(51) },
    { age: 200 },
    { age: 0 },
    { age: "abc" },
    { gender: "X" },
    { city: "x".repeat(21) },
  ]) {
    const r = await req("/api/account/profile", {
      method: "PATCH",
      body,
      token: me.token,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.status}`);
  }
  const r = await req("/api/account/profile", {
    method: "PATCH",
    body: {},
    token: me.token,
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("account-tabs step 2: PATCH profile ignores username/role and requires login", async () => {
  const me = await registerFresh();
  const r = await req("/api/account/profile", {
    method: "PATCH",
    body: { name: "Kept", username: "hacker", role: "admin" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.username, me.username);
  assert.equal(r.json.user.role, "user");
  const anon = await req("/api/account/profile", {
    method: "PATCH",
    body: { name: "Nope" },
  });
  assert.equal(anon.status, 401);
});

test("account-tabs step 2: POST /api/account/avatar rejects bad input without login/storage", async () => {
  const anon = await req("/api/account/avatar", {
    method: "POST",
    body: { content_base64: PNG_1X1_B64, content_type: "image/png" },
  });
  assert.equal(anon.status, 401);
  const me = await registerFresh();
  const notImage = await req("/api/account/avatar", {
    method: "POST",
    body: {
      content_base64: Buffer.from("hello").toString("base64"),
      content_type: "text/plain",
    },
    token: me.token,
  });
  assert.equal(notImage.status, 400, JSON.stringify(notImage.json));
  const tooBig = await req("/api/account/avatar", {
    method: "POST",
    body: {
      content_base64: Buffer.alloc(200001).toString("base64"),
      content_type: "image/png",
    },
    token: me.token,
  });
  assert.equal(tooBig.status, 400, JSON.stringify(tooBig.json));
});

test("account-tabs step 2: POST /api/account/avatar happy path (server key, client key ignored)", async (t) => {
  if (!storageConfigured) t.skip("storage not configured");
  const me = await registerFresh();
  const r = await req("/api/account/avatar", {
    method: "POST",
    body: {
      content_base64: PNG_1X1_B64,
      content_type: "image/png",
      key: "avatars/1/evil.png", // must be ignored: the server generates the key
    },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.avatarKey, new RegExp(`^avatars/${me.user.id}/\\d+-[0-9a-f]+\\.png$`));
  assert.notEqual(r.json.avatarKey, "avatars/1/evil.png");
  const again = await login(me.username, me.password);
  assert.equal(again.user.avatar, r.json.avatarKey);
});

test("account-tabs step 2: second avatar upload deletes the old key", async (t) => {
  if (!storageConfigured) t.skip("storage not configured");
  const me = await registerFresh();
  const first = await req("/api/account/avatar", {
    method: "POST",
    body: { content_base64: PNG_1X1_B64, content_type: "image/png" },
    token: me.token,
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const second = await req("/api/account/avatar", {
    method: "POST",
    body: { content_base64: PNG_1X1_B64, content_type: "image/png" },
    token: me.token,
  });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.notEqual(second.json.avatarKey, first.json.avatarKey);
  // The old key's presigned URL now 404s: the object is gone.
  const signed = await req(
    `/api/storage/url?key=${encodeURIComponent(first.json.avatarKey)}`,
    { token: me.token },
  );
  assert.equal(signed.status, 200, JSON.stringify(signed.json));
  const fetched = await fetch(signed.json.url);
  assert.equal(fetched.status, 404);
});

// --- Step 3: change password ---

test("account-tabs step 3: change password round-trips to the new password", async () => {
  const me = await registerFresh();
  const r = await req("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: me.password, newPassword: "newpass456" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  const oldLogin = await req("/api/auth/login", {
    method: "POST",
    body: { username: me.username, password: me.password },
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await login(me.username, "newpass456");
  assert.ok(newLogin.token);
});

test("account-tabs step 3: wrong current password changes nothing", async () => {
  const me = await registerFresh();
  const r = await req("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: "wrongpassword", newPassword: "newpass456" },
    token: me.token,
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  // The old password still works: nothing changed.
  const again = await login(me.username, me.password);
  assert.ok(again.token);
});

test("account-tabs step 3: new password too short or identical is rejected", async () => {
  const me = await registerFresh();
  for (const body of [
    { currentPassword: me.password, newPassword: "short" },
    { currentPassword: me.password, newPassword: me.password },
  ]) {
    const r = await req("/api/auth/change-password", {
      method: "POST",
      body,
      token: me.token,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.status}`);
  }
  const anon = await req("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: "x", newPassword: "newpass456" },
  });
  assert.equal(anon.status, 401);
});

test("account-tabs step 3: other sessions stay valid after a password change (Q4)", async () => {
  const me = await registerFresh();
  const second = await login(me.username, me.password);
  assert.notEqual(second.token, me.token);
  const r = await req("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: me.password, newPassword: "newpass456" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // Q4 default: the other session is NOT invalidated.
  const stillThere = await req("/api/orders", { token: second.token });
  assert.equal(stillThere.status, 200, JSON.stringify(stillThere.json));
});

// --- Step 4: change email (OTP since 2026-11-12) ---
// Helper: request a demo code for a target (the simulated send-otp
// returns the code in the response — the tests read it like the UI does).
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

// verify-otp always answers 200 with {valid} — see account-otp.test.mjs.
async function verifyOtp(token, channel, target, code) {
  const r = await req("/api/account/verify-otp", {
    method: "POST",
    body: { channel, target, code },
    token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.valid, true, JSON.stringify(r.json));
  return r.json;
}

test("account-tabs step 4: change email round-trips and lowercases the value", async () => {
  const me = await registerFresh();
  const code = await getOtp(me.token, "email", "  New@Example.COM  ");
  await verifyOtp(me.token, "email", "  New@Example.COM  ", code);
  const r = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "  New@Example.COM  ", code },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.email, "new@example.com");
  // Read back: a fresh login returns the new email; verified is untouched.
  const fresh = await login(me.username, me.password);
  assert.equal(fresh.user.email, "new@example.com");
  assert.ok(!fresh.user.verified); // verified untouched (pg returns 0, not false)
});

test("account-tabs step 4: duplicate email (any case) is rejected with 409", async () => {
  const a = await registerFresh();
  const codeA = await getOtp(a.token, "email", "dup@example.com");
  await verifyOtp(a.token, "email", "dup@example.com", codeA);
  const dup = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "dup@example.com", code: codeA },
    token: a.token,
  });
  assert.equal(dup.status, 200, JSON.stringify(dup.json));
  const b = await registerFresh();
  // Send-level: requesting a code for an email another user owns is 409.
  const sendClash = await req("/api/account/send-otp", {
    method: "POST",
    body: { channel: "email", target: "DUP@Example.com" },
    token: b.token,
  });
  assert.equal(sendClash.status, 409, JSON.stringify(sendClash.json));
  // Patch-level: the duplicate check runs BEFORE code verification, so
  // a code issued for another target still yields 409 (not 400).
  const codeB = await getOtp(b.token, "email", "b-other@example.com");
  const clash = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "DUP@Example.com", code: codeB },
    token: b.token,
  });
  assert.equal(clash.status, 409, JSON.stringify(clash.json));
  assert.match(clash.json.error, /邮箱已被使用/);
  // B's own email is still unset: the failed change changed nothing.
  const freshB = await login(b.username, b.password);
  assert.equal(freshB.user.email, null);
});

test("account-tabs step 4: bad format, empty and anonymous email changes are rejected", async () => {
  const me = await registerFresh();
  for (const body of [{ email: "not-an-email" }, { email: "" }]) {
    const r = await req("/api/account/email", {
      method: "PATCH",
      body,
      token: me.token,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.status}`);
  }
  const anon = await req("/api/account/email", {
    method: "PATCH",
    body: { email: "x@example.com" },
  });
  assert.equal(anon.status, 401);
});

// --- Step 5: social links ---

test("account-tabs step 5: set all three links and read them back", async () => {
  const me = await registerFresh();
  const r = await req("/api/account/social", {
    method: "PATCH",
    body: { douyin: "douyin123", wechat: "wx_abc", xiaohongshu: "https://www.xiaohongshu.com/user/profile/xyz" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.social, {
    douyin: "douyin123",
    wechat: "wx_abc",
    xiaohongshu: "https://www.xiaohongshu.com/user/profile/xyz",
  });
  // Read back: a fresh login returns the stored JSON string.
  const fresh = await login(me.username, me.password);
  assert.deepEqual(JSON.parse(fresh.user.social_links), r.json.social);
});

test("account-tabs step 5: empty string deletes one link, others stay", async () => {
  const me = await registerFresh();
  await req("/api/account/social", {
    method: "PATCH",
    body: { douyin: "douyin123", wechat: "wx_abc" },
    token: me.token,
  });
  const r = await req("/api/account/social", {
    method: "PATCH",
    body: { douyin: "" },
    token: me.token,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.social, { wechat: "wx_abc" });
});

test("account-tabs step 5: unknown keys, token fields and bad values are rejected", async () => {
  const me = await registerFresh();
  for (const body of [
    { weibo: "wb123" }, // Weibo is not one of the three networks (Q2).
    { token: "abc" }, // No token/code/password fields are accepted.
    { douyin: "x".repeat(101) }, // Longer than 100 chars.
    { douyin: 123 }, // Must be a string.
  ]) {
    const r = await req("/api/account/social", {
      method: "PATCH",
      body,
      token: me.token,
    });
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.status}`);
  }
  const anon = await req("/api/account/social", {
    method: "PATCH",
    body: { douyin: "douyin123" },
  });
  assert.equal(anon.status, 401);
});
