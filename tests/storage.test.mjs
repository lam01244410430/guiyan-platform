// Guiyan object-storage tests — run against a REAL Neon branch, never a mock.
//
//   set -a; source .env.local; set +a   # DATABASE_URL + AWS_* from `neon deploy`
//   DEMO_PASSWORD=<redacted> ADMIN_PASSWORD=<redacted> npm --prefix server test
//
// The test spawns server/server.mjs on TEST_PORT (default 3102) and talks
// to it over HTTP. It runs against the Neon branch in DATABASE_URL — the
// deployment target — because only the real branch has the real bucket and
// credentials. It writes exactly one small object under tests/ and deletes
// it again; it creates no orders and no resources. The server seeds the
// database on first boot (by design); point DATABASE_URL at the branch this
// app is deployed against, never at any other project's database.
//
// When the AWS_* storage vars are missing, the test asserts the fail-soft
// path instead: /api/storage/health answers 503 "对象存储未配置".
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const PORT = Number(process.env.TEST_PORT || 3102);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const KEY = `tests/ping-${randomBytes(4).toString("hex")}.txt`;
const CONTENT = `guiyan-storage-ping ${new Date().toISOString()}\n`;

let proc;
let token;
async function req(p, { method = "GET", body, token: t } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
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
  const login = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: process.env.DEMO_PASSWORD },
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  token = login.json.token;
});

after(async () => {
  if (storageConfigured && token) {
    // Best-effort cleanup of the probe object, even if a test failed.
    await req(`/api/storage/${encodeURIComponent(KEY)}`, {
      method: "DELETE",
      token,
    }).catch(() => {});
  }
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("storage health reports the configured bucket, or 503 when unconfigured", async () => {
  const r = await req("/api/storage/health");
  if (!storageConfigured) {
    assert.equal(r.status, 503);
    assert.match(r.json.error, /对象存储未配置/);
    return;
  }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.bucket, "uploads");
});

test("storage requires login for upload, url and delete", async () => {
  const upload = await req("/api/storage/upload", {
    method: "POST",
    body: { key: KEY, content_base64: Buffer.from("x").toString("base64") },
  });
  assert.equal(upload.status, 401);
  const url = await req(`/api/storage/url?key=${encodeURIComponent(KEY)}`);
  assert.equal(url.status, 401);
  const del = await req(`/api/storage/${encodeURIComponent(KEY)}`, {
    method: "DELETE",
  });
  assert.equal(del.status, 401);
});

test("storage rejects bad keys", async (t) => {
  if (!storageConfigured) t.skip("storage not configured");
  for (const bad of ["../escape.txt", "/absolute.txt", "", "a".repeat(513)]) {
    const r = await req("/api/storage/upload", {
      method: "POST",
      body: {
        key: bad,
        content_base64: Buffer.from("x").toString("base64"),
      },
      token,
    });
    assert.equal(r.status, 400, `key ${JSON.stringify(bad)}: ${r.status}`);
  }
});

test("storage round-trip: upload, presigned fetch, delete", async (t) => {
  if (!storageConfigured) t.skip("storage not configured");
  const uploaded = await req("/api/storage/upload", {
    method: "POST",
    body: {
      key: KEY,
      content_base64: Buffer.from(CONTENT, "utf-8").toString("base64"),
      content_type: "text/plain; charset=utf-8",
    },
    token,
  });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.json));
  assert.equal(uploaded.json.key, KEY);
  assert.equal(uploaded.json.size, Buffer.byteLength(CONTENT));

  const signed = await req(
    `/api/storage/url?key=${encodeURIComponent(KEY)}`,
    { token },
  );
  assert.equal(signed.status, 200, JSON.stringify(signed.json));
  assert.ok(signed.json.url.startsWith("https://"));
  assert.match(signed.json.url, /X-Amz-Signature=/);
  const fetched = await fetch(signed.json.url);
  assert.equal(fetched.status, 200);
  assert.equal(await fetched.text(), CONTENT);

  const deleted = await req(`/api/storage/${encodeURIComponent(KEY)}`, {
    method: "DELETE",
    token,
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal(deleted.json.deleted, true);

  const gone = await req(
    `/api/storage/url?key=${encodeURIComponent(KEY)}`,
    { token },
  );
  assert.equal(gone.status, 200);
  const refetched = await fetch(gone.json.url);
  assert.equal(refetched.status, 404);
});
