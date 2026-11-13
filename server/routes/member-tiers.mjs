// Member tiers + tier discount (Roadmap 82 Wave R3-1, 2026-11-13) —
// xlsx rows 24, 14. A tier belongs to one shop; a user holds one tier
// per shop, but only the MAIN shop (shop 1, the default shop) has a
// stored column — users.tier_id. Other shops resolve the tier live
// from that shop's spending at order time (there is no per-shop tier
// column). Payment stays simulated: the discount is arithmetic on
// simulated amounts, never real money.
//
// Spending (fixed definition, never ambiguous): SUM(amount) over the
// user's orders in PAID_STATUSES (lib/profiles.mjs: paid / completed /
// disputed / refund_requested — orders that have been paid; pending /
// confirmed have not paid yet, cancelled / refunded do not count),
// counted per shop through the order's resource.shop_id.
//
// Tier resolution for a shop: the highest tier with min_spend_cents <=
// spending; ties break by higher discount_pct, then lowest id. A user
// is re-evaluated only when spending can change — after pay (up),
// complete (no change, idempotent re-check) and approveRefund (down);
// there is no time-based expiry and no downgrade except spending
// falling back below the threshold (in practice only a refund approval
// can do that). Editing a tier's threshold does NOT retroactively
// re-evaluate users — the new threshold applies at the next trigger.
//
// Shop scoping follows R1-1: role=admin only (anonymous and non-admin
// -> 403); a shop-scoped admin (shop_id set) works only in their own
// shop, cross-shop -> 403; the platform admin (shop_id NULL) works in
// any shop. Validate first, write after, never throw after a write in
// the same request (OTP lesson).
import { assert, text, int, time } from "../lib/http.mjs";
import { PAID_STATUSES } from "../lib/profiles.mjs";

export const MAIN_SHOP_ID = 1;

// Default tiers for the main shop, seeded by postgres.mjs setup when
// shop 1 has no tiers at all (guard pattern — an admin's edits are
// never overwritten). Thresholds in integer cents.
export const DEFAULT_TIERS = [
  { name: "普通会员", min_spend_cents: 0, discount_pct: 0, benefits: "注册即享" },
  { name: "银卡会员", min_spend_cents: 100000, discount_pct: 5, benefits: "购票享 95 折" },
  { name: "金卡会员", min_spend_cents: 500000, discount_pct: 10, benefits: "购票享 9 折" },
  { name: "钻石会员", min_spend_cents: 1000000, discount_pct: 15, benefits: "购票享 85 折" },
];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertTierAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的会员等级", 403);
}

function tierRow(t) {
  if (!t) return null;
  return {
    id: t.id,
    shop_id: t.shop_id,
    name: t.name,
    min_spend_cents: t.min_spend_cents,
    discount_pct: t.discount_pct,
    benefits: t.benefits ?? "",
    created_at: t.created_at,
  };
}

// Spending of one user in one shop: SUM(amount) over orders that have
// been paid (PAID_STATUSES). The status list is a constant, so it is
// inlined as literals — never interpolated from user input.
export async function spendingForShop(get, userId, shopId) {
  const row = await get(
    `SELECT COALESCE(SUM(o.amount),0) AS n FROM orders o
     JOIN resources r ON r.id=o.resource_id
     WHERE o.user_id=? AND r.shop_id=? AND o.status IN ('${PAID_STATUSES.join("','")}')`,
    userId,
    shopId,
  );
  return row?.n || 0;
}

// All tiers of one shop, highest threshold first (the resolution order).
async function tiersForShop(all, shopId) {
  return all(
    "SELECT * FROM member_tiers WHERE shop_id=? ORDER BY min_spend_cents DESC, discount_pct DESC, id ASC",
    shopId,
  );
}

// Resolve the effective tier of a user in a shop: the highest tier
// whose threshold the user's spending in that shop reaches, or null
// when the shop has no tiers at all. Also returns the next tier up
// (the lowest tier above current spending) and how much more spending
// it takes, so the account endpoint can show progress.
export async function resolveTier(get, all, userId, shopId) {
  const spending = await spendingForShop(get, userId, shopId);
  const tiers = await tiersForShop(all, shopId);
  // Tiers arrive highest-threshold first: the first tier at or below
  // spending is the user's tier; the last tier still above spending
  // is the lowest one above it — the next tier up.
  let tier = null;
  let nextTier = null;
  for (const t of tiers) {
    if (t.min_spend_cents <= spending) {
      tier = t;
      break;
    }
    nextTier = t;
  }
  return {
    tier: tierRow(tier),
    spending_cents: spending,
    next_tier: tierRow(nextTier),
    remaining_cents: nextTier ? nextTier.min_spend_cents - spending : 0,
    discount_pct: tier ? tier.discount_pct : 0,
  };
}

// Re-evaluate a user's stored tier for the main shop (the only shop
// with a stored column). Runs inside the caller's transaction — the
// order transition that changed spending and this UPDATE commit or
// roll back together. For any other shop there is nothing to store:
// its effective tier is resolved live at order time.
export async function evaluateTier(get, all, run, userId) {
  const resolved = await resolveTier(get, all, userId, MAIN_SHOP_ID);
  await run("UPDATE users SET tier_id=? WHERE id=?", resolved.tier?.id ?? null, userId);
  return resolved;
}

// The stored main-shop tier of a user (users.tier_id), or null when
// the user has never been evaluated (new account) or the tier row is
// gone. The discount at order time uses this row for main-shop orders.
export async function storedMainTier(get, userId) {
  const u = await get("SELECT tier_id FROM users WHERE id=?", userId);
  if (!u?.tier_id) return null;
  const t = await get("SELECT * FROM member_tiers WHERE id=?", u.tier_id);
  if (!t || t.shop_id !== MAIN_SHOP_ID) return null;
  return tierRow(t);
}

// Discount for one order: base price first (tier price x qty, or
// resource price x qty — computed by the caller), then the member
// discount of the order's shop. Main-shop orders use the stored tier;
// other shops resolve live from that shop's spending. Returns the
// discount in integer cents (floor) and the tier row applied (null =
// no discount).
export async function discountForOrder(get, all, userId, shopId, baseCents) {
  let tier = null;
  if (shopId === MAIN_SHOP_ID) tier = await storedMainTier(get, userId);
  else tier = (await resolveTier(get, all, userId, shopId)).tier;
  if (!tier || !tier.discount_pct) return { discount_cents: 0, tier: null };
  const discountCents = Math.floor((baseCents * tier.discount_pct) / 100);
  return { discount_cents: discountCents, tier };
}

async function getShopOr404(get, id) {
  const s = await get("SELECT * FROM shops WHERE id=?", id);
  assert(s, "店铺不存在", 404);
  return s;
}

export async function listShopTiers(ctx) {
  const { req, p, send, get, all } = ctx;
  const m = p.match(/^\/api\/shops\/(\d+)\/member-tiers$/);
  if (!m || req.method !== "GET") return false;
  const shop = await getShopOr404(get, Number(m[1]));
  const rows = await all(
    "SELECT * FROM member_tiers WHERE shop_id=? ORDER BY min_spend_cents ASC, id ASC",
    shop.id,
  );
  send({ shop_id: shop.id, member_tiers: rows.map(tierRow) });
  return true;
}

export async function listAdminTiers(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/member-tiers" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const shopParam = url.searchParams.get("shop");
  let shopId = scope;
  if (shopParam !== null && shopParam !== "") {
    shopId = Number(shopParam);
    assert(Number.isSafeInteger(shopId) && shopId >= 1, "店铺编号错误", 400);
  }
  if (scope !== null) shopId = scope;
  const rows =
    shopId === null
      ? await all("SELECT * FROM member_tiers ORDER BY shop_id ASC, min_spend_cents ASC, id ASC")
      : await all(
          "SELECT * FROM member_tiers WHERE shop_id=? ORDER BY min_spend_cents ASC, id ASC",
          shopId,
        );
  send({ member_tiers: rows.map(tierRow) });
  return true;
}

export async function createMemberTier(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/member-tiers" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson).
  // R3-1: a shop-scoped admin works only in their own shop — an
  // explicit shop_id naming another shop is a cross-shop write -> 403
  // (stricter than admin-resources' silent re-scoping, per the R3-1
  // plan: "cross-shop -> 403 on admin writes"). The platform admin
  // creates into the main shop unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的会员等级", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertTierAccess(session, shopId);
  await getShopOr404(get, shopId);
  const name = text(b.name, "等级名称", 100);
  const minSpend = int(b.min_spend_cents, "消费门槛（分）", 0);
  const discountPct = int(b.discount_pct, "折扣百分比", 0, 100);
  const benefits =
    b.benefits === undefined || b.benefits === null
      ? ""
      : text(String(b.benefits), "等级权益", 500);
  const result = await run(
    "INSERT INTO member_tiers(shop_id,name,min_spend_cents,discount_pct,benefits,created_at) VALUES(?,?,?,?,?,?)",
    shopId,
    name,
    minSpend,
    discountPct,
    benefits,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM member_tiers WHERE id=?", id);
  await audit(session, "新增会员等级", `${created.name}（${shopId}号店）`);
  send({ ok: true, id, member_tier: tierRow(created) });
  return true;
}

export async function patchMemberTier(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/member-tiers\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const tier = await get("SELECT * FROM member_tiers WHERE id=?", id);
  assert(tier, "会员等级不存在", 404);
  assertTierAccess(session, tier.shop_id);
  // Validate everything BEFORE any write (OTP lesson). Changing a
  // threshold does not re-evaluate existing users — the new threshold
  // applies at the next pay / complete / approveRefund trigger.
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "等级名称", 100);
  if (b.min_spend_cents !== undefined)
    updates.min_spend_cents = int(b.min_spend_cents, "消费门槛（分）", 0);
  if (b.discount_pct !== undefined)
    updates.discount_pct = int(b.discount_pct, "折扣百分比", 0, 100);
  if (b.benefits !== undefined)
    updates.benefits =
      b.benefits === null ? "" : text(String(b.benefits), "等级权益", 500);
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE member_tiers SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM member_tiers WHERE id=?", id);
  await audit(session, "修改会员等级", `${fresh.name}（${fresh.shop_id}号店）`);
  send({ ok: true, member_tier: tierRow(fresh) });
  return true;
}

export async function getAccountTier(ctx) {
  const { req, p, send, get, all } = ctx;
  if (p !== "/api/account/tier" || req.method !== "GET") return false;
  const u = ctx.needUser();
  const stored = await storedMainTier(get, u.id);
  const resolved = await resolveTier(get, all, u.id, MAIN_SHOP_ID);
  // The tier the user holds is the stored main-shop tier; spending
  // and next-tier progress are always live, so the progress bar never
  // goes stale between evaluations.
  send({
    tier: stored,
    spending_cents: resolved.spending_cents,
    next_tier: resolved.next_tier,
    remaining_cents: resolved.remaining_cents,
    discount_pct: stored ? stored.discount_pct : 0,
  });
  return true;
}
