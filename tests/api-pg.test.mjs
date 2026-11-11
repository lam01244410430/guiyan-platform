// Guiyan API tests — run against a REAL PostgreSQL 16, never a mock.
//
//   DATABASE_URL=postgres://guiyan:guiyan@localhost:5433/guiyan_test \
//   DEMO_PASSWORD=... ADMIN_PASSWORD=... \
//   npm --prefix server test
//
// The test spawns server/server.mjs on TEST_PORT (default 3101) and talks
// to it over HTTP. DATABASE_URL must point at a FRESH, disposable database
// (the server seeds 62 resources + demo users on first boot). Do not point
// it at any shared or production database.
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

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
);
const BOOKING_DATE = "2026-12-20";

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
  // Cold cache for the run: the test database is recreated per run but
  // redis survives it, so a stale guiyan:* key from an earlier run would
  // serve another database's data. Flush only the disposable test redis.
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
});

test("health reports postgres mode", async () => {
  const r = await req("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.database, "postgres");
});

test("categories list the 10 resource types", async () => {
  const r = await req("/api/categories");
  assert.equal(r.status, 200);
  assert.equal(r.json.categories.length, 10);
  assert.ok(r.json.categories.some((c) => c.id === "show"));
});

test("resource list has exactly the 62 seeded resources", async () => {
  const r = await req("/api/resources");
  assert.equal(r.status, 200);
  assert.equal(r.json.resources.length, 62);
  const liu = r.json.resources.find(
    (x) => x.name === "民族歌舞剧《刘三姐》",
  );
  assert.ok(liu, "刘三姐 must be seeded");
  assert.equal(liu.price, 28000); // integer cents
  assert.equal(liu.category, "show");
});

test("resource filters and search work", async () => {
  const heritage = await req("/api/resources?category=heritage");
  assert.equal(heritage.status, 200);
  assert.ok(heritage.json.resources.length >= 6);
  assert.ok(heritage.json.resources.every((x) => x.category === "heritage"));
  // Category filter also accepts the Chinese category name (mini-program sends it).
  const byName = await req(
    "/api/resources?category=" + encodeURIComponent("非遗体验"),
  );
  assert.equal(byName.status, 200);
  assert.equal(byName.json.resources.length, heritage.json.resources.length);
  const search = await req("/api/resources?q=" + encodeURIComponent("刘三姐"));
  assert.equal(search.status, 200);
  assert.equal(search.json.resources.length, 2);
  const one = await req(
    `/api/resources/${search.json.resources[0].id}`,
  );
  assert.equal(one.status, 200);
  assert.equal(one.json.resource.id, search.json.resources[0].id);
  const missing = await req("/api/resources/999999");
  assert.equal(missing.status, 404);
});

test("login accepts the demo account and rejects a wrong password", async () => {
  const ok = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: process.env.DEMO_PASSWORD },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  assert.equal(ok.json.user.username, "demo");
  const bad = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: "wrong-password" },
  });
  assert.equal(bad.status, 401);
});

async function login() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "demo", password: process.env.DEMO_PASSWORD },
  });
  assert.equal(r.status, 200);
  return r.json.token;
}

async function adminLogin() {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, "admin");
  return r.json.token;
}

async function pickShow(token) {
  const r = await req("/api/resources?category=show&sort=hot");
  assert.equal(r.status, 200);
  const show = r.json.resources.find((x) => x.stock > 0);
  assert.ok(show, "need a show resource with stock");
  return show;
}

test("orders require login", async () => {
  const r = await req("/api/orders");
  assert.equal(r.status, 401);
});

test("order happy path: create -> confirm -> pay (simulated) -> complete", async () => {
  const token = await login();
  const show = await pickShow(token);
  const created = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: show.id,
      quantity: 2,
      booking_date: BOOKING_DATE,
      channel: "H5",
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.status, "pending");
  assert.equal(created.json.amount, show.price * 2);
  const id = created.json.id;

  const confirm = await req(`/api/orders/${id}/confirm`, {
    method: "POST",
    token,
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.json.status, "confirmed");

  const pay = await req(`/api/orders/${id}/pay`, { method: "POST", token });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.status, "paid");
  assert.equal(pay.json.simulated, true);

  const complete = await req(`/api/orders/${id}/complete`, {
    method: "POST",
    token,
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.json.status, "completed");

  const list = await req("/api/orders", { token });
  assert.equal(list.status, 200);
  const mine = list.json.orders.find((o) => o.id === id);
  assert.ok(mine);
  assert.equal(mine.status, "completed");
  assert.equal(mine.amount, show.price * 2);
});

test("illegal order transition is rejected with 400", async () => {
  const token = await login();
  const show = await pickShow(token);
  const created = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: show.id,
      quantity: 1,
      booking_date: BOOKING_DATE,
    },
  });
  assert.equal(created.status, 200);
  const pay = await req(`/api/orders/${created.json.id}/pay`, {
    method: "POST",
    token,
  });
  assert.equal(pay.status, 400); // pending cannot pay; must confirm first
  const cancel = await req(`/api/orders/${created.json.id}/cancel`, {
    method: "POST",
    token,
  });
  assert.equal(cancel.status, 200);
});

test("client-sent amount is ignored; server computes it", async () => {
  const token = await login();
  const show = await pickShow(token);
  const created = await req("/api/orders", {
    method: "POST",
    token,
    body: {
      resourceId: show.id,
      quantity: 2,
      booking_date: BOOKING_DATE,
      amount: 1, // tampered: must be ignored
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.amount, show.price * 2);
  await req(`/api/orders/${created.json.id}/cancel`, {
    method: "POST",
    token,
  });
});

test("favorites round-trip", async () => {
  const token = await login();
  const list0 = await req("/api/resources");
  const rid = list0.json.resources[0].id;
  await req(`/api/favorites/${rid}`, { method: "DELETE", token });
  const on = await req("/api/favorites", {
    method: "POST",
    token,
    body: { resourceId: rid },
  });
  assert.equal(on.status, 200);
  assert.equal(on.json.favorite, true);
  const favs = await req("/api/favorites", { token });
  assert.equal(favs.status, 200);
  assert.ok(favs.json.favorites.some((r) => r.id === rid));
  const off = await req(`/api/favorites/${rid}`, {
    method: "DELETE",
    token,
  });
  assert.equal(off.status, 200);
  const favs2 = await req("/api/favorites", { token });
  assert.ok(!favs2.json.favorites.some((r) => r.id === rid));
});

test("demands list and create", async () => {
  const token = await login();
  const beforeList = await req("/api/demands", { token });
  assert.equal(beforeList.status, 200);
  assert.ok(beforeList.json.demands.length >= 8);
  assert.ok(
    beforeList.json.demands.some(
      (d) => d.title === "寻民族歌舞团队，合作城市文化周",
    ),
  );
  const title = "测试需求 " + Date.now();
  const created = await req("/api/demands", {
    method: "POST",
    token,
    body: {
      title,
      category: "artist",
      budget: 100000,
      city: "南宁",
      description: "测试需求（自动化测试产生）",
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.ok(created.json.id);
  const afterList = await req("/api/demands", { token });
  assert.ok(afterList.json.demands.some((d) => d.title === title));
});

test("assistant answers by rule from live data", async () => {
  const refund = await req(
    "/api/assistant?q=" + encodeURIComponent("怎么退款"),
  );
  assert.equal(refund.status, 200);
  assert.equal(refund.json.kind, "refund");
  assert.equal(refund.json.mock, true);

  const heritage = await req(
    "/api/assistant?q=" + encodeURIComponent("非遗体验有哪些"),
  );
  assert.equal(heritage.status, 200);
  assert.equal(heritage.json.kind, "heritage");
  assert.ok(heritage.json.items.length >= 6);
  assert.ok(heritage.json.answer.includes("非遗体验"));

  const hot = await req(
    "/api/assistant?q=" + encodeURIComponent("今晚有什么热门演出"),
  );
  assert.equal(hot.status, 200);
  assert.equal(hot.json.kind, "hot");
  assert.equal(hot.json.items.length, 3);

  const hello = await req("/api/assistant?q=hello");
  assert.equal(hello.status, 200);
  assert.equal(hello.json.kind, "hello");

  const empty = await req("/api/assistant?q=");
  assert.equal(empty.status, 400);
});

test("admin stats series covers all four periods with zero-filled buckets", async () => {
  const token = await adminLogin();
  for (const period of ["day", "week", "month", "quarter"]) {
    const r = await req(`/api/admin/stats?period=${period}`, { token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.period, period);
    assert.ok(Array.isArray(r.json.series) && r.json.series.length > 0);
    assert.ok(r.json.series.every((s) => typeof s.amount === "number" && typeof s.count === "number"));
    assert.equal(r.json.sources["票房"], "未接入");
    assert.equal(r.json.sources["核销"], "未接入");
  }
  // Seed orders end 2026-11-09 but "today" is the real date, so the day
  // series must contain zero-transaction buckets after the last order.
  const day = await req("/api/admin/stats?period=day", { token });
  assert.ok(day.json.series.some((s) => s.count === 0), "day series must fill zero buckets");
  assert.ok(day.json.series.some((s) => s.count > 0), "day series must contain real orders");
  const bad = await req("/api/admin/stats?period=year", { token });
  assert.equal(bad.status, 400);
  const demo = await login();
  const forbidden = await req("/api/admin/stats?period=day", { token: demo });
  assert.equal(forbidden.status, 403);
});

test("admin analysis ports the original insights", async () => {
  const token = await adminLogin();
  const r = await req("/api/admin/analysis?period=day", { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.kpis.revenue > 0);
  // kpis.orders counts every order row, same as cumulative stats — compare
  // against the live cumulative count instead of a hard-coded seed total,
  // so this test does not depend on how many orders earlier tests created.
  const stats = await req("/api/admin/stats", { token });
  assert.equal(stats.status, 200);
  assert.equal(r.json.kpis.orders, stats.json.orders);
  assert.ok(r.json.kpis.paidOrders > 0);
  assert.ok(r.json.kpis.resources > 0);
  assert.ok(Array.isArray(r.json.ranking) && r.json.ranking.length > 0);
  assert.equal(r.json.ranking[0].name, "广西文化艺术中心");
  assert.equal(r.json.insights.length, 8);
  assert.equal(typeof r.json.report, "string");
  assert.ok(r.json.report.includes("模拟经营分析报告"));
  assert.ok(r.json.report.includes("按订单创建时间统计"));
  assert.equal(r.json.venues.length, 6); // 2 original venue resources + 4 catalog venues
  assert.equal(r.json.venues[0].seatOccupancy, null); // no venue<->show link in Lam's seed
  assert.ok(r.json.definitions.series.includes("无支付时间字段"));
  assert.ok(r.json.userSummary.total >= 38);
  const bad = await req("/api/admin/analysis?period=year", { token });
  assert.equal(bad.status, 400);
});

test("admin alerts flag low stock, and simulated events trigger + resolve", async () => {
  const token = await adminLogin();
  const r = await req("/api/admin/alerts", { token });
  assert.equal(r.status, 200);
  const low = r.json.alerts.find((a) => a.title.includes("壮锦纹样帆布袋"));
  assert.ok(low, "resource #12 stock=2 must raise a low-stock alert");
  assert.ok(low.title.includes("仅剩2"));
  // No disputed / refund_requested orders exist in Lam's seed, so the
  // abnormal-orders alert must not appear with an invented count.
  assert.ok(!r.json.alerts.some((a) => a.title.includes("售后或纠纷")));
  const triggered = await req("/api/admin/alerts", {
    method: "POST",
    token,
    body: { kind: "sales" },
  });
  assert.equal(triggered.status, 200, JSON.stringify(triggered.json));
  const after = await req("/api/admin/alerts", { token });
  const sim = after.json.alerts.find((a) => a.title.includes("销量突降"));
  assert.ok(sim, "triggered simulated event must appear");
  assert.ok(sim.title.includes("（模拟事件）"));
  assert.ok(sim.id, "simulated event must carry its events-table id");
  const resolved = await req("/api/admin/alerts", {
    method: "POST",
    token,
    body: { resolve: sim.id },
  });
  assert.equal(resolved.status, 200);
  const gone = await req("/api/admin/alerts", { token });
  assert.ok(!gone.json.alerts.some((a) => a.id === sim.id));
  const badKind = await req("/api/admin/alerts", {
    method: "POST",
    token,
    body: { kind: "nope" },
  });
  assert.equal(badKind.status, 400);
  const demo = await login();
  assert.equal((await req("/api/admin/alerts", { token: demo })).status, 403);
});

test("admin orders CSV has BOM, exact header and one row per order", async () => {
  const token = await adminLogin();
  const all = await req("/api/admin/orders", { token });
  assert.equal(all.status, 200);
  const res = await fetch(BASE + "/api/admin/orders.csv", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("text/csv"));
  assert.ok(
    res.headers.get("content-disposition").includes("guiyan-orders.csv"),
  );
  // Assert the BOM on raw bytes: Response.text() decodes UTF-8 and strips
  // a leading U+FEFF, so startsWith("\uFEFF") can never pass even though
  // the wire bytes are correct. TextDecoder also strips the BOM, so after
  // decoding the header starts at lines[0] with no slice.
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(
    [...buf.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "CSV must start with a UTF-8 BOM",
  );
  const text = new TextDecoder("utf-8").decode(buf);
  const lines = text.split("\r\n");
  assert.equal(
    lines[0],
    '"订单编号","资源","用户","金额(元)","演出/使用日期","状态","渠道","下单时间(北京时间)","历史时间说明"',
  );
  // B-018: the admin orders list is capped at LIMIT 200, but the CSV
  // exports every order — so the row count must be checked against the
  // cumulative stats total, not the capped list (313 rows vs 200 listed).
  const stats = await req("/api/admin/stats", { token });
  assert.equal(stats.status, 200);
  assert.equal(lines.length - 1, stats.json.orders);
  assert.ok(lines.some((l) => l.includes("按订单创建时间统计")));
  const demo = await login();
  const forbidden = await fetch(BASE + "/api/admin/orders.csv", {
    headers: { Authorization: `Bearer ${demo}` },
  });
  assert.equal(forbidden.status, 403);
});

test("admin reviews a pending demand; demo user gets 403, missing id 404", async () => {
  const token = await adminLogin();
  const demo = await login();
  const forbidden = await req("/api/admin/demands/3", {
    method: "PATCH",
    token: demo,
    body: { status: "approved" },
  });
  assert.equal(forbidden.status, 403);
  const missing = await req("/api/admin/demands/999999", {
    method: "PATCH",
    token,
    body: { status: "approved" },
  });
  assert.equal(missing.status, 404);
  const badStatus = await req("/api/admin/demands/3", {
    method: "PATCH",
    token,
    body: { status: "maybe" },
  });
  assert.equal(badStatus.status, 400);
  // Seed demand 3 ("小剧场巡演合作意向") is the only pending one.
  const ok = await req("/api/admin/demands/3", {
    method: "PATCH",
    token,
    body: { status: "approved" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.status, "approved");
  const list = await req("/api/admin/demands", { token });
  const d3 = list.json.demands.find((d) => d.id === 3);
  assert.ok(d3);
  assert.equal(d3.status, "approved");
});

test("admin audit-logs are readable by admin only, capped at 60", async () => {
  const token = await adminLogin();
  const r = await req("/api/admin/audit-logs", { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.logs));
  assert.ok(r.json.logs.length > 0 && r.json.logs.length <= 60);
  assert.ok(r.json.logs.some((l) => l.action === "内容审核"));
  const demo = await login();
  assert.equal((await req("/api/admin/audit-logs", { token: demo })).status, 403);
});

// --- Redis cache (phase 1b) -------------------------------------------------
// These tests only run when the server under test was started with
// REDIS_URL set (the test spawns the server with process.env, so
// REDIS_URL=redis://127.0.0.1:6380 npm --prefix server test enables
// them). Without REDIS_URL the cache is disabled and every response
// serves Postgres directly with no X-Cache header.
const cacheOn = Boolean(process.env.REDIS_URL);
const cacheTest = (name, fn) =>
  test(name, { skip: !cacheOn }, fn);

cacheTest("cache: resources list MISS then HIT, bust on order write", async () => {
  const token = await login();
  const show = await pickShow(token);
  // Bust first: an earlier test may already have cached the list.
  const created = await req("/api/orders", {
    method: "POST",
    token,
    body: { resourceId: show.id, quantity: 1, booking_date: BOOKING_DATE },
  });
  assert.equal(created.status, 200);
  const first = await req("/api/resources");
  assert.equal(first.headers.get("x-cache"), "MISS");
  const second = await req("/api/resources");
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(second.json, first.json);
  // Cancelling the order is a write: the list must be busted. The
  // re-read is NOT deep-equal to the first read — cancel restores the
  // ordered show's stock by 1 — so compare ids and the stock delta.
  const cancel = await req(`/api/orders/${created.json.id}/cancel`, {
    method: "POST",
    token,
  });
  assert.equal(cancel.status, 200);
  const third = await req("/api/resources");
  assert.equal(third.headers.get("x-cache"), "MISS");
  assert.equal(third.json.resources.length, first.json.resources.length);
  assert.deepEqual(
    third.json.resources.map((r) => r.id),
    first.json.resources.map((r) => r.id),
  );
  const stockOf = (list) =>
    list.find((r) => r.id === show.id).stock;
  assert.equal(stockOf(third.json.resources), stockOf(first.json.resources) + 1);
  // Filtered queries bypass the cache entirely (no X-Cache header).
  const filtered = await req("/api/resources?category=show");
  assert.equal(filtered.headers.get("x-cache"), null);
});

cacheTest("cache: admin stats series MISS then HIT, bust on demand create", async () => {
  const admin = await adminLogin();
  const demo = await login();
  // Bust first via a demand write (earlier tests may have cached it).
  const title = "缓存测试需求 " + Date.now();
  const d0 = await req("/api/demands", {
    method: "POST",
    token: demo,
    body: { title, category: "artist", budget: 1000, city: "南宁", description: "cache bust" },
  });
  assert.equal(d0.status, 200);
  const first = await req("/api/admin/stats?period=day", { token: admin });
  assert.equal(first.headers.get("x-cache"), "MISS");
  const second = await req("/api/admin/stats?period=day", { token: admin });
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(second.json, first.json);
  const d1 = await req("/api/demands", {
    method: "POST",
    token: demo,
    body: { title: title + " 2", category: "artist", budget: 1000, city: "南宁", description: "cache bust 2" },
  });
  assert.equal(d1.status, 200);
  const third = await req("/api/admin/stats?period=day", { token: admin });
  assert.equal(third.headers.get("x-cache"), "MISS");
  assert.deepEqual(third.json, first.json);
});

cacheTest("cache: admin analysis MISS then HIT, bust on order transition", async () => {
  const admin = await adminLogin();
  const demo = await login();
  const show = await pickShow(demo);
  const created = await req("/api/orders", {
    method: "POST",
    token: demo,
    body: { resourceId: show.id, quantity: 1, booking_date: BOOKING_DATE },
  });
  assert.equal(created.status, 200);
  const first = await req("/api/admin/analysis?period=day", { token: admin });
  assert.equal(first.headers.get("x-cache"), "MISS");
  const second = await req("/api/admin/analysis?period=day", { token: admin });
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(second.json, first.json);
  const confirm = await req(`/api/orders/${created.json.id}/confirm`, {
    method: "POST",
    token: demo,
  });
  assert.equal(confirm.status, 200);
  const third = await req("/api/admin/analysis?period=day", { token: admin });
  assert.equal(third.headers.get("x-cache"), "MISS");
  await req(`/api/orders/${created.json.id}/cancel`, { method: "POST", token: demo });
});

cacheTest("cache: assistant hot MISS then HIT", async () => {
  const q = "/api/assistant?q=" + encodeURIComponent("今晚有什么热门演出");
  const demo = await login();
  const show = await pickShow(demo);
  // Bust the hot key (order writes bust resources) so MISS is observable.
  const created = await req("/api/orders", {
    method: "POST",
    token: demo,
    body: { resourceId: show.id, quantity: 1, booking_date: BOOKING_DATE },
  });
  assert.equal(created.status, 200);
  await req(`/api/orders/${created.json.id}/cancel`, { method: "POST", token: demo });
  const first = await req(q);
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.equal(first.json.kind, "hot");
  const second = await req(q);
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(second.json, first.json);
});

// Fail-open with redis stopped: only runs when GUIYAN_REDIS_CONTAINER
// names the docker container (e.g. guiyan-redis on the EC2). Stops the
// container, asserts every cached endpoint still answers from Postgres,
// then restarts it in a finally block.
test(
  "cache: fail-open when redis is stopped",
  { skip: !cacheOn || !process.env.GUIYAN_REDIS_CONTAINER },
  async () => {
    const { execSync } = await import("node:child_process");
    const container = process.env.GUIYAN_REDIS_CONTAINER;
    const admin = await adminLogin();
    // Warm the cache first so the stopped-redis calls would have hit it.
    await req("/api/resources");
    await req("/api/admin/stats?period=day", { token: admin });
    execSync(`docker stop ${container}`, { stdio: "ignore" });
    try {
      const resources = await req("/api/resources");
      assert.equal(resources.status, 200);
      assert.equal(resources.json.resources.length, 62);
      const stats = await req("/api/admin/stats?period=day", { token: admin });
      assert.equal(stats.status, 200);
      assert.ok(Array.isArray(stats.json.series));
      const analysis = await req("/api/admin/analysis?period=day", { token: admin });
      assert.equal(analysis.status, 200);
      assert.ok(analysis.json.kpis.revenue > 0);
      const hot = await req(
        "/api/assistant?q=" + encodeURIComponent("今晚有什么热门演出"),
      );
      assert.equal(hot.status, 200);
      assert.equal(hot.json.kind, "hot");
    } finally {
      execSync(`docker start ${container}`, { stdio: "ignore" });
      // Give the client a moment to reconnect before later tests run.
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
);

/* ---- Phase 3: registration (POST /api/auth/register) ---- */

test("register creates a user, returns token + user with role=user, and the new account can log in", async () => {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser1", password: "secret1", name: "注册用户", email: "reg1@example.com" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.token, "register must auto-login with a token");
  assert.equal(r.json.user.username, "reguser1");
  assert.equal(r.json.user.name, "注册用户");
  assert.equal(r.json.user.role, "user");
  assert.equal(r.json.user.email, "reg1@example.com");
  assert.equal(r.json.user.password, undefined, "password must not leak");
  // The token works immediately, and the same credentials log in too.
  const me = await req("/api/orders", { token: r.json.token });
  assert.equal(me.status, 200);
  const again = await req("/api/auth/login", {
    method: "POST",
    body: { username: "reguser1", password: "secret1" },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.user.username, "reguser1");
});

test("register rejects a duplicate username with 409", async () => {
  const dup = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser1", password: "secret1", name: "又一个" },
  });
  assert.equal(dup.status, 409);
  const demoDup = await req("/api/auth/register", {
    method: "POST",
    body: { username: "demo", password: "secret1", name: "冒充" },
  });
  assert.equal(demoDup.status, 409);
});

test("register validates username, password, name and email", async () => {
  const shortPw = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser2", password: "12345", name: "短密码" },
  });
  assert.equal(shortPw.status, 400);
  const noName = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser2", password: "secret1", name: "   " },
  });
  assert.equal(noName.status, 400);
  const badEmail = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser2", password: "secret1", name: "错邮箱", email: "not-an-email" },
  });
  assert.equal(badEmail.status, 400);
  const badUser = await req("/api/auth/register", {
    method: "POST",
    body: { username: "ab", password: "secret1", name: "太短" },
  });
  assert.equal(badUser.status, 400);
  const badChars = await req("/api/auth/register", {
    method: "POST",
    body: { username: "bad name!", password: "secret1", name: "坏字符" },
  });
  assert.equal(badChars.status, 400);
});

test("register ignores a client-supplied role: role=admin still creates a user", async () => {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser3", password: "secret1", name: "想当管理员", role: "admin" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.role, "user");
  // ...and the new account cannot reach the admin API.
  const stats = await req("/api/admin/stats", { token: r.json.token });
  assert.equal(stats.status, 403);
});

test("register without email works, and the new user shows in /api/admin/users", async () => {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username: "reguser4", password: "secret1", name: "无邮箱用户" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.email, null);
  const admin = await adminLogin();
  const users = await req("/api/admin/users", { token: admin });
  assert.equal(users.status, 200);
  const found = users.json.users.find((u) => u.username === "reguser4");
  assert.ok(found, "new user must appear in admin users");
  assert.equal(found.role, "user");
  assert.equal(found.password, undefined);
});
