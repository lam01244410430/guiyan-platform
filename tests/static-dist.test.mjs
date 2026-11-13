// Static-dist tests — the container serves the built React app (dist/),
// not the source (web/ + admin/), because browsers cannot run .jsx.
//
//   DATABASE_URL=postgres://guiyan:guiyan@localhost:5433/guiyan_test \
//   DEMO_PASSWORD=... ADMIN_PASSWORD=... \
//   npm --prefix server test
//
// The test builds dist/ first (npm run build from the repo root), then
// spawns server/server.mjs with STATIC_DIR=dist on TEST_PORT (default
// 3101) and talks to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database. Do not point it at any shared or production
// database.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5433/guiyan_test",
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverDir = path.join(repoRoot, "server");

let proc;

async function req(p) {
  const res = await fetch(BASE + p);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  // Build the production bundle first — the server serves it from dist/.
  await new Promise((resolve, reject) => {
    execFile("npm", ["run", "build"], { cwd: repoRoot }, (error) => {
      if (error) reject(new Error(`npm run build failed: ${error.message}`));
      else resolve();
    });
  });
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      STATIC_DIR: "dist",
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
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
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("GET / serves the built dist index (hashed asset, no .jsx)", async () => {
  const r = await req("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(r.text, /\/assets\/main-[A-Za-z0-9_-]+\.js/);
  assert.ok(!r.text.includes(".jsx"), "dist index must not reference .jsx");
});

test("GET /admin/ serves the built dist admin login page", async () => {
  const r = await req("/admin/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.ok(r.text.includes("桂演管理后台 · 登录"));
});

test("GET /admin.html is a 404 JSON error", async () => {
  const r = await req("/admin.html");
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: "页面不存在" });
});
