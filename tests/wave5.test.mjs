// Guiyan Wave 5 tests (#29 login rate limit; #27 miniprogram apiBase;
// #23 venue recommendations + report download) — run against a REAL
// PostgreSQL 16, never a mock. Same harness shape as
// tests/account-otp.test.mjs: spawn server/server.mjs on TEST_PORT
// (default 3107) and talk to it over HTTP. DATABASE_URL must point at a
// FRESH, disposable database. Fresh users are created per test via
// register with a unique username, so earlier tests cannot interfere
// (the limiter counts per (IP, username), and each test uses its own
// username).
//
// #29 rules (plan): 5 failed logins per (IP, username) in a 1-hour
// sliding window lock the pair out with 429
// "登录尝试过多，请稍后再试"; a correct password does not bypass the
// lock; success clears the counter; the limiter is fail-open (a dead
// store must never lock everyone out).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

async function req(p, { method = "GET", body, token, headers } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
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

async function registerFresh(prefix = "rl") {
  const suffix = randomBytes(4).toString("hex");
  const username = `${prefix}_${suffix}`;
  const password = "ratelimit123";
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: `Rate ${suffix}` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { username, password, token: r.json.token, user: r.json.user };
}

async function loginRaw(username, password, headers) {
  return req("/api/auth/login", {
    method: "POST",
    body: { username, password },
    headers,
  });
}

// 5 wrong passwords (each 401) + a 6th that must answer 429: the pair
// is locked. Returns after the lock is proven.
async function lockUser(username, password) {
  for (let i = 0; i < 5; i++) {
    const r = await loginRaw(username, "wrong-password");
    assert.equal(r.status, 401, `attempt ${i + 1}: ${JSON.stringify(r.json)}`);
  }
  const sixth = await loginRaw(username, "wrong-password");
  assert.equal(sixth.status, 429, JSON.stringify(sixth.json));
  assert.equal(sixth.json?.error, "登录尝试过多，请稍后再试");
}

async function ageAttempts(username, msAgo) {
  await pool.query(
    "UPDATE login_attempts SET attempted_at=$1 WHERE username=$2",
    [new Date(Date.now() - msAgo).toISOString(), username],
  );
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: Wave 5 tests never call the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[wave5-server] ${d}`));
  proc.stderr.on("data", (d) =>
    process.stderr.write(`[wave5-server:err] ${d}`),
  );
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("Wave 5 server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc) proc.kill();
  return pool.end();
});

// --- #29: login rate limit ---------------------------------------------

test("wave5 #29: 5 wrong passwords → 401; 6th → 429 with the lock message", async () => {
  const me = await registerFresh();
  await lockUser(me.username, me.password);
});

test("wave5 #29: correct password while locked → still 429", async () => {
  const me = await registerFresh();
  await lockUser(me.username, me.password);
  const r = await loginRaw(me.username, me.password);
  assert.equal(r.status, 429, JSON.stringify(r.json));
  assert.equal(r.json?.error, "登录尝试过多，请稍后再试");
});

test("wave5 #29: a different IP is not locked (x-forwarded-for, first entry wins)", async () => {
  const me = await registerFresh();
  await lockUser(me.username, me.password);
  const r = await loginRaw(me.username, me.password, {
    "x-forwarded-for": "203.0.113.9, 70.0.0.1",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json?.token);
});

test("wave5 #29: a different username is not locked", async () => {
  const locked = await registerFresh();
  await lockUser(locked.username, locked.password);
  const other = await registerFresh();
  const r = await loginRaw(other.username, other.password);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json?.token);
});

test("wave5 #29: attempts older than 1 hour no longer lock (window expiry)", async () => {
  const me = await registerFresh();
  await lockUser(me.username, me.password);
  await ageAttempts(me.username, 2 * 3600 * 1000);
  const r = await loginRaw(me.username, me.password);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json?.token);
});

test("wave5 #29: a successful login clears the counter", async () => {
  const me = await registerFresh();
  for (let i = 0; i < 3; i++) {
    const r = await loginRaw(me.username, "wrong-password");
    assert.equal(r.status, 401, JSON.stringify(r.json));
  }
  const ok = await loginRaw(me.username, me.password);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // If the clear had not happened, the 3rd wrong password below would
  // be the 6th failure overall and answer 429 instead of 401.
  for (let i = 0; i < 5; i++) {
    const r = await loginRaw(me.username, "wrong-password");
    assert.equal(r.status, 401, `post-clear attempt ${i + 1}: ${JSON.stringify(r.json)}`);
  }
  const sixth = await loginRaw(me.username, "wrong-password");
  assert.equal(sixth.status, 429, JSON.stringify(sixth.json));
});

test("wave5 #29: locking writes exactly one audit row (登录受限)", async () => {
  const me = await registerFresh();
  await lockUser(me.username, me.password);
  // A 6th attempt is rejected before recording, so it must not add a
  // second audit row.
  await loginRaw(me.username, "wrong-password");
  const rows = await pool.query(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=$1 AND action='登录受限'",
    [me.user.id],
  );
  assert.equal(Number(rows.rows[0].n), 1);
});

test("wave5 #29: failures for a nonexistent username count toward the lock", async () => {
  const ghost = `ghost_${randomBytes(4).toString("hex")}`;
  for (let i = 0; i < 5; i++) {
    const r = await loginRaw(ghost, "wrong-password");
    assert.equal(r.status, 401, JSON.stringify(r.json));
  }
  const sixth = await loginRaw(ghost, "wrong-password");
  assert.equal(sixth.status, 429, JSON.stringify(sixth.json));
});

test("wave5 #29: fail-open — login still works when the limiter store is gone", async () => {
  const me = await registerFresh();
  await pool.query("DROP TABLE login_attempts");
  try {
    const ok = await loginRaw(me.username, me.password);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const bad = await loginRaw(me.username, "wrong-password");
    assert.equal(bad.status, 401, JSON.stringify(bad.json));
  } finally {
    // Recreate the table (the server only creates tables at boot).
    // NOTE: id must be GENERATED BY DEFAULT AS IDENTITY, exactly as
    // server/postgres.mjs converts the schema — a plain INTEGER
    // PRIMARY KEY has no default and every INSERT fails with 23502.
    await pool.query(
      "CREATE TABLE IF NOT EXISTS login_attempts(id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, ip TEXT NOT NULL, username TEXT NOT NULL, attempted_at TEXT NOT NULL)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(ip,username,attempted_at)",
    );
  }
  // The recreated table works again: a fresh lockout still trips.
  await lockUser(me.username, me.password);
});

// --- #27: miniprogram apiBase -------------------------------------------
// Static checks (no DB needed, but they run in the shared suite): the
// default apiBase is the production Vercel URL, and Zhou's hardcoded IP
// appears nowhere in the miniprogram. Compile-testing in WeChat DevTools
// is Lam's step, not the agents'.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const miniprogramDir = path.resolve(repoRoot, "miniprogram");

test("wave5 #27: miniprogram apiBase defaults to the production Vercel URL", async () => {
  const appJs = await readFile(path.resolve(miniprogramDir, "app.js"), "utf-8");
  assert.match(appJs, /apiBase:\s*'https:\/\/guiyan-platform\.vercel\.app'/);
});

test("wave5 #27: no hardcoded Zhou IP anywhere in the miniprogram", async () => {
  let found = "";
  try {
    found = execFileSync("grep", ["-r", "120.24.109.101", miniprogramDir], {
      encoding: "utf-8",
    });
  } catch (e) {
    // grep exits 1 when there is no match — that is the expected outcome.
    assert.equal(e.status, 1, "grep failed: " + e.message);
  }
  assert.equal(found, "");
});

// --- #23: venue recommendations + report download ------------------------
// Backend contract (the admin UI renders venues[].recommendations verbatim;
// the download reuses downloadText, so only the contract + the static UI
// wiring are testable here — the click itself is a browser check).
// No backend change: recommendations already come from buildAnalysis.

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

test("wave5 #23: analysis returns venue recommendations (top-3, score order)", async () => {
  const token = await adminLogin();
  const r = await req("/api/admin/analysis?period=month", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.venues) && r.json.venues.length > 0);
  for (const v of r.json.venues) {
    // Always an array, never null — even when nothing matches.
    assert.ok(Array.isArray(v.recommendations), "venue " + v.id + " recommendations must be an array");
    assert.ok(v.recommendations.length <= 3, "venue " + v.id + " at most 3 recommendations");
    for (let i = 0; i < v.recommendations.length; i++) {
      const rec = v.recommendations[i];
      assert.equal(typeof rec.id, "number");
      assert.equal(typeof rec.name, "string");
      assert.ok(rec.name.length > 0);
      assert.equal(typeof rec.score, "number");
      assert.equal(typeof rec.reason, "string");
      assert.ok(rec.reason.length > 0);
      if (i > 0) {
        const prev = v.recommendations[i - 1];
        assert.ok(
          rec.score < prev.score || (rec.score === prev.score && rec.id > prev.id),
          "venue " + v.id + " recommendations must be score-desc, id-asc",
        );
      }
    }
  }
});

test("wave5 #23: admin UI renders recommendations and offers a report download", async () => {
  const dash = await readFile(
    path.resolve(repoRoot, "admin", "assets", "js", "AdminDashboard.jsx"),
    "utf-8",
  );
  assert.ok(dash.includes("v.recommendations"), "venue card must render v.recommendations");
  assert.ok(dash.includes("推荐剧目"), "venue card must label the recommendations");
  assert.ok(dash.includes("downloadReport"), "report download handler must exist");
  assert.ok(dash.includes("guiyan-analysis-"), "download filename must be guiyan-analysis-<period>.txt");
  assert.ok(dash.includes("下载报告"), "download button must be labelled");
});
