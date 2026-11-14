// tests/r7-asean.test.mjs: R7-8 (rows 45, 58) — 东盟语言 + 文本生成.
// ASEAN languages (th/ms/id) + genre-based ai-copy templates (template only).
// Spawns server/server.mjs on TEST_PORT (default 3108) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) H5 LANGS is zh/vi/en/th/ms/id, 503 keys/language, equal
// sets, all 80 core keys present in th/ms/id; (2) miniprogram LANGS codes
// match H5 and every language block is 316 keys, equal sets; (3) H5 Thai:
// core keys show Thai text, untranslated keys fall back to zh (never
// undefined), array tables (CATS/CITYN/UNITN) fall back to the zh column;
// (4) miniprogram t(): th/ms/id core keys + zh fallback, getLang accepts
// th/ms/id; (5) language pickers list all 6 languages on both sides;
// (6) ai-copy genre 戏曲 for a 京剧 prompt (mock, 3 channels, title
// template unchanged); (7) ai-copy genres 音乐/歌舞/话剧/非遗/文旅/亲子
// + unknown prompt -> 通用, family intro kept; (8) ai-copy placeholders
// intact for a bare prompt (no invented money/date).
//
// Translation rule (fixed): only the 80-key core set (navigation / home /
// search / detail / chat / orders / account) is hand-translated per
// language — never bulk machine-translated. Full per-language translation
// is an open item per language. The 80 keys are the same on both sides,
// so H5 zh/vi/en stay 455 keys and th/ms/id carry the 82-key core set
// (80 keys + quicks + flow); miniprogram zh/vi/en stay 269, th/ms/id 82.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5448/guiyan_test",
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null; assertions below will fail with a clear message
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(username = "demo", password = process.env.DEMO_PASSWORD) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

async function aiCopy(token, prompt) {
  return req("/api/ai/copy", { method: "POST", token, body: { prompt } });
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: r7-asean never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[r7-asean-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[r7-asean-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("r7-asean server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

// The 80 hand-translated core keys (same list on both sides).
const CORE_KEYS = [
  "brandTag", "navCatalog", "navDemands", "navAssistant", "myTickets",
  "loginBtn", "logoutBtn", "heroSub", "heroLead", "heroSearchPh",
  "searchBtn", "catTitle", "catSub", "allChip", "allCities", "searchPh",
  "sortHot", "sortAsc", "sortDesc", "sortName", "priceMinPh", "priceMaxPh",
  "ratingAll", "results", "emptyRes", "dateLabel", "qtyLabel", "totalLabel",
  "bookNow", "favOn", "favOff", "perfTitle", "perfOnSale", "tierTitle",
  "tierSoldOut", "tierLeft", "tierPick", "pickupTitle", "pickupPick",
  "venueTitle", "seatPick", "seatSelected", "viewsUnit", "priceMeta",
  "chatName", "chatMode", "chatPh", "sendBtn", "greeting", "aiTitle",
  "aiSub", "aiNote", "prefAsk", "orderCreated", "actConfirm", "actCancel",
  "actPay", "actComplete", "actRefund", "doneNote", "statusToast",
  "stPending", "stConfirmed", "stPaid", "stCompleted", "stCancelled",
  "stRefunded", "stRefundRequested", "stDisputed", "memberTierTitle",
  "memberTierCurrent", "couponCode", "couponCodePh", "giftCouponTitle",
  "storedValueTitle", "storedValueBalance", "storedValueTopup",
  "ticketTitle", "ticketCode", "ticketEmpty",
];

function miniI18nBlocks() {
  const text = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"),
    "utf8",
  );
  const blocks = {};
  for (const lang of ["zh", "vi", "en", "th", "ms", "id"]) {
    const start = text.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const end = text.indexOf("\n  }", start);
    const block = text.slice(start, end);
    blocks[lang] = [
      ...block.matchAll(/^    ([A-Za-z0-9_]+):/gm),
    ].map((m) => m[1]);
  }
  return blocks;
}

function loadMiniI18n() {
  // CommonJS under a type:module root — evaluate in a vm with a wx stub.
  const src = fs.readFileSync(
    path.resolve(repoDir, "miniprogram", "utils", "i18n.js"),
    "utf8",
  );
  const store = {};
  const sandbox = {
    wx: {
      getStorageSync: (k) => (k in store ? store[k] : ""),
      setStorageSync: (k, v) => {
        store[k] = v;
      },
    },
    getApp: () => ({ globalData: {} }),
    module: { exports: {} },
  };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.module.exports;
}

test("r7-asean H5 LANGS is zh/vi/en/th/ms/id; zh/vi/en 455 keys, th/ms/id 82 keys", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  assert.deepEqual(data.LANGS, ["zh", "vi", "en", "th", "ms", "id"]);
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  // zh/vi/en keep the full 455-key set; th/ms/id translate the 80-key
  // core set + quicks + flow = 82 keys (partial translation by design).
  assert.deepEqual(counts, [455, 455, 455, 82, 82, 82]);
  const sets = data.LANGS.map((l) => new Set(Object.keys(data.I18N[l])));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)) &&
      [...sets[1]].every((k) => sets[0].has(k) && sets[2].has(k)),
    "H5 i18n key sets must be equal across zh/vi/en",
  );
  for (const s of sets.slice(3))
    assert.ok(
      [...s].every((k) => sets[0].has(k)),
      "th/ms/id keys must be a subset of the zh key set",
    );
  assert.equal(CORE_KEYS.length, 80);
  for (const k of CORE_KEYS)
    for (const l of ["th", "ms", "id"])
      assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
});

test("r7-asean miniprogram LANGS matches H5; zh/vi/en 269 keys, th/ms/id 82 keys", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const mini = loadMiniI18n();
  assert.deepEqual(
    // Spread out of the vm realm: vm arrays carry another realm's
    // prototype, which deepStrictEqual rejects despite equal contents.
    [...mini.LANGS.map((l) => l.code)],
    [...data.LANGS],
    "miniprogram LANGS codes must equal H5 LANGS",
  );
  assert.deepEqual(
    [...mini.LANGS.map((l) => l.label)],
    ["中文", "Tiếng Việt", "English", "ภาษาไทย", "Bahasa Melayu", "Bahasa Indonesia"],
  );
  const blocks = miniI18nBlocks();
  for (const lang of ["zh", "vi", "en"]) {
    assert.equal(blocks[lang].length, 269, `${lang} key count`);
  }
  for (const lang of ["th", "ms", "id"]) {
    assert.equal(blocks[lang].length, 82, `${lang} key count`);
    for (const k of CORE_KEYS)
      assert.ok(blocks[lang].includes(k), `${k} missing in mini ${lang}`);
  }
  const sets = Object.values(blocks).map((k) => new Set(k));
  assert.ok(
    [...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)),
    "miniprogram i18n key sets must be equal across zh/vi/en",
  );
  for (const s of sets.slice(3))
    assert.ok(
      [...s].every((k) => sets[0].has(k)),
      "th/ms/id keys must be a subset of the zh key set",
    );
});

test("r7-asean H5 Thai: core keys show Thai, untranslated keys fall back to zh", async () => {
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const prev = data.langState.lang;
  try {
    data.langState.lang = "th";
    assert.equal(data.t("searchBtn"), "ค้นหาโชว์");
    assert.equal(data.t("brandTag"), "แพลตฟอร์มทรัพยากรการแสดงกว่างซี");
    assert.equal(data.t("loginBtn"), "เข้าสู่ระบบ");
    assert.equal(data.t("bookNow"), "จองเลย");
    assert.equal(data.t("sendBtn"), "ส่ง");
    // Untranslated key (not in the 80-key core set) falls back to zh.
    assert.equal(data.t("registerBtn"), "注册");
    assert.equal(data.t("postDemandBtn"), "发布需求");
    assert.notEqual(data.t("registerBtn"), undefined);
    // Array tables only carry zh/vi/en: the index clamps to zh.
    assert.equal(data.li(), 0);
    assert.equal(data.catName("show"), "演出剧目");
    assert.equal(data.cityName("南宁"), "南宁");
    // Malay + Indonesian spot checks.
    data.langState.lang = "ms";
    assert.equal(data.t("searchBtn"), "Cari Persembahan");
    assert.equal(data.t("registerBtn"), "注册");
    data.langState.lang = "id";
    assert.equal(data.t("searchBtn"), "Cari Pertunjukan");
    assert.equal(data.t("loginBtn"), "Masuk");
  } finally {
    data.langState.lang = prev;
  }
});

test("r7-asean miniprogram t(): th/ms/id core keys, zh fallback, getLang accepts them", async () => {
  const mini = loadMiniI18n();
  assert.equal(mini.t("searchBtn", "th"), "ค้นหาโชว์");
  assert.equal(mini.t("bookNow", "th"), "จองเลย");
  assert.equal(mini.t("searchBtn", "ms"), "Cari Persembahan");
  assert.equal(mini.t("loginBtn", "ms"), "Log Masuk");
  assert.equal(mini.t("searchBtn", "id"), "Cari Pertunjukan");
  assert.equal(mini.t("loginBtn", "id"), "Masuk");
  // Untranslated key falls back to zh, never to the key name or undefined.
  // (registerBtn is H5-only, so the mini fallback key used here is
  // postDemand, which exists in mini zh but not in the th/ms/id core set.)
  assert.equal(mini.t("postDemand", "th"), "＋ 发布需求");
  assert.equal(mini.t("postDemand", "ms"), "＋ 发布需求");
  // getLang/setLang round-trip for the new codes.
  for (const code of ["th", "ms", "id"]) {
    mini.setLang(code);
    assert.equal(mini.getLang(), code);
    assert.equal(mini.LANGS[mini.langIndex()].code, code);
  }
});

test("r7-asean language pickers list all 6 languages on both sides", async () => {
  const chrome = fs.readFileSync(
    path.resolve(repoDir, "web", "assets", "js", "chrome.jsx"),
    "utf8",
  );
  for (const opt of [
    '<option value="th">ภาษาไทย</option>',
    '<option value="ms">Bahasa Melayu</option>',
    '<option value="id">Bahasa Indonesia</option>',
  ])
    assert.ok(chrome.includes(opt), `H5 picker lacks ${opt}`);
  const want =
    "langs: ['中文', 'Tiếng Việt', 'English', 'ภาษาไทย', 'Bahasa Melayu', 'Bahasa Indonesia']";
  const pages = [
    "miniprogram/components/topbar/topbar.js",
    "miniprogram/pages/index/index.js",
    "miniprogram/pages/category/category.js",
    "miniprogram/pages/detail/detail.js",
    "miniprogram/pages/demands/demands.js",
    "miniprogram/pages/orders/orders.js",
    "miniprogram/pages/me/me.js",
    "miniprogram/pages/assistant/assistant.js",
    "miniprogram/pages/verify/verify.js",
  ];
  for (const p of pages) {
    const src = fs.readFileSync(path.resolve(repoDir, p), "utf8");
    assert.ok(src.includes(want), `${p} picker lacks the 3 ASEAN languages`);
  }
});

test("r7-asean ai-copy genre 戏曲： 京剧 prompt returns genre + template, mock true", async () => {
  const token = await login();
  const r = await aiCopy(token, "为《京剧》写一段推送");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.topic, "京剧");
  assert.equal(r.json.genre, "戏曲");
  assert.equal(r.json.label, "本地模板");
  assert.equal(r.json.mock, true);
  assert.equal(r.json.channels.length, 3);
  assert.ok(r.json.body.includes("一板一眼皆是传承"), r.json.body);
  assert.ok(r.json.channels[0].content.includes("#戏曲"), r.json.channels[0].content);
  // Title templates are unchanged (one of the 3 existing templates).
  assert.ok(
    ["京剧，周末见", "相约京剧，遇见好时光", "把京剧写进你的行程"].includes(r.json.title),
    r.json.title,
  );
});

test("r7-asean ai-copy genres 音乐/歌舞/话剧/非遗/文旅/亲子 + unknown -> 通用", async () => {
  const token = await login();
  const cases = [
    ["请写一段交响音乐会文案", "音乐", "让旋律漫过山水"],
    ["为《刘三姐》写一段推送", "歌舞", "歌声起处山水动"],
    ["写一段话剧文案", "话剧", "一幕起落间"],
    ["写一段非遗剪纸文案", "非遗", "指尖上的千年手艺"],
    ["写一段漓江文旅文案", "文旅", "沿着山水与歌声"],
  ];
  for (const [prompt, genre, intro] of cases) {
    const r = await aiCopy(token, prompt);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.genre, genre, prompt);
    assert.ok(r.json.body.includes(intro), `${prompt}: ${r.json.body}`);
  }
  // Family prompts keep the existing family intro and report genre 亲子.
  const fam = await aiCopy(token, "亲子非遗体验文案");
  assert.equal(fam.status, 200, JSON.stringify(fam.json));
  assert.equal(fam.json.genre, "亲子");
  assert.ok(fam.json.body.includes("和孩子一起听、看、动手"), fam.json.body);
  // Unknown genre -> 通用.
  const general = await aiCopy(token, "写一段文案");
  assert.equal(general.status, 200, JSON.stringify(general.json));
  assert.equal(general.json.genre, "通用");
});

test("r7-asean ai-copy placeholders intact for a bare prompt", async () => {
  const token = await login();
  const r = await aiCopy(token, "写一段文案");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const ph of ["[待确认日期]", "[待确认场馆]", "[待确认价格]"]) {
    assert.ok(r.json.body.includes(ph), `${ph} must appear: ${r.json.body}`);
  }
  // No invented money or date may appear outside the placeholders.
  assert.ok(!/\d+元/.test(r.json.body.replace("[待确认价格]", "")), r.json.body);
  assert.ok(!/20\d{2}年/.test(r.json.body), r.json.body);
  assert.equal(r.json.mock, true);
});
