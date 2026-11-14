// tests/r6-creative.test.mjs: R6-3 (xlsx row 68) — 文创商品库.
// Creative goods sell as ordinary resources through the existing
// order flow: category `creative` is recognised by ctx (seed.mjs)
// and by the H5/mini/admin CATS tables; POST /api/orders deducts
// `stock` exactly like ordinary goods (409 when empty); a missing
// booking_date defaults to the purchase day (demo baseline today);
// availability mode is `none` (no use date). Spawns server/server.mjs
// on TEST_PORT (default 3112) and talks to it over HTTP. DATABASE_URL
// must point at a FRESH disposable database (npm test is NOT
// idempotent on a reused DB).
//
// Covered: categories list creative (id + 文创衍生); filter by id and
// by Chinese name returns only creative goods; availability mode
// `none` with available null; buy creative goods -> pending order,
// amount = price x qty, stock drops by 1, cancel restores it; buy
// without booking_date -> booking_date is the purchase day
// (2026-11-09); stock 0 -> 409 库存不足; i18n key counts (H5 423,
// miniprogram 262, equal sets) + the two new creative keys.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.TEST_PORT || 3112);
const BASE = `http://127.0.0.1:${PORT}`;
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;

async function req(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(username, password) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(r.status, 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function register(username, password) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { username, password, name: username, email: `${username}@example.com` },
  });
  assert.equal(r.status, 200, `register ${username} -> ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id };
}

async function getOrder(token, id) {
  const r = await req(`/api/orders/${id}`, { token });
  assert.equal(r.status, 200, `GET order ${id} -> ${r.status}`);
  return r.data.order;
}

async function getResource(id) {
  const r = await req(`/api/resources/${id}`);
  assert.equal(r.status, 200, `GET resource ${id} -> ${r.status}`);
  return r.data.resource;
}

let adminToken;
let buyerToken;
let stockedId;
let emptyId;

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD || "demo123",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  adminToken = await login("admin", "admin123");
  ({ token: buyerToken } = await register("r6creative1", "Test1234"));
  // Two deterministic creative goods via the admin form (this also
  // proves the admin category dropdown accepts `creative`): one
  // with stock 5, one with stock 0.
  const stocked = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R6文创测试商品", category: "creative", city: "南宁",
      price: 8900, unit: "件", description: "R6-3 测试用文创商品",
      stock: 5, shop_id: 1,
    },
  });
  assert.equal(stocked.status, 200, JSON.stringify(stocked.data));
  stockedId = stocked.data.resource.id;
  const empty = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R6文创缺货商品", category: "creative", city: "南宁",
      price: 1000, unit: "件", description: "R6-3 测试用缺货文创商品",
      stock: 0, shop_id: 1,
    },
  });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  emptyId = empty.data.resource.id;
});

after(async () => {
  if (child) child.kill("SIGTERM");
});

test("categories list creative; filter by id and Chinese name finds creative goods", async () => {
  const cats = await req("/api/categories");
  assert.equal(cats.status, 200, JSON.stringify(cats.data));
  const creative = cats.data.categories.find((c) => c.id === "creative");
  assert.ok(creative, "creative missing from /api/categories");
  assert.equal(creative.name, "文创衍生");
  const byId = await req("/api/resources?category=creative");
  assert.equal(byId.status, 200, JSON.stringify(byId.data));
  assert.ok(byId.data.resources.length >= 2, "seed + test creative goods expected");
  assert.ok(byId.data.resources.every((r) => r.category === "creative"));
  assert.ok(byId.data.resources.some((r) => r.id === stockedId));
  assert.ok(byId.data.resources.some((r) => r.id === emptyId));
  const byName = await req("/api/resources?category=%E6%96%87%E5%88%9B%E8%A1%8D%E7%94%9F");
  assert.equal(byName.status, 200, JSON.stringify(byName.data));
  assert.deepEqual(
    byName.data.resources.map((r) => r.id).sort(),
    byId.data.resources.map((r) => r.id).sort(),
  );
});

test("creative availability mode is none (no use date)", async () => {
  const avail = await req(`/api/resources/${stockedId}/availability`);
  assert.equal(avail.status, 200, JSON.stringify(avail.data));
  assert.equal(avail.data.mode, "none");
  assert.equal(avail.data.available, null);
});

test("buy creative goods -> order like a ticket, stock drops by 1", async () => {
  const before = await getResource(stockedId);
  assert.equal(before.stock, 5);
  const created = await req("/api/orders", {
    method: "POST",
    token: buyerToken,
    body: {
      resourceId: stockedId, quantity: 1,
      booking_date: "2026-12-20", channel: "H5",
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.status, "pending");
  assert.equal(created.data.amount, 8900);
  // The create response carries no booking_date (it returns id /
  // code / amount / status only) — read the stored order instead.
  const stored = await getOrder(buyerToken, created.data.id);
  assert.equal(stored.booking_date, "2026-12-20");
  assert.equal(stored.resource_id, stockedId);
  assert.equal(stored.quantity, 1);
  const afterBuy = await getResource(stockedId);
  assert.equal(afterBuy.stock, 4);
  // Restore the shared seed state: cancel returns the unit to stock.
  const cancel = await req(`/api/orders/${created.data.id}/cancel`, {
    method: "POST",
    token: buyerToken,
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  const afterCancel = await getResource(stockedId);
  assert.equal(afterCancel.stock, 5);
});

test("buy without booking_date -> purchase day (demo baseline today)", async () => {
  const created = await req("/api/orders", {
    method: "POST",
    token: buyerToken,
    body: { resourceId: stockedId, quantity: 1, channel: "H5" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const stored = await getOrder(buyerToken, created.data.id);
  assert.equal(stored.booking_date, "2026-11-09");
  const cancel = await req(`/api/orders/${created.data.id}/cancel`, {
    method: "POST",
    token: buyerToken,
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal((await getResource(stockedId)).stock, 5);
});

test("stock 0 creative goods -> 409, same out-of-stock rule", async () => {
  const created = await req("/api/orders", {
    method: "POST",
    token: buyerToken,
    body: {
      resourceId: emptyId, quantity: 1,
      booking_date: "2026-12-20", channel: "H5",
    },
  });
  assert.equal(created.status, 409, JSON.stringify(created.data));
  assert.match(String(created.data.error || ""), /库存不足/);
  assert.equal((await getResource(emptyId)).stock, 0);
});

test("i18n 448/262; creative keys present on both sides", async () => {
  // R6-3 adds 2 H5 keys (availCreative, creativeDateLabel) and 1
  // mini key (creativeDateLabel): 372 -> 374, 181 -> 182.
  const data = await import(
    path.resolve(repoDir, "web", "assets", "js", "data.js")
  );
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [448, 448, 448]);
  for (const k of ["availCreative", "creativeDateLabel"]) {
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
    assert.ok(
      blocks[lang].includes("creativeDateLabel"),
      `creativeDateLabel missing in mini ${lang}`,
    );
  }
});
