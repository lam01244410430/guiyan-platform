// Admin resource management (Wave 4 #16 / #22, port of zhou
// guiyan-demo/server/index.mjs POST /api/resources, PATCH
// /api/resources/:id and POST /api/resources/:id/sync, re-routed to
// Lam's /api/admin/resources shape in a NEW file — admin.mjs stays
// 92 lines with 4 GET endpoints).
//
// Q13 DECIDED 2026-11-12 (Lam: "sửa resource", option (a), in Wave 4
// after #14): admin goes from read-only (server/index.mjs:1) to
// managing resources. All four endpoints are admin-only
// (assert(session?.role === "admin"), same as admin.mjs:12).
//
// Q14 DECIDED: POST /api/sync is NOT built — it would insert a fake
// paid order and pollute real statistics. The sync here is FULLY
// SIMULATED: it only writes meta.channels/lastSync/syncResult + an
// audit row, never calls anything external, and the response says so
// ("未发送外部请求").
//
// Money is integer cents on the wire (Lam's convention); the admin UI
// inputs yuan and converts before calling. `image` stays a static
// path string (/images/...); no upload in #16.
// Risk (noted in the design doc): admin writes change stock/capacity/
// meta, which directly affects availability (#12), recommendations
// (#11) and statistics — the admin-only gate is the control.
import { assert, text, int, resourceRow, time } from "../lib/http.mjs";

const STATUSES = ["published", "draft"];
const SYNC_CHANNELS = ["抖音", "小红书", "大麦"];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop's resources.
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

function assertMetaObject(value) {
  assert(
    value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value),
    "扩展信息必须为对象",
  );
  return value;
}

function validateCategory(ctx, category) {
  assert(
    ctx.categories.some((c) => c.id === category),
    "请选择资源分类",
  );
  return category;
}

// Shared field validation for create (all required) and edit (only
// the provided fields). Returns the validated values, keyed by column.
function validateFields(ctx, b, existing) {
  const out = {};
  if (b.name !== undefined || !existing)
    out.name = text(b.name, "名称", 80);
  if (b.category !== undefined || !existing)
    out.category = validateCategory(ctx, b.category);
  if (b.city !== undefined || !existing) out.city = text(b.city, "城市", 30);
  if (b.price !== undefined || !existing)
    out.price = int(b.price, "价格", 0);
  if (b.unit !== undefined || !existing) out.unit = text(b.unit, "单位", 10);
  if (b.description !== undefined)
    out.description = text(b.description, "介绍", 3000);
  if (b.image !== undefined) out.image = text(b.image, "图片路径", 200);
  if (b.capacity !== undefined)
    out.capacity = int(b.capacity, "容量", 0, 100000);
  if (b.stock !== undefined) out.stock = int(b.stock, "库存", 0, 100000);
  if (b.status !== undefined) {
    assert(STATUSES.includes(b.status), "资源状态错误");
    out.status = b.status;
  }
  if (b.meta !== undefined) out.meta = assertMetaObject(b.meta);
  if (b.tags !== undefined) {
    assert(Array.isArray(b.tags), "标签必须为数组");
    assert(
      b.tags.every((t) => typeof t === "string"),
      "标签必须为字符串数组",
    );
    out.tags = b.tags;
  }
  return out;
}

async function bustResourceCache(ctx) {
  // A resource write moves the cached list + admin stats/analysis.
  if (ctx.cache) {
    await ctx.cache.bustResources();
    await ctx.cache.bustAdmin();
  }
}

export async function listAdminResources(ctx) {
  const { req, p, send, session, all, resourceSelect } = ctx;
  if (p !== "/api/admin/resources" || req.method !== "GET") return false;
  assertAdmin(session);
  // ALL rows including drafts, newest first (r.id DESC): a resource
  // just set to draft must stay visible here so the admin can
  // re-publish it after a reload. No cache — 62 rows, admin-only, and
  // the list must reflect the latest status immediately. R1-1: a
  // shop-scoped admin sees only their own shop's rows.
  const scope = scopedShopId(session);
  const resources = (
    await (scope === null
      ? all(`${resourceSelect} ORDER BY r.id DESC`)
      : all(
          `${resourceSelect} WHERE r.shop_id=? ORDER BY r.id DESC`,
          scope,
        ))
  ).map(resourceRow);
  send({ resources });
  return true;
}

export async function createAdminResource(ctx) {
  const { req, p, b, send, session, get, run, audit, cache } = ctx;
  if (p !== "/api/admin/resources" || req.method !== "POST") return false;
  assertAdmin(session);
  const f = validateFields(ctx, b, null);
  // R1-1: a shop-scoped admin creates into their own shop; the platform
  // admin creates into the main shop unless shop_id names another
  // (existing, active) shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    shopId = scope;
  } else if (b.shop_id !== undefined && b.shop_id !== null) {
    shopId = int(b.shop_id, "店铺", 1);
    const shop = await get("SELECT * FROM shops WHERE id=?", shopId);
    assert(shop, "店铺不存在", 404);
    assert(shop.status === "active", "店铺已停用", 400);
  } else {
    shopId = 1;
  }
  const result = await run(
    "INSERT INTO resources(name,category,city,price,unit,description,image,capacity,stock,tags,meta,status,owner_id,shop_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    f.name,
    f.category,
    f.city,
    f.price,
    f.unit,
    b.description === undefined ? "" : f.description,
    b.image === undefined ? "" : f.image,
    b.capacity === undefined ? 0 : f.capacity,
    b.stock === undefined ? 100 : f.stock,
    JSON.stringify(b.tags === undefined ? [] : f.tags),
    JSON.stringify(b.meta === undefined ? {} : f.meta),
    b.status === undefined ? "published" : f.status,
    session.id,
    shopId,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  await audit(session, "新增资源", f.name);
  await bustResourceCache(ctx);
  const created = await get("SELECT * FROM resources WHERE id=?", id);
  send({ ok: true, id, resource: resourceRow(created) });
  return true;
}

export async function editAdminResource(ctx) {
  const { req, p, b, send, session, get, run, audit, cache } = ctx;
  const m = p.match(/^\/api\/admin\/resources\/(\d+)$/);
  if (m && req.method === "PATCH") {
    assertAdmin(session);
    const id = Number(m[1]);
    const r = await get("SELECT * FROM resources WHERE id=?", id);
    assert(r, "资源不存在", 404);
    assertShopAccess(session, r);
    const f = validateFields(ctx, b, r);
    const next = {
      name: f.name === undefined ? r.name : f.name,
      category: f.category === undefined ? r.category : f.category,
      city: f.city === undefined ? r.city : f.city,
      price: f.price === undefined ? r.price : f.price,
      unit: f.unit === undefined ? r.unit : f.unit,
      description:
        f.description === undefined ? r.description : f.description,
      image: f.image === undefined ? r.image : f.image,
      capacity: f.capacity === undefined ? r.capacity : f.capacity,
      stock: f.stock === undefined ? r.stock : f.stock,
      tags:
        f.tags === undefined ? JSON.parse(r.tags) : f.tags,
      meta:
        f.meta === undefined ? JSON.parse(r.meta) : f.meta,
      status: f.status === undefined ? r.status : f.status,
    };
    await run(
      "UPDATE resources SET name=?,category=?,city=?,price=?,unit=?,description=?,image=?,capacity=?,stock=?,tags=?,meta=?,status=? WHERE id=?",
      next.name,
      next.category,
      next.city,
      next.price,
      next.unit,
      next.description,
      next.image,
      next.capacity,
      next.stock,
      JSON.stringify(next.tags),
      JSON.stringify(next.meta),
      next.status,
      id,
    );
    await audit(session, "修改资源", next.name);
    await bustResourceCache(ctx);
    const updated = await get("SELECT * FROM resources WHERE id=?", id);
    send({ ok: true, resource: resourceRow(updated) });
    return true;
  }
  return false;
}

// Channel sync — show only, FULLY SIMULATED (port of zhou
// POST /api/resources/:id/sync). Writes meta.channels/lastSync/
// syncResult + an audit row; makes no external call. The syncResult
// text is labelled simulated and the response says no external
// request was sent.
export async function syncAdminResource(ctx) {
  const { req, p, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/resources\/(\d+)\/sync$/);
  if (m && req.method === "POST") {
    assertAdmin(session);
    const id = Number(m[1]);
    const r = await get("SELECT * FROM resources WHERE id=?", id);
    assert(r, "资源不存在", 404);
    assertShopAccess(session, r);
    assert(r.category === "show", "只有剧目可进行渠道发布模拟");
    const meta = JSON.parse(r.meta);
    meta.channels = [...SYNC_CHANNELS];
    meta.lastSync = time();
    meta.syncResult = "三渠道内容同步成功（模拟）";
    await run("UPDATE resources SET meta=? WHERE id=?", JSON.stringify(meta), id);
    await audit(
      session,
      "剧目渠道同步",
      `${r.name}：抖音、小红书、大麦（模拟）`,
    );
    if (ctx.cache) await ctx.cache.bustResources();
    const updated = await get("SELECT * FROM resources WHERE id=?", id);
    send({
      ok: true,
      message: "剧目已模拟同步至抖音、小红书和大麦，未发送外部请求。",
      resource: resourceRow(updated),
    });
    return true;
  }
  return false;
}
