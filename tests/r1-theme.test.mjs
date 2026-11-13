// tests/r1-theme.test.mjs: R1-3 (row 4) — shop theming.
// Spawns server/server.mjs on TEST_PORT (default 3110) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: GET /api/shops/:id/theme returns the default theme (public,
// unknown shop -> 404); PATCH /api/admin/shops/:id/theme merges a
// partial theme and validates it (bad color / unknown key / duplicate
// or unknown sections / banner over 200 chars -> 400); a shop-scoped
// admin themes only their own shop (other shop -> 403, anonymous -> 403).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { scryptSync, randomBytes } from "node:crypto";

const PORT = Number(process.env.TEST_PORT || 3110);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let child;

const CANONICAL_SECTIONS = [
  "hero",
  "categories",
  "catalog",
  "spot",
  "demands",
  "ai",
  "wechat",
];

function hashPassword(pw) {
  // Same format as server/seed.mjs + server/routes/auth.mjs: salt +
  // scrypt 32-byte hash (a different length makes timingSafeEqual
  // throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on login).
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

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

async function getTheme(id, token) {
  return req(`/api/shops/${id}/theme`, { token });
}
async function patchTheme(token, id, body) {
  return req(`/api/admin/shops/${id}/theme`, {
    method: "PATCH",
    token,
    body,
  });
}

let adminToken;
let themeShopId;

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
  // A shop-scoped admin + their own shop, with names unique to this
  // file (other R1 files create shopadmin2/3 + shop B on the same DB).
  const pw = hashPassword("Admin1234");
  const a = await pool.query(
    "INSERT INTO users(username,password,name,role,city,created_at) VALUES($1,$2,$3,'admin','南宁',$4) RETURNING id",
    ["shopadminT", pw, "主题店管理员", new Date().toISOString()],
  );
  const r = await req("/api/admin/shops", {
    method: "POST",
    token: adminToken,
    body: { name: "桂演主题分店", owner_id: a.rows[0].id },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  themeShopId = r.data.shop.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("theme defaults: public GET returns the default theme, unknown shop 404", async () => {
  const r = await getTheme(1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.shop_id, 1);
  assert.equal(r.data.theme.banner, "");
  assert.equal(r.data.theme.primaryColor, "#0b3d36");
  assert.deepEqual(r.data.theme.sections, CANONICAL_SECTIONS);
  assert.equal((await getTheme(99999)).status, 404);
});

test("platform admin patches theme (partial merge); bad input 400", async () => {
  const r = await patchTheme(adminToken, 1, {
    banner: "主题横幅",
    primaryColor: "#c8452c",
    sections: ["catalog", "hero"],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.theme.banner, "主题横幅");
  assert.equal(r.data.theme.primaryColor, "#c8452c");
  assert.deepEqual(r.data.theme.sections, ["catalog", "hero"]);
  // A partial PATCH keeps the other fields.
  const p2 = await patchTheme(adminToken, 1, { banner: "只改横幅" });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  assert.equal(p2.data.theme.banner, "只改横幅");
  assert.equal(p2.data.theme.primaryColor, "#c8452c");
  assert.deepEqual(p2.data.theme.sections, ["catalog", "hero"]);
  const after = await getTheme(1);
  assert.equal(after.data.theme.banner, "只改横幅");
  // Validation: bad color, unknown key, duplicate/unknown sections,
  // banner over 200 chars, non-object body — all 400, nothing written.
  assert.equal((await patchTheme(adminToken, 1, { primaryColor: "#ff0000" })).status, 400);
  assert.equal((await patchTheme(adminToken, 1, { nope: 1 })).status, 400);
  assert.equal((await patchTheme(adminToken, 1, { sections: ["hero", "hero"] })).status, 400);
  assert.equal((await patchTheme(adminToken, 1, { sections: ["nope"] })).status, 400);
  assert.equal((await patchTheme(adminToken, 1, { sections: [] })).status, 400);
  assert.equal((await patchTheme(adminToken, 1, { banner: "x".repeat(201) })).status, 400);
  const unchanged = await getTheme(1);
  assert.equal(unchanged.data.theme.banner, "只改横幅");
  assert.equal(unchanged.data.theme.primaryColor, "#c8452c");
});

test("shop-scoped admin themes only their own shop; anonymous cannot PATCH", async () => {
  const t = await login("shopadminT", "Admin1234");
  const own = await patchTheme(t, themeShopId, { primaryColor: "#c9a24b" });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.theme.primaryColor, "#c9a24b");
  assert.equal((await patchTheme(t, 1, { primaryColor: "#c9a24b" })).status, 403);
  assert.equal((await patchTheme(undefined, themeShopId, { primaryColor: "#c9a24b" })).status, 403);
  // The public GET still works without a token.
  assert.equal((await getTheme(themeShopId)).status, 200);
});
