// Admin shop management (Roadmap 82 Wave R1-1, 2026-11-13) — multi-shop
// organisation + permissions (xlsx row 1). One database, separated by
// shop_id (Q7 default (a)); no per-shop database, no new channel.
// A shop is owned by ONE admin user; that owner's users.shop_id points
// at the shop, which is what scopes their admin access (see
// admin-resources.mjs). The main shop "桂演平台总店" (id 1, parent NULL,
// owner = platform admin id 1) is seeded by postgres.mjs on every setup
// and can never be disabled. Shop status is administrative: creating a
// resource or a sub-shop under a disabled shop is rejected (400).
import { assert, text, int, time } from "../lib/http.mjs";

const SHOP_STATUSES = ["active", "disabled"];
const MAIN_SHOP_ID = 1;

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// Platform admin = role admin with NO shop (shop_id NULL). A shop-scoped
// admin (shop_id set) manages only their own shop's resources, never
// the shop organisation itself.
function assertPlatformAdmin(session) {
  assertAdmin(session);
  assert(
    session.shop_id === null || session.shop_id === undefined,
    "只有平台管理员可管理店铺",
    403,
  );
}

const SHOP_SELECT = `SELECT s.*,u.name AS owner_name,
  (SELECT COUNT(*) FROM resources r WHERE r.shop_id=s.id) AS resource_count
  FROM shops s LEFT JOIN users u ON u.id=s.owner_id`;

function shopRow(s) {
  return {
    id: s.id,
    parent_id: s.parent_id,
    name: s.name,
    owner_id: s.owner_id,
    owner_name: s.owner_name ?? null,
    status: s.status,
    resource_count: Number(s.resource_count ?? 0),
    created_at: s.created_at,
  };
}

async function getShopOr404(get, id) {
  const s = await get(`${SHOP_SELECT} WHERE s.id=?`, id);
  assert(s, "店铺不存在", 404);
  return s;
}

async function assertOwnerEligible(get, ownerId, shopId) {
  // An owner must be an admin who does not already own another shop.
  // shopId is the shop being created/edited (owning it already is fine).
  const owner = await get("SELECT * FROM users WHERE id=?", ownerId);
  assert(owner, "店主不存在", 404);
  assert(owner.role === "admin", "店主须为管理员账号", 400);
  assert(
    owner.shop_id === null ||
      owner.shop_id === undefined ||
      owner.shop_id === shopId,
    "该管理员已有所属店铺",
    400,
  );
  return owner;
}

export async function listAdminShops(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/shops" || req.method !== "GET") return false;
  assertAdmin(session);
  // A shop-scoped admin sees only their own shop; the platform admin
  // sees all shops, main shop first.
  const rows =
    session.shop_id === null || session.shop_id === undefined
      ? await all(`${SHOP_SELECT} ORDER BY s.id ASC`)
      : await all(
          `${SHOP_SELECT} WHERE s.id=? ORDER BY s.id ASC`,
          session.shop_id,
        );
  send({ shops: rows.map(shopRow) });
  return true;
}

export async function createAdminShop(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/shops" || req.method !== "POST") return false;
  assertPlatformAdmin(session);
  const name = text(b.name, "店铺名称", 50);
  // Parent defaults to the main shop; it must exist and be active.
  const parentId =
    b.parent_id === undefined || b.parent_id === null
      ? MAIN_SHOP_ID
      : int(b.parent_id, "上级店铺", 1);
  const parent = await get("SELECT * FROM shops WHERE id=?", parentId);
  assert(parent, "上级店铺不存在", 404);
  assert(parent.status === "active", "上级店铺已停用", 400);
  // Owner is optional (unassigned shop); when given, it must be an
  // admin who owns no other shop.
  const ownerId =
    b.owner_id === undefined || b.owner_id === null
      ? null
      : int(b.owner_id, "店主", 1);
  if (ownerId !== null) await assertOwnerEligible(get, ownerId, null);
  const result = await run(
    "INSERT INTO shops(parent_id,name,owner_id,status,created_at) VALUES(?,?,?,?,?)",
    parentId,
    name,
    ownerId,
    "active",
    time(),
  );
  const id = Number(result.lastInsertRowid);
  // The owner's scope follows the shop from creation.
  if (ownerId !== null)
    await run("UPDATE users SET shop_id=? WHERE id=?", id, ownerId);
  await audit(session, "新增店铺", name);
  const created = await getShopOr404(get, id);
  send({ ok: true, id, shop: shopRow(created) });
  return true;
}

export async function patchAdminShop(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/shops\/(\d+)$/);
  if (m && req.method === "PATCH") {
    assertPlatformAdmin(session);
    const id = Number(m[1]);
    const shop = await getShopOr404(get, id);
    // Validate everything BEFORE any write (OTP lesson: a throw after
    // a write is lost to the rollback).
    const updates = {};
    if (b.name !== undefined) updates.name = text(b.name, "店铺名称", 50);
    let statusChange = null;
    if (b.status !== undefined) {
      assert(SHOP_STATUSES.includes(b.status), "店铺状态错误", 400);
      if (id === MAIN_SHOP_ID && b.status === "disabled")
        assert(false, "总店不可停用", 400);
      statusChange = b.status;
      updates.status = b.status;
    }
    let ownerChange = undefined;
    if (b.owner_id !== undefined) {
      if (b.owner_id === null) {
        if (id === MAIN_SHOP_ID) assert(false, "总店须有店主", 400);
        ownerChange = null;
      } else {
        const ownerId = int(b.owner_id, "店主", 1);
        await assertOwnerEligible(get, ownerId, id);
        // The main shop's owner must stay a platform admin (shop_id
        // NULL); a shop-scoped admin can never own the main shop.
        if (id === MAIN_SHOP_ID) {
          const owner = await get(
            "SELECT shop_id FROM users WHERE id=?",
            ownerId,
          );
          assert(
            owner.shop_id === null || owner.shop_id === undefined,
            "总店店主须为平台管理员",
            400,
          );
        }
        ownerChange = ownerId;
      }
      updates.owner_id = ownerChange;
    }
    assert(
      Object.keys(updates).length > 0,
      "未提供可修改的字段",
      400,
    );
    const keys = Object.keys(updates);
    const sets = keys.map((k) => `${k}=?`).join(", ");
    await run(
      `UPDATE shops SET ${sets} WHERE id=?`,
      ...keys.map((k) => updates[k]),
      id,
    );
    // Owner scope follows the shop: the old owner loses the scope
    // (only if it still points at this shop), the new owner gains it.
    if (ownerChange !== undefined) {
      if (shop.owner_id !== null && shop.owner_id !== ownerChange)
        await run(
          "UPDATE users SET shop_id=NULL WHERE id=? AND shop_id=?",
          shop.owner_id,
          id,
        );
      if (ownerChange !== null)
        await run(
          "UPDATE users SET shop_id=? WHERE id=?",
          id,
          ownerChange,
        );
    }
    await audit(session, "修改店铺", shop.name);
    const fresh = await getShopOr404(get, id);
    send({ ok: true, shop: shopRow(fresh) });
    return true;
  }
  return false;
}

// R1-3 shop theming (row 4, 2026-11-13): per-shop storefront theme.
// Stored as JSON text in shops.theme (NULL = default theme); the
// public GET merges stored values over the defaults, field by field,
// so a corrupt stored value never breaks the storefront.
const THEME_COLORS = [
  "#0b3d36",
  "#14564d",
  "#c8452c",
  "#c9a24b",
  "#0d6e5f",
  "#a83a20",
  "#b8860b",
];
const THEME_SECTIONS = [
  "hero",
  "categories",
  "catalog",
  "spot",
  "demands",
  "ai",
  "wechat",
];
const DEFAULT_THEME = {
  banner: "",
  primaryColor: "#0b3d36",
  sections: [...THEME_SECTIONS],
};

function parseTheme(raw) {
  // Field-by-field fallback: a corrupt stored JSON, or a stored value
  // of the wrong shape, yields the default for that field only.
  const out = { ...DEFAULT_THEME, sections: [...THEME_SECTIONS] };
  if (raw === null || raw === undefined || raw === "") return out;
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return out;
  if (typeof stored.banner === "string" && stored.banner.length <= 200)
    out.banner = stored.banner;
  if (
    typeof stored.primaryColor === "string" &&
    THEME_COLORS.includes(stored.primaryColor)
  )
    out.primaryColor = stored.primaryColor;
  if (Array.isArray(stored.sections)) {
    const clean = stored.sections.filter(
      (s, i, a) =>
        typeof s === "string" &&
        THEME_SECTIONS.includes(s) &&
        a.indexOf(s) === i,
    );
    if (clean.length > 0) out.sections = clean;
  }
  return out;
}

// Validate a theme PATCH body (the body IS the theme object) and merge
// it over the current theme. Unknown keys, a non-object body, a banner
// over 200 chars, a color outside the Guiyan allowlist, or sections
// outside the canonical set / with duplicates are all 400.
function validateTheme(body, current) {
  assert(
    body && typeof body === "object" && !Array.isArray(body),
    "店铺装修须为对象",
    400,
  );
  const allowed = ["banner", "primaryColor", "sections"];
  for (const k of Object.keys(body)) {
    assert(allowed.includes(k), "未知的装修字段：" + k, 400);
  }
  const merged = { ...current, sections: [...current.sections] };
  if (body.banner !== undefined) {
    assert(typeof body.banner === "string", "横幅须为文字", 400);
    assert(body.banner.length <= 200, "横幅最多 200 字", 400);
    merged.banner = body.banner;
  }
  if (body.primaryColor !== undefined) {
    assert(
      typeof body.primaryColor === "string" &&
        THEME_COLORS.includes(body.primaryColor),
      "主色须在桂演配色内",
      400,
    );
    merged.primaryColor = body.primaryColor;
  }
  if (body.sections !== undefined) {
    assert(Array.isArray(body.sections), "栏目须为列表", 400);
    assert(body.sections.length > 0, "栏目不可为空", 400);
    for (const s of body.sections) {
      assert(
        typeof s === "string" && THEME_SECTIONS.includes(s),
        "未知的栏目：" + String(s),
        400,
      );
    }
    assert(
      new Set(body.sections).size === body.sections.length,
      "栏目不可重复",
      400,
    );
    merged.sections = [...body.sections];
  }
  return merged;
}

export async function getShopTheme(ctx) {
  const { req, p, send, get } = ctx;
  const m = p.match(/^\/api\/shops\/(\d+)\/theme$/);
  if (!m || req.method !== "GET") return false;
  const shop = await get("SELECT * FROM shops WHERE id=?", Number(m[1]));
  assert(shop, "店铺不存在", 404);
  send({ shop_id: shop.id, theme: parseTheme(shop.theme) });
  return true;
}

export async function patchShopTheme(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/shops\/(\d+)\/theme$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  // A shop-scoped admin themes only their own shop; the platform
  // admin (shop_id NULL) themes any shop.
  if (
    session.shop_id !== null &&
    session.shop_id !== undefined &&
    session.shop_id !== id
  )
    assert(false, "只能装修本店铺", 403);
  const shop = await get("SELECT * FROM shops WHERE id=?", id);
  assert(shop, "店铺不存在", 404);
  // Validate everything BEFORE any write (OTP lesson: a throw after
  // a write is lost to the rollback).
  const merged = validateTheme(b, parseTheme(shop.theme));
  await run(
    "UPDATE shops SET theme=? WHERE id=?",
    JSON.stringify(merged),
    id,
  );
  await audit(session, "修改店铺装修", shop.name);
  send({ ok: true, shop_id: id, theme: merged });
  return true;
}
