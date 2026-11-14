import { createStorage } from "../storage.mjs";
import { time } from "./http.mjs";
import { enrichOrder } from "../routes/pickup.mjs";

export function createContext(database) {
  const db = database;
  // Object storage is fail-soft (null when AWS_* env vars are missing);
  // storage routes answer 503 then. See server/storage.mjs.
  const storage = createStorage();
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const audit = async (u, action, detail) =>
    await run(
      "INSERT INTO audit_logs(user_id,action,detail,created_at) VALUES(?,?,?,?)",
      u?.id || null,
      action,
      detail,
      time(),
    );
  // R6-5: messages carry a type (general / resource_update /
  // comment_reply / order_status). The type classifies the inbox;
  // it never changes who is notified or when. Old callers pass
  // nothing and keep the default 'general'.
  const MESSAGE_TYPES = [
    "general",
    "resource_update",
    "comment_reply",
    "order_status",
  ];
  const notify = async (uid, title, content, sender = 1, type = "general") =>
    await run(
      "INSERT INTO messages(user_id,sender_id,title,content,type,created_at) VALUES(?,?,?,?,?,?)",
      uid,
      sender,
      title,
      content,
      MESSAGE_TYPES.includes(type) ? type : "general",
      time(),
    );
  function transaction(fn) {
    // Write requests already run atomically on one database connection.
    return fn();
  }

  async function separateRead(fn) {
    // Independent READ-ONLY transaction for the limiter check: a
    // failing statement inside the request transaction aborts the
    // whole transaction (Postgres 25P02), so a dead limiter table
    // would turn every login into a 500 instead of failing open.
    return db.request(fn, { write: false, success: () => true });
  }

  async function separateRequest(fn) {
    // Independent transaction: commits even when the outer request rolls
    // back (a failed login answers 401, which rolls its transaction
    // back — see the OTP lesson). Skips the advisory lock: the outer
    // request already holds it, and taking it again on a second
    // connection would deadlock. Used by the login limiter
    // (server/lib/rate-limit.mjs); counting writes must survive failed
    // logins, or the limiter can never trip.
    return db.request(fn, { write: true, success: () => true, lock: false });
  }

  const resourceSelect = `
    SELECT r.*,
      COALESCE((SELECT AVG(rating) FROM comments c WHERE c.resource_id=r.id AND c.status='approved'),0) rating,
      (SELECT COUNT(*) FROM comments c WHERE c.resource_id=r.id AND c.status='approved') review_count
    FROM resources r`;

  async function orderRows(user) {
    const rows = await all(
      `SELECT o.*,r.name AS resource_name,r.image,r.category,r.city,r.unit FROM orders o
       JOIN resources r ON r.id=o.resource_id WHERE o.user_id=? ORDER BY o.id DESC`,
      user.id,
    );
    // R2-3: every order row carries its pickup point + the shop's
    // default template (nulls for an old-flow order), so the H5
    // my-tickets drawer and the mini-program order views render them
    // without a second round trip.
    const out = [];
    for (const o of rows)
      out.push({ ...o, ...(await enrichOrder(get, o)) });
    return out;
  }

  return {
    all, get, run, audit, notify, transaction, separateRequest, separateRead, resourceSelect, orderRows, storage,
    dialect: db.dialect,
  };
}
