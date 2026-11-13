// Ticket issuance + verification (Roadmap 82 Wave R4-1, 2026-11-14) —
// xlsx rows 20, 30. One ticket per paid unit; a ticket is a code the
// gate scans (`POST /api/verify/:code`). There is NO separate staff
// role in this system — staff = admin role, so verification is
// admin-only. Paper printing (R4-2, row 29) lives here too:
// `POST /api/admin/tickets/print` + `GET /api/admin/print-logs` —
// the endpoint only RECORDS the print event; paper output is the
// browser's print of the ticket layout (window.print), never a
// physical printer integration.
//
// Fixed rules (see docs/10-she-ji-wen-dang/03-xiang-mu-jie-duan.md
// §"Lộ trình 82 module — Sóng R4" R4-1):
// - Code: `GY` + 8 chars [A-Z0-9] from crypto.randomBytes; UNIQUE;
//   a 23505 retries with a fresh code (max 5 attempts, then 500).
//   The retry uses a SAVEPOINT: a failed INSERT aborts its Postgres
//   transaction (25P02), so a bare retry in the same transaction
//   could never succeed.
// - Issued at pay only (see issueTicketsForOrder, called from the
//   pay branch of transitionOrder): one ticket per order.quantity;
//   seat orders link tickets 1:1 to the order's sold seats
//   (row, col ASC); non-seat orders get seat_id NULL.
// - Verify checks ticket status ONLY — no date/performance check
//   this wave (an expired performance's ticket still verifies;
//   documented, never claimed otherwise).
// - Batch verify (R4-3, rows 31, 78): `POST /api/verify/batch`
//   verifies up to 50 codes in ONE transaction, one result per
//   code; a bad code never throws the batch; re-sending the same
//   batch returns already_used (no double-use); every attempt
//   writes a verify_logs row (the batch answers 200 overall, so
//   the logs live in the main transaction — no separateRequest
//   needed, unlike the single-verify 4xx paths).
// - Every verify attempt writes a verify_logs row (success +
//   failures, including the 404 case). A 4xx response rolls the
//   request transaction back, so failure logs go through
//   ctx.separateRequest (an independent transaction that commits
//   even when the outer one rolls back — same pattern as the login
//   limiter in server/lib/rate-limit.mjs); the success log stays in
//   the main transaction, atomic with the status change.
// - A ticket frozen in a pending partial refund refuses with 400
//   "票正在退款审核中" + log refund_pending. The
//   pending_refund_tickets column exists since R4-4 (orders ALTERs
//   in postgres.mjs); the check still probes information_schema
//   first and treats a missing column as "nothing frozen", so the
//   code works on a DB created before R4-4 too.
// - Write requests hold the global advisory lock, so the
//   check-then-update in verify is race-safe (same reasoning as the
//   R2-5 seat hold).
import { randomBytes } from "node:crypto";
import { assert, int, time } from "../lib/http.mjs";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_CODE_ATTEMPTS = 5;

// `GY` + 8 chars [A-Z0-9] (e.g. GY7K2Q9X4M), from crypto.randomBytes.
export function generateTicketCode() {
  const bytes = randomBytes(8);
  let code = "GY";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

function ticketRow(t) {
  if (!t) return null;
  return {
    id: t.id,
    order_id: t.order_id,
    seat_id: t.seat_id ?? null,
    code: t.code,
    status: t.status,
    printed_at: t.printed_at ?? null,
    verified_at: t.verified_at ?? null,
    verified_by: t.verified_by ?? null,
    created_at: t.created_at,
    ...(t.seat_row !== undefined ? { seat_row: t.seat_row ?? null } : {}),
    ...(t.seat_col !== undefined ? { seat_col: t.seat_col ?? null } : {}),
    ...(t.order_code !== undefined ? { order_code: t.order_code } : {}),
    ...(t.resource_name !== undefined
      ? { resource_name: t.resource_name }
      : {}),
  };
}

function orderInfo(o) {
  if (!o) return null;
  return {
    id: o.id,
    code: o.code,
    resource_name: o.resource_name,
    booking_date: o.booking_date,
    quantity: o.quantity,
    status: o.status,
  };
}

async function logVerify(run, { ticketId, code, result, verifiedBy, now }) {
  await run(
    "INSERT INTO verify_logs(ticket_id,code,result,verified_by,created_at) VALUES(?,?,?,?,?)",
    ticketId,
    code,
    result,
    verifiedBy,
    now,
  );
}

// Issue one ticket per order.quantity, inside the caller's
// transaction (pay branch, or the setup backfill in postgres.mjs —
// both run under the advisory lock, so check-then-insert is safe).
// Seat orders link tickets 1:1 to the order's sold seats (row, col
// ASC); a quantity larger than the sold-seat count leaves the extra
// tickets with seat_id NULL. Returns the issued codes.
export async function issueTicketsForOrder(get, run, order, now) {
  const qty = Number(order.quantity) || 0;
  if (qty <= 0) return [];
  const seatRow = await get(
    "SELECT array_agg(id ORDER BY row ASC, col ASC, id ASC) AS ids FROM seats WHERE order_id=? AND status='sold'",
    order.id,
  );
  const seatIds = Array.isArray(seatRow?.ids) ? seatRow.ids : [];
  const stamp = now();
  const codes = [];
  for (let i = 0; i < qty; i++) {
    const seatId = seatIds[i] ?? null;
    let issued = false;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !issued; attempt++) {
      const code = generateTicketCode();
      await run("SAVEPOINT ticket_issue");
      try {
        await run(
          "INSERT INTO tickets(order_id,seat_id,code,status,created_at) VALUES(?,?,?,'issued',?)",
          order.id,
          seatId,
          code,
          stamp,
        );
        codes.push(code);
        issued = true;
      } catch (e) {
        // A failed statement aborts the transaction — roll back to
        // the savepoint before retrying with a fresh code.
        await run("ROLLBACK TO SAVEPOINT ticket_issue");
        if (e.code !== "23505" || attempt === MAX_CODE_ATTEMPTS - 1)
          throw e;
      }
      await run("RELEASE SAVEPOINT ticket_issue");
    }
    if (!issued) assert(false, "生成票码失败，请重试", 500);
  }
  return codes;
}

// The ticket ids frozen in the order's pending partial-refund
// request (R4-4). The pending_refund_tickets column exists since
// R4-4 — probe information_schema and treat a missing column as an
// empty freeze list (see the file header). Exported: the R4-2 print
// endpoint reuses the same freeze check, so a frozen ticket refuses
// both verify and print.
export async function pendingRefundTicketIds(get, orderId) {
  const col = await get(
    "SELECT 1 AS x FROM information_schema.columns WHERE table_name='orders' AND column_name='pending_refund_tickets'",
  );
  if (!col) return [];
  const row = await get(
    "SELECT pending_refund_tickets FROM orders WHERE id=?",
    orderId,
  );
  try {
    const ids = JSON.parse(row?.pending_refund_tickets || "[]");
    return Array.isArray(ids) ? ids.map(Number) : [];
  } catch {
    return [];
  }
}

// POST /api/verify/:code — admin only (staff = admin role; no
// separate staff role exists). Anonymous -> 401 (needUser), a
// signed-in non-admin -> 403.
export async function verifyTicket(ctx) {
  const { p, req, send, needUser, session, get, run, separateRequest } = ctx;
  const m = p.match(/^\/api\/verify\/([^/]+)$/);
  if (!m || req.method !== "POST") return false;
  const u = needUser();
  assertAdmin(session);
  // Ticket codes are GY + [A-Z0-9] only, so the raw path segment is
  // the code — no percent-decoding (decodeURIComponent would throw
  // a 500 on a malformed % sequence; an unknown code is a 404).
  const code = m[1].trim().toUpperCase();
  assert(code !== "", "票码不能为空", 400);
  const now = time();
  const ticket = await get("SELECT * FROM tickets WHERE code=?", code);
  if (!ticket) {
    // The 404 response rolls the request transaction back, so the
    // not_found log goes through an independent transaction.
    await separateRequest(async () => {
      await logVerify(run, {
        ticketId: null,
        code,
        result: "not_found",
        verifiedBy: u.id,
        now,
      });
    });
    send({ error: "票不存在", code }, 404);
    return true;
  }
  const order = await get(
    "SELECT o.*, r.name AS resource_name FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
    ticket.order_id,
  );
  const fail = async (result, message, status) => {
    await separateRequest(async () => {
      await logVerify(run, {
        ticketId: ticket.id,
        code,
        result,
        verifiedBy: u.id,
        now,
      });
    });
    send(
      { error: message, ticket: ticketRow(ticket), order: orderInfo(order) },
      status,
    );
    return true;
  };
  // Frozen in a pending partial refund (R4-4) — checked before the
  // status, so a frozen ticket never verifies even while issued.
  const frozen = await pendingRefundTicketIds(get, ticket.order_id);
  if (frozen.includes(ticket.id))
    return fail("refund_pending", "票正在退款审核中", 400);
  if (ticket.status === "void")
    return fail("void", "票已作废", 400);
  if (ticket.status === "used")
    return fail("already_used", "票已核销", 400);
  // issued -> used, with the log, in the one request transaction.
  await run(
    "UPDATE tickets SET status='used', verified_at=?, verified_by=? WHERE id=? AND status='issued'",
    now,
    u.id,
    ticket.id,
  );
  await logVerify(run, {
    ticketId: ticket.id,
    code,
    result: "used",
    verifiedBy: u.id,
    now,
  });
  const fresh = await get("SELECT * FROM tickets WHERE id=?", ticket.id);
  send({ ok: true, ticket: ticketRow(fresh), order: orderInfo(order) });
  return true;
}

// --- R4-3: batch verify (xlsx rows 31, 78) ----------------------
// POST /api/verify/batch — admin only (staff = admin role; same
// convention as verifyTicket: anonymous -> 401 via needUser,
// signed-in non-admin -> 403). Body {codes: [...]}: at most 50
// codes, an empty array -> 400, a non-array -> 400. ONE
// transaction, one result per code in input order:
//   {code, result, ticket?, order?} with result in
//   used/already_used/not_found/void/refund_pending.
// A single bad code NEVER throws the batch — the loop continues
// and the batch still answers 200. Idempotent: a code verified
// earlier in this batch (or in a previous batch) is re-read inside
// the same transaction, so the second occurrence sees status
// 'used' and answers already_used — no double-use. Every attempt
// writes a verify_logs row in the same transaction (the batch
// answers 200, so the main transaction commits and the logs
// survive — no separateRequest needed here).
// NOTE: this route must be dispatched BEFORE verifyTicket (see
// server/index.mjs) — the single-verify matcher
// /^\/api\/verify\/([^/]+)$/ would otherwise swallow "batch" as
// a ticket code.
export async function verifyBatch(ctx) {
  const { p, req, b, send, needUser, session, get, run } = ctx;
  if (p !== "/api/verify/batch" || req.method !== "POST") return false;
  const u = needUser();
  assertAdmin(session);
  assert(Array.isArray(b?.codes), "请提供票码列表", 400);
  assert(b.codes.length > 0, "票码列表不能为空", 400);
  assert(b.codes.length <= 50, "一次最多核销 50 张票", 400);
  const now = time();
  const results = [];
  for (const raw of b.codes) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (!code) {
      await logVerify(run, {
        ticketId: null,
        code,
        result: "not_found",
        verifiedBy: u.id,
        now,
      });
      results.push({ code, result: "not_found", ticket: null, order: null });
      continue;
    }
    const ticket = await get("SELECT * FROM tickets WHERE code=?", code);
    if (!ticket) {
      await logVerify(run, {
        ticketId: null,
        code,
        result: "not_found",
        verifiedBy: u.id,
        now,
      });
      results.push({ code, result: "not_found", ticket: null, order: null });
      continue;
    }
    const order = await get(
      "SELECT o.*, r.name AS resource_name FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
      ticket.order_id,
    );
    const found = {
      code,
      ticket: ticketRow(ticket),
      order: orderInfo(order),
    };
    const fail = async (result) => {
      await logVerify(run, {
        ticketId: ticket.id,
        code,
        result,
        verifiedBy: u.id,
        now,
      });
      results.push({ ...found, result });
    };
    // Frozen in a pending partial refund (R4-4) — same probe as
    // verifyTicket; a missing column means nothing is frozen.
    const frozen = await pendingRefundTicketIds(get, ticket.order_id);
    if (frozen.includes(ticket.id)) {
      await fail("refund_pending");
      continue;
    }
    if (ticket.status === "void") {
      await fail("void");
      continue;
    }
    if (ticket.status === "used") {
      await fail("already_used");
      continue;
    }
    // issued -> used, with the log, in the batch transaction.
    await run(
      "UPDATE tickets SET status='used', verified_at=?, verified_by=? WHERE id=? AND status='issued'",
      now,
      u.id,
      ticket.id,
    );
    await logVerify(run, {
      ticketId: ticket.id,
      code,
      result: "used",
      verifiedBy: u.id,
      now,
    });
    const fresh = await get("SELECT * FROM tickets WHERE id=?", ticket.id);
    results.push({
      code,
      result: "used",
      ticket: ticketRow(fresh),
      order: orderInfo(order),
    });
  }
  send({ results });
  return true;
}

// GET /api/orders/:id/tickets — the order owner or an admin. Paid
// orders carry tickets; an unpaid order answers an empty list (no
// tickets exist before pay).
export async function listOrderTickets(ctx) {
  const { p, req, send, needUser, get, all } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/tickets$/);
  if (!m || req.method !== "GET") return false;
  const u = needUser();
  const o = await get("SELECT * FROM orders WHERE id=?", Number(m[1]));
  assert(o, "订单不存在", 404);
  assert(o.user_id === u.id || u.role === "admin", "无权查看此订单", 403);
  const rows = await all(
    "SELECT t.*, s.row AS seat_row, s.col AS seat_col FROM tickets t LEFT JOIN seats s ON s.id=t.seat_id WHERE t.order_id=? ORDER BY t.id ASC",
    o.id,
  );
  send({
    order_id: o.id,
    order_code: o.code,
    tickets: rows.map(ticketRow),
  });
  return true;
}

// GET /api/admin/tickets — admin, shop-scoped via order ->
// resource.shop_id (platform admin: all shops; shop-scoped admin:
// own shop only). ?order_id= & ?status= (issued/used/void) &
// ?code= (normalized like verify). Newest first, LIMIT 200.
export async function listAdminTickets(ctx) {
  const { p, req, send, session, get, all, url } = ctx;
  if (p !== "/api/admin/tickets" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = session.shop_id ?? null;
  const orderParam = url.searchParams.get("order_id");
  const statusParam = url.searchParams.get("status");
  const codeParam = url.searchParams.get("code");
  let sql =
    "SELECT t.*, o.code AS order_code, r.name AS resource_name FROM tickets t JOIN orders o ON o.id=t.order_id JOIN resources r ON r.id=o.resource_id WHERE 1=1";
  const params = [];
  if (scope !== null) {
    sql += " AND r.shop_id=?";
    params.push(scope);
  }
  if (orderParam !== null && orderParam !== "") {
    sql += " AND t.order_id=?";
    params.push(int(Number(orderParam), "订单", 1));
  }
  if (statusParam !== null && statusParam !== "") {
    assert(
      ["issued", "used", "void"].includes(statusParam),
      "票状态须为 issued、used 或 void",
      400,
    );
    sql += " AND t.status=?";
    params.push(statusParam);
  }
  if (codeParam !== null && codeParam !== "") {
    sql += " AND t.code=?";
    params.push(codeParam.trim().toUpperCase());
  }
  sql += " ORDER BY t.id DESC LIMIT 200";
  const rows = await all(sql, ...params);
  send({ tickets: rows.map(ticketRow) });
  return true;
}

// --- R4-2: paper ticket printing (xlsx row 29) -------------------
// HONESTY BOUNDARY: this endpoint only RECORDS the print event —
// one print_logs row per ticket + the ticket's printed_at — and the
// paper output is the browser's print of the ticket layout
// (window.print + print CSS, in the admin / H5 UIs). There is NO
// physical printer integration here: no printer is connected, and
// nothing in this file claims one is.

function printLogRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    ticket_id: r.ticket_id,
    code: r.code ?? null,
    order_id: r.order_id ?? null,
    order_code: r.order_code ?? null,
    printed_by: r.printed_by ?? null,
    printed_at: r.printed_at,
    created_at: r.created_at,
  };
}

// The shop that owns a ticket (ticket -> order -> resource.shop_id),
// for the shop-scope check. Platform admin (shop_id NULL) sees all
// shops; a shop-scoped admin sees only their own shop.
async function ticketShopId(get, ticketId) {
  const row = await get(
    "SELECT r.shop_id AS shop_id FROM tickets t JOIN orders o ON o.id=t.order_id JOIN resources r ON r.id=o.resource_id WHERE t.id=?",
    ticketId,
  );
  return row?.shop_id ?? null;
}

// POST /api/admin/tickets/print — admin only (same convention as
// the other admin ticket routes: anonymous -> 403, non-admin ->
// 403). Body {order_id} or {ticket_ids} (ticket_ids wins when both
// are given). Only `issued` tickets print: used/void -> 400, and a
// ticket frozen in a pending partial refund -> 400
// "票正在退款审核中" (same freeze probe as verify). Re-printing an
// already-printed issued ticket is allowed — a new print_logs row
// and printed_at updated (the paper-jam case). Validate first,
// write after: one transaction updates printed_at and writes one
// print_logs row per ticket. Response {printed, tickets}.
export async function printTickets(ctx) {
  const { p, req, b, send, session, get, all, run } = ctx;
  if (p !== "/api/admin/tickets/print" || req.method !== "POST") return false;
  assertAdmin(session);
  const scope = session.shop_id ?? null;
  const now = time();
  let tickets;
  if (Array.isArray(b?.ticket_ids)) {
    assert(b.ticket_ids.length > 0, "请提供要打印的票", 400);
    tickets = [];
    for (const rawId of b.ticket_ids) {
      const id = int(Number(rawId), "票", 1);
      const t = await get("SELECT * FROM tickets WHERE id=?", id);
      assert(t, "票不存在", 404);
      tickets.push(t);
    }
  } else if (b?.order_id !== undefined && b?.order_id !== null) {
    const orderId = int(Number(b.order_id), "订单", 1);
    const order = await get("SELECT * FROM orders WHERE id=?", orderId);
    assert(order, "订单不存在", 404);
    tickets = await all(
      "SELECT * FROM tickets WHERE order_id=? ORDER BY id ASC",
      orderId,
    );
    assert(tickets.length > 0, "该订单暂无可打印的票", 400);
  } else {
    assert(false, "请提供 order_id 或 ticket_ids", 400);
  }
  // Shop scope, then status / freeze — all validated before any
  // write, so a refused print leaves no log row behind.
  for (const t of tickets) {
    const shopId = await ticketShopId(get, t.id);
    assert(
      scope === null || shopId === scope,
      "只能打印本店铺的票",
      403,
    );
  }
  for (const t of tickets) {
    const frozen = await pendingRefundTicketIds(get, t.order_id);
    if (frozen.includes(t.id)) assert(false, "票正在退款审核中", 400);
    if (t.status === "void") assert(false, "票已作废", 400);
    if (t.status === "used") assert(false, "票已核销", 400);
  }
  for (const t of tickets) {
    await run("UPDATE tickets SET printed_at=? WHERE id=?", now, t.id);
    await run(
      "INSERT INTO print_logs(ticket_id,printed_by,printed_at,created_at) VALUES(?,?,?,?)",
      t.id,
      session.id,
      now,
      now,
    );
  }
  const fresh = await all(
    "SELECT * FROM tickets WHERE id IN (" +
      tickets.map(() => "?").join(",") +
      ") ORDER BY id ASC",
    ...tickets.map((t) => t.id),
  );
  send({ printed: fresh.length, tickets: fresh.map(ticketRow) });
  return true;
}

// GET /api/admin/print-logs — admin, shop-scoped via ticket ->
// order -> resource.shop_id. ?ticket_id= & ?order_id=. Newest
// first, LIMIT 200.
export async function listPrintLogs(ctx) {
  const { p, req, send, session, all, url } = ctx;
  if (p !== "/api/admin/print-logs" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = session.shop_id ?? null;
  const ticketParam = url.searchParams.get("ticket_id");
  const orderParam = url.searchParams.get("order_id");
  let sql =
    "SELECT pl.*, t.code AS code, t.order_id AS order_id, o.code AS order_code FROM print_logs pl JOIN tickets t ON t.id=pl.ticket_id JOIN orders o ON o.id=t.order_id JOIN resources r ON r.id=o.resource_id WHERE 1=1";
  const params = [];
  if (scope !== null) {
    sql += " AND r.shop_id=?";
    params.push(scope);
  }
  if (ticketParam !== null && ticketParam !== "") {
    sql += " AND pl.ticket_id=?";
    params.push(int(Number(ticketParam), "票", 1));
  }
  if (orderParam !== null && orderParam !== "") {
    sql += " AND t.order_id=?";
    params.push(int(Number(orderParam), "订单", 1));
  }
  sql += " ORDER BY pl.id DESC LIMIT 200";
  const rows = await all(sql, ...params);
  send({ print_logs: rows.map(printLogRow) });
  return true;
}
