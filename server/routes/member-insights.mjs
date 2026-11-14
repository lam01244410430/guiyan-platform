// Member data + operating suggestions (Roadmap 82 Wave R5-2,
// 2026-11-14) — xlsx rows 38, 54. Rule-based ONLY, no model: the
// suggestions below are fixed rule text over real orders/tiers.
//
// Row 54 note (fixed): this item covers ONLY the 运营决策支撑
// (rule-based operating suggestions) half of row 54 (AI个性化推荐 /
// 运营决策支撑）; the AI-personalized half stays in R7. Nothing here
// is AI, and nothing here may be presented as AI.
//
// GET /api/admin/member-insights (admin; ?shop= default 1) returns
// {users: [...], suggestions: [...]} for one shop. Per user:
// - user_id, name
// - spending_cents: R3-1 fixed definition — SUM(amount) over
//   PAID_STATUSES (lib/profiles.mjs) per shop via resources.shop_id.
//   Reuses resolveTier() from routes/member-tiers.mjs; the spending
//   definition is never duplicated here.
// - last_order_at: latest paid order's created_at in the shop, null
//   when the user has no paid order there (Lam has no paid_at
//   column — same convention as lib/profiles.mjs).
// - tier: current tier NAME in the shop, resolved live from spending
//   (resolveTier). users.tier_id stores the MAIN shop tier only
//   (R3-1); other shops have no stored column, so every shop is
//   resolved live here — for the main shop the live resolution
//   equals the stored tier whenever spending has not changed since
//   the last pay / complete / approveRefund evaluation.
// - churn: no paid order in the last churnDays days. A user who has
//   never bought in the shop has no last order, so they count as
//   churned too (same convention as profiles.mjs, where a never-paid
//   user gets days_since_payment 99999); the callback suggestion
//   below still requires prior spending > 0, so new users are never
//   suggested for callback.
// - upgrade_candidate: a next tier exists and remaining_cents is
//   within upgradeGapPct% of that tier's threshold, i.e.
//   remaining <= floor(next.min_spend_cents * upgradeGapPct / 100).
// - next_tier, remaining_cents (0 / null when already top tier).
//
// The users list is the shop's members: non-admin users with at
// least one order (any status) on a resource of the shop. A user who
// only ever ordered in another shop is not a member of this shop.
//
// Suggestions (fixed rule text, no model):
// - upgrade: one entry per upgrade-candidate user — near the next
//   tier, suggest pushing that tier's benefits.
// - callback: one entry per user WITH prior spending > 0 whose
//   last paid order is older than callbackDays days — suggest
//   calling them back. (callbackDays is its own rule, so the
//   callback window can differ from the churn flag window; both
//   default to 90. A user can therefore be callback-eligible
//   while not flagged churned, and vice versa.)
// - push_show: ONE shop-level entry — the show with the highest
//   paid revenue in the shop in the last 30 days (orders joined to
//   shows via shows.resource_id = orders.resource_id), suggest
//   promoting it. Omitted when the shop has no paid show revenue
//   in the last 30 days.
//
// Rules live in `settings` under key `memberInsightRules`
// (seeded by the postgres.mjs guard-key backfill, same pattern as
// tagRules — an admin's edits are never overwritten):
// churnDays default 90, upgradeGapPct default 20, callbackDays
// default 90. GET/PATCH /api/admin/member-insight-rules (admin).
// PATCH validates before writing: unknown keys -> 400, churnDays
// int 1-365, upgradeGapPct int 0-100, callbackDays int 1-365.
// Partial patches merge into the stored rules.
//
// Shop scoping follows R1-1 / listAdminTiers: a shop-scoped admin
// (session.shop_id set) is forced to their own shop whatever ?shop=
// says; the platform admin (shop_id NULL) picks a shop with ?shop=
// (default 1). Anonymous -> 401, non-admin -> 403.
import { assert, int } from "../lib/http.mjs";
import { PAID_STATUSES } from "../lib/profiles.mjs";
import { resolveTier, MAIN_SHOP_ID } from "./member-tiers.mjs";

export const DEFAULT_MEMBER_INSIGHT_RULES = {
  churnDays: 90,
  upgradeGapPct: 20,
  callbackDays: 90,
};

const RULE_RANGES = {
  churnDays: [1, 365],
  upgradeGapPct: [0, 100],
  callbackDays: [1, 365],
};
const RULE_LABELS = {
  churnDays: "流失天数",
  upgradeGapPct: "可升级差距百分比",
  callbackDays: "回访天数",
};

const PAID_LIST = `'${PAID_STATUSES.join("','")}'`;

function assertAdminSession(session) {
  assert(session, "请先登录", 401);
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping (listAdminTiers pattern): a shop-scoped admin
// is forced to their own shop; the platform admin names a shop with
// ?shop= (default MAIN_SHOP_ID). An unknown shop id is not a 404 —
// it simply has no members, same as the tiers list.
function resolveShopId(session, url) {
  const scope = session.shop_id ?? null;
  if (scope !== null) return scope;
  const raw = url.searchParams.get("shop");
  if (raw === null || raw === "") return MAIN_SHOP_ID;
  const shopId = Number(raw);
  assert(Number.isSafeInteger(shopId) && shopId >= 1, "店铺编号错误", 400);
  return shopId;
}

// Read the stored rules; missing row or broken JSON falls back to
// the defaults (lazy default, never throws, never overwrites the
// stored row — same pattern as loadTagRules in lib/profiles.mjs).
export async function loadMemberInsightRules(ctx) {
  const row = await ctx.get(
    "SELECT value FROM settings WHERE key='memberInsightRules'",
  );
  try {
    const parsed = JSON.parse(row?.value ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        churnDays:
          Number.isSafeInteger(parsed.churnDays) &&
          parsed.churnDays >= 1 &&
          parsed.churnDays <= 365
            ? parsed.churnDays
            : DEFAULT_MEMBER_INSIGHT_RULES.churnDays,
        upgradeGapPct:
          Number.isSafeInteger(parsed.upgradeGapPct) &&
          parsed.upgradeGapPct >= 0 &&
          parsed.upgradeGapPct <= 100
            ? parsed.upgradeGapPct
            : DEFAULT_MEMBER_INSIGHT_RULES.upgradeGapPct,
        callbackDays:
          Number.isSafeInteger(parsed.callbackDays) &&
          parsed.callbackDays >= 1 &&
          parsed.callbackDays <= 365
            ? parsed.callbackDays
            : DEFAULT_MEMBER_INSIGHT_RULES.callbackDays,
      };
    }
  } catch {
    // fall through to the default below
  }
  return { ...DEFAULT_MEMBER_INSIGHT_RULES };
}

function validateRulePatch(body) {
  assert(body && typeof body === "object" && !Array.isArray(body), "规则格式错误");
  const updates = {};
  for (const key of Object.keys(body)) {
    assert(
      Object.prototype.hasOwnProperty.call(RULE_RANGES, key),
      `未知规则项：${key}`,
      400,
    );
    const [min, max] = RULE_RANGES[key];
    updates[key] = int(body[key], RULE_LABELS[key], min, max);
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的规则项", 400);
  return updates;
}

export async function getMemberInsightRules(ctx) {
  const { req, p, send, session } = ctx;
  if (p !== "/api/admin/member-insight-rules" || req.method !== "GET")
    return false;
  assertAdminSession(session);
  send({ rules: await loadMemberInsightRules(ctx) });
  return true;
}

export async function patchMemberInsightRules(ctx) {
  const { req, p, b, send, session, run, audit } = ctx;
  if (p !== "/api/admin/member-insight-rules" || req.method !== "PATCH")
    return false;
  assertAdminSession(session);
  // Validate everything BEFORE any write (OTP lesson).
  const updates = validateRulePatch(b);
  const rules = { ...(await loadMemberInsightRules(ctx)), ...updates };
  await run(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT (key) DO UPDATE SET value=?",
    "memberInsightRules",
    JSON.stringify(rules),
    JSON.stringify(rules),
  );
  await audit(session, "修改会员数据规则", JSON.stringify(rules));
  send({ ok: true, rules });
  return true;
}

export async function listMemberInsights(ctx) {
  const { req, p, send, session, get, all, url } = ctx;
  if (p !== "/api/admin/member-insights" || req.method !== "GET")
    return false;
  assertAdminSession(session);
  const shopId = resolveShopId(session, url);
  const rules = await loadMemberInsightRules(ctx);
  const nowMs = Date.now();
  const churnMs = rules.churnDays * 86400000;
  const callbackMs = rules.callbackDays * 86400000;
  const monthAgo = new Date(nowMs - 30 * 86400000).toISOString();

  // Members of this shop: non-admin users with at least one order
  // (any status) on a resource of the shop.
  const members = await all(
    `SELECT u.id, u.name FROM users u
     WHERE u.role<>'admin' AND EXISTS (
       SELECT 1 FROM orders o JOIN resources r ON r.id=o.resource_id
       WHERE o.user_id=u.id AND r.shop_id=?
     ) ORDER BY u.id`,
    shopId,
  );
  const users = [];
  const suggestions = [];
  for (const m of members) {
    const resolved = await resolveTier(get, all, m.id, shopId);
    const lastRow = await get(
      `SELECT MAX(o.created_at) AS last_order_at FROM orders o
       JOIN resources r ON r.id=o.resource_id
       WHERE o.user_id=? AND r.shop_id=? AND o.status IN (${PAID_LIST})`,
      m.id,
      shopId,
    );
    const lastOrderAt = lastRow?.last_order_at || null;
    const lastMs = lastOrderAt ? new Date(lastOrderAt).valueOf() : null;
    // Never bought in this shop -> no last order -> churned (see
    // the header comment); the callback suggestion below still
    // requires spending > 0.
    const churn = lastMs === null || nowMs - lastMs > churnMs;
    const nextTier = resolved.next_tier;
    const upgradeCandidate =
      nextTier !== null &&
      resolved.remaining_cents <=
        Math.floor((nextTier.min_spend_cents * rules.upgradeGapPct) / 100);
    users.push({
      user_id: m.id,
      name: m.name,
      spending_cents: resolved.spending_cents,
      last_order_at: lastOrderAt,
      tier: resolved.tier ? resolved.tier.name : null,
      churn,
      upgrade_candidate: upgradeCandidate,
      next_tier: nextTier ? nextTier.name : null,
      remaining_cents: nextTier ? resolved.remaining_cents : 0,
    });
    if (upgradeCandidate) {
      suggestions.push({
        type: "upgrade",
        user_id: m.id,
        name: m.name,
        next_tier: nextTier.name,
        remaining_cents: resolved.remaining_cents,
        text: `距${nextTier.name}还差${resolved.remaining_cents}分，建议向其推送下一等级权益，促成升级。`,
      });
    }
    if (
      resolved.spending_cents > 0 &&
      lastMs !== null &&
      nowMs - lastMs > callbackMs
    ) {
      suggestions.push({
        type: "callback",
        user_id: m.id,
        name: m.name,
        last_order_at: lastOrderAt,
        text: `超过${rules.callbackDays}天未购且有过消费，建议回访召回。`,
      });
    }
  }
  // ONE shop-level entry: the highest-revenue show in this shop in
  // the last 30 days (paid orders joined to shows via the show's
  // resource). Omitted when there is no paid show revenue.
  const topShow = await get(
    `SELECT s.id AS show_id, s.title AS title, COALESCE(SUM(o.amount),0) AS revenue_cents
     FROM shows s
     JOIN orders o ON o.resource_id=s.resource_id
     JOIN resources r ON r.id=o.resource_id
     WHERE s.shop_id=? AND r.shop_id=? AND o.status IN (${PAID_LIST})
       AND o.created_at>=?
     GROUP BY s.id, s.title ORDER BY revenue_cents DESC LIMIT 1`,
    shopId,
    shopId,
    monthAgo,
  );
  if (topShow) {
    suggestions.push({
      type: "push_show",
      show_id: topShow.show_id,
      title: topShow.title,
      revenue_cents: topShow.revenue_cents,
      text: `近30天本店收入最高的演出是“${topShow.title}”，建议加大推广。`,
    });
  }
  send({ users, suggestions });
  return true;
}
