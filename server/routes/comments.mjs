// R6-5 — 评分评论审核 + 消息通知 (xlsx rows 72, 75).
//
// Comments had NO API at all before this wave — only seed data (2 demo
// rows: 1 approved + 1 pending) and the approved-only rating /
// review_count aggregates in server/lib/context.mjs; comments.status
// existed but no endpoint read or wrote it. This file builds that flow:
// public list (approved only, plus the caller's own pending/rejected),
// login-gated create (new rows start pending; one pending comment per
// user per resource), and the admin review + reply flow. The seeded
// pending comment stays pending — no bulk change of historical data.
//
// Money is integer cents everywhere (no money moves here at all);
// validate first, write after, never throw after a write in the same
// request (OTP lesson); GETs run in REPEATABLE READ READ ONLY.
import { assert, text, int, time } from "../lib/http.mjs";

const STATUSES = ["approved", "rejected"];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/reviews only their own shop's resources.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertShopAccess(session, resource) {
  const scope = scopedShopId(session);
  assert(
    scope === null || resource.shop_id === scope,
    "无权管理该店铺的资源",
    403,
  );
}

function commentRow(c) {
  return {
    id: c.id,
    user_id: c.user_id,
    user_name: c.user_name,
    resource_id: c.resource_id,
    resource_name: c.resource_name,
    rating: c.rating,
    content: c.content,
    reply: c.reply || "",
    status: c.status,
    created_at: c.created_at,
  };
}

export async function listComments(ctx) {
  const { p, req, send, session, all, get } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/comments$/);
  if (m && req.method === "GET") {
    const id = Number(m[1]);
    const r = await get(
      "SELECT id, shop_id, status FROM resources WHERE id=?",
      id,
    );
    assert(r, "资源不存在", 404);
    const isAdmin = session?.role === "admin";
    // A draft resource's comments are not public (same rule as
    // GET /api/resources/:id, which only serves published rows).
    if (r.status !== "published" && !isAdmin) {
      assert(false, "资源不存在", 404);
    }
    if (isAdmin) assertShopAccess(session, r);
    let comments;
    if (isAdmin) {
      comments = await all(
        `SELECT c.*,u.name AS user_name,r.name AS resource_name FROM comments c
         JOIN users u ON u.id=c.user_id JOIN resources r ON r.id=c.resource_id
         WHERE c.resource_id=? ORDER BY c.id ASC`,
        id,
      );
    } else if (session) {
      // The author additionally sees their own pending/rejected rows.
      comments = await all(
        `SELECT c.*,u.name AS user_name,r.name AS resource_name FROM comments c
         JOIN users u ON u.id=c.user_id JOIN resources r ON r.id=c.resource_id
         WHERE c.resource_id=? AND (c.status='approved' OR c.user_id=?)
         ORDER BY c.id ASC`,
        id,
        session.id,
      );
    } else {
      comments = await all(
        `SELECT c.*,u.name AS user_name,r.name AS resource_name FROM comments c
         JOIN users u ON u.id=c.user_id JOIN resources r ON r.id=c.resource_id
         WHERE c.resource_id=? AND c.status='approved' ORDER BY c.id ASC`,
        id,
      );
    }
    send({ comments: comments.map(commentRow) });
    return true;
  }
  return false;
}

export async function createComment(ctx) {
  const { p, req, b, send, needUser, get, run, time } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/comments$/);
  if (m && req.method === "POST") {
    const u = needUser();
    const id = Number(m[1]);
    const r = await get(
      "SELECT id FROM resources WHERE id=? AND status='published'",
      id,
    );
    assert(r, "资源不存在", 404);
    // Validate everything before any write (OTP lesson).
    const rating = int(b.rating, "评分", 1, 5);
    const content = text(b.content, "评价内容", 500);
    const pending = await get(
      "SELECT id FROM comments WHERE user_id=? AND resource_id=? AND status='pending'",
      u.id,
      id,
    );
    assert(!pending, "您已提交过一条待审核评价，请等待审核", 400);
    const result = await run(
      "INSERT INTO comments(user_id,resource_id,rating,content,status,created_at) VALUES(?,?,?,?,?,?)",
      u.id,
      id,
      rating,
      content,
      "pending",
      time(),
    );
    send({ ok: true, id: Number(result.lastInsertRowid) });
    return true;
  }
  return false;
}

export async function listAdminComments(ctx) {
  const { p, req, send, session, all, url } = ctx;
  if (p === "/api/admin/comments" && req.method === "GET") {
    assertAdmin(session);
    const status = url.searchParams.get("status") || "";
    assert(
      status === "" || ["pending", ...STATUSES].includes(status),
      "审核状态错误",
    );
    const scope = scopedShopId(session);
    const conds = [];
    const params = [];
    if (scope !== null) {
      conds.push("r.shop_id=?");
      params.push(scope);
    }
    if (status !== "") {
      conds.push("c.status=?");
      params.push(status);
    }
    const comments = await all(
      `SELECT c.*,u.name AS user_name,r.name AS resource_name FROM comments c
       JOIN users u ON u.id=c.user_id JOIN resources r ON r.id=c.resource_id
       ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
       ORDER BY c.id DESC`,
      ...params,
    );
    send({ comments: comments.map(commentRow) });
    return true;
  }
  return false;
}

export async function reviewComment(ctx) {
  const { p, req, b, send, session, get, run, audit, cache } = ctx;
  const m = p.match(/^\/api\/admin\/comments\/(\d+)$/);
  if (m && req.method === "PATCH") {
    assertAdmin(session);
    assert(STATUSES.includes(b.status), "审核状态错误");
    const id = int(Number(m[1]), "编号", 1);
    const c = await get(
      `SELECT c.*,r.shop_id,r.name AS resource_name FROM comments c
       JOIN resources r ON r.id=c.resource_id WHERE c.id=?`,
      id,
    );
    assert(c, "评价不存在", 404);
    assertShopAccess(session, c);
    assert(c.status === "pending", "该评价已审核", 400);
    await run("UPDATE comments SET status=? WHERE id=?", b.status, id);
    await audit(session, "审核评论", `${c.resource_name} #${id} ${b.status}`);
    // Approval changes the resource's rating/review_count (the
    // context.mjs aggregation reads approved rows only), which feeds
    // the cached resources list — bust it like any resource write.
    if (cache) await cache.bustResources();
    send({ ok: true, status: b.status });
    return true;
  }
  return false;
}

export async function replyComment(ctx) {
  const { p, req, b, send, session, get, run, notify, audit } = ctx;
  const m = p.match(/^\/api\/admin\/comments\/(\d+)\/reply$/);
  if (m && req.method === "PATCH") {
    assertAdmin(session);
    const id = int(Number(m[1]), "编号", 1);
    const reply = text(b.reply, "回复内容", 500);
    const c = await get(
      `SELECT c.*,r.shop_id,r.name AS resource_name FROM comments c
       JOIN resources r ON r.id=c.resource_id WHERE c.id=?`,
      id,
    );
    assert(c, "评价不存在", 404);
    assertShopAccess(session, c);
    await run("UPDATE comments SET reply=? WHERE id=?", reply, id);
    await notify(
      c.user_id,
      "评论回复",
      `“${c.resource_name}”的商家回复：${reply}`,
      1,
      "comment_reply",
    );
    await audit(session, "回复评论", `${c.resource_name} #${id}`);
    send({ ok: true });
    return true;
  }
  return false;
}
