// tests/r7-voice.test.mjs: R7-2 (row 42) — 多模态：说 → 字 (speech-to-text).
// Spawns server/server.mjs on TEST_PORT (default 3108) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Server-testable parts only:
// (1) voice text enters through the SAME assistant proxy as typed text:
//     POST /api/assistant/chat with an empty / blank / over-1000-char
//     message -> 400 (the proxy's existing validation, asserted here so
//     the voice path cannot smuggle an empty question through);
// (2) a real spoken transcript ("刘三姐多少钱") goes through that proxy
//     and gets a reply (dead upstream here, so the rule fallback answers
//     — the trial agent answers the real price when reachable, same
//     endpoint, same path, no voice-only shortcut);
// (3) the price behind that question is real catalog data: 刘三姐 is
//     ¥280 (28000 cents) in GET /api/resources;
// (4) i18n counts after the 4 new H5 voice keys (423 -> 427 standalone, 448 merged) and the 5
//     new mini-program voice keys (236 -> 241 standalone, 262 merged);
// (5) static code checks on the client recognition code (see below).
//
// Browser recognition itself is verified by code review + the manual
// steps in this comment, NOT by a faked passing test — no headless
// browser runs in npm test:
//   MANUAL (H5): open the site in Chrome/Edge, open the AI chat, click
//   the mic button, allow the mic, say "刘三姐多少钱" -> the transcript
//   appears IN THE INPUT and is NOT sent until the user presses 发送;
//   in a browser without SpeechRecognition the mic shows "当前浏览器不
//   支持语音输入，请手动输入"; a failed recognition shows "语音识别失败，
//   请重试或手动输入". Never a faked transcript.
//   MANUAL (mini-program): open the assistant page, tap the mic -> the
//   recorder runs (正在录音，点击停止), tap again to stop -> the page
//   says "语音识别尚未接入服务商 — 请手动输入文字提问" and the recorded
//   audio is discarded (never uploaded, never turned into text). No
//   recognition provider is connected in this wave — that needs a
//   separate Lam/group decision.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
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

const PORT = Number(process.env.TEST_PORT || 3108);
const BASE = `http://127.0.0.1:${PORT}`;
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverDir = path.resolve(repoDir, "server");

let proc;

async function req(p, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: r7-voice never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[r7-voice-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[r7-voice-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("r7-voice server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("r7-voice: empty voice text -> 400 via the assistant proxy", async () => {
  const r = await req("/api/assistant/chat", {
    method: "POST",
    body: { message: "", language: "zh" },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("r7-voice: whitespace-only voice text -> 400", async () => {
  const r = await req("/api/assistant/chat", {
    method: "POST",
    body: { message: "   ", language: "zh" },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("r7-voice: over-1000-char voice text -> 400", async () => {
  const r = await req("/api/assistant/chat", {
    method: "POST",
    body: { message: "刘".repeat(1001), language: "zh" },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("r7-voice: spoken transcript goes through the same proxy, rule fallback answers", async () => {
  // Dead upstream -> the proxy falls back to the rule engine, exactly as
  // a typed question would. Same endpoint, same validation, same path.
  const r = await req("/api/assistant/chat", {
    method: "POST",
    body: { message: "刘三姐多少钱", language: "zh" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.source, "rules", JSON.stringify(r.json));
  assert.equal(typeof r.json.reply, "string");
  assert.ok(r.json.reply.length > 0);
});

test("r7-voice: the catalog price behind the spoken question is real (刘三姐 ¥280)", async () => {
  const r = await req("/api/resources?q=" + encodeURIComponent("刘三姐"));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = (r.json.resources || []).find(
    (x) => x.name === "民族歌舞剧《刘三姐》",
  );
  assert.ok(row, "民族歌舞剧《刘三姐》 must be in the catalog");
  assert.equal(row.price, 28000, "刘三姐 is ¥280 (28000 cents)");
});

test("r7-voice: GET /api/assistant?q= empty -> 400", async () => {
  const r = await req("/api/assistant?q=");
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("r7-voice i18n: H5 448 keys/language, miniprogram 262, voice keys present", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of ["voiceMic", "voiceListening", "voiceUnsupported", "voiceFailed"]) {
    for (const l of data.LANGS)
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  }
  const text = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"),
    "utf8",
  );
  const blocks = {};
  for (const lang of ["zh", "vi", "en"]) {
    const start = text.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const end = text.indexOf("\n  }", start);
    const block = text.slice(start, end);
    blocks[lang] = [
      ...block.matchAll(/^    ([A-Za-z0-9_]+):/gm),
    ].map((m) => m[1]);
  }
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 262, `${lang} key count`);
    for (const k of ["voiceMic", "voiceRecording", "voiceRecordFailed", "voiceNotConnected", "voiceTypeInstead"])
      assert.ok(blocks[lang].includes(k), `${k} missing in mini ${lang}`);
  }
});

test("r7-voice: recognition is client-side only — static code checks", async () => {
  const aiChat = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "AiChat.jsx"),
    "utf8",
  );
  // H5: browser Web Speech API (standard + webkit prefix), mic button,
  // clear failure/unsupported messages.
  assert.ok(aiChat.includes("SpeechRecognition"), "AiChat must use SpeechRecognition");
  assert.ok(aiChat.includes("webkitSpeechRecognition"), "AiChat must fall back to webkitSpeechRecognition");
  assert.ok(aiChat.includes('aria-label={t("voiceMic")}'), "mic button must carry the voiceMic label");
  assert.ok(aiChat.includes("voiceUnsupported"), "AiChat must show the unsupported message");
  assert.ok(aiChat.includes("voiceFailed"), "AiChat must show the failed message");
  // The recognition result fills the input only — it must NEVER auto-send.
  const onresult = aiChat.slice(
    aiChat.indexOf("rec.onresult"),
    aiChat.indexOf("rec.onerror"),
  );
  assert.ok(onresult.length > 0, "AiChat must have a rec.onresult handler");
  assert.ok(onresult.includes("setInput"), "onresult must fill the chat input");
  assert.ok(!onresult.includes("send("), "onresult must never auto-send");
  // Mini-program: recorder only, honest no-provider boundary. The audio
  // is never uploaded and no text is ever fabricated from it.
  const mini = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "pages", "assistant", "assistant.js"),
    "utf8",
  );
  assert.ok(mini.includes("getRecorderManager"), "mini assistant must use wx.getRecorderManager");
  assert.ok(mini.includes("voiceNotConnected"), "mini must show the not-connected notice");
  assert.ok(mini.includes("voiceTypeInstead"), "mini must offer manual text input");
  assert.ok(!mini.includes("uploadFile"), "mini must never upload the recording");
  assert.ok(!/transcript/i.test(mini), "mini must never fabricate a transcript");
});
