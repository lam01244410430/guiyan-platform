// Guiyan Phase-2 seed integrity tests — run against a REAL PostgreSQL 16,
// never a mock.
//
//   DATABASE_URL=postgres://guiyan:guiyan123@127.0.0.1:5433/guiyan_test
//   DEMO_PASSWORD=demo123 ADMIN_PASSWORD=admin123
//   node --test tests/seed-integrity.test.mjs
//
// The server seeds on first boot (demo set + 100 Phase-2 users) against a
// FRESH, disposable database. Do not point it at any shared or production
// database. Expected Phase-2 counts (deterministic seed, see
// server/seed.mjs): 100 new users (ids 40..139), 180 new orders,
// 120 favorites, 50 comments, 25 demands, 30 messages; demo set intact
// (admin/demo/supplier + 36 visitors = 39 users, 130 orders, 62 resources).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan123@127.0.0.1:5433/guiyan_test",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error("DEMO_PASSWORD and ADMIN_PASSWORD are required");

const PORT = Number(process.env.TEST_PORT || 3102);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const SEED_NOW = "2026-11-09T08:00:00.000Z";

let proc;
let pool;
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
async function one(sql, params = []) {
  return (await pool.query(sql, params)).rows[0];
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import("redis");
      const flush = createClient({ url: process.env.REDIS_URL });
      await flush.connect();
      await flush.flushDb();
      await flush.quit();
    } catch (error) {
      console.error("cache flush failed (continuing with stale redis)", {
        code: error?.code || "FLUSH_FAILED",
      });
    }
  }
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

after(async () => {
  if (pool) await pool.end();
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("demo set intact + exactly 100 new users, unique usernames", async () => {
  const total = await one("SELECT COUNT(*)::int AS n FROM users");
  assert.equal(total.n, 139, "39 demo + 100 new users");
  const demo = await one(
    "SELECT COUNT(*)::int AS n FROM users WHERE username IN ('admin','demo','supplier')",
  );
  assert.equal(demo.n, 3);
  const visitors = await one(
    "SELECT COUNT(*)::int AS n FROM users WHERE username LIKE 'visitor%'",
  );
  assert.equal(visitors.n, 36);
  const fresh = await one(
    "SELECT COUNT(*)::int AS n FROM users WHERE id >= 40",
  );
  assert.equal(fresh.n, 100);
  const dupes = await one(
    "SELECT COUNT(*)::int AS n FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) d",
  );
  assert.equal(dupes.n, 0, "usernames must be unique");
  const dupNames = await one(
    "SELECT COUNT(*)::int AS n FROM (SELECT name FROM users WHERE id >= 40 GROUP BY name HAVING COUNT(*) > 1) d",
  );
  assert.equal(dupNames.n, 0, "new full names must be unique");
  // No email column exists yet (Phase 3 owns registration); the derived
  // address <username>@example.com must still be unique per new user.
  const dupMail = await one(
    "SELECT COUNT(*)::int AS n FROM (SELECT username || '@example.com' AS email FROM users WHERE id >= 40 GROUP BY email HAVING COUNT(*) > 1) d",
  );
  assert.equal(dupMail.n, 0);
  const badCity = await one(
    "SELECT COUNT(*)::int AS n FROM users WHERE id >= 40 AND (city IS NULL OR city = '')",
  );
  assert.equal(badCity.n, 0);
});

test("new orders: 180, 90 users with >=1, amounts match resource prices, dates consistent", async () => {
  const total = await one("SELECT COUNT(*)::int AS n FROM orders");
  assert.equal(total.n, 310, "130 demo + 180 new orders");
  const fresh = await one(
    "SELECT COUNT(*)::int AS n FROM orders WHERE user_id >= 40",
  );
  assert.equal(fresh.n, 180);
  const withOrders = await one(
    "SELECT COUNT(DISTINCT user_id)::int AS n FROM orders WHERE user_id >= 40",
  );
  assert.equal(withOrders.n, 90, "90 of 100 new users have >=1 order");
  const dupCodes = await one(
    "SELECT COUNT(*)::int AS n FROM (SELECT code FROM orders GROUP BY code HAVING COUNT(*) > 1) d",
  );
  assert.equal(dupCodes.n, 0, "order codes must be unique");
  const badAmount = await one(
    `SELECT COUNT(*)::int AS n FROM orders o JOIN resources r ON r.id = o.resource_id
     WHERE o.user_id >= 40 AND o.amount <> o.quantity * r.price`,
  );
  assert.equal(badAmount.n, 0, "amount must equal quantity * resource price");
  const badDates = await one(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE user_id >= 40 AND (created_at > booking_date::text
       OR created_at > $1 OR booking_date > '2026-12-31')`,
    [SEED_NOW],
  );
  assert.equal(badDates.n, 0, "created_at <= booking_date, no future dates");
  const badStatus = await one(
    `SELECT COUNT(*)::int AS n FROM orders WHERE user_id >= 40
     AND status NOT IN ('completed','paid','pending','confirmed','cancelled')`,
  );
  assert.equal(badStatus.n, 0);
});

test("favorites/comments/demands/messages: exact counts, all FKs resolve", async () => {
  const fav = await one("SELECT COUNT(*)::int AS n FROM favorites");
  assert.equal(fav.n, 120);
  const favUsers = await one(
    "SELECT COUNT(DISTINCT user_id)::int AS n FROM favorites",
  );
  assert.equal(favUsers.n, 80, "80 new users have favorites");
  const comments = await one(
    "SELECT COUNT(*)::int AS n FROM comments WHERE user_id >= 40",
  );
  assert.equal(comments.n, 50);
  const badRating = await one(
    "SELECT COUNT(*)::int AS n FROM comments WHERE user_id >= 40 AND (rating < 1 OR rating > 5)",
  );
  assert.equal(badRating.n, 0);
  const badCommentStatus = await one(
    "SELECT COUNT(*)::int AS n FROM comments WHERE user_id >= 40 AND status NOT IN ('approved','pending')",
  );
  assert.equal(badCommentStatus.n, 0);
  const demands = await one(
    "SELECT COUNT(*)::int AS n FROM demands WHERE user_id >= 40",
  );
  assert.equal(demands.n, 25);
  const messages = await one(
    "SELECT COUNT(*)::int AS n FROM messages WHERE user_id >= 40 OR sender_id >= 40",
  );
  assert.equal(messages.n, 30);
  // No orphans anywhere (LEFT JOIN against users/resources must find none).
  const orphans = await one(
    `SELECT (
       (SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL) +
       (SELECT COUNT(*) FROM orders o LEFT JOIN resources r ON r.id = o.resource_id WHERE r.id IS NULL) +
       (SELECT COUNT(*) FROM favorites f LEFT JOIN users u ON u.id = f.user_id WHERE u.id IS NULL) +
       (SELECT COUNT(*) FROM favorites f LEFT JOIN resources r ON r.id = f.resource_id WHERE r.id IS NULL) +
       (SELECT COUNT(*) FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL) +
       (SELECT COUNT(*) FROM comments c LEFT JOIN resources r ON r.id = c.resource_id WHERE r.id IS NULL) +
       (SELECT COUNT(*) FROM demands d LEFT JOIN users u ON u.id = d.user_id WHERE u.id IS NULL) +
       (SELECT COUNT(*) FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL) +
       (SELECT COUNT(*) FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE u.id IS NULL)
     )::int AS n`,
  );
  assert.equal(orphans.n, 0, "no orphan FK references in seed-linked data");
  const resources = await one("SELECT COUNT(*)::int AS n FROM resources");
  assert.equal(resources.n, 62, "seed resources unchanged (22 + 40 catalog)");
});

test("new user login works with the shared seed password; demo still logs in", async () => {
  const fresh = await req("/api/auth/login", {
    method: "POST",
    body: { username: "lixiaoming01", password: "guiyan2026" },
  });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
  assert.ok(fresh.json.token, "new seed user must get a session token");
  assert.equal(fresh.json.user.username, "lixiaoming01");
  const last = await req("/api/auth/login", {
    method: "POST",
    body: { username: "hefangyang100", password: "guiyan2026" },
  });
  assert.equal(last.status, 200, JSON.stringify(last.json));
  const wrong = await req("/api/auth/login", {
    method: "POST",
    body: { username: "lixiaoming01", password: "wrong-password" },
  });
  assert.equal(wrong.status, 401);
  const demo = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: process.env.DEMO_PASSWORD },
  });
  assert.equal(demo.status, 200, JSON.stringify(demo.json));
});
