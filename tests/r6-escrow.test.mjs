// tests/r6-escrow.test.mjs: R6-6 (row 73) — 交易保障: escrow hold/release
// on a paid order + the escrow clause in the contract.
// Spawns server/server.mjs on TEST_PORT (default 3108) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: (1) paid order hold -> 已托管 (escrow 模拟托管中 -> 已托管);
// (2) unpaid order hold -> 400, escrow stays 未支付; (3) release ->
// 已释放 (owner release -> 403 first, admin release -> 200, second
// release -> 400); (4) hold/release during a dispute -> 400, and the
// freeze lifts once the dispute is rejected (back to paid, hold works);
// (5) the contract contains the escrow clause (amount = order amount,
// holder = platform, release = completed or both parties confirm) and
// the rest of the contract is unchanged; (6) someone else's order ->
// 403; (7) a held order completes -> 已释放, an unheld order completes
// -> 已结算 (existing behavior).
//
// i18n key counts (H5 427, miniprogram 241) are asserted by the 22
// count files — this file asserts the behaviour only. The 5 new escrow
// keys are presence-checked in tests/wave3.test.mjs.
import test, { before, after} from "node:test";
import assert from "node:assert/strict";
import { spawn} from "node:child_process";
import path from "node:path";
import { fileURLToPath} from "node:url";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
throw new Error(
"DATABASE_URL is required, e.g. postgres://guiyan:guiyan@localhost:5433/guiyan_test",
);
if (!process.env.DEMO_PASSWORD ||!process.env.ADMIN_PASSWORD)
throw new Error(
"DEMO_PASSWORD and ADMIN_PASSWORD are required (demo login tests)",
);

const PORT = Number(process.env.TEST_PORT || 3108);
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(
path.dirname(fileURLToPath(import.meta.url)),
"..",
"server",
);
// Booking dates 2026-12-31..2027-01-02: seed orders only cover
// 2026-12-01..06, api-pg uses 2026-12-20, wave4 uses 2026-12-21..25 and
// p3bugs uses 2026-12-26..30, so these dates start clean.
const D1 = "2026-12-31";
const D2 = "2027-01-01";
const D3 = "2027-01-02";

let proc;

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
return { status: res.status, json, text, headers: res.headers};
}

async function login(username = "demo", password = process.env.DEMO_PASSWORD) {
const r = await req("/api/auth/login", {
method: "POST",
body: { username, password},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
return r.json.token;
}

async function adminLogin() {
const r = await req("/api/auth/login", {
method: "POST",
body: { username: "admin", password: process.env.ADMIN_PASSWORD},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.user.role, "admin");
return r.json.token;
}

async function registerUser(username, password, name) {
const r = await req("/api/auth/register", {
method: "POST",
body: { username, password, name},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
return r.json.token;
}

async function listByCategory(category) {
const r = await req(`/api/resources?category=${category}`);
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.ok(Array.isArray(r.json.resources) && r.json.resources.length > 0, `no ${category} resources`);
return r.json.resources;
}

async function createOrder(token, resourceId, quantity, bookingDate) {
const r = await req("/api/orders", {
method: "POST",
body: { resourceId, quantity, booking_date: bookingDate},
token,
});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.ok, true);
return r.json;
}

async function paidOrder(token, resourceId, quantity, bookingDate) {
const created = await createOrder(token, resourceId, quantity, bookingDate);
const confirm = await req(`/api/orders/${created.id}/confirm`, { method: "POST", token});
assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
const pay = await req(`/api/orders/${created.id}/pay`, { method: "POST", token});
assert.equal(pay.status, 200, JSON.stringify(pay.json));
assert.equal(pay.json.status, "paid");
return created;
}

async function myOrder(token, id) {
const list = await req("/api/orders", { token});
assert.equal(list.status, 200, JSON.stringify(list.json));
const o = list.json.orders.find((x) => x.id === id);
assert.ok(o, `order ${id} missing from own list`);
return o;
}

async function pickShow(minStock = 1) {
const shows = await listByCategory("show");
const s = shows.find((r) => r.stock >= minStock);
assert.ok(s, `need a show with stock >= ${minStock}`);
return s;
}

async function escrow(token, id, action) {
return req(`/api/orders/${id}/escrow`, {
method: "POST",
token,
body: { action},
});
}

before(async () => {
proc = spawn("node", ["server.mjs"], {
cwd: serverDir,
env: {
...process.env,
DATABASE_URL,
PORT: String(PORT),
// Dead port on purpose: r6-escrow never calls the trial backend.
AI_CHAT_URL: "http://127.0.0.1:1/api/chat",
AI_CHAT_TIMEOUT_MS: "200",
},
stdio: ["ignore", "pipe", "pipe"],
});
proc.stdout.on("data", (d) => process.stderr.write(`[r6-escrow-server] ${d}`));
proc.stderr.on("data", (d) => process.stderr.write(`[r6-escrow-server:err] ${d}`));
const deadline = Date.now() + 60000;
for (;;) {
try {
const r = await req("/api/health");
if (r.status === 200 && r.json?.ok) break;
} catch {
// not up yet
}
if (Date.now() > deadline)
throw new Error("r6-escrow server did not become healthy within 60s");
await new Promise((r) => setTimeout(r, 500));
}
});

after(() => {
if (proc &&!proc.killed) proc.kill("SIGTERM");
});

test("r6-escrow: paid order hold moves escrow 模拟托管中 -> 已托管", async () => {
const token = await login();
const s = await pickShow(1);
const order = await paidOrder(token, s.id, 1, D1);
assert.equal((await myOrder(token, order.id)).escrow, "模拟托管中");
const r = await escrow(token, order.id, "hold");
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.ok, true);
assert.equal(r.json.status, "paid");
assert.equal(r.json.escrow, "已托管");
assert.equal((await myOrder(token, order.id)).escrow, "已托管");
// A second hold is a wrong state -> 400, escrow unchanged.
const again = await escrow(token, order.id, "hold");
assert.equal(again.status, 400, JSON.stringify(again.json));
assert.equal((await myOrder(token, order.id)).escrow, "已托管");
});

test("r6-escrow: unpaid order hold -> 400, escrow stays 未支付", async () => {
const token = await login();
const s = await pickShow(1);
const created = await createOrder(token, s.id, 1, D2);
assert.equal((await myOrder(token, created.id)).escrow, "未支付");
const r = await escrow(token, created.id, "hold");
assert.equal(r.status, 400, JSON.stringify(r.json));
assert.equal((await myOrder(token, created.id)).escrow, "未支付");
// A bad action is also a 400 with no write.
const bad = await escrow(token, created.id, "freeze");
assert.equal(bad.status, 400, JSON.stringify(bad.json));
});

test("r6-escrow: release moves 已托管 -> 已释放, admin-only", async () => {
const token = await login();
const admin = await adminLogin();
const s = await pickShow(1);
const order = await paidOrder(token, s.id, 1, D1);
// Release before any hold is a wrong state -> 400.
const early = await escrow(admin, order.id, "release");
assert.equal(early.status, 400, JSON.stringify(early.json));
await escrow(token, order.id, "hold");
assert.equal((await myOrder(token, order.id)).escrow, "已托管");
// The owner cannot release their own escrow -> 403.
const ownerRelease = await escrow(token, order.id, "release");
assert.equal(ownerRelease.status, 403, JSON.stringify(ownerRelease.json));
assert.equal((await myOrder(token, order.id)).escrow, "已托管");
const r = await escrow(admin, order.id, "release");
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.escrow, "已释放");
assert.equal((await myOrder(token, order.id)).escrow, "已释放");
// A second release is a wrong state -> 400.
const again = await escrow(admin, order.id, "release");
assert.equal(again.status, 400, JSON.stringify(again.json));
});

test("r6-escrow: hold/release during a dispute -> 400, freeze lifts on rejectDispute", async () => {
const token = await login();
const admin = await adminLogin();
const s = await pickShow(1);
const order = await paidOrder(token, s.id, 1, D2);
const d = await req(`/api/orders/${order.id}/dispute`, {
method: "POST",
token,
body: { reason: "与商家有争议"},
});
assert.equal(d.status, 200, JSON.stringify(d.json));
assert.equal(d.json.status, "disputed");
const hold = await escrow(token, order.id, "hold");
assert.equal(hold.status, 400, JSON.stringify(hold.json));
const release = await escrow(admin, order.id, "release");
assert.equal(release.status, 400, JSON.stringify(release.json));
assert.equal((await myOrder(token, order.id)).escrow, "模拟托管中");
// The dispute is rejected -> back to paid, the freeze lifts.
const rej = await req(`/api/orders/${order.id}/rejectDispute`, {
method: "POST",
token: admin,
body: { reason: "申诉不成立"},
});
assert.equal(rej.status, 200, JSON.stringify(rej.json));
assert.equal(rej.json.status, "paid");
const after = await escrow(token, order.id, "hold");
assert.equal(after.status, 200, JSON.stringify(after.json));
assert.equal(after.json.escrow, "已托管");
});

test("r6-escrow: contract contains the escrow clause, other content unchanged", async () => {
const admin = await adminLogin();
const r = await req("/api/orders/1/contract", { token: admin});
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.title, "模拟服务与授权协议");
const content = r.json.content;
assert.ok(content.includes("托管条款（模拟）"), content);
assert.ok(content.includes("托管金额 = 订单金额"), content);
assert.ok(content.includes("托管方 = 平台"), content);
assert.ok(content.includes("释放条件 = 订单完成或双方确认"), content);
assert.ok(content.includes("模拟支付下无真实资金流动"), content);
// The rest of the contract is untouched.
assert.ok(content.includes("服务流程：预约→审核→模拟支付→服务完成→模拟结算。"), content);
assert.ok(content.includes("纠纷可通过订单申诉提交，资金状态仅为本地模拟。"), content);
assert.ok(content.includes(""), content);
});

test("r6-escrow: someone else's order -> 403", async () => {
const token = await login();
const other = await registerUser("escrow_other", "escrow123", "Escrow Other");
const s = await pickShow(1);
const order = await paidOrder(token, s.id, 1, D3);
const r = await escrow(other, order.id, "hold");
assert.equal(r.status, 403, JSON.stringify(r.json));
assert.equal((await myOrder(token, order.id)).escrow, "模拟托管中");
// Anonymous -> 401, also with no write.
const anon = await escrow(undefined, order.id, "hold");
assert.equal(anon.status, 401, JSON.stringify(anon.json));
assert.equal((await myOrder(token, order.id)).escrow, "模拟托管中");
});

test("r6-escrow: held order completes -> 已释放, unheld order completes -> 已结算", async () => {
const token = await login();
const s = await pickShow(2);
const held = await paidOrder(token, s.id, 1, D3);
const unheld = await paidOrder(token, s.id, 1, D3);
const h = await escrow(token, held.id, "hold");
assert.equal(h.status, 200, JSON.stringify(h.json));
assert.equal((await myOrder(token, held.id)).escrow, "已托管");
assert.equal((await myOrder(token, unheld.id)).escrow, "模拟托管中");
const c1 = await req(`/api/orders/${held.id}/complete`, { method: "POST", token});
assert.equal(c1.status, 200, JSON.stringify(c1.json));
assert.equal(c1.json.status, "completed");
assert.equal((await myOrder(token, held.id)).escrow, "已释放");
const c2 = await req(`/api/orders/${unheld.id}/complete`, { method: "POST", token});
assert.equal(c2.status, 200, JSON.stringify(c2.json));
assert.equal(c2.json.status, "completed");
assert.equal((await myOrder(token, unheld.id)).escrow, "已结算");
});
