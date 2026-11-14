// Event tracking + batch aggregation (Roadmap 82 Wave R5-1, 2026-11-14)
// — xlsx rows 36, 37. The `events` table already exists (Wave 3 #11:
// `view`, detail = resource id, anonymous OK). This wave adds the
// remaining types and the batch job that turns the raw stream into
// per-hour / per-day counts.
//
// Event types (fixed allowlist — anything else is a 400):
// - view:   detail = resource id (as before; also accepted here, so
//           clients have one endpoint for every event)
// - click:  detail = `resource:{id}` / `show:{id}` / `ticket_type:{id}`
// - search: detail = the query, at most 200 chars
// - dwell:  detail = `resource:{id}`, duration in `duration_ms`
//           (0–3600000 ms = 0–60 min); view/click/search always write 0.
//
// POST /api/events is PUBLIC, anonymous allowed, exactly like the
// view endpoint — tracking must never force a login. There is NO
// rate limit on this endpoint in this wave (documented: #29 limits
// logins only); the admin aggregation endpoints below are admin-only.
//
// Aggregation (fixed): POST /api/admin/aggregate-events recomputes
// the aggregates for one period + date from `events` and upserts
// them, so running it twice changes nothing (idempotent). There is
// NO cron / scheduler / background worker in this wave (R3-4
// precedent) — aggregation runs on a manual trigger + the admin
// "重新聚合" button only. GET /api/admin/event-aggregates reads the
// stored aggregates; it never recomputes live.
//
// period_key format (fixed): hour -> `2026-11-14T06` (UTC, from the
// ISO created_at), day -> `2026-11-14`. `key` is the event detail
// verbatim (e.g. `resource:12`, or the search query itself).
import { assert, int, time } from "../lib/http.mjs";

export const EVENT_TYPES = ["view", "click", "search", "dwell"];
const MAX_DETAIL_CHARS = 500;
const MAX_SEARCH_CHARS = 200;
const MAX_DURATION_MS = 3600000;

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

function parseDate(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  assert(
    typeof raw === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
      !isNaN(new Date(raw).valueOf()) &&
      new Date(raw).toISOString().slice(0, 10) === raw,
    "日期格式错误（YYYY-MM-DD）",
    400,
  );
  return raw;
}

function aggregateRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    period: r.period,
    period_key: r.period_key,
    type: r.type,
    key: r.key,
    count: r.count,
    total_duration_ms: r.total_duration_ms,
    updated_at: r.updated_at,
  };
}

// POST /api/events — public, anonymous allowed. One row per event;
// never blocks the caller (clients send fire-and-forget).
export async function recordEvent(ctx) {
  const { req, p, b, send, session, run } = ctx;
  if (p !== "/api/events" || req.method !== "POST") return false;
  assert(
    typeof b.type === "string" && EVENT_TYPES.includes(b.type),
    "事件类型无效（view / click / search / dwell）",
    400,
  );
  assert(
    typeof b.detail === "string" &&
      b.detail.trim().length > 0 &&
      b.detail.trim().length <= MAX_DETAIL_CHARS,
    `事件详情不能为空且不能超过${MAX_DETAIL_CHARS}字`,
    400,
  );
  const detail = b.detail.trim();
  if (b.type === "search")
    assert(
      detail.length <= MAX_SEARCH_CHARS,
      `搜索词不能超过${MAX_SEARCH_CHARS}字`,
      400,
    );
  // duration_ms is meaningful only for dwell; every other type
  // writes 0 (fixed). A dwell duration outside 0–3600000 is a 400.
  let durationMs = 0;
  if (b.type === "dwell") {
    durationMs =
      b.duration_ms === undefined || b.duration_ms === null
        ? 0
        : int(b.duration_ms, "停留时长", 0, MAX_DURATION_MS);
  }
  const result = await run(
    "INSERT INTO events(user_id,type,detail,duration_ms,created_at) VALUES(?,?,?,?,?)",
    session?.id || null,
    b.type,
    detail,
    durationMs,
    time(),
  );
  send({ ok: true, id: Number(result.lastInsertRowid) });
  return true;
}

// POST /api/admin/aggregate-events — admin only. Recompute the
// aggregates for {period, date?} from `events` and upsert them.
// Idempotent: the rows for that period + date are deleted first,
// then re-inserted from the live event stream, so a second run
// produces exactly the same rows.
export async function aggregateEvents(ctx) {
  const { req, p, b, send, session, run, all, audit } = ctx;
  if (p !== "/api/admin/aggregate-events" || req.method !== "POST")
    return false;
  assertAdmin(session);
  assert(
    b.period === "hour" || b.period === "day",
    "聚合周期须为 hour 或 day",
    400,
  );
  const period = b.period;
  const date = parseDate(b.date, time().slice(0, 10));
  const keyLen = period === "hour" ? 13 : 10;
  const now = time();
  await run(
    "DELETE FROM event_aggregates WHERE period=? AND period_key LIKE ?",
    period,
    `${date}%`,
  );
  // GROUP BY uses SELECT-list ordinals (2,3,4): the `?` -> $n
  // rewrite gives the two substr(...,keyLen) occurrences different
  // parameter numbers, and Postgres rejects a GROUP BY expression
  // that does not match the SELECT expression structurally.
  await run(
    `INSERT INTO event_aggregates(period,period_key,type,key,count,total_duration_ms,updated_at)
     SELECT ?,substr(created_at,1,?),type,detail,COUNT(*),COALESCE(SUM(duration_ms),0),?
     FROM events WHERE substr(created_at,1,10)=?
     GROUP BY 2,3,4`,
    period,
    keyLen,
    now,
    date,
  );
  const rows = await all(
    "SELECT * FROM event_aggregates WHERE period=? AND period_key LIKE ? ORDER BY period_key ASC, type ASC, key ASC",
    period,
    `${date}%`,
  );
  await audit(
    session,
    "重新聚合事件",
    `${period} ${date}（${rows.length} 组）`,
  );
  send({ ok: true, period, date, event_aggregates: rows.map(aggregateRow) });
  return true;
}

// GET /api/admin/event-aggregates — admin only. Reads the STORED
// aggregates (never recomputes live). ?period=day (default) or hour,
// ?date= (default today, UTC), ?type= (optional, one of the four).
export async function listEventAggregates(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/event-aggregates" || req.method !== "GET")
    return false;
  assertAdmin(session);
  const period = url.searchParams.get("period") || "day";
  assert(period === "hour" || period === "day", "周期须为 hour 或 day", 400);
  const date = parseDate(
    url.searchParams.get("date"),
    time().slice(0, 10),
  );
  const type = url.searchParams.get("type");
  if (type !== null && type !== "")
    assert(EVENT_TYPES.includes(type), "事件类型无效", 400);
  const rows =
    type === null || type === ""
      ? await all(
          "SELECT * FROM event_aggregates WHERE period=? AND period_key LIKE ? ORDER BY period_key ASC, type ASC, key ASC",
          period,
          `${date}%`,
        )
      : await all(
          "SELECT * FROM event_aggregates WHERE period=? AND period_key LIKE ? AND type=? ORDER BY period_key ASC, type ASC, key ASC",
          period,
          `${date}%`,
          type,
        );
  send({ event_aggregates: rows.map(aggregateRow) });
  return true;
}
