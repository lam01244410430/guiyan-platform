// R7-4 (rows 49, 52) — 7x24 Q&A + proactive recommendation.
// Runs against a REAL PostgreSQL 16, never a mock.
//
//   DATABASE_URL=<redacted>
//   DEMO_PASSWORD=<redacted>
//   node --test tests/r7-assistant.test.mjs
//
// The test spawns server/server.mjs on TEST_PORT (default 3122) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database (the server seeds 62 resources + demo users on
// first boot). Do not point it at any shared or production database.
// The trial AI backend is stubbed to fail, so POST
// /api/assistant/chat always exercises the rule-engine fallback —
// never the real trial IP (34.96.190.102).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
"DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5444/guiyan_test"
  );
if (!process.env.DEMO_PASSWORD || !process.env.ADMIN_PASSWORD)
  throw new Error(
    "DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
  );

const PORT = Number(process.env.TEST_PORT || 3122);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);

let proc;
let serverStderr = "";
let stubServer;
let stubPort;
let stubHandler = async (req, res) => {
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "boom" }));
};
function stubJson(status, body) {
  return async (req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
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

before(async () => {
  stubServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      Promise.resolve(stubHandler(req, res)).catch(() => {
        try {
          res.writeHead(500);
          res.end();
        } catch {
          // ignore
        }
      });
    });
  });
  await new Promise((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  stubPort = stubServer.address().port;
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      AI_CHAT_URL: `http://127.0.0.1:${stubPort}/api/chat`,
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[server] ${d}`));
  proc.stderr.on("data", (d) => {
    serverStderr += String(d);
    process.stderr.write(`[server:err] ${d}`);
  });
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
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
  if (stubServer) stubServer.close();
});

async function login() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: process.env.DEMO_PASSWORD },
  });
  assert.equal(r.status, 200);
  return r.json.token;
}

async function demoOrders(token) {
  const r = await req("/api/orders", { token });
  assert.equal(r.status, 200);
  assert.ok(r.json.orders.length > 0, "demo needs seeded orders");
  return r.json.orders;
}

// R3-1 default tiers (server/routes/member-tiers.mjs DEFAULT_TIERS):
// thresholds in integer cents, highest reached wins.
function tierForSpending(spendingCents) {
  if (spendingCents >= 1000000) return "钻石会员";
  if (spendingCents >= 500000) return "金卡会员";
  if (spendingCents >= 100000) return "银卡会员";
  return "普通会员";
}

test("r7-assistant: asking about my orders returns a real order number/status", async () => {
  const token = await login();
  const orders = await demoOrders(token);
  const first = orders[0];
  const r = await req(
    "/api/assistant?q=" + encodeURIComponent("我的订单"),
    { token },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myOrders");
  assert.ok(r.json.answer.includes(first.code), r.json.answer);
  assert.ok(r.json.answer.includes(first.resource_name), r.json.answer);
  assert.equal(r.json.items[0].code, first.code);
  assert.equal(r.json.items[0].status, first.status);
  assert.equal(r.json.items[0].amount, first.amount);
});

test("r7-assistant: not logged in, asking about my orders gets a login prompt", async () => {
  const r = await req("/api/assistant?q=" + encodeURIComponent("我的订单"));
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myOrders");
  assert.ok(r.json.answer.includes("请先登录"), r.json.answer);
});

test("r7-assistant: membership info returns the real tier and stored-value balance", async () => {
  const token = await login();
  const tier = await req("/api/account/tier", { token });
  assert.equal(tier.status, 200);
  const expectedTier = tierForSpending(tier.json.spending_cents);
  const sv = await req("/api/account/stored-value", { token });
  assert.equal(sv.status, 200);
  const balance = sv.json.account?.balance_cents || 0;
  const r = await req(
    "/api/assistant?q=" +
      encodeURIComponent("我的会员等级和文惠卡余额"),
    { token },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "member");
  assert.ok(r.json.answer.includes(expectedTier), r.json.answer);
  assert.ok(
    r.json.answer.includes(`文惠卡余额：¥${balance / 100}`),
    r.json.answer,
  );
  assert.ok(!r.json.answer.includes("尚未接入"), r.json.answer);
});

test("r7-assistant: refund question returns the real status of my orders", async () => {
  const token = await login();
  const orders = await demoOrders(token);
  const paid = orders.find((o) => o.status === "paid");
  assert.ok(paid, "demo needs a seeded paid order");
  const r = await req(
    "/api/assistant?q=" + encodeURIComponent("我的退款怎么办"),
    { token },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myRefund");
  assert.ok(r.json.answer.includes(paid.code), r.json.answer);
  assert.ok(r.json.answer.includes("已支付，可申请退款"), r.json.answer);
});

test("r7-assistant: asking about one order returns that order's real refund status", async () => {
  const token = await login();
  const orders = await demoOrders(token);
  const paid = orders.find((o) => o.status === "paid");
  assert.ok(paid, "demo needs a seeded paid order");
  const r = await req(
    "/api/assistant?q=" +
      encodeURIComponent(`订单${paid.code}退款状态`),
    { token },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myRefund");
  assert.ok(r.json.answer.includes(paid.code), r.json.answer);
  // Specific-order wording (REFUND_NEXT) differs from the grouped
  // summary's "已支付，可申请退款" — same state, per-order next step.
  assert.ok(r.json.answer.includes("已支付，可在「我的票券」申请退款"), r.json.answer);
});

test("r7-assistant: a live refund request is read back as refund_requested", async () => {
  const token = await login();
  const orders = await demoOrders(token);
  const paid = orders.find((o) => o.status === "paid");
  assert.ok(paid, "demo needs a seeded paid order");
  // Full refund request (no quantity): paid -> refund_requested, the
  // Wave 4 #13 state machine — the assistant only reads it.
  const ref = await req(`/api/orders/${paid.id}/refund`, {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(ref.status, 200, JSON.stringify(ref.json));
  const after = await req(`/api/orders/${paid.id}`, { token });
  assert.equal(after.json.order.status, "refund_requested");
  const r = await req(
    "/api/assistant?q=" +
      encodeURIComponent(`订单${paid.code}退款申请现在什么状态`),
    { token },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myRefund");
  assert.ok(r.json.answer.includes(paid.code), r.json.answer);
  assert.ok(r.json.answer.includes("已申请退款，等待管理员处理"), r.json.answer);
});

test("r7-assistant: 3-turn conversation recommends the genre stated in turn 1", async () => {
  stubHandler = stubJson(500, { error: "boom" });
  const token = await login();
  const chat = (message) =>
    req("/api/assistant/chat", { method: "POST", token, body: { message } });
  const t1 = await chat("帮我推荐");
  assert.equal(t1.status, 200);
  assert.equal(t1.json.source, "rules");
  assert.equal(t1.json.fallback, true);
  assert.equal(t1.json.kind, "recommend");
  assert.ok(t1.json.reply.includes("体裁"), t1.json.reply);
  const t2 = await chat("民族歌舞");
  assert.equal(t2.json.kind, "recommend");
  assert.ok(t2.json.reply.includes("城市"), t2.json.reply);
  const t3 = await chat("南宁");
  assert.equal(t3.json.kind, "recommend");
  assert.ok(t3.json.reply.includes("预算"), t3.json.reply);
  const t4 = await chat("100到300元");
  assert.equal(t4.json.kind, "recommend");
  assert.ok(t4.json.items?.length >= 1, JSON.stringify(t4.json));
  assert.ok(t4.json.items[0].name.includes("刘三姐"), JSON.stringify(t4.json));
  assert.ok(t4.json.reply.includes("民族歌舞"), t4.json.reply);
  assert.ok(t4.json.reply.includes("南宁"), t4.json.reply);
});

test("r7-assistant: one message stating all three preferences recommends at once", async () => {
  stubHandler = stubJson(500, { error: "boom" });
  const token = await login();
  const r = await req("/api/assistant/chat", {
    method: "POST",
    token,
    body: { message: "推荐南宁100到300元的民族歌舞" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.source, "rules");
  assert.equal(r.json.kind, "recommend");
  assert.ok(r.json.items?.length >= 1, JSON.stringify(r.json));
  assert.equal(r.json.items[0].name, "民族歌舞剧《刘三姐》");
  assert.ok(r.json.reply.includes("民族歌舞"), r.json.reply);
});
