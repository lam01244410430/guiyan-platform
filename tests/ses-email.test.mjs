// Guiyan SES email tests (2026-11-16) — real OTP delivery via AWS SES SMTP.
// Run against a REAL PostgreSQL 16, never a mock. Same harness shape as
// tests/account-otp.test.mjs: spawn server/server.mjs on TEST_PORT
// (default 3124) and talk to it over HTTP. DATABASE_URL must point at a
// FRESH, disposable database.
//
// Two halves:
//  - Unit tests for server/lib/email.mjs need no database: no provider env
//    -> sendEmail() reports simulated and sends nothing; the test-transport
//    override receives the message instead of SMTP.
//  - Integration tests spawn the server with SES env vars pointing at an
//    in-file stub SMTP sink (a minimal SMTP server on localhost that
//    records every message). That proves the code hands a correct message
//    to the real transport over real SMTP — without touching AWS.
// The simulated path (no provider env -> code returned in the response)
// is covered by tests/account-otp.test.mjs, which runs without SES env.
// The REAL send through SES to an inbox needs live SMTP credentials and is
// verified separately (verify package), never faked here.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  emailConfigured,
  sendEmail,
  setEmailTransportForTest,
} from "../server/lib/email.mjs";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://guiyan:guiyan@localhost:5433/guiyan_test";
const HAS_DB = Boolean(
  process.env.DATABASE_URL &&
    process.env.DEMO_PASSWORD &&
    process.env.ADMIN_PASSWORD,
);
const PORT = Number(process.env.TEST_PORT || 3124);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------------------------------------------------------------- unit ---

test("ses-email: not configured without env -> sendEmail reports simulated, sends nothing", async () => {
  const saved = {
    SES_SMTP_HOST: process.env.SES_SMTP_HOST,
    SES_SMTP_USER: process.env.SES_SMTP_USER,
    SES_SMTP_PASS: process.env.SES_SMTP_PASS,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  delete process.env.SES_SMTP_HOST;
  delete process.env.SES_SMTP_USER;
  delete process.env.SES_SMTP_PASS;
  delete process.env.EMAIL_FROM;
  try {
    assert.equal(emailConfigured(), false);
    const r = await sendEmail({
      to: "nobody@example.com",
      subject: "t",
      text: "x",
    });
    assert.deepEqual(r, { sent: false, simulated: true });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("ses-email: emailConfigured() is true only when user+pass+from are set", async () => {
  const saved = {
    SES_SMTP_USER: process.env.SES_SMTP_USER,
    SES_SMTP_PASS: process.env.SES_SMTP_PASS,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  try {
    process.env.SES_SMTP_USER = "u";
    process.env.SES_SMTP_PASS = "p";
    process.env.EMAIL_FROM = "lamvipboy777@gmail.com";
    assert.equal(emailConfigured(), true);
    delete process.env.SES_SMTP_PASS;
    assert.equal(emailConfigured(), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("ses-email: test transport override receives the message", async () => {
  const seen = [];
  setEmailTransportForTest(async (msg) => {
    seen.push(msg);
    return { sent: true, messageId: "stub-1" };
  });
  try {
    const r = await sendEmail({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    assert.deepEqual(r, { sent: true, messageId: "stub-1" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].to, "a@example.com");
    assert.equal(seen[0].subject, "s");
  } finally {
    setEmailTransportForTest(null);
  }
});

test("ses-email: UI shows the sent note for email, keeps the demo note for phone", async () => {
  const { readFileSync } = await import("node:fs");
  const repoDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const dashboard = readFileSync(
    path.join(repoDir, "web", "assets", "js", "UserDashboard.jsx"),
    "utf8",
  );
  const data = await import(path.join(repoDir, "web", "assets", "js", "data.js"));
  // Email tab: the sent note renders from the new otpSentNote key when the
  // server answers {sent:true}; the demo code renders only when the server
  // returned a code (simulated path).
  assert.ok(dashboard.includes('t("otpSentNote")'), "email tab must render otpSentNote");
  assert.ok(dashboard.includes("emailSent"), "email tab must track the sent state");
  assert.ok(dashboard.includes('fmt(t("otpDemoNote"), { code: emailDemo })'));
  // Phone tab is untouched: still the demo note only.
  assert.ok(dashboard.includes('fmt(t("otpDemoNote"), { code: phoneDemo })'));
  assert.ok(!dashboard.includes("phoneSent"), "phone tab must not gain a sent state");
  for (const l of ["zh", "vi", "en"]) {
    assert.ok(
      typeof data.I18N[l].otpSentNote === "string" && data.I18N[l].otpSentNote.length > 0,
      `otpSentNote missing in ${l}`,
    );
  }
  assert.deepEqual(
    ["zh", "vi", "en"].map((l) => Object.keys(data.I18N[l]).length),
    [483, 483, 483],
  );
});

// ------------------------------------------------------- stub SMTP sink ---

// Minimal SMTP sink: accepts one message per connection and records the
// DATA payload. Speaks just enough SMTP for nodemailer (EHLO, MAIL FROM,
// RCPT TO, DATA, QUIT). No STARTTLS advertised, so the transport stays
// plain — only ever used by tests.
function startStubSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buf = "";
    let dataMode = false;
    let dataLines = [];
    socket.write("220 stub-smtp ready\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (dataMode) {
          if (line === ".") {
            dataMode = false;
            messages.push(dataLines.join("\n"));
            dataLines = [];
            socket.write("250 OK\r\n");
          } else {
            dataLines.push(line);
          }
          continue;
        }
        const cmd = line.split(" ")[0].toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250 stub-smtp\r\n");
        else if (cmd === "MAIL" || cmd === "RCPT") socket.write("250 OK\r\n");
        else if (cmd === "DATA") {
          dataMode = true;
          socket.write("354 End data\r\n");
        } else if (cmd === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, messages });
    });
  });
}

// The stub records raw SMTP DATA: nodemailer MIME-encodes non-ASCII
// (the subject becomes an =?UTF-8?B?...?= encoded-word and both body
// parts are base64). Decode both before asserting on content.
function decodeMail(raw) {
  let out = raw.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) =>
    Buffer.from(b, "base64").toString("utf8"),
  );
  out = out.replace(
    /(Content-Transfer-Encoding: base64\n\n)([A-Za-z0-9+/=\n]+)/g,
    (_, head, b64) =>
      head + Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8"),
  );
  return out;
}
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

// ------------------------------------------------------------ integration ---

let stub = null;
let proc = null;

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

function spawnServer(port, extraEnv) {
  const child = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(port),
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) =>
    process.stderr.write(`[ses-server:${port}] ${d}`),
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(`[ses-server:${port}:err] ${d}`),
  );
  return child;
}

async function waitHealthy(base, label) {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.status === 200) {
        const j = await r.json();
        if (j?.ok) return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error(`${label} did not become healthy within 60s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function registerFresh(base) {
  const suffix = randomBytes(4).toString("hex");
  const username = `ses_${suffix}`;
  const r = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "sestest123", name: `Ses ${suffix}` }),
  });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const j = JSON.parse(text);
  return { username, token: j.token, user: j.user };
}

before(async () => {
  if (!HAS_DB) return;
  stub = await startStubSmtp();
  proc = spawnServer(PORT, {
    SES_SMTP_HOST: "127.0.0.1",
    SES_SMTP_PORT: String(stub.port),
    SES_SMTP_USER: "stub-user",
    SES_SMTP_PASS: "stub-pass",
    EMAIL_FROM: "lamvipboy777@gmail.com",
  });
  await waitHealthy(BASE, "SES server");
});

after(async () => {
  if (proc) proc.kill();
  if (stub) await new Promise((r) => stub.server.close(r));
  await pool.end();
});

test(
  "ses-email: email send-otp with provider sends a real email, no code in response",
  { skip: !HAS_DB },
  async () => {
    const me = await registerFresh(BASE);
    const target = `ses_${randomBytes(4).toString("hex")}@example.com`;
    const before = stub.messages.length;
    const r = await req("/api/account/send-otp", {
      method: "POST",
      body: { channel: "email", target },
      token: me.token,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.code, undefined, "code must NOT be in the response");
    assert.equal(r.json.sent, true);
    assert.equal(r.json.channel, "email");
    assert.equal(r.json.target, target);
    assert.equal(r.json.expires_in_seconds, 300);
    assert.equal(stub.messages.length, before + 1, "one email must be sent");
    const mail = decodeMail(stub.messages[stub.messages.length - 1]);
    assert.match(mail, new RegExp(`^To: ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
    assert.match(mail, /Subject: .*验证码/m);
    const m = mail.match(/\b(\d{6})\b/);
    assert.ok(m, "email body must contain the 6-digit code");
    const dbCode = await pool.query(
      "SELECT code FROM verification_codes WHERE user_id=$1 AND channel='email' AND target=$2 AND used_at IS NULL ORDER BY id DESC LIMIT 1",
      [me.user.id, target],
    );
    assert.equal(dbCode.rows.length, 1);
    assert.equal(m[1], dbCode.rows[0].code, "emailed code must match the DB row");
    const v = await req("/api/account/verify-otp", {
      method: "POST",
      body: { channel: "email", target, code: m[1] },
      token: me.token,
    });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.valid, true, JSON.stringify(v.json));
  },
);

test(
  "ses-email: phone send-otp stays simulated with provider configured",
  { skip: !HAS_DB },
  async () => {
    const me = await registerFresh(BASE);
    const target = `+86138${randomBytes(4).toString("hex").slice(0, 8).replace(/[a-f]/g, "1")}`;
    const before = stub.messages.length;
    const r = await req("/api/account/send-otp", {
      method: "POST",
      body: { channel: "phone", target },
      token: me.token,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.code, /^\d{6}$/, "phone has no SMS provider: code is still returned");
    assert.equal(stub.messages.length, before, "no email must be sent for phone");
  },
);

test(
  "ses-email: send failure answers 502 and stores no code",
  { skip: !HAS_DB },
  async () => {
    const deadPort = await closedPort();
    const portB = PORT + 1;
    const baseB = `http://127.0.0.1:${portB}`;
    const procB = spawnServer(portB, {
      SES_SMTP_HOST: "127.0.0.1",
      SES_SMTP_PORT: String(deadPort),
      SES_SMTP_USER: "stub-user",
      SES_SMTP_PASS: "stub-pass",
      EMAIL_FROM: "lamvipboy777@gmail.com",
    });
    try {
      await waitHealthy(baseB, "SES server B");
      const me = await registerFresh(baseB);
      const target = `sesfail_${randomBytes(4).toString("hex")}@example.com`;
      const r = await fetch(baseB + "/api/account/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${me.token}`,
        },
        body: JSON.stringify({ channel: "email", target }),
      });
      const textB = await r.text();
      assert.equal(r.status, 502, textB);
      const rows = await pool.query(
        "SELECT id FROM verification_codes WHERE user_id=$1 AND channel='email' AND target=$2",
        [me.user.id, target],
      );
      assert.equal(rows.rows.length, 0, "failed send must roll back: no code stored");
    } finally {
      procB.kill();
    }
  },
);
