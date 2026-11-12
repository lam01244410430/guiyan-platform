// Guiyan Wave 3 tests (rule-based, no LLM) — run against a REAL
// PostgreSQL 16, never a mock. Same harness shape as
// tests/api-pg.test.mjs: spawn server/server.mjs on TEST_PORT (default
// 3103) and talk to it over HTTP. DATABASE_URL must point at a FRESH,
// disposable database (the server seeds 62 resources + demo users on
// first boot). Do not point it at any shared or production database.
//
// The wave3 server is spawned with AI_CHAT_URL pointed at a dead port:
// no wave3 test calls the real trial backend (operator answers bypass
// it), and any accidental non-operator chat call fails open to rules.
//
// Run order inside `npm test`: api-pg.test.mjs runs BEFORE this file, so
// wave3 tests must never assert exact seed counts for orders/users —
// earlier tests create orders and register users. Compute expectations
// from the live database (via the API) instead.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
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

const PORT = Number(process.env.TEST_PORT || 3103);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);

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

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

before(async () => {
  proc = spawn("node", ["server.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(PORT),
      // Dead port on purpose: wave3 never calls the trial backend.
      AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
      AI_CHAT_TIMEOUT_MS: "200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stderr.write(`[wave3-server] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[wave3-server:err] ${d}`));
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await req("/api/health");
      if (r.status === 200 && r.json?.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error("wave3 server did not become healthy within 60s");
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

// --- #11a: real view recording -------------------------------------------

test("wave3 #11a: POST /api/resources/:id/view records a real view (anonymous)", async () => {
  const before = await req("/api/resources/1");
  assert.equal(before.status, 200);
  const viewsBefore = before.json.resource.views;
  const v = await req("/api/resources/1/view", { method: "POST" });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.ok, true);
  const after = await req("/api/resources/1");
  assert.equal(after.status, 200);
  assert.equal(after.json.resource.views, viewsBefore + 1);
});

test("wave3 #11a: view on a missing resource is 404 and records nothing", async () => {
  const r = await req("/api/resources/999999/view", { method: "POST" });
  assert.equal(r.status, 404);
});

test("wave3 #11a: a logged-in view also increments views by exactly 1", async () => {
  const token = await login();
  const before = await req("/api/resources/2");
  assert.equal(before.status, 200);
  const v = await req("/api/resources/2/view", { method: "POST", token });
  assert.equal(v.status, 200);
  const after = await req("/api/resources/2");
  assert.equal(after.json.resource.views, before.json.resource.views + 1);
});

// --- #9: tags (read path; rule-mutation tests run last in this file) ----

test("wave3 #9: GET /api/admin/tag-rules returns the 4 default rules", async () => {
  const admin = await adminLogin();
  const r = await req("/api/admin/tag-rules", { token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tagRules.length, 4);
  assert.deepEqual(
    r.json.tagRules.map((x) => x.id),
    ["high", "potential", "silent", "heritage"],
  );
  const heritage = r.json.tagRules.find((x) => x.id === "heritage");
  assert.ok(heritage.conditions.some((c) => c.field === "view_category" && c.op === "eq" && c.value === "heritage"));
  // Money thresholds are stored in 分 (cents): high = ¥10,000.
  assert.equal(r.json.tagRules.find((x) => x.id === "high").conditions[0].value, 1000000);
  const demo = await login();
  assert.equal((await req("/api/admin/tag-rules", { token: demo })).status, 403);
  assert.equal((await req("/api/admin/tag-rules")).status, 403);
});

test("wave3 #9: GET /api/admin/users carries tags[] and no password", async () => {
  const admin = await adminLogin();
  const r = await req("/api/admin/users", { token: admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.users.length >= 139);
  for (const u of r.json.users) {
    assert.ok(Array.isArray(u.tags), `user ${u.id} must have tags[]`);
    assert.equal(u.password, undefined);
  }
  // Demo (id 2) has paid orders by now (api-pg happy-path ran first), so
  // the default tags apply: 已付费 (and 体验用户, not 高价值/潜力会员).
  const demoUser = r.json.users.find((u) => u.id === 2);
  assert.ok(demoUser, "demo user id 2 must be listed");
  assert.ok(demoUser.tags.includes("已付费"), JSON.stringify(demoUser.tags));
  // Some user never paid (seed: every 10th new user has 0 orders; the
  // api-pg registration tests also create order-less users).
  assert.ok(r.json.users.some((u) => u.tags.includes("新用户")));
});

test("wave3 #9: GET /api/admin/users?tag= filters server-side", async () => {
  const admin = await adminLogin();
  const paid = await req("/api/admin/users?tag=" + encodeURIComponent("已付费"), { token: admin });
  assert.equal(paid.status, 200);
  assert.ok(paid.json.users.length > 0);
  assert.ok(paid.json.users.every((u) => u.tags.includes("已付费")));
  const fresh = await req("/api/admin/users?tag=" + encodeURIComponent("新用户"), { token: admin });
  assert.equal(fresh.status, 200);
  assert.ok(fresh.json.users.length > 0);
  assert.ok(fresh.json.users.every((u) => u.tags.includes("新用户")));
  const none = await req("/api/admin/users?tag=" + encodeURIComponent("不存在的标签"), { token: admin });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.users, []);
});

// --- #11b: portrait + recommendations ------------------------------------

const PAID = ["paid", "completed", "disputed", "refund_requested"];

test("wave3 #11b: GET /api/profile needs login and matches the demo's real orders", async () => {
  assert.equal((await req("/api/profile")).status, 401);
  const token = await login();
  const r = await req("/api/profile", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.profile;
  assert.ok(p, "profile must be present");
  assert.equal(p.id, 2, "profile must be the logged-in user (demo id 2)");
  assert.equal(p.password, undefined, "password hash must never leak");
  assert.ok(Array.isArray(p.tags));
  // New 5-group portrait shape (2026-11-12 甲方 update) — exactly these
  // groups, no flat fields in parallel.
  assert.deepEqual(Object.keys(p.portrait).sort(), [
    "basic",
    "behavior",
    "channel",
    "showPref",
    "spending",
  ]);
  assert.equal(p.portrait.pricePreference, undefined);
  assert.equal(p.portrait.balance, undefined);
  assert.equal(p.portrait.payment, undefined);
  assert.equal(p.portrait.purchaseWindow, undefined);
  // 基础属性: demo seed is age 23, 女, 南宁 (server/seed.mjs).
  assert.equal(p.portrait.basic.age, 23);
  assert.equal(p.portrait.basic.gender, "女");
  // 区域 = users.city: Lam has no separate region column.
  assert.equal(p.portrait.basic.region, "南宁");
  // Recompute from the demo's live orders (api-pg tests created some, so
  // seed counts are not asserted — only the formula is).
  const orders = (await req("/api/orders", { token })).json.orders;
  const paid = orders.filter((o) => PAID.includes(o.status));
  const spent = paid.reduce((n, o) => n + o.amount, 0);
  assert.equal(p.paid_count, paid.length);
  assert.equal(p.spent, spent);
  const published = (await req("/api/resources")).json.resources;
  const byId = new Map(published.map((x) => [x.id, x]));
  // 活跃城市: city of the demo's paid orders, most frequent first.
  // Ties are possible (demo's paid orders split across cities) and the
  // server keeps the first in id order — assert membership in the tied
  // top set, not one arbitrary city.
  const cityCounts = new Map();
  for (const o of paid) {
    const c = byId.get(o.resource_id)?.city;
    if (c) cityCounts.set(c, (cityCounts.get(c) || 0) + 1);
  }
  const maxN = Math.max(0, ...cityCounts.values());
  const topCities = [...cityCounts].filter(([, n]) => n === maxN).map(([c]) => c);
  if (paid.length) assert.ok(topCities.includes(p.portrait.basic.activeCity));
  // 消费能力.
  assert.equal(
    p.portrait.spending.pricePreference,
    paid.length ? Math.round(spent / paid.length) : 0,
  );
  assert.deepEqual(p.portrait.spending.frequency, {
    paidCount: paid.length,
    orderCount: orders.length,
  });
  // 储值情况 TBD: no stored-value system — never a balance.
  assert.equal(p.portrait.spending.balance, null);
  assert.equal(p.portrait.spending.storedValue, "尚未接入");
  // 观演偏好: the only meta.genre value anywhere in the seed is 民族歌舞
  // (22 original resources; the 40 catalog rows carry no genre), so a
  // demo with any genre interaction has exactly that genre.
  const paidGenres = paid
    .map((o) => byId.get(o.resource_id)?.meta?.genre)
    .filter(Boolean);
  assert.equal(
    p.portrait.showPref.genre,
    paidGenres.length ? "民族歌舞" : "暂无",
  );
  assert.equal(typeof p.portrait.showPref.artist, "string");
  assert.ok(p.portrait.showPref.artist.length > 0);
  assert.equal(typeof p.portrait.showPref.venue, "string");
  assert.ok(p.portrait.showPref.venue.length > 0);
  assert.equal(typeof p.portrait.showPref.showType, "string");
  if (paid.length) assert.notEqual(p.portrait.showPref.showType, "暂无");
  // 行为偏好.
  if (paid.length) {
    const last = paid.map((o) => o.created_at).sort().at(-1);
    const hhmm = new Date(new Date(last).getTime() + 8 * 3600000)
      .toISOString()
      .slice(11, 16);
    assert.equal(p.portrait.behavior.purchaseWindow, hhmm);
    assert.equal(
      p.portrait.behavior.repeat,
      paid.length > 1 ? "有复购" : "暂无复购",
    );
  }
  assert.equal(p.portrait.behavior.payment, "模拟支付");
  // 分享行为 TBD: Lam records no shares.
  assert.equal(p.portrait.behavior.sharing, "暂无数据");
  // 渠道来源 (Q13 proposed map): demo's users.channel is H5 -> 自然流量.
  assert.equal(p.portrait.channel.source, "自然流量");
  assert.equal(typeof p.suggestion, "string");
  assert.ok(p.suggestion.length > 0);
});

test("wave3 #11b: real view events feed view_count and view_category", async () => {
  const token = await login();
  const before = (await req("/api/profile", { token })).json.profile;
  const res2 = (await req("/api/resources/2")).json.resource;
  await req("/api/resources/2/view", { method: "POST", token });
  await req("/api/resources/2/view", { method: "POST", token });
  const after = (await req("/api/profile", { token })).json.profile;
  assert.equal(after.view_count, before.view_count + 2);
  assert.ok(after.view_category.includes(res2.category));
});

test("wave3 #11b: artist fallback (B-026) — a user who only interacted with an artist resource names it as 艺人", async () => {
  // Fresh user with no orders: favorite the only artist-category
  // resource (青年山歌演唱组合, id 5), which carries no meta.team.
  // Plan §4.4a: 艺人 falls back to the most-interacted artist resource.
  const res5 = (await req("/api/resources/5")).json.resource;
  assert.equal(res5.category, "artist");
  const uname = "wave3artist" + Date.now().toString(36);
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { username: uname, password: "guiyan2026", name: "画像测试" },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  const token = reg.json.token;
  const fav = await req("/api/favorites", {
    method: "POST",
    token,
    body: { resourceId: 5 },
  });
  assert.equal(fav.status, 200, JSON.stringify(fav.json));
  assert.equal(fav.json.favorite, true);
  const profile = (await req("/api/profile", { token })).json.profile;
  assert.equal(profile.portrait.showPref.artist, "青年山歌演唱组合");
  assert.equal(profile.portrait.showPref.genre, "暂无");
});

test("wave3 #11b: GET /api/recommendations scores, sorts and embeds resources", async () => {
  const token = await login();
  const r = await req("/api/recommendations", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const recs = r.json.recommendations;
  assert.equal(recs.length, 10, "default limit is 10");
  const published = (await req("/api/resources")).json.resources;
  const byId = new Map(published.map((x) => [x.id, x]));
  for (const rec of recs) {
    assert.ok(byId.has(rec.resourceId), "only published resources");
    assert.equal(typeof rec.score, "number");
    assert.equal(typeof rec.reason, "string");
    assert.ok(rec.reason.length > 0);
    assert.equal(rec.resource.id, rec.resourceId);
    assert.equal(rec.resource.name, byId.get(rec.resourceId).name);
    assert.equal(rec.resource.price, byId.get(rec.resourceId).price);
  }
  for (let i = 1; i < recs.length; i++) {
    assert.ok(
      recs[i].score < recs[i - 1].score ||
        (recs[i].score === recs[i - 1].score &&
          recs[i].resourceId > recs[i - 1].resourceId),
      "score desc, then resourceId asc",
    );
  }
  // A show the demo actually paid for scores >= 8 (purchase) and its
  // reason names the purchase signal. (Demo prefers shows, so a bought
  // show scores preference +20 and purchase +8 — safely in the top 10;
  // a bought non-show at +8 alone might fall outside it.)
  const orders = (await req("/api/orders", { token })).json.orders;
  const paid = orders.filter((o) => PAID.includes(o.status));
  assert.ok(paid.length > 0, "demo must have a paid order for this check");
  const boughtShow = paid.find((o) => byId.get(o.resource_id)?.category === "show");
  assert.ok(boughtShow, "demo must have a paid show order for this check");
  const bought = recs.find((x) => x.resourceId === boughtShow.resource_id);
  assert.ok(bought, "bought show must be recommended");
  assert.ok(bought.score >= 8, JSON.stringify(bought));
  assert.ok(bought.reason.includes("购买"), bought.reason);
  // Preference match is always +20: every recommended resource in the
  // demo's preference category scores at least 20.
  const profile = (await req("/api/profile", { token })).json.profile;
  for (const rec of recs.filter((x) => x.resource.category === profile.preference)) {
    assert.ok(rec.score >= 20, JSON.stringify(rec));
    assert.ok(rec.reason.includes("符合你的兴趣偏好"), rec.reason);
    // The reason names the matched portrait dimension (演出类型/观演偏好).
    assert.ok(rec.reason.includes("演出类型/观演偏好"), rec.reason);
  }
  // Reason names the matched dimension: same city -> 活跃城市/区域.
  // The bought show (刘三姐/壮乡情) is in 南宁, the demo's city.
  assert.ok(
    recs.some((x) => x.reason.includes("活跃城市/区域")),
    "at least one same-city recommendation must name 活跃城市/区域",
  );
  // Same meta.genre -> 剧种: the bought show carries the demo's top
  // genre (民族歌舞, the only genre value in the seed), so its reason
  // must name it. Same meta.team -> 艺人: scan the top 10 for any
  // resource carrying the demo's top artist.
  assert.ok(bought.reason.includes("剧种"), bought.reason);
  const topArtist = profile.portrait.showPref.artist;
  if (topArtist !== "暂无") {
    let artistNamed = false;
    for (const x of recs) {
      const detail = (await req("/api/resources/" + x.resourceId)).json.resource;
      if (detail?.meta?.team === topArtist && x.reason.includes("艺人")) {
        artistNamed = true;
        break;
      }
    }
    assert.ok(artistNamed, "at least one recommendation must name the top 艺人");
  }
  // limit clamps: 3 -> 3 items, 99 -> 20 max.
  assert.equal((await req("/api/recommendations?limit=3", { token })).json.recommendations.length, 3);
  assert.equal((await req("/api/recommendations?limit=99", { token })).json.recommendations.length, 20);
});

test("wave3 #11b: recommendations userId gate (demo 403, admin 200, anon 401)", async () => {
  assert.equal((await req("/api/recommendations")).status, 401);
  const demo = await login();
  assert.equal(
    (await req("/api/recommendations?userId=4", { token: demo })).status,
    403,
  );
  const admin = await adminLogin();
  const ok = await req("/api/recommendations?userId=4", { token: admin });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(Array.isArray(ok.json.recommendations));
  const missing = await req("/api/recommendations?userId=999999", { token: admin });
  assert.equal(missing.status, 404);
});

test("wave3 i18n: 335 keys in zh/vi/en with equal sets (323 account-tabs + 8 OTP keys + 3 B-037 tab keys + 1 login lock key)", async () => {
  const data = await import(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "web",
      "assets",
      "js",
      "data.js",
    )
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [335, 335, 335]);
  for (const k of ["profileTitle", "profileBasic", "profileSpending", "profileShowPref", "profileBehavior", "profileChannel", "profileAge", "profileGender", "profileRegion", "profileRegionNote", "profileActiveCity", "profilePricePref", "profilePriceBand", "profileFrequency", "profileFrequencyValue", "profileStoredValue", "profileGenre", "profileArtist", "profileVenue", "profileShowType", "profileTimeSlot", "profileTimeNote", "profilePayment", "profileSharing", "profileRepeat", "profileSource", "profileSuggestion", "recTitle", "recScore", "availLeft", "availBooked", "availFree", "availService", "seatTitle", "seatNote", "bookedDates", "metaTitle", "metaDuration", "metaTeam", "metaGenre", "metaExperience", "metaAgency", "metaProcess", "metaAddress", "metaFacilities", "metaModel", "metaDeposit", "metaUsage", "metaScope", "metaTerm", "metaTerritory", "metaRights", "metaCertificate", "metaSpecification", "metaShipping", "metaPlayback", "metaIncludes", "metaPartner", "metaKind", "metaChannels", "metaServiceNote", "lightTitle", "lightNote", "lightRotate", "lightColor", "digiStart", "digiPause", "digiNote", "contractBtn", "contractDownload", "stRefundRequested", "stDisputed", "actDispute", "refundReasonPh", "refundWaiting", "disputeWaiting", "refundReasonLbl", "refundDecisionLbl", "priceMinPh", "priceMaxPh", "ratingAll", "rating4", "rating45", "inboxTitle", "inboxEmpty", "inboxMarkAll", "admResAdd", "admResEdit", "admResPublish", "admResUnpublish", "admResSync", "admResLastSync", "admResSyncResult", "admResName", "admResCategory", "admResCity", "admResPrice", "admResUnit", "admResDesc", "admResImage", "admResStock", "admResCapacity", "admResStatus", "admResSave", "admResCancel", "admResSaved", "tabInfo", "ordSearchPh", "ordColCode", "ordColDate", "ordColQty", "ordColAmount", "ordColActions", "profEditTitle", "avatarTitle", "avatarChange", "avatarHint", "avatarBadType", "avatarTooBig", "lblId", "lblCreated", "genderMale", "genderFemale", "genderNone", "tabPassword", "pwCurrent", "pwNew", "pwConfirm", "pwMismatch", "tabEmail", "emailCurrent", "emailNew", "emailNone", "tabSocial", "socialNote", "socDouyin", "socWechat", "socXiaohongshu", "tabPhone", "phoneCurrent", "phoneNew", "phoneNone", "otpSend", "otpCode", "otpCodePh", "otpDemoNote", "loginLocked"]) {
    for (const l of data.LANGS) assert.ok(k in data.I18N[l], `${k} missing in ${l}`);
  }
});

// --- #8: assistant operator + support ------------------------------------

test("wave3 #8: GET /api/assistant?q=我的订单 anonymous asks to log in", async () => {
  const r = await req("/api/assistant?q=" + encodeURIComponent("我的订单"));
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myOrders");
  assert.ok(r.json.answer.includes("请先登录"));
  assert.equal(r.json.items, undefined);
});

test("wave3 #8: logged-in user sees their real orders via myOrders", async () => {
  const token = await login();
  const mine = (await req("/api/orders", { token })).json.orders;
  assert.ok(mine.length > 0, "demo must have orders for this check");
  const r = await req("/api/assistant?q=" + encodeURIComponent("我的订单"), { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myOrders");
  assert.equal(r.json.items.length, Math.min(5, mine.length));
  assert.deepEqual(
    r.json.items.map((o) => o.code),
    mine.slice(0, 5).map((o) => o.code),
  );
  for (const item of r.json.items) {
    assert.equal(typeof item.resource_name, "string");
    assert.equal(typeof item.status, "string");
    assert.equal(typeof item.amount, "number");
  }
});

test("wave3 #8: myRefund groups by Lam's real statuses, never the zhou-only ones", async () => {
  const token = await login();
  const mine = (await req("/api/orders", { token })).json.orders;
  const r = await req("/api/assistant?q=" + encodeURIComponent("怎么退款"), { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, "myRefund");
  assert.ok(!r.json.answer.includes("refund_requested"), r.json.answer);
  assert.ok(!r.json.answer.includes("disputed"), r.json.answer);
  assert.ok(r.json.answer.includes("改签需先联系资源方确认档期"), r.json.answer);
  // Any paid/completed order code the demo holds must be listed.
  const refundable = mine.filter((o) => ["paid", "completed"].includes(o.status));
  assert.ok(refundable.length > 0, "demo must hold a paid/completed order");
  assert.ok(r.json.answer.includes(refundable[0].code), r.json.answer);
});

test("wave3 #8: operator via POST chat is admin-only and reads real analysis", async () => {
  const admin = await adminLogin();
  const analysis = (await req("/api/admin/analysis?period=day", { token: admin })).json;
  const sales = await req("/api/assistant/chat", {
    method: "POST",
    token: admin,
    body: { message: "今日销量", kind: "operator" },
  });
  assert.equal(sales.status, 200, JSON.stringify(sales.json));
  assert.equal(sales.json.source, "rules");
  assert.equal(sales.json.mock, true);
  assert.equal(sales.json.kind, "operator");
  assert.ok(sales.json.reply.includes("交易概览"), sales.json.reply);
  assert.ok(
    sales.json.reply.includes("¥" + (analysis.kpis.revenue / 100).toString()),
    sales.json.reply,
  );
  const demo = await login();
  assert.equal(
    (await req("/api/assistant/chat", { method: "POST", token: demo, body: { message: "今日销量", kind: "operator" } })).status,
    403,
  );
  assert.equal(
    (await req("/api/assistant/chat", { method: "POST", body: { message: "今日销量", kind: "operator" } })).status,
    403,
  );
});

test("wave3 #8: operator answers all 8 dimensions from real data", async () => {
  const admin = await adminLogin();
  const analysis = (await req("/api/admin/analysis?period=day", { token: admin })).json;
  const cases = [
    ["生成经营报告", "模拟经营分析报告"],
    ["场馆表现", analysis.venues[0].name],
    ["场馆表现", "档期占用"],
    ["用户增长", "用户情况"],
    ["渠道来源", "渠道分析"],
    ["库存预警", "预警提醒"],
    ["热销排行", "热销TOP5"],
    ["运营建议", "运营建议"],
  ];
  for (const [message, marker] of cases) {
    const r = await req("/api/assistant/chat", {
      method: "POST",
      token: admin,
      body: { message, kind: "operator" },
    });
    assert.equal(r.status, 200, JSON.stringify({ message, r }));
    assert.equal(r.json.kind, "operator");
    assert.ok(r.json.reply.startsWith("【本地规则分析，未接入大模型】"), r.json.reply);
    assert.ok(r.json.reply.includes(marker), `${message} must mention ${marker}`);
  }
  // The report answer carries the full report text.
  const report = await req("/api/assistant/chat", {
    method: "POST",
    token: admin,
    body: { message: "生成经营报告", kind: "operator" },
  });
  assert.ok(report.json.reply.includes(analysis.report.slice(0, 60)), "report text must match analysis.report");
  // GET can never reach the operator branch (Q2): a sales question over
  // the public endpoint falls through to the public rules.
  const get = await req("/api/assistant?q=" + encodeURIComponent("今日销量"));
  assert.equal(get.status, 200);
  assert.notEqual(get.json.kind, "operator");
});

// --- #10: AIGC copy template ----------------------------------------------

test("wave3 #10: POST /api/ai/copy needs login and returns 3 channel versions", async () => {
  assert.equal(
    (await req("/api/ai/copy", { method: "POST", body: { prompt: "为《刘三姐》写一段推送" } })).status,
    401,
  );
  const token = await login();
  const r = await req("/api/ai/copy", {
    method: "POST",
    token,
    body: { prompt: "为《刘三姐》写一段推送" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.topic, "刘三姐");
  assert.equal(r.json.label, "本地模板");
  assert.equal(r.json.mock, true);
  assert.equal(r.json.channels.length, 3);
  assert.deepEqual(
    r.json.channels.map((c) => c.name),
    ["小红书版", "公众号版", "短信版"],
  );
  assert.ok(r.json.answer.includes("【本地多渠道模板草稿，未接入大模型】"));
  assert.equal(typeof r.json.title, "string");
  assert.ok(r.json.title.includes("刘三姐"));
  assert.equal(typeof r.json.body, "string");
  assert.ok(Array.isArray(r.json.notes) && r.json.notes.length === 2);
  // Title is one of zhou's 3 random templates (Q6: random kept).
  assert.ok(
    [
      "刘三姐，周末见",
      "相约刘三姐，遇见好时光",
      "把刘三姐写进你的行程",
    ].includes(r.json.title),
    r.json.title,
  );
});

test("wave3 #10: copy with full facts uses them, without facts uses placeholders only", async () => {
  const token = await login();
  const full = await req("/api/ai/copy", {
    method: "POST",
    token,
    body: { prompt: "《刘三姐》2026年12月21日，地点：南宁剧场，票价280元" },
  });
  assert.equal(full.status, 200);
  assert.ok(full.json.body.includes("2026年12月21日"), full.json.body);
  assert.ok(full.json.body.includes("南宁剧场"), full.json.body);
  assert.ok(full.json.body.includes("280元"), full.json.body);
  assert.ok(!full.json.body.includes("[待确认"), full.json.body);
  const bare = await req("/api/ai/copy", {
    method: "POST",
    token,
    body: { prompt: "写一段山歌文案" },
  });
  assert.equal(bare.status, 200);
  for (const ph of ["[待确认日期]", "[待确认场馆]", "[待确认价格]"]) {
    assert.ok(bare.json.body.includes(ph), `${ph} must appear: ${bare.json.body}`);
  }
  // No invented money or date may appear outside the placeholders.
  assert.ok(!/\d+元/.test(bare.json.body.replace("[待确认价格]", "")), bare.json.body);
  assert.ok(!/20\d{2}年/.test(bare.json.body), bare.json.body);
});

test("wave3 #10: family intro for 亲子 prompts; prompt validation 400s", async () => {
  const token = await login();
  const fam = await req("/api/ai/copy", {
    method: "POST",
    token,
    body: { prompt: "亲子非遗体验文案" },
  });
  assert.equal(fam.status, 200);
  assert.ok(fam.json.body.includes("和孩子一起听、看、动手"), fam.json.body);
  for (const bad of [{ prompt: "" }, { prompt: "   " }, { prompt: "x".repeat(1001) }, {}]) {
    const r = await req("/api/ai/copy", { method: "POST", token, body: bad });
    assert.equal(r.status, 400, JSON.stringify({ bad, r }));
  }
});

// --- #9: rule mutations (LAST — they change global tag state) --------------

test("wave3 #9: PATCH /api/admin/tag-rules rejects invalid rules with 400", async () => {
  const admin = await adminLogin();
  const defaults = (await req("/api/admin/tag-rules", { token: admin })).json.tagRules;
  const one = (over = {}) => ({
    id: "t1", name: "测试标签", enabled: true, match: "all",
    conditions: [{ field: "spent", op: "gte", value: 0 }],
    ...over,
  });
  const many = Array.from({ length: 21 }, (_, i) => one({ id: "t" + i, name: "标签" + i }));
  const dupName = [one({ id: "a1", name: "重名" }), one({ id: "a2", name: "重名" })];
  const badField = [one({ conditions: [{ field: "nope", op: "gte", value: 0 }] })];
  const textGte = [one({ conditions: [{ field: "city", op: "gte", value: "南宁" }] })];
  for (const bad of [many, dupName, badField, textGte]) {
    const r = await req("/api/admin/tag-rules", { method: "PATCH", token: admin, body: { tagRules: bad } });
    assert.equal(r.status, 400, JSON.stringify({ bad, r }));
  }
  // Rules are unchanged after the rejected PATCHes.
  const after = (await req("/api/admin/tag-rules", { token: admin })).json.tagRules;
  assert.deepEqual(after, defaults);
  const demo = await login();
  assert.equal(
    (await req("/api/admin/tag-rules", { method: "PATCH", token: demo, body: { tagRules: defaults } })).status,
    403,
  );
});

test("wave3 #9: disabling a rule removes its tag everywhere, then restore defaults", async () => {
  const admin = await adminLogin();
  const defaults = (await req("/api/admin/tag-rules", { token: admin })).json.tagRules;
  const disabled = defaults.map((r) =>
    r.id === "silent" ? { ...r, enabled: false } : r,
  );
  const saved = await req("/api/admin/tag-rules", {
    method: "PATCH",
    token: admin,
    body: { tagRules: disabled },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.tagRules.find((r) => r.id === "silent").enabled, false);
  const users = (await req("/api/admin/users", { token: admin })).json.users;
  assert.ok(!users.some((u) => u.tags.includes("沉默用户")), "no user may keep 沉默用户 after the rule is off");
  const analysis = (await req("/api/admin/analysis?period=day", { token: admin })).json;
  assert.equal(analysis.userSummary.silent, 0);
  // Restore the defaults so later runs and the dashboard see the same rules.
  const restored = await req("/api/admin/tag-rules", {
    method: "PATCH",
    token: admin,
    body: { tagRules: defaults },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual(
    (await req("/api/admin/tag-rules", { token: admin })).json.tagRules,
    defaults,
  );
});
