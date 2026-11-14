// R6-1 — 版权库 + 剧目库 (xlsx rows 63, 67): the `licenses` table +
// POST /api/admin/licenses (admin, shop-scoped) + GET /api/licenses
// (public, ?kind=&status=). Money is integer cents; validate first,
// write after, never throw after a write in the same request; the
// public GET runs in REPEATABLE READ READ ONLY (createRequestHandler
// gives GETs a read-only transaction). The copyright fact fields
// (copyright_holder / license_type / ip_region) live on resources.meta
// and are written through the existing admin resource PATCH — this
// file only records the licence itself, never invents a holder.
import { assert, text, int, time } from "../lib/http.mjs";

const KINDS = ["buy", "sell"];
const STATUSES = ["pending", "active", "expired"];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin manages only their own shop's resources.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

// Licence dates are ISO calendar dates; unlike http.date() they may
// lie before the demo baseline (a licence can predate 2026-11-09).
function isoDate(value, label) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !isNaN(new Date(value).valueOf()) &&
      new Date(value).toISOString().slice(0, 10) === value,
    `${label}格式错误`,
  );
  return value;
}

export async function createAdminLicense(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/licenses" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson).
  const resourceId = int(b.resource_id, "资源", 1);
  const resource = await get(
    "SELECT * FROM resources WHERE id=?",
    resourceId,
  );
  assert(resource, "资源不存在", 404);
  const scope = scopedShopId(session);
  assert(
    scope === null || resource.shop_id === scope,
    "无权管理该店铺的版权",
    403,
  );
  const licensor = text(b.licensor, "授权方", 100);
  const licensee = text(b.licensee, "被授权方", 100);
  assert(KINDS.includes(b.kind), "授权方向错误");
  const kind = b.kind;
  const priceCents = int(b.price_cents, "授权价格", 0);
  const status = b.status === undefined ? "pending" : b.status;
  assert(STATUSES.includes(status), "授权状态错误");
  let startAt = null;
  let endAt = null;
  if (b.start_at !== undefined && b.start_at !== null && b.start_at !== "")
    startAt = isoDate(b.start_at, "开始日期");
  if (b.end_at !== undefined && b.end_at !== null && b.end_at !== "")
    endAt = isoDate(b.end_at, "结束日期");
  assert(
    startAt === null || endAt === null || endAt >= startAt,
    "结束日期不能早于开始日期",
  );
  const result = await run(
    "INSERT INTO licenses(resource_id,licensor,licensee,kind,price_cents,status,start_at,end_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    resourceId,
    licensor,
    licensee,
    kind,
    priceCents,
    status,
    startAt,
    endAt,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  await audit(
    session,
    "登记版权",
    `${resource.name}：${licensor} → ${licensee}`,
  );
  const license = await get(
    `SELECT l.*, r.name AS resource_name, r.category AS resource_category
     FROM licenses l JOIN resources r ON r.id=l.resource_id WHERE l.id=?`,
    id,
  );
  send({ ok: true, id, license });
  return true;
}

export async function listLicenses(ctx) {
  const { p, req, send, url, all } = ctx;
  if (p !== "/api/licenses" || req.method !== "GET") return false;
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status");
  assert(!kind || KINDS.includes(kind), "授权方向错误");
  assert(!status || STATUSES.includes(status), "授权状态错误");
  const where = ["r.status='published'"];
  const params = [];
  if (kind) {
    where.push("l.kind=?");
    params.push(kind);
  }
  if (status) {
    where.push("l.status=?");
    params.push(status);
  }
  const licenses = await all(
    `SELECT l.*, r.name AS resource_name, r.category AS resource_category
     FROM licenses l JOIN resources r ON r.id=l.resource_id
     WHERE ${where.join(" AND ")} ORDER BY l.id DESC`,
    ...params,
  );
  send({ licenses });
  return true;
}
