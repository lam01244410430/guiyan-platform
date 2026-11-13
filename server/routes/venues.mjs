// Venues + seat templates (Roadmap 82 Wave R2-4, 2026-11-13) —
// xlsx rows 10/11. A venue is a real place (a shop's stage), and a
// seat template describes its seating zones ([{name, rows, cols}]).
// Resources link to a venue via resources.venue_id (backfilled in
// postgres.mjs setup for venue-category resources with
// meta.seatRows/seatCols; meta stays untouched as the fallback for
// the old display-only seat map until R2-5).
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, text, int, time } from "../lib/http.mjs";

const MAIN_SHOP_ID = 1;

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertVenueAccess(session, venue) {
  const scope = scopedShopId(session);
  assert(
    scope === null || venue.shop_id === scope,
    "无权管理该店铺的场馆",
    403,
  );
}

function venueRow(v) {
  return {
    id: v.id,
    shop_id: v.shop_id,
    name: v.name,
    address: v.address,
    capacity: v.capacity,
    floor_plan: v.floor_plan,
    created_at: v.created_at,
    has_seats: Boolean(v.has_seats),
  };
}

function templateRow(t) {
  let zones = [];
  try {
    zones = JSON.parse(t.zones || "[]") || [];
  } catch {
    zones = [];
  }
  return {
    id: t.id,
    venue_id: t.venue_id,
    name: t.name,
    zones,
    created_at: t.created_at,
  };
}

// zones: a non-empty array of {name, rows, cols}; rows/cols are
// positive integers (a zone with 0 rows or 0 cols seats nobody, so
// it is rejected at write time, not at seat-generation time).
function validateZones(value) {
  assert(Array.isArray(value) && value.length > 0, "座位分区不能为空");
  assert(value.length <= 20, "座位分区不能超过20个");
  return value.map((z, i) => ({
    name: text(z?.name, `第${i + 1}分区名称`, 50),
    rows: int(z?.rows, `第${i + 1}分区行数`, 1, 1000),
    cols: int(z?.cols, `第${i + 1}分区列数`, 1, 1000),
  }));
}

async function getVenueOr404(get, id) {
  const v = await get("SELECT * FROM venues WHERE id=?", id);
  assert(v, "场馆不存在", 404);
  return v;
}

async function templatesOf(all, venueId) {
  const rows = await all(
    "SELECT * FROM seat_templates WHERE venue_id=? ORDER BY id ASC",
    venueId,
  );
  return rows.map(templateRow);
}

async function venueWithTemplates(get, all, venue) {
  const templates = await templatesOf(all, venue.id);
  return { ...venueRow({ ...venue, has_seats: templates.length > 0 }), seat_templates: templates };
}

async function resolveTargetShop(ctx, scope) {
  // Platform admin: the body may name a shop (else the main shop).
  // Shop-scoped admin: always their own shop; naming another shop is
  // a cross-shop create -> 403 (R1-1 rule, same as shows.mjs).
  const { b, get } = ctx;
  let shopId;
  if (scope !== null) {
    if (
      b.shop_id !== undefined &&
      b.shop_id !== null &&
      b.shop_id !== scope
    )
      assert(false, "只能在本店铺创建场馆", 403);
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

export async function listVenues(ctx) {
  const { req, p, send, url, all } = ctx;
  if (p !== "/api/venues" || req.method !== "GET") return false;
  const where = [];
  const params = [];
  const shop = url.searchParams.get("shop");
  if (shop !== null && shop !== "") {
    where.push("v.shop_id=?");
    params.push(int(Number(shop), "店铺", 1));
  }
  const rows = await all(
    `SELECT v.*, EXISTS(SELECT 1 FROM seat_templates t WHERE t.venue_id=v.id) AS has_seats FROM venues v${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY v.id ASC`,
    ...params,
  );
  send({ venues: rows.map(venueRow) });
  return true;
}

export async function getVenue(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/venues\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  const v = await getVenueOr404(get, Number(m[1]));
  send({ venue: await venueWithTemplates(get, all, v) });
  return true;
}

export async function createVenue(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/venues" || req.method !== "POST") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  // Validate everything BEFORE any write (OTP lesson).
  const name = text(b.name, "场馆名称", 80);
  let address = "";
  if (b.address !== undefined) {
    assert(
      typeof b.address === "string" && b.address.length <= 200,
      "场馆地址不能超过200字",
      400,
    );
    address = b.address.trim();
  }
  const capacity = b.capacity === undefined ? 0 : int(b.capacity, "容量", 0, 100000);
  let floorPlan = "";
  if (b.floor_plan !== undefined) {
    assert(
      typeof b.floor_plan === "string" && b.floor_plan.length <= 3000,
      "场地平面图描述不能超过3000字",
      400,
    );
    floorPlan = b.floor_plan.trim();
  }
  const shopId = await resolveTargetShop(ctx, scope);
  const result = await run(
    "INSERT INTO venues(shop_id,name,address,capacity,floor_plan,created_at) VALUES(?,?,?,?,?,?)",
    shopId,
    name,
    address,
    capacity,
    floorPlan,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  await audit(session, "新增场馆", name);
  const created = await getVenueOr404(get, id);
  send({ ok: true, id, venue: venueRow({ ...created, has_seats: false }) });
  return true;
}

export async function patchVenue(ctx) {
  const { req, p, b, send, session, get, run, all } = ctx;
  const m = p.match(/^\/api\/admin\/venues\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const venue = await getVenueOr404(get, id);
  assertVenueAccess(session, venue);
  // Validate everything BEFORE any write (OTP lesson).
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "场馆名称", 80);
  if (b.address !== undefined) {
    assert(
      typeof b.address === "string" && b.address.length <= 200,
      "场馆地址不能超过200字",
      400,
    );
    updates.address = b.address.trim();
  }
  if (b.capacity !== undefined)
    updates.capacity = int(b.capacity, "容量", 0, 100000);
  if (b.floor_plan !== undefined) {
    assert(
      typeof b.floor_plan === "string" && b.floor_plan.length <= 3000,
      "场地平面图描述不能超过3000字",
      400,
    );
    updates.floor_plan = b.floor_plan.trim();
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE venues SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await getVenueOr404(get, id);
  send({ ok: true, venue: await venueWithTemplates(get, all, fresh) });
  return true;
}

export async function listSeatTemplates(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/venues\/(\d+)\/seat-templates$/);
  if (!m || req.method !== "GET") return false;
  const venue = await getVenueOr404(get, Number(m[1]));
  send({ seat_templates: await templatesOf(all, venue.id) });
  return true;
}

export async function createSeatTemplate(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/venues\/(\d+)\/seat-templates$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const venue = await getVenueOr404(get, Number(m[1]));
  assertVenueAccess(session, venue);
  // Validate everything BEFORE any write (OTP lesson).
  const name = text(b.name, "座位模板名称", 80);
  const zones = validateZones(b.zones);
  const result = await run(
    "INSERT INTO seat_templates(venue_id,name,zones,created_at) VALUES(?,?,?,?)",
    venue.id,
    name,
    JSON.stringify(zones),
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM seat_templates WHERE id=?", id);
  send({ ok: true, id, seat_template: templateRow(created) });
  return true;
}

export async function patchSeatTemplate(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/admin\/seat-templates\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const tpl = await get("SELECT * FROM seat_templates WHERE id=?", id);
  assert(tpl, "座位模板不存在", 404);
  const venue = await getVenueOr404(get, tpl.venue_id);
  assertVenueAccess(session, venue);
  // Validate everything BEFORE any write (OTP lesson).
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "座位模板名称", 80);
  if (b.zones !== undefined) updates.zones = JSON.stringify(validateZones(b.zones));
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE seat_templates SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM seat_templates WHERE id=?", id);
  send({ ok: true, seat_template: templateRow(fresh) });
  return true;
}
