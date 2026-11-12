// WeChat mini-program sign-in tests (POST /api/auth/wechat-mini) — run
// against a REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/account-otp.test.mjs: spawn server/server.mjs on TEST_PORT
// (default 3107) and talk to it over HTTP. DATABASE_URL must point at a
// FRESH, disposable database.
//
// No real WeChat code exists in tests, so the jscode2session exchange is
// exercised only with a fake code: with dummy WECHAT_MINI_* env vars the
// live WeChat API answers errcode (invalid appid) and the endpoint must
// answer 401 — that proves the exchange path runs and fails closed.
// Without the env vars the endpoint must answer 503 (clean failure, no
// WeChat call attempted). A real-code link can only be verified by Lam
// in DevTools against the live mini-program.
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

const PORT = Number(process.env.TEST_PORT || 3107);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const pool = new pg.Pool({ connectionString: DATABASE_URL });

let proc;
let procNoCfg;
const PORT_NOCFG = PORT + 1;
const BASE_NOCFG = `http://127.0.0.1:${PORT_NOCFG}`;

async function reqNoCfg(p, { method = "GET", body } = {}) {
  const res = await fetch(BASE_NOCFG + p, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

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
  const username = `wx_${suffix}`;
  const password = "wxtest123";
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: `Wx ${suffix}` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { username, password, token: r.json.token, user: r.json.user };
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

before(async () => {
  // Dummy WeChat credentials: the live API rejects them (errcode), which
  // is exactly the fake-code path under test. The real AppSecret is never
  // present in any test.
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      WECHAT_MINI_APPID: "wx0000000000000000",
      WECHAT_MINI_APPSECRET: "00000000000000000000000000000000",
    },
    stdio: "pipe",
  });
  proc.stderr.on("data", () => {});
  await waitHealthy();
  // Second server on PORT+1 with NO WeChat env vars: the 503 path
  // (clean failure, no jscode2session call attempted).
  const envNoCfg = { ...process.env, PORT: String(PORT_NOCFG) };
  delete envNoCfg.WECHAT_MINI_APPID;
  delete envNoCfg.WECHAT_MINI_APPSECRET;
  procNoCfg = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: envNoCfg,
    stdio: "pipe",
  });
  procNoCfg.stderr.on("data", () => {});
  for (let i = 0; i < 50; i++) {
    try {
      const r = await reqNoCfg("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  if (proc) proc.kill();
  if (procNoCfg) procNoCfg.kill();
  await pool.end();
});

test("wechat-mini: no WeChat env vars is 503, no WeChat call", async () => {
  const r = await reqNoCfg("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "fake-code-123" },
  });
  assert.equal(r.status, 503, JSON.stringify(r.json));
  assert.match(r.json.error, /微信登录未配置/);
});

test("wechat-mini: missing code is 400", async () => {
  const r = await req("/api/auth/wechat-mini", { method: "POST", body: {} });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("wechat-mini: oversized code is 400", async () => {
  const r = await req("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "x".repeat(129) },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("wechat-mini: fake code with dummy env is 401 and links nothing", async () => {
  const before = await pool.query("SELECT COUNT(*)::int AS n FROM oauth_accounts");
  const r = await req("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "fake-code-123" },
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  assert.match(r.json.error, /微信登录失败/);
  const afterCount = await pool.query("SELECT COUNT(*)::int AS n FROM oauth_accounts");
  assert.equal(afterCount.rows[0].n, before.rows[0].n);
});

test("wechat-mini: wrong password fails 401 before any WeChat call", async () => {
  const u = await registerFresh();
  const r = await req("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "fake-code-123", username: u.username, password: "wrongpass" },
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  assert.equal(r.json.error, "账号或密码不正确");
});

test("wechat-mini: correct password + fake code is 401 (exchange fails)", async () => {
  const u = await registerFresh();
  const r = await req("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "fake-code-123", username: u.username, password: u.password },
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  assert.match(r.json.error, /微信登录失败/);
});

test("wechat-mini: signed-in user + fake code is 401 and links nothing", async () => {
  const { token } = await login();
  const before = await pool.query("SELECT COUNT(*)::int AS n FROM oauth_accounts");
  const r = await req("/api/auth/wechat-mini", {
    method: "POST",
    body: { code: "fake-code-123" },
    token,
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  const afterCount = await pool.query("SELECT COUNT(*)::int AS n FROM oauth_accounts");
  assert.equal(afterCount.rows[0].n, before.rows[0].n);
});

test("wechat-mini: oauth_accounts table exists with the unique link key", async () => {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.table_constraints " +
      "WHERE table_name='oauth_accounts' AND constraint_type='UNIQUE'",
  );
  assert.ok(r.rows[0].n >= 1, "UNIQUE(provider, provider_user_id) missing");
});
