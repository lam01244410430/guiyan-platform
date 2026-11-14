// tests/r6-comments.test.mjs: R6-5 (rows 72, 75) — 评分评论审核 +
// 消息通知. Spawns server/server.mjs on TEST_PORT (default 3120) and
// talks to it over HTTP. DATABASE_URL must point at a FRESH disposable
// database.
//
// Covered (9 tests): (1) a pending comment is invisible to others but
// visible to its author; (2) approve -> visible to everyone, and the
// resource rating/review_count update (context.mjs approved-only
// aggregation); (3) reject -> stays hidden (author still sees their
// own rejected row); (4) repeat submit while one is pending -> 400
// (rating out of range -> 400 too); (5) an admin reply notifies the
// author (inbox has a comment_reply message) and the reply renders on
// the comment; (6) a resource price change notifies users who
// favorited it (resource_update) and nobody else; (7) delisting
// (published -> draft) notifies favoriters too; (8) anonymous post
// -> 401, non-admin review -> 403, public list stays 200; (9) an
// order pay writes an inbox message typed order_status.
//
// Fixture notes: every comment test runs on one admin-created resource
// (R6-5 test resource, ¥280) so the seed comments on resources 1..22
// cannot interfere — including the seeded pending comment (resource 1,
// user 4), which stays pending and is never touched. The order test
// buys seed resource 1 like the R5 tests. Test usernames are
// hyphen-free ([A-Za-z0-9_], R4-4 lesson). i18n: H5 385 / miniprogram
// 194 (13 new comment + message-type keys both sides: 372 -> 385,
// 181 -> 194).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = Number(process.env.TEST_PORT || 3120);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
  return { token: r.data.token, userId: r.data.user.id };
}

async function getMessages(token, qs = "") {
  const r = await req(`/api/messages${qs}`, { token });
  assert.equal(r.status, 200, `messages ${qs} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.messages;
}

let adminToken;
let resourceId;
let author;
let other;
let favUser;
let repeatUser;
let orderUser;
let approvedCommentId;
let rejectedCommentId;

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
  author = await register("r6cmtAuthor", "Test1234");
  other = await register("r6cmtOther", "Test1234");
  favUser = await register("r6cmtFav", "Test1234");
  repeatUser = await register("r6cmtRepeat", "Test1234");
  orderUser = await register("r6cmtOrder", "Test1234");
  const created = await req("/api/admin/resources", {
    method: "POST",
    token: adminToken,
    body: {
      name: "R65评论测试资源",
      category: "show",
      city: "南宁",
      price: 28000,
      unit: "张",
      description: "R6-5 test resource",
      image: "/images/test.jpg",
    },
  });
  assert.equal(created.status, 200, `create resource -> ${created.status} ${JSON.stringify(created.data)}`);
  resourceId = created.data.id;
  const fav = await req("/api/favorites", {
    method: "POST",
    token: favUser.token,
    body: { resourceId },
  });
  assert.equal(fav.status, 200, `favorite -> ${fav.status} ${JSON.stringify(fav.data)}`);
  assert.equal(fav.data.favorite, true);
});

after(async () => {
  if (child) child.kill("SIGTERM");
  await pool.end();
});

test("pending comment invisible to others, visible to its author", async () => {
  const posted = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    token: author.token,
    body: { rating: 5, content: "R65 很好看，推荐" },
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  assert.ok(posted.data.id, "post returns the comment id");
  approvedCommentId = posted.data.id;
  const pub = await req(`/api/resources/${resourceId}/comments`);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.comments.length, 0, "no approved comment yet");
  const asOther = await req(`/api/resources/${resourceId}/comments`, {
    token: other.token,
  });
  assert.equal(asOther.data.comments.length, 0, "another user sees nothing pending");
  const asAuthor = await req(`/api/resources/${resourceId}/comments`, {
    token: author.token,
  });
  assert.equal(asAuthor.data.comments.length, 1, "author sees their own pending row");
  assert.equal(asAuthor.data.comments[0].status, "pending");
  assert.equal(asAuthor.data.comments[0].content, "R65 很好看，推荐");
  const detail = await req(`/api/resources/${resourceId}`);
  assert.equal(detail.data.resource.rating, 0, "no approved comment -> rating 0");
  assert.equal(detail.data.resource.review_count, 0);
});

test("approve -> visible to everyone, rating/review_count update", async () => {
  const reviewed = await req(`/api/admin/comments/${approvedCommentId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "approved" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  const pub = await req(`/api/resources/${resourceId}/comments`);
  assert.equal(pub.data.comments.length, 1, "approved comment is public now");
  assert.equal(pub.data.comments[0].rating, 5);
  assert.equal(pub.data.comments[0].user_name, "r6cmtAuthor");
  const detail = await req(`/api/resources/${resourceId}`);
  assert.equal(detail.data.resource.rating, 5, "approved-only aggregation picks the comment up");
  assert.equal(detail.data.resource.review_count, 1);
  const logs = await req("/api/admin/audit-logs", { token: adminToken });
  assert.equal(logs.status, 200);
  assert.ok(
    logs.data.logs.some((l) => l.action === "审核评论"),
    "review audits 审核评论",
  );
});

test("reject -> stays hidden, author still sees their own row", async () => {
  const posted = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    token: other.token,
    body: { rating: 2, content: "R65 一般" },
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  rejectedCommentId = posted.data.id;
  const reviewed = await req(`/api/admin/comments/${rejectedCommentId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "rejected" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  const pub = await req(`/api/resources/${resourceId}/comments`);
  assert.equal(pub.data.comments.length, 1, "rejected comment never goes public");
  assert.equal(pub.data.comments[0].id, approvedCommentId);
  const asAuthor = await req(`/api/resources/${resourceId}/comments`, {
    token: other.token,
  });
  const own = asAuthor.data.comments.find((c) => c.id === rejectedCommentId);
  assert.ok(own, "author sees their own rejected row");
  assert.equal(own.status, "rejected");
  // Only pending can be decided: a second decision on the same row -> 400.
  const again = await req(`/api/admin/comments/${rejectedCommentId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "approved" },
  });
  assert.equal(again.status, 400, JSON.stringify(again.data));
});

test("repeat submit while one is pending -> 400; rating out of range -> 400", async () => {
  const first = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    token: repeatUser.token,
    body: { rating: 4, content: "R65 还不错" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    token: repeatUser.token,
    body: { rating: 5, content: "R65 再来一条" },
  });
  assert.equal(second.status, 400, JSON.stringify(second.data));
  const badRating = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    token: orderUser.token,
    body: { rating: 6, content: "R65 评分越界" },
  });
  assert.equal(badRating.status, 400, JSON.stringify(badRating.data));
  // Leave no pending row behind for later tests: the repeat user's
  // pending comment is rejected here (it is this file's own row).
  const reviewed = await req(`/api/admin/comments/${first.data.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "rejected" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
});

test("reply -> author inbox has a comment_reply message, reply renders", async () => {
  const replied = await req(`/api/admin/comments/${approvedCommentId}/reply`, {
    method: "PATCH",
    token: adminToken,
    body: { reply: "谢谢支持，欢迎再来" },
  });
  assert.equal(replied.status, 200, JSON.stringify(replied.data));
  const inbox = await getMessages(author.token);
  const note = inbox.find((m) => m.type === "comment_reply");
  assert.ok(note, `author inbox has comment_reply, got ${JSON.stringify(inbox.map((m) => m.type))}`);
  assert.match(note.content, /谢谢支持/);
  const pub = await req(`/api/resources/${resourceId}/comments`);
  assert.equal(pub.data.comments[0].reply, "谢谢支持，欢迎再来");
  // The typed filter only returns that group.
  const filtered = await getMessages(author.token, "?type=comment_reply");
  assert.ok(filtered.length >= 1);
  assert.ok(filtered.every((m) => m.type === "comment_reply"));
});

test("price change -> favoriting users get resource_update, nobody else", async () => {
  const edited = await req(`/api/admin/resources/${resourceId}`, {
    method: "PATCH",
    token: adminToken,
    body: { price: 30000 },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.resource.price, 30000);
  const favInbox = await getMessages(favUser.token);
  const note = favInbox.find((m) => m.type === "resource_update");
  assert.ok(note, `favoriter inbox has resource_update, got ${JSON.stringify(favInbox.map((m) => m.type))}`);
  assert.match(note.content, /300|¥300/);
  const authorInbox = await getMessages(author.token);
  assert.equal(
    authorInbox.filter((m) => m.type === "resource_update").length,
    0,
    "a non-favoriter gets no resource_update",
  );
});

test("delisting -> favoriting users get another resource_update", async () => {
  const before = (await getMessages(favUser.token)).filter(
    (m) => m.type === "resource_update",
  ).length;
  const edited = await req(`/api/admin/resources/${resourceId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "draft" },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const after = (await getMessages(favUser.token)).filter(
    (m) => m.type === "resource_update",
  ).length;
  assert.equal(after, before + 1, "delisting notifies the favoriter once more");
  const latest = (await getMessages(favUser.token)).find(
    (m) => m.type === "resource_update",
  );
  assert.match(latest.content, /下架/);
});

test("anonymous post -> 401; non-admin review -> 403; public list stays 200", async () => {
  const anon = await req(`/api/resources/${resourceId}/comments`, {
    method: "POST",
    body: { rating: 5, content: "R65 匿名" },
  });
  assert.equal(anon.status, 401, JSON.stringify(anon.data));
  const notAdmin = await req(`/api/admin/comments/${approvedCommentId}`, {
    method: "PATCH",
    token: author.token,
    body: { status: "approved" },
  });
  assert.equal(notAdmin.status, 403, JSON.stringify(notAdmin.data));
  // Seed resource 1 is published: its public list stays 200 (the
  // approved seed comment on resource 2 is covered by the same shape
  // on any published resource; resource 1's own approved rows are
  // asserted by the seed, not here).
  const pub = await req("/api/resources/1/comments");
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.ok(Array.isArray(pub.data.comments));
  // The test resource was delisted in the previous test, so its
  // public list is now 404 — drafts are not public (same rule as
  // GET /api/resources/:id). The admin still sees its comments.
  const delisted = await req(`/api/resources/${resourceId}/comments`);
  assert.equal(delisted.status, 404, JSON.stringify(delisted.data));
  const asAdmin = await req(`/api/resources/${resourceId}/comments`, {
    token: adminToken,
  });
  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.data));
  const adminList = await req("/api/admin/comments?status=pending", {
    token: adminToken,
  });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.data));
  // The seeded pending comment (resource 1, user 4) is still pending
  // and still listed — this wave never bulk-changes historical data.
  assert.ok(
    adminList.data.comments.some(
      (c) => c.resource_id === 1 && c.status === "pending",
    ),
    "seeded pending comment stays pending",
  );
});

test("order pay -> inbox message typed order_status", async () => {
  const o = await req("/api/orders", {
    method: "POST",
    token: orderUser.token,
    body: { resourceId: 1, quantity: 1, booking_date: "2026-12-20" },
  });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const confirmed = await req(`/api/orders/${o.data.id}/confirm`, {
    method: "POST",
    token: orderUser.token,
    body: {},
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const paid = await req(`/api/orders/${o.data.id}/pay`, {
    method: "POST",
    token: orderUser.token,
    body: {},
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const inbox = await getMessages(orderUser.token);
  const note = inbox.find((m) => m.type === "order_status");
  assert.ok(note, `order inbox has order_status, got ${JSON.stringify(inbox.map((m) => m.type))}`);
});
