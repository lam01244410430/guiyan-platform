// Real AI copy (2026-11-16) — POST /api/ai/copy calls the trial agent
// (stubbed here) with one dedicated prompt per channel, in parallel.
// Agent up -> source:"ai", label "AI 生成", the 3 versions come from
// the model. Agent down (500 / timeout) -> fail-open to the existing
// template with source:"template", label "本地模板". The chat agent's
// system prompt is untouched; the copy prompt carries its own
// instructions, including the [待确认...] rule for facts the user did
// not provide. Runs against a REAL PostgreSQL 16, never a mock.
import test, { before, after} from "node:test";
import assert from "node:assert/strict";
import { spawn} from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath} from "node:url";
import fs from "node:fs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
throw new Error(
"DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5454/guiyan_test",
);
if (!process.env.DEMO_PASSWORD ||!process.env.ADMIN_PASSWORD)
throw new Error(
"DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
);

const PORT = Number(process.env.TEST_PORT || 3124);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
path.dirname(fileURLToPath(import.meta.url)),
"..",
"server",
);

let proc;
let stubServer;
let stubPort;
// Every request the stub agent receives, in arrival order.
const captured = [];
let stubHandler = async (req, res) => {
const msg = req.jsonBody?.message || "";
const reply = msg.includes("小红书")
? "STUB小红书：刘三姐山歌悠扬，值得一看 #广西文化"
: msg.includes("公众号")
? "STUB公众号标题\nSTUB公众号正文：刘三姐，山水实景演出。"
: msg.includes("短信")
? "STUB短信：刘三姐演出，详情见桂演。"
: "STUB默认回复";
res.writeHead(200, { "Content-Type": "application/json"});
res.end(JSON.stringify({ reply}));
};
function stubJson(status, body) {
return async (req, res) => {
res.writeHead(status, { "Content-Type": "application/json"});
res.end(JSON.stringify(body));
};
}
async function req(p, { method = "GET", body, token} = {}) {
const res = await fetch(BASE + p, {
method,
headers: {
...(body? { "Content-Type": "application/json"}: {}),
...(token? { Authorization: `Bearer ${token}`}: {}),
},
body: body? JSON.stringify(body): undefined,
});
const text = await res.text();
let json = null;
try {
json = JSON.parse(text);
} catch {
// keep json null; assertions below will fail with a clear message
}
return { status: res.status, json, text};
}

before(async () => {
stubServer = http.createServer((req, res) => {
const chunks = [];
req.on("data", (c) => chunks.push(c));
req.on("end", () => {
try {
req.jsonBody = JSON.parse(Buffer.concat(chunks).toString() || "{}");
} catch {
req.jsonBody = null;
}
if (req.jsonBody) captured.push(req.jsonBody);
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
if (proc &&!proc.killed) proc.kill("SIGTERM");
if (stubServer) stubServer.close();
});

async function login() {
const r = await req("/api/auth/login", {
method: "POST",
body: { username: "demo", password: process.env.DEMO_PASSWORD},
});
assert.equal(r.status, 200);
return r.json.token;
}

test("ai copy via stub agent: source ai, 3 versions from the model", async () => {
const token = await login();
captured.length = 0;
const r = await req("/api/ai/copy", {
method: "POST",
token,
body: { prompt: "为《刘三姐》写一段推送"},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.source, "ai");
assert.equal(r.json.label, "AI 生成");
assert.equal(r.json.mock, false);
assert.equal(r.json.topic, "刘三姐");
assert.deepEqual(
r.json.channels.map((c) => c.name),
["小红书版", "公众号版", "短信版"],
);
assert.ok(r.json.channels[0].content.includes("STUB小红书"), r.json.channels[0].content);
assert.ok(r.json.channels[1].content.includes("STUB公众号"), r.json.channels[1].content);
assert.ok(r.json.channels[2].content.includes("STUB短信"), r.json.channels[2].content);
assert.equal(r.json.body, "STUB公众号标题\nSTUB公众号正文：刘三姐，山水实景演出。");
assert.equal(r.json.title, "STUB公众号标题");
assert.ok(r.json.answer.startsWith(""), r.json.answer);
assert.equal(r.json.notes.length, 2);
// One call per channel, all in Chinese, each carrying the topic and
// the [待确认...] rule for facts the user did not provide.
assert.equal(captured.length, 3, JSON.stringify(captured));
for (const c of captured) {
assert.equal(c.language, "zh");
assert.ok(c.message.includes("《刘三姐》") || c.message.includes("刘三姐"), c.message);
assert.ok(c.message.includes("[待确认日期]"), c.message);
assert.ok(c.message.includes("[待确认场馆]"), c.message);
assert.ok(c.message.includes("[待确认价格]"), c.message);
}
assert.ok(captured.some((c) => c.message.includes("小红书")), "one call asks for the 小红书 version");
assert.ok(captured.some((c) => c.message.includes("公众号")), "one call asks for the 公众号 version");
assert.ok(captured.some((c) => c.message.includes("短信")), "one call asks for the 短信 version");
});

test("ai copy agent down (500): fail-open to the template", async () => {
const token = await login();
stubHandler = stubJson(500, { error: "boom"});
const r = await req("/api/ai/copy", {
method: "POST",
token,
body: { prompt: "为《刘三姐》写一段推送"},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.source, "template");
assert.equal(r.json.label, "本地模板");
assert.equal(r.json.mock, true);
assert.equal(r.json.topic, "刘三姐");
assert.deepEqual(
r.json.channels.map((c) => c.name),
["小红书版", "公众号版", "短信版"],
);
assert.ok(r.json.answer.includes(""));
assert.ok(
["刘三姐，周末见", "相约刘三姐，遇见好时光", "把刘三姐写进你的行程"].includes(r.json.title),
r.json.title,
);
});

test("ai copy agent timeout: hanging stub fails open to the template", async () => {
const token = await login();
stubHandler = async (req, res) => {
// Answer after the 200ms agent timeout: the server must already
// have failed open by then, and the socket still closes cleanly.
await new Promise((resolve) => setTimeout(resolve, 1000));
try {
res.writeHead(200, { "Content-Type": "application/json"});
res.end(JSON.stringify({ reply: "too late"}));
} catch {
// ignore — the caller already gave up
}
};
const r = await req("/api/ai/copy", {
method: "POST",
token,
body: { prompt: "为《刘三姐》写一段推送"},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.source, "template");
assert.equal(r.json.label, "本地模板");
assert.equal(r.json.mock, true);
});

test("ai copy needs login", async () => {
assert.equal(
(await req("/api/ai/copy", { method: "POST", body: { prompt: "为《刘三姐》写一段推送"}})).status,
401,
);
});

test("ai copy never logs prompt/reply content; admin label switches on source", () => {
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiCopy = fs.readFileSync(
path.join(repoDir, "server", "routes", "ai-copy.mjs"),
"utf-8",
);
assert.ok(!aiCopy.includes("console.log("), "no console.log in ai-copy.mjs");
assert.ok(!aiCopy.includes("prompt.slice"), "the audit no longer stores the prompt text");
const adminJsx = fs.readFileSync(
path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
"utf-8",
);
assert.ok(
adminJsx.includes('aicopy: ["文案生成", copyResult? (copyResult.source === "ai"? "AI 生成": "本地模板 · 智能服务暂时不可用，已用模板生成"): "AI 生成 · 智能服务不可用时自动用模板"]'),
"admin subtitle shows AI 生成 on success and the template fallback otherwise",
);
assert.ok(
adminJsx.includes("AI 生成三渠道文案草稿；智能服务不可用时自动用本地模板。"),
"admin note describes AI-first with template fallback",
);
assert.ok(!adminJsx.includes("本地模板 · 未接入大模型"), "the old 'not connected to a model' label is gone");
});
