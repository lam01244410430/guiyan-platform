import { assert } from "../lib/http.mjs";

// Wave 4 #14 — the READ side of the messages table. Writing already
// exists (lib/context.mjs notify(), called on order creation/status
// change, demand creation/review); before #14 nothing ever read a message
// back. System messages only: there is no way to send a message to
// another user, and no chat. A caller only ever sees their own rows.

export async function listMessages(ctx) {
  const { p, req, send, needUser, all, get, url } = ctx;
  if (p === "/api/messages" && req.method === "GET") {
    const u = needUser();
    let limit = parseInt(url.searchParams.get("limit") || "20", 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;
    const messages = await all(
      "SELECT id,title,content,is_read,created_at FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?",
      u.id,
      limit,
    );
    const row = await get(
      "SELECT COUNT(*) AS n FROM messages WHERE user_id=? AND is_read=0",
      u.id,
    );
    send({ messages, unread: row ? row.n : 0 });
    return true;
  }
  return false;
}

export async function markMessageRead(ctx) {
  const { p, req, send, needUser, get, run } = ctx;
  const m = p.match(/^\/api\/messages\/(\d+)\/read$/);
  if (m && req.method === "PATCH") {
    const u = needUser();
    const msg = await get(
      "SELECT id FROM messages WHERE id=? AND user_id=?",
      Number(m[1]),
      u.id,
    );
    assert(msg, "消息不存在", 404);
    await run("UPDATE messages SET is_read=1 WHERE id=?", Number(m[1]));
    send({ ok: true });
    return true;
  }
  return false;
}

export async function markAllMessagesRead(ctx) {
  const { p, req, send, needUser, run } = ctx;
  if (p === "/api/messages/read-all" && req.method === "PATCH") {
    const u = needUser();
    await run("UPDATE messages SET is_read=1 WHERE user_id=?", u.id);
    send({ ok: true });
    return true;
  }
  return false;
}
