// Shows + performances (Roadmap 82 Wave R2-1, 2026-11-13) — ticket
// core, xlsx rows 5/6. A shop creates a show (a project built on one
// `show`-category resource), an admin approves/rejects it like a
// demand, and each approved show has performances (one start time +
// base price + sale status each). Buyers only ever see approved
// shows and on-sale performances (public list, detail, availability).
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, text, int, time, today } from "../lib/http.mjs";
import { isAdminRole } from "../lib/roles.mjs";
import { ticketTypesForPerformance } from "./ticket-types.mjs";

const SHOW_STATUSES = ["pending", "approved", "rejected"];
const PERF_STATUSES = ["scheduled", "on_sale", "cancelled"];
const MAIN_SHOP_ID = 1;

function assertAdmin(session) {
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertShowAccess(session, show) {
  const scope = scopedShopId(session);
  assert(
    scope === null || show.shop_id === scope,
    "无权管理该店铺的演出",
    403,
  );
}

function showRow(s, performances) {
  return {
    id: s.id,
    shop_id: s.shop_id,
    resource_id: s.resource_id,
    title: s.title,
    description: s.description,
    status: s.status,
    created_by: s.created_by,
    created_at: s.created_at,
    performances: performances || [],
  };
}

function perfRow(pf) {
  return {
    id: pf.id,
    show_id: pf.show_id,
    resource_id: pf.resource_id ?? null,
    start_at: pf.start_at,
    price_cents: pf.price_cents,
    status: pf.status,
    created_at: pf.created_at,
  };
}

async function getShowOr404(get, id) {
  const s = await get("SELECT * FROM shows WHERE id=?", id);
  assert(s, "演出不存在", 404);
  return s;
}

async function performancesOf(all, showId) {
  const rows = await all(
    "SELECT * FROM performances WHERE show_id=? ORDER BY start_at ASC, id ASC",
    showId,
  );
  return rows.map(perfRow);
}

// start_at must be an ISO datetime whose date part is on/after the
// demo baseline day (2026-11-09, same rule as the booking `date`
// validator in lib/http.mjs, extended to a datetime).
function isoStartAt(value) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      ),
    "开演时间须为 ISO 日期时间",
    400,
  );
  const d = new Date(value);
  assert(!isNaN(d.valueOf()), "开演时间无效", 400);
  assert(value.slice(0, 10) >= today, "开演时间不能早于演示基准日", 400);
  return value;
}

async function resolveTargetShop(ctx, scope) {
  // Platform admin: the body may name a shop (else the main shop).
  // Shop-scoped admin: always their own shop; naming another shop is
  // a cross-shop create -> 403 (R1-1 rule).
  const { b, get } = ctx;
  let shopId;
  if (scope !== null) {
    if (
      b.shop_id !== undefined &&
      b.shop_id !== null &&
      b.shop_id !== scope
    )
      assert(false, "只能在本店铺创建演出", 403);
    shopId = scope;
  } else if (b.shop_id !== undefined && b.shop_id !== null) {
    shopId = int(b.shop_id, "店铺", 1);
  } else {
    shopId = MAIN_SHOP_ID;
  }
  const shop = await get("SELECT * FROM shops WHERE id=?", shopId);
  assert(shop, "店铺不存在", 404);
  return shopId;
}

export async function createShow(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/shows" || req.method !== "POST") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  // Validate everything BEFORE any write (OTP lesson).
  const title = text(b.title, "演出名称", 100);
  // Description is optional (default ''): an empty string is fine,
  // unlike text() which requires a non-empty value.
  let description = "";
  if (b.description !== undefined) {
    assert(
      typeof b.description === "string" && b.description.length <= 3000,
      "演出介绍不能超过3000字",
      400,
    );
    description = b.description.trim();
  }
  const resourceId = int(b.resource_id, "资源", 1);
  const shopId = await resolveTargetShop(ctx, scope);
  const resource = await get("SELECT * FROM resources WHERE id=?", resourceId);
  assert(resource, "资源不存在", 404);
  assert(resource.category === "show", "演出须关联演出剧目类资源", 400);
  assert(resource.shop_id === shopId, "资源不属于该店铺", 400);
  const result = await run(
    "INSERT INTO shows(shop_id,resource_id,title,description,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
    shopId,
    resourceId,
    title,
    description,
    "pending",
    session.id,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  await audit(session, "新增演出", title);
  const created = await getShowOr404(get, id);
  send({ ok: true, id, show: showRow(created, []) });
  return true;
}

export async function listShows(ctx) {
  const { req, p, send, url, all } = ctx;
  if (p !== "/api/shows" || req.method !== "GET") return false;
  // Public: approved shows only, each with its performances.
  const where = ["s.status='approved'"];
  const params = [];
  const shop = url.searchParams.get("shop");
  if (shop !== null && shop !== "") {
    where.push("s.shop_id=?");
    params.push(int(Number(shop), "店铺", 1));
  }
  const resourceId = url.searchParams.get("resource_id");
  if (resourceId !== null && resourceId !== "") {
    where.push("s.resource_id=?");
    params.push(int(Number(resourceId), "资源", 1));
  }
  const rows = await all(
    `SELECT s.* FROM shows s WHERE ${where.join(" AND ")} ORDER BY s.id DESC`,
    ...params,
  );
  const shows = [];
  for (const s of rows) shows.push(showRow(s, await performancesOf(all, s.id)));
  send({ shows });
  return true;
}

export async function getShow(ctx) {
  const { req, p, send, session, get, all } = ctx;
  const m = p.match(/^\/api\/shows\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  const s = await getShowOr404(get, Number(m[1]));
  // Public only when approved; any admin sees any show.
  assert(
    s.status === "approved" || isAdminRole(session?.role),
    "演出不存在",
    404,
  );
  send({ show: showRow(s, await performancesOf(all, s.id)) });
  return true;
}

export async function listAdminShows(ctx) {
  const { req, p, send, session, url, all } = ctx;
  if (p !== "/api/admin/shows" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const where = [];
  const params = [];
  if (scope !== null) {
    where.push("s.shop_id=?");
    params.push(scope);
  }
  const status = url.searchParams.get("status");
  if (status !== null && status !== "") {
    assert(SHOW_STATUSES.includes(status), "演出状态错误", 400);
    where.push("s.status=?");
    params.push(status);
  }
  const rows = await all(
    `SELECT s.* FROM shows s${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY s.id DESC`,
    ...params,
  );
  const shows = [];
  for (const s of rows) shows.push(showRow(s, await performancesOf(all, s.id)));
  send({ shows });
  return true;
}

export async function reviewShow(ctx) {
  const { req, p, b, send, session, get, run, audit, all } = ctx;
  const m = p.match(/^\/api\/admin\/shows\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const show = await getShowOr404(get, id);
  assertShowAccess(session, show);
  // Validate everything BEFORE any write (OTP lesson).
  assert(
    b.status === "approved" || b.status === "rejected",
    "演出审核状态须为 approved 或 rejected",
    400,
  );
  await run("UPDATE shows SET status=? WHERE id=?", b.status, id);
  await audit(session, "审核演出", show.title);
  const fresh = await getShowOr404(get, id);
  send({ ok: true, show: showRow(fresh, await performancesOf(all, id)) });
  return true;
}

export async function createPerformance(ctx) {
  const { req, p, b, send, session, get, run, all } = ctx;
  const m = p.match(/^\/api\/shows\/(\d+)\/performances$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const show = await getShowOr404(get, Number(m[1]));
  assertShowAccess(session, show);
  // Validate everything BEFORE any write (OTP lesson).
  const startAt = isoStartAt(b.start_at);
  const priceCents = int(b.price_cents, "票价", 0);
  assert(show.status === "approved", "演出未通过审核，不可创建场次", 400);
  const result = await run(
    "INSERT INTO performances(show_id,resource_id,start_at,price_cents,status,created_at) VALUES(?,?,?,?,?,?)",
    show.id,
    show.resource_id,
    startAt,
    priceCents,
    "scheduled",
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get(
    "SELECT * FROM performances WHERE id=?",
    id,
  );
  send({ ok: true, id, performance: perfRow(created) });
  return true;
}

// Showtimes-final: shop access for one performance — via its show, or
// via its resource when it is a direct performance (show_id NULL).
async function assertPerfAccess(session, get, perf) {
  if (perf.show_id) {
    const show = await getShowOr404(get, perf.show_id);
    assertShowAccess(session, show);
    return;
  }
  const resource = await get(
    "SELECT * FROM resources WHERE id=?",
    perf.resource_id,
  );
  assert(resource, "资源不存在", 404);
  const scope = scopedShopId(session);
  assert(
    scope === null || resource.shop_id === scope,
    "无权管理该店铺的场次",
    403,
  );
}

export async function createDirectPerformance(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/performances$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const resource = await get(
    "SELECT * FROM resources WHERE id=?",
    Number(m[1]),
  );
  assert(resource, "资源不存在", 404);
  const scope = scopedShopId(session);
  assert(
    scope === null || resource.shop_id === scope,
    "无权管理该店铺的场次",
    403,
  );
  // Validate everything BEFORE any write (OTP lesson). A direct
  // performance needs no show approval — the resource is already
  // published — so it goes on sale at once, with a default 标准票
  // tier (quota = the resource stock, at least 1) so buyers can
  // book immediately (orders require both performance + tier).
  const startAt = isoStartAt(b.start_at);
  const priceCents = int(b.price_cents, "票价", 0);
  assert(resource.status === "published", "资源未上架，不可创建场次", 400);
  const result = await run(
    "INSERT INTO performances(show_id,resource_id,start_at,price_cents,status,created_at) VALUES(NULL,?,?,?,?,'on_sale',?)",
    resource.id,
    startAt,
    priceCents,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const quota = Math.max(1, resource.stock || 0);
  const tierResult = await run(
    "INSERT INTO ticket_types(performance_id,name,price_cents,quota,sale_until,created_at) VALUES(?,?,?,?,NULL,?)",
    id,
    "标准票",
    priceCents,
    quota,
    time(),
  );
  const created = await get("SELECT * FROM performances WHERE id=?", id);
  const tier = await get("SELECT * FROM ticket_types WHERE id=?", Number(tierResult.lastInsertRowid));
  send({
    ok: true,
    id,
    performance: perfRow(created),
    ticket_type: tier
      ? {
          id: tier.id,
          performance_id: tier.performance_id,
          name: tier.name,
          price_cents: tier.price_cents,
          quota: tier.quota,
          sale_until: tier.sale_until,
          created_at: tier.created_at,
        }
      : null,
  });
  return true;
}

export async function patchPerformance(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/admin\/performances\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const perf = await get("SELECT * FROM performances WHERE id=?", id);
  assert(perf, "场次不存在", 404);
  await assertPerfAccess(session, get, perf);
  // Validate everything BEFORE any write (OTP lesson). Status moves:
  // scheduled -> on_sale, any -> cancelled; a cancelled performance
  // never goes back on sale.
  const updates = {};
  if (b.status !== undefined) {
    assert(PERF_STATUSES.includes(b.status), "场次状态错误", 400);
    if (b.status === "on_sale") {
      assert(
        perf.status === "scheduled" || perf.status === "on_sale",
        "只有待上架的场次可以上架",
        400,
      );
    }
    updates.status = b.status;
  }
  if (b.start_at !== undefined) updates.start_at = isoStartAt(b.start_at);
  if (b.price_cents !== undefined)
    updates.price_cents = int(b.price_cents, "票价", 0);
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE performances SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM performances WHERE id=?", id);
  send({ ok: true, performance: perfRow(fresh) });
  return true;
}

// Availability extension (R2-1): the on-sale performances of the
// resource's APPROVED shows, for the H5/mini-program detail views.
// Only {id, start_at, status, price_cents, ticket_types} — the shape
// the design fixes; all other availability fields are untouched (see
// routes/resources.mjs getAvailability). R2-2: each performance gains
// its ticket_types with live sold/available counts; a performance with
// no tiers gets ticket_types: [].
// Showtimes-final (Q1a): direct performances (show_id NULL,
// resource_id set) are included too — the LEFT JOIN keeps them when
// their show is absent, and show-linked rows still need an approved
// show. A direct performance reports show_id null.
export async function performancesForResource(all, get, resourceId) {
  const rows = await all(
    `SELECT pf.id, pf.show_id, pf.resource_id, pf.start_at, pf.status, pf.price_cents
     FROM performances pf LEFT JOIN shows s ON s.id=pf.show_id
     WHERE (s.resource_id=? AND s.status='approved' OR pf.resource_id=?) AND pf.status='on_sale'
     ORDER BY pf.start_at ASC, pf.id ASC`,
    resourceId,
    resourceId,
  );
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      show_id: r.show_id,
      resource_id: r.resource_id ?? null,
      start_at: r.start_at,
      status: r.status,
      price_cents: r.price_cents,
      ticket_types: await ticketTypesForPerformance(all, get, r.id),
    });
  }
  return out;
}
