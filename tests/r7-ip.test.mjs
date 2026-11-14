// tests/r7-ip.test.mjs: R7-1 (rows 40, 41) — 文小惠 IP config frame.
// Spawns server/server.mjs on TEST_PORT (default 3121) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered (7 tests): (1) unset on a fresh DB -> GET /api/ip returns
// {} and AiChat still falls back to its default greeting (no design
// has arrived, so nothing is invented); (2) PATCH sets all three
// fields -> GET returns them, and the audit log has a "修改IP配置"
// row; (3) illegal avatar URLs (http://, javascript:, //host, bare
// text, with spaces) -> 400 and the stored config is unchanged;
// (4) name >20 chars / greeting >200 chars / unknown key / empty
// body / non-string value -> 400; (5) anonymous PATCH -> 403,
// non-admin PATCH -> 403, anonymous GET -> 200 (public); (6) partial
// PATCH merges (other fields untouched) and an empty string clears a
// field back to unset; (7) wiring: the admin "IP 配置" view calls
// GET /api/ip + PATCH /api/admin/ip, and AiChat reads GET /api/ip
// (source-level checks — the build + smoke verify runtime).
//
// The PATCH in tests 2/6 restores the config to empty before the
// file ends, so no later test (and no other file) sees set values.
// Test usernames are hyphen-free ([A-Za-z0-9_] only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3121);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

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
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function getIp() {
  const r = await req("/api/ip");
  assert.equal(r.status, 200, `GET /api/ip -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

let adminToken;
let userToken;

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
  adminToken = await login("admin", "admin123");
  userToken = await register("r7ipuser", "Test1234");
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("unset on a fresh DB -> GET /api/ip returns {} and AiChat keeps its default greeting", async () => {
  assert.deepEqual(await getIp(), {});
  // AiChat default unchanged: the greeting bubble falls back to the
  // i18n default when no greeting is configured (no invented value).
  const aiChat = readFileSync(
    new URL("../web/assets/js/AiChat.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    aiChat.includes('(ipConfig && ipConfig.ip_greeting) || t("aiChatGreeting")'),
    "AiChat must fall back to t(\"aiChatGreeting\") when ip_greeting is unset",
  );
  assert.ok(
    aiChat.includes('(ipConfig && ipConfig.ip_name) || t("aiChatTitle")'),
    "AiChat must fall back to t(\"aiChatTitle\") when ip_name is unset",
  );
});

test("PATCH sets all three fields -> GET returns them, audit has 修改IP配置", async () => {
  const patched = await req("/api/admin/ip", {
    method: "PATCH",
    token: adminToken,
    body: {
      ip_name: "小惠",
      ip_avatar_url: "https://example.com/xiaohui.png",
      ip_greeting: "你好，我是小惠",
    },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.ok, true);
  assert.deepEqual(await getIp(), {
    ip_name: "小惠",
    ip_avatar_url: "https://example.com/xiaohui.png",
    ip_greeting: "你好，我是小惠",
  });
  const audit = await pool.query(
    "SELECT action, detail FROM audit_logs WHERE action='修改IP配置' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(audit.rows.length, 1, "no 修改IP配置 audit row");
  assert.ok(audit.rows[0].detail.includes("小惠"), `audit detail ${audit.rows[0].detail}`);
});

test("illegal avatar URLs -> 400 and the stored config is unchanged", async () => {
  const before = await getIp();
  for (const bad of [
    "http://example.com/x.png",
    "javascript:alert(1)",
    "//evil.example.com/x.png",
    "notaurl",
    "https://exa mple.com/x.png",
    "/has space.png",
  ]) {
    const r = await req("/api/admin/ip", {
      method: "PATCH",
      token: adminToken,
      body: { ip_avatar_url: bad },
    });
    assert.equal(r.status, 400, `avatar ${JSON.stringify(bad)} -> ${r.status}`);
  }
  assert.deepEqual(await getIp(), before);
  // The two legal shapes pass: https:// URL and site-relative path.
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_avatar_url: "/uploads/ip.png" },
    })).status,
    200,
  );
  assert.equal((await getIp()).ip_avatar_url, "/uploads/ip.png");
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_avatar_url: "https://example.com/xiaohui.png" },
    })).status,
    200,
  );
});

test("name/greeting length limits, unknown key, empty body, non-string -> 400", async () => {
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_name: "一".repeat(21) },
    })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_greeting: "一".repeat(201) },
    })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_name: "一".repeat(20) },
    })).status,
    200,
    "exactly 20 chars must pass",
  );
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { nope: "x" },
    })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/ip", { method: "PATCH", token: adminToken, body: {} })).status,
    400,
  );
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_name: 123 },
    })).status,
    400,
  );
  // Restore the name used by the boundary check.
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_name: "小惠" },
    })).status,
    200,
  );
});

test("anonymous PATCH -> 403, non-admin PATCH -> 403, anonymous GET -> 200", async () => {
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", body: { ip_name: "x" },
    })).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: userToken, body: { ip_name: "x" },
    })).status,
    403,
  );
  assert.equal((await req("/api/ip")).status, 200);
});

test("partial PATCH merges and an empty string clears a field back to unset", async () => {
  // Only the name changes; avatar + greeting stay as set.
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH", token: adminToken, body: { ip_name: "惠惠" },
    })).status,
    200,
  );
  assert.deepEqual(await getIp(), {
    ip_name: "惠惠",
    ip_avatar_url: "https://example.com/xiaohui.png",
    ip_greeting: "你好，我是小惠",
  });
  // Clearing all three returns GET /api/ip to {}.
  assert.equal(
    (await req("/api/admin/ip", {
      method: "PATCH",
      token: adminToken,
      body: { ip_name: "", ip_avatar_url: "", ip_greeting: "" },
    })).status,
    200,
  );
  assert.deepEqual(await getIp(), {});
});

test("wiring: admin IP 配置 view + AiChat read GET /api/ip", async () => {
  const admin = readFileSync(
    new URL("../admin/assets/js/AdminDashboard.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(admin.includes('"IP 配置"'), "admin nav/view must carry the IP 配置 label");
  assert.ok(admin.includes('apiGet("/api/ip")'), "admin view must load GET /api/ip");
  assert.ok(admin.includes('apiPatch("/api/admin/ip"'), "admin view must save via PATCH /api/admin/ip");
  const aiChat = readFileSync(
    new URL("../web/assets/js/AiChat.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(aiChat.includes('apiGet("/api/ip")'), "AiChat must read GET /api/ip");
  assert.ok(aiChat.includes("ipConfig.ip_avatar_url"), "AiChat must use the configured avatar when set");
});
