// Pickup points + ticket templates (Roadmap 82 Wave R2-3, 2026-11-13) —
// xlsx rows 8/9. A show configures its pickup points (where buyers
// collect their tickets); each shop configures ticket templates (the
// colour + layout a ticket renders with) and names one default. An
// order against a performance whose show has >=1 pickup point must
// name one of that show's points (see routes/orders.mjs); order
// responses carry the chosen point + the shop's default template
// (enrichOrder below, shared with the order list in lib/context.mjs).
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, text, int, time } from "../lib/http.mjs";

// The Guiyan 7-colour allowlist — the same list as R1-3 shop theming
// (server/routes/shops.mjs THEME_COLORS); a template colour must be
// one of these, never an arbitrary hex value.
export const TEMPLATE_COLORS = [
  "#0b3d36",
  "#14564d",
  "#c8452c",
  "#c9a24b",
  "#0d6e5f",
  "#a83a20",
  "#b8860b",
];

// The built-in default template: what GET /api/shops/:id/ticket-template
// returns when the shop has set no default of its own, and what a tier
// order carries when its shop has none. Deep pine is the Guiyan brand
// primary (same as the R1-3 default theme primaryColor).
export const BUILTIN_TEMPLATE = {
  id: null,
  name: "默认票面",
  color: "#0b3d36",
  layout: {},
};

const MAIN_SHOP_ID = 1;

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertShopAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的票面模板", 403);
}

function pickupRow(pp) {
  return {
    id: pp.id,
    show_id: pp.show_id,
    name: pp.name,
    address: pp.address,
    created_at: pp.created_at,
  };
}

function templateRow(t) {
  let layout = {};
  try {
    const parsed = JSON.parse(t.layout || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      layout = parsed;
  } catch {
    layout = {};
  }
  return {
    id: t.id,
    shop_id: t.shop_id,
    name: t.name,
    color: t.color,
    layout,
    is_default: Number(t.is_default) || 0,
    created_at: t.created_at,
  };
}

// layout is stored as JSON text and must be an object with optional
// string fields only: at most 20 fields, keys <= 50 chars, values
// strings <= 500 chars, whole JSON <= 5000 chars. Accepts an object
// or a JSON string from the client; absent/null means {}.
function validateLayout(value) {
  if (value === undefined || value === null) return "{}";
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      assert(false, "票面版式须为 JSON 对象", 400);
    }
  }
  assert(obj && typeof obj === "object" && !Array.isArray(obj), "票面版式须为 JSON 对象", 400);
  const keys = Object.keys(obj);
  assert(keys.length <= 20, "票面版式字段不能超过20个", 400);
  for (const k of keys) {
    assert(typeof k === "string" && k.length <= 50, "票面版式字段名不能超过50字", 400);
    assert(
      typeof obj[k] === "string" && obj[k].length <= 500,
      "票面版式字段须为字符串且不能超过500字",
      400,
    );
  }
  const json = JSON.stringify(obj);
  assert(json.length <= 5000, "票面版式不能超过5000字", 400);
  return json;
}

function parseIsDefault(value) {
  if (value === undefined || value === null) return 0;
  assert(
    value === 0 || value === 1 || value === true || value === false,
    "是否默认须为 0 或 1",
    400,
  );
  return value === 1 || value === true ? 1 : 0;
}

async function getShowOr404(get, id) {
  const s = await get("SELECT * FROM shows WHERE id=?", id);
  assert(s, "演出不存在", 404);
  return s;
}

async function resolveTargetShop(ctx, scope) {
  // Same rule as shows.mjs resolveTargetShop: platform admin names a
  // shop (else the main shop); a shop-scoped admin always uses their
  // own shop and naming another shop is a cross-shop create -> 403.
  const { b, get } = ctx;
  let shopId;
  if (scope !== null) {
    if (
      b.shop_id !== undefined &&
      b.shop_id !== null &&
      b.shop_id !== scope
    )
      assert(false, "只能管理本店铺的票面模板", 403);
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

export async function createPickupPoint(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/shows\/(\d+)\/pickup-points$/);
  if (!m || req.method !== "POST") return false;
  assertAdmin(session);
  const show = await getShowOr404(get, Number(m[1]));
  assertShopAccess(session, show.shop_id);
  // Validate everything BEFORE any write (OTP lesson).
  const name = text(b.name, "取票点名称", 100);
  const address = text(b.address, "取票点地址", 500);
  const result = await run(
    "INSERT INTO pickup_points(show_id,name,address,created_at) VALUES(?,?,?,?)",
    show.id,
    name,
    address,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM pickup_points WHERE id=?", id);
  send({ ok: true, id, pickup_point: pickupRow(created) });
  return true;
}

export async function listPickupPoints(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/shows\/(\d+)\/pickup-points$/);
  if (!m || req.method !== "GET") return false;
  const show = await getShowOr404(get, Number(m[1]));
  // Public only when the show is approved — anything else reads as
  // "not found", same as the show detail rule in routes/shows.mjs.
  assert(show.status === "approved", "演出不存在", 404);
  const rows = await all(
    "SELECT * FROM pickup_points WHERE show_id=? ORDER BY id ASC",
    show.id,
  );
  send({ pickup_points: rows.map(pickupRow) });
  return true;
}

export async function deletePickupPoint(ctx) {
  const { req, p, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/admin\/pickup-points\/(\d+)$/);
  if (!m || req.method !== "DELETE") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const pp = await get("SELECT * FROM pickup_points WHERE id=?", id);
  assert(pp, "取票点不存在", 404);
  const show = await getShowOr404(get, pp.show_id);
  assertShopAccess(session, show.shop_id);
  // A point an order already chose cannot be deleted: the orders
  // table references it, and silently dropping it would orphan the
  // stored choice. Validate first, write after (OTP lesson).
  const used = await get(
    "SELECT id FROM orders WHERE pickup_point_id=? LIMIT 1",
    id,
  );
  assert(!used, "已有订单使用该取票点，不可删除", 400);
  await run("DELETE FROM pickup_points WHERE id=?", id);
  send({ ok: true });
  return true;
}

export async function listTemplates(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/ticket-templates" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const rows =
    scope === null
      ? await all("SELECT * FROM ticket_templates ORDER BY shop_id ASC, id ASC")
      : await all(
          "SELECT * FROM ticket_templates WHERE shop_id=? ORDER BY id ASC",
          scope,
        );
  send({ ticket_templates: rows.map(templateRow) });
  return true;
}

export async function createTemplate(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  if (p !== "/api/admin/ticket-templates" || req.method !== "POST") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  // Validate everything BEFORE any write (OTP lesson): the shop, the
  // name, the colour allowlist, the layout object. Clearing the old
  // default happens after validation, in the same request.
  const shopId = await resolveTargetShop(ctx, scope);
  const name = text(b.name, "模板名称", 100);
  assert(
    typeof b.color === "string" && TEMPLATE_COLORS.includes(b.color),
    "模板颜色须为桂演配色之一",
    400,
  );
  const layout = validateLayout(b.layout);
  const isDefault = parseIsDefault(b.is_default);
  if (isDefault === 1)
    await run(
      "UPDATE ticket_templates SET is_default=0 WHERE shop_id=? AND is_default=1",
      shopId,
    );
  const result = await run(
    "INSERT INTO ticket_templates(shop_id,name,color,layout,is_default,created_at) VALUES(?,?,?,?,?,?)",
    shopId,
    name,
    b.color,
    layout,
    isDefault,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM ticket_templates WHERE id=?", id);
  send({ ok: true, id, ticket_template: templateRow(created) });
  return true;
}

export async function patchTemplate(ctx) {
  const { req, p, b, send, session, get, run } = ctx;
  const m = p.match(/^\/api\/admin\/ticket-templates\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const tpl = await get("SELECT * FROM ticket_templates WHERE id=?", id);
  assert(tpl, "票面模板不存在", 404);
  assertShopAccess(session, tpl.shop_id);
  // Validate everything BEFORE any write (OTP lesson). Setting
  // is_default=1 clears the shop's other default in the same request.
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "模板名称", 100);
  if (b.color !== undefined) {
    assert(
      typeof b.color === "string" && TEMPLATE_COLORS.includes(b.color),
      "模板颜色须为桂演配色之一",
      400,
    );
    updates.color = b.color;
  }
  if (b.layout !== undefined) updates.layout = validateLayout(b.layout);
  let setDefault = false;
  if (b.is_default !== undefined) {
    updates.is_default = parseIsDefault(b.is_default);
    setDefault = updates.is_default === 1;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  if (setDefault)
    await run(
      "UPDATE ticket_templates SET is_default=0 WHERE shop_id=? AND id<>? AND is_default=1",
      tpl.shop_id,
      id,
    );
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE ticket_templates SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM ticket_templates WHERE id=?", id);
  send({ ok: true, ticket_template: templateRow(fresh) });
  return true;
}

export async function getShopTemplate(ctx) {
  const { req, p, send, get } = ctx;
  const m = p.match(/^\/api\/shops\/(\d+)\/ticket-template$/);
  if (!m || req.method !== "GET") return false;
  const shop = await get("SELECT * FROM shops WHERE id=?", Number(m[1]));
  assert(shop, "店铺不存在", 404);
  send({ ticket_template: await defaultTemplateForShop(get, shop.id) });
  return true;
}

// The shop's default template, or the built-in default when the shop
// has set none. Shared by the public endpoint above and by order
// enrichment below.
export async function defaultTemplateForShop(get, shopId) {
  const row = await get(
    "SELECT * FROM ticket_templates WHERE shop_id=? AND is_default=1 ORDER BY id DESC LIMIT 1",
    shopId,
  );
  return row ? templateRow(row) : { ...BUILTIN_TEMPLATE, layout: {} };
}

// What an order response carries (R2-3): the pickup point the buyer
// chose (null when the order has none) + the shop's default template
// for a tier order (null for an old-flow order, which never has a
// pickup point). The shop is the show's shop for tier orders.
export async function enrichOrder(get, order) {
  let pickup_point = null;
  if (order.pickup_point_id) {
    const pp = await get(
      "SELECT * FROM pickup_points WHERE id=?",
      order.pickup_point_id,
    );
    // The order response carries only {id, name, address} — the
    // pickup-points list endpoint above returns the full row.
    if (pp) pickup_point = { id: pp.id, name: pp.name, address: pp.address };
  }
  let ticket_template = null;
  if (order.performance_id) {
    const perf = await get(
      "SELECT * FROM performances WHERE id=?",
      order.performance_id,
    );
    if (perf) {
      const show = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
      if (show) ticket_template = await defaultTemplateForShop(get, show.shop_id);
    }
  }
  return { pickup_point, ticket_template };
}
