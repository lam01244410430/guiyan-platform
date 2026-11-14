// Shared user-profile / tag-rule engine (Wave 3) — ported once from the
// original group demo (guiyan-demo/server/insights.mjs: ruleMatches(),
// profileRows(), recommendations(); guiyan-demo/server/review-upgrade.mjs:
// defaultTagRules), rewritten for this repo's stack (plain Node +
// PostgreSQL, ctx helpers). Used by #9 (tags), #11 (portrait +
// recommendations) and #8 (operator userSummary), so the three routes can
// never disagree about a user's tags.
//
// Money is INTEGER cents everywhere (spent, pricePreference, rule
// thresholds) — the same unit as orders.amount. Tag rules store 分, like
// zhou; the admin UI labels the unit explicitly (see TagRules view).
// days_since_payment counts from orders.created_at: Lam has no paid_at
// column, so "last payment" is the last paid order's creation time
// (stated in the analysis `definitions`, as before).

import { assert, int, text, time } from "./http.mjs";

// Paid statuses — the same list as server/routes/admin-insights.mjs
// PAID_STATUSES. `disputed` / `refund_requested` never occur in Lam's
// order state machine (no such transitions), but the list is shared so a
// future Wave 4 approval flow is counted the same way everywhere.
export const PAID_STATUSES = ["paid", "completed", "disputed", "refund_requested"];

// Port of insights.mjs ruleMatches(): one condition compares a metrics
// field; `view_category` checks Array.includes, the rest use the op.
export function ruleMatches(user, rule) {
  const result = rule.conditions.map((c) => {
    const a = user[c.field];
    const b = c.value;
    if (c.field === "view_category") return Array.isArray(a) && a.includes(b);
    return c.op === "gte"
      ? a >= b
      : c.op === "lte"
        ? a <= b
        : c.op === "gt"
          ? a > b
          : c.op === "lt"
            ? a < b
            : String(a) === String(b);
  });
  return rule.match === "any" ? result.some(Boolean) : result.every(Boolean);
}

// Port of review-upgrade.mjs defaultTagRules (4 manual rules, money in 分)
// + the R7-5 auto rule (mode 'auto', signal below).
export const defaultTagRules = [
  {
    id: "high",
    name: "高价值用户",
    enabled: true,
    mode: "manual",
    match: "all",
    conditions: [{ field: "spent", op: "gte", value: 1000000 }],
  },
  {
    id: "potential",
    name: "潜力会员",
    enabled: true,
    mode: "manual",
    match: "all",
    conditions: [
      { field: "spent", op: "gte", value: 100000 },
      { field: "spent", op: "lt", value: 1000000 },
      { field: "paid_count", op: "gte", value: 2 },
      { field: "days_since_payment", op: "lte", value: 90 },
    ],
  },
  {
    id: "silent",
    name: "沉默用户",
    enabled: true,
    mode: "manual",
    match: "all",
    conditions: [
      { field: "paid_count", op: "gte", value: 1 },
      { field: "days_since_payment", op: "gt", value: 90 },
    ],
  },
  {
    id: "heritage",
    name: "非遗浏览未购",
    enabled: true,
    mode: "manual",
    match: "all",
    conditions: [
      { field: "view_category", op: "eq", value: "heritage" },
      { field: "paid_count", op: "eq", value: 0 },
    ],
  },
  {
    // R7-5: the first stored auto-tag rule. Signal (verified in code,
    // never invented): meta.genre "民族歌舞" — the only genre value in
    // the seed (resources 2 刘三姐 and 3 壮乡情); there is no category
    // or genre named 民族音乐 for shows. The tag text follows the
    // approved R7-5 example (喜欢民族音乐 — 民族音乐 is attested as a
    // seed resource tag); the SIGNAL uses the verified genre value.
    // mode "auto" = evaluated by evaluateAutoTags() into user_tags
    // (source 'auto'); it is never a computed tag (see computeTags).
    id: "folk",
    name: "喜欢民族音乐",
    enabled: true,
    mode: "auto",
    signal: { kind: "view_genre", genre: "民族歌舞", threshold: 3 },
  },
];

const RULE_FIELDS = [
  "spent",
  "paid_count",
  "days_since_payment",
  "view_count",
  "favorite_count",
  "preference",
  "city",
  "channel",
  "view_category",
];
const NUMERIC_FIELDS = [
  "spent",
  "paid_count",
  "days_since_payment",
  "view_count",
  "favorite_count",
];

// Port of the tagRules checks in guiyan-demo/server/index.mjs
// PATCH /api/settings (1246-1309). Throws a 400 assert on the first
// invalid rule, so the caller never stores a half-validated set.
// Auto-tag signal kinds (R7-5) — every kind counts REAL stored rows,
// never a guess:
// - view_genre: view events whose resource meta.genre === signal.genre
// - view_category: view events whose resource category === signal.category
// - click_category: click events (detail `resource:{id}`) of that category
// - order_category: PAID orders of that category
// - favorite_category: favorites of that category
// threshold is a count of rows/events (1–100).
export const AUTO_SIGNAL_KINDS = [
  "view_genre",
  "view_category",
  "click_category",
  "order_category",
  "favorite_category",
];

// Mirror of seed.mjs `categories` (importing it here would be circular:
// seed.mjs imports defaultTagRules from this file). An auto rule may only
// name a category that exists in the code — never an invented one.
const KNOWN_CATEGORIES = [
  "show",
  "venue",
  "artist",
  "equipment",
  "copyright",
  "heritage",
  "creative",
  "digital",
  "tourism",
  "service",
  "show-license",
];

function validateAutoSignal(signal) {
  assert(signal && typeof signal === "object", "自动标签规则需要 signal");
  assert(AUTO_SIGNAL_KINDS.includes(signal.kind), "不支持的自动标签信号");
  int(signal.threshold, "触发次数", 1, 100);
  if (signal.kind === "view_genre") text(signal.genre, "剧种", 40);
  else {
    text(signal.category, "资源分类", 40);
    assert(KNOWN_CATEGORIES.includes(signal.category), "资源分类不存在");
  }
}

export function validateTagRules(rules) {
  assert(Array.isArray(rules) && rules.length <= 20, "最多配置20条标签规则");
  const ids = new Set();
  const names = new Set();
  const out = [];
  for (const r of rules) {
    assert(r && typeof r === "object", "标签规则格式错误");
    text(r.id, "规则编号", 60);
    text(r.name, "标签名称", 20);
    assert(
      !ids.has(r.id) && !names.has(r.name),
      "规则编号和标签名称不能重复",
    );
    ids.add(r.id);
    names.add(r.name);
    assert(typeof r.enabled === "boolean", "规则须标明是否启用");
    // R7-5: mode 'manual' (default — the Wave 3 computed rules) or
    // 'auto' (stored tags via evaluateAutoTags). An absent mode means
    // manual, so pre-R7-5 stored rule sets still validate.
    const mode = r.mode === undefined ? "manual" : r.mode;
    assert(mode === "manual" || mode === "auto", "规则模式须为 manual 或 auto");
    if (mode === "auto") {
      validateAutoSignal(r.signal);
      // An auto rule is driven by its signal, not by conditions —
      // carrying both would be ambiguous, so conditions are refused.
      assert(r.conditions === undefined, "自动标签规则使用 signal，不用 conditions");
      out.push({ ...r, mode });
      continue;
    }
    assert(
      ["all", "any"].includes(r.match) &&
        Array.isArray(r.conditions) &&
        r.conditions.length >= 1 &&
        r.conditions.length <= 6,
      "规则至少需要1个、最多6个条件",
    );
    for (const c of r.conditions) {
      assert(c && typeof c === "object", "规则条件格式错误");
      assert(
        RULE_FIELDS.includes(c.field) &&
          ["gte", "lte", "gt", "lt", "eq"].includes(c.op),
        "不支持的规则条件",
      );
      if (NUMERIC_FIELDS.includes(c.field)) int(c.value, "阈值", 0);
      else {
        assert(c.op === "eq", "文本条件仅支持等于");
        text(c.value, "匹配值", 40);
      }
    }
    out.push({ ...r, mode });
  }
  return out;
}

// Read the stored tagRules; missing row or broken JSON falls back to the
// defaults (lazy default, never throws, never overwrites the stored row).
// Returns a deep copy so callers cannot mutate the shared default.
export async function loadTagRules(ctx) {
  const row = await ctx.get("SELECT value FROM settings WHERE key='tagRules'");
  try {
    const parsed = JSON.parse(row?.value ?? "");
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to the default below
  }
  return JSON.parse(JSON.stringify(defaultTagRules));
}

const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);

// Price band of one ticket (cents per unit), port of insights.mjs
// priceBand(). Bands are named by their yuan range.
const priceBand = (value) =>
  value < 10000
    ? "100元以下"
    : value < 20000
      ? "100–199元"
      : value < 50000
        ? "200–499元"
        : value < 100000
          ? "500–999元"
          : "1000元及以上";

const dayOfBeijing = (value) =>
  value
    ? new Date(new Date(value).getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, 10)
    : null;
const todayBeijing = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

// Channel map (Q13 — DECIDED by Lam 2026-11-12: H5 is the mobile web entry, so H5 -> 自然流量）.
// users.channel has only 4 seed values (H5, 微信小程序, 猫眼, 抖音).
// Proposed buckets: 抖音 -> 抖音; 猫眼 -> 猫眼; 微信小程序 -> 其他渠道
// (its own channel, but outside the other three buckets); H5 -> 自然流量
// (arriving at the main web directly = organic traffic); anything else
// or empty -> 其他渠道. Flip this ONE function if Lam re-buckets.
export function mapChannelSource(channel) {
  if (channel === "抖音") return "抖音";
  if (channel === "猫眼") return "猫眼";
  if (channel === "H5") return "自然流量";
  return "其他渠道";
}

// resources.meta arrives as a parsed object (resourceRow) or a JSON
// string (raw ctx.all rows); tolerate both, never throw on bad JSON.
function parseMeta(r) {
  const m = r?.meta;
  if (!m) return {};
  if (typeof m === "object") return m;
  try {
    const parsed = JSON.parse(m);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Most frequent key in a Map<key, count>; ties prefer `prefer` (used so
// showType ties break toward the user's declared preference). Returns
// null when the map is empty.
function topOf(counts, prefer) {
  let best = null;
  let bestCount = 0;
  for (const [k, n] of counts) {
    if (n > bestCount || (n === bestCount && prefer !== undefined && k === prefer)) {
      best = k;
      bestCount = n;
    }
  }
  return best;
}

// Default tags added on top of rule matches, port of the tags block in
// insights.mjs profileRows(): 新用户 / 体验用户 + 高频消费 / 已付费 /
// 待培育 + the user's preference category name (or 综合兴趣).
export function computeTags(metrics, rules, categories) {
  // R7-5: computed tags come from MANUAL rules only. Auto rules have
  // no conditions (ruleMatches would crash on them) and their tags are
  // stored rows merged in profileRows(), never computed here.
  const matched = rules
    .filter((r) => r.enabled && r.mode !== "auto" && ruleMatches(metrics, r))
    .map((r) => r.name);
  const paid = metrics.paid_count;
  return [
    ...new Set([
      ...matched,
      ...(!paid
        ? ["新用户"]
        : !matched.some((t) => ["高价值用户", "潜力会员"].includes(t))
          ? ["体验用户"]
          : []),
      paid >= 5 ? "高频消费" : paid ? "已付费" : "待培育",
      categories.find((c) => c.id === metrics.preference)?.name || "综合兴趣",
    ]),
  ];
}

function suggestionFor(tags) {
  return tags.includes("沉默用户")
    ? "超过设定天数未消费，建议站内召回并推荐同城、同票价区间内容；优惠权益需运营另行确认。"
    : tags.includes("高价值用户")
      ? "推荐剧场专场与会员组合权益"
      : tags.includes("潜力会员")
        ? "近期有付费与复购，推荐同城演出及偏好价位资源"
        : "推荐低门槛非遗体验与首购活动";
}

// Port of insights.mjs profileRows() for Postgres: one row per non-admin
// user with metrics + tags[] + portrait + suggestion. `last_order` is the
// most recent paid order's created_at (Lam has no paid_at); the portrait's
// purchaseWindow is its Beijing HH:MM — the ORDER time, never a show time.
// Portrait shape (2026-11-12 甲方 update): 5 nested groups
// basic/spending/showPref/behavior/channel — see the portrait block below.
// The users query lists columns explicitly: the password hash must never
// reach a profile payload.
export async function profileRows(ctx) {
  const { all, categories } = ctx;
  const today = todayBeijing();
  const users = await all(
    "SELECT id,username,name,city,age,gender,channel,preference,verified,role,created_at FROM users WHERE role<>'admin' ORDER BY id",
  );
  const orders = await all(
    `SELECT o.*,r.category FROM orders o
     JOIN resources r ON r.id=o.resource_id ORDER BY o.id`,
  );
  const favorites = await all("SELECT user_id,resource_id FROM favorites");
  const events = await all(
    "SELECT user_id,detail FROM events WHERE type='view'",
  );
  const rules = await loadTagRules(ctx);
  const storedTags = await loadStoredUserTags(ctx);
  // Full resource rows: the portrait needs category + city + name +
  // meta.genre/meta.team, not just the id/category the tags need.
  const resources = await all("SELECT id,category,city,name,meta FROM resources");
  const byId = new Map(
    resources.map((r) => [r.id, { ...r, meta: parseMeta(r) }]),
  );
  // R3-6: main-shop (shop 1) stored-value balances, one row per user
  // who has ever topped up. The literal 1 is the main-shop id (same
  // value as MAIN_SHOP_ID in routes/member-tiers.mjs; a literal here
  // avoids a profiles <-> member-tiers circular import).
  const storedBalances = await all(
    "SELECT user_id, balance_cents FROM stored_value_accounts WHERE shop_id=1",
  );
  const balanceByUser = new Map(
    storedBalances.map((r) => [r.user_id, r.balance_cents]),
  );
  return users.map((u) => {
    const own = orders.filter((o) => o.user_id === u.id);
    const paid = own.filter((o) => PAID_STATUSES.includes(o.status));
    const last =
      paid
        .map((o) => o.created_at)
        .sort()
        .at(-1) || null;
    const bands = new Map();
    for (const o of paid.filter((o) => o.category === "show")) {
      const b = priceBand(o.amount / o.quantity);
      bands.set(b, (bands.get(b) || 0) + o.quantity);
    }
    const views = events.filter((e) => e.user_id === u.id);
    const spent = sum(paid, "amount");
    // R3-6: the user's real main-shop 文惠卡 balance (0 when they
    // have never topped up — no account row yet).
    const storedBalance = balanceByUser.get(u.id) || 0;
    const metrics = {
      ...u,
      order_count: own.length,
      paid_count: paid.length,
      spent,
      last_order: last,
      days_since_payment: last
        ? Math.max(
            0,
            Math.floor(
              (new Date(today) - new Date(dayOfBeijing(last))) / 86400000,
            ),
          )
        : 99999,
      favorite_count: favorites.filter((f) => f.user_id === u.id).length,
      view_count: views.length,
      view_category: [
        ...new Set(
          views
            .map((e) => byId.get(Number(e.detail))?.category)
            .filter(Boolean),
        ),
      ],
    };
    // Stored tags (R7-5 user_tags: auto grants + manual rows) join the
    // computed manual-rule tags, so GET /api/admin/users, the portrait
    // and the analysis userSummary all see the same tags.
    const tags = [
      ...new Set([
        ...computeTags(metrics, rules, categories),
        ...(storedTags.get(u.id) || []),
      ]),
    ];
    // --- Portrait, grouped into the 5 甲方 dimensions (2026-11-12
    // update; the old flat fields are gone, no parallel shape) --------
    // Interactions feeding 观演偏好/活跃城市: paid orders + views +
    // favorites, all resolved to resources through byId.
    const favResIds = favorites
      .filter((f) => f.user_id === u.id)
      .map((f) => f.resource_id);
    const viewResIds = views.map((e) => Number(e.detail));
    const interacted = [
      ...paid.map((o) => o.resource_id),
      ...viewResIds,
      ...favResIds,
    ];
    const genreCounts = new Map();
    const teamCounts = new Map();
    const artistCounts = new Map();
    const catCounts = new Map();
    const venueCounts = new Map();
    for (const id of interacted) {
      const r = byId.get(Number(id));
      if (!r) continue;
      if (r.meta.genre) genreCounts.set(r.meta.genre, (genreCounts.get(r.meta.genre) || 0) + 1);
      if (r.meta.team) teamCounts.set(r.meta.team, (teamCounts.get(r.meta.team) || 0) + 1);
      // B-026 (review fix): artist-category resources carry no
      // meta.team, so they need their own count for the 艺人 fallback
      // below — otherwise a user who only interacted with an artist
      // resource would read "暂无" despite a real artist interaction.
      if (r.category === "artist") artistCounts.set(r.name, (artistCounts.get(r.name) || 0) + 1);
      catCounts.set(r.category, (catCounts.get(r.category) || 0) + 1);
      if (r.category === "venue") venueCounts.set(r.id, (venueCounts.get(r.id) || 0) + 1);
    }
    // 活跃城市: city of the user's paid orders first; if none, the city
    // most viewed/favorited; final fallback the user's own city.
    const paidCityCounts = new Map();
    for (const o of paid) {
      const c = byId.get(Number(o.resource_id))?.city;
      if (c) paidCityCounts.set(c, (paidCityCounts.get(c) || 0) + 1);
    }
    const seenCityCounts = new Map();
    for (const id of [...viewResIds, ...favResIds]) {
      const c = byId.get(Number(id))?.city;
      if (c) seenCityCounts.set(c, (seenCityCounts.get(c) || 0) + 1);
    }
    const activeCity =
      topOf(paidCityCounts) || topOf(seenCityCounts) || u.city || "暂无";
    const topVenueId = topOf(venueCounts);
    return {
      ...metrics,
      tags,
      portrait: {
        basic: {
          age: u.age ?? null,
          gender: u.gender || "未设置",
          // Lam has NO separate region column: 区域 = users.city,
          // stated here and in the UI (not a second data source).
          region: u.city || "暂无",
          activeCity,
        },
        spending: {
          pricePreference: paid.length ? Math.round(spent / paid.length) : 0,
          priceBand:
            [...bands].sort((a, b) => b[1] - a[1])[0]?.[0] ||
            "暂无已支付票价样本",
          priceDistribution: [...bands].map(([name, count]) => ({
            name,
            count,
          })),
          frequency: { paidCount: paid.length, orderCount: own.length },
          // R3-6: the 文惠卡 system exists now — the REAL main-shop
          // balance in integer cents (0 when never topped up), and
          // storedValue says the system is connected.
          balance: storedBalance,
          storedValue: "已接入",
        },
        showPref: {
          // Only the 22 original seed resources carry meta.genre; the
          // 40 catalog rows have none, so they never contribute here.
          // No sample at all -> "暂无", never a guessed genre.
          genre: topOf(genreCounts) || "暂无",
          // Plan §4.4a: most frequent meta.team, OR the most-interacted
          // category=artist resource (B-026 fix — the only artist
          // resource in the seed has no meta.team); no sample -> "暂无".
          artist: topOf(teamCounts) || topOf(artistCounts) || "暂无",
          venue: topVenueId ? byId.get(topVenueId).name : "暂无",
          // Top category across paid + viewed + favorited; ties break
          // toward the category the user declared at registration.
          showType: topOf(catCounts, u.preference) || "暂无",
        },
        behavior: {
          purchaseWindow: last
            ? new Date(new Date(last).getTime() + 8 * 3600000)
                .toISOString()
                .slice(11, 16)
            : "暂无",
          payment: "模拟支付",
          // TBD: Lam records no shares (no share event, no share
          // column) — "暂无数据", never an invented count.
          sharing: "暂无数据",
          repeat: paid.length > 1 ? "有复购" : "暂无复购",
        },
        channel: { source: mapChannelSource(u.channel) },
      },
      suggestion: suggestionFor(tags),
    };
  });
}

// Stored tags (R7-5 user_tags): auto tags written by evaluateAutoTags
// plus any manual rows. Read once per profileRows() call so GET
// /api/admin/users, the portrait and the analysis userSummary all see
// the same tags. A missing table (a DB set up before R7-5 —
// schema.mjs CREATE TABLE IF NOT EXISTS runs at boot, so this is only
// a belt-and-braces fallback) reads as no stored tags, never a 500.
async function loadStoredUserTags(ctx) {
  try {
    const rows = await ctx.all("SELECT user_id, tag FROM user_tags");
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r.tag);
    }
    return byUser;
  } catch {
    return new Map();
  }
}

// --- R7-5: stored auto-tags -------------------------------------------
// An auto rule (mode 'auto') is evaluated against REAL stored rows and,
// when its signal threshold is met, writes one user_tags row
// (source 'auto', ON CONFLICT DO NOTHING — re-evaluation never
// duplicates). Manual rows (source 'manual') are never written,
// changed or deleted here; disabling an auto rule stops future grants
// but does not remove tags already granted (an admin removes a wrong
// tag by deleting the row — no endpoint in this wave).
// Evaluation is synchronous at the write that creates the signal —
// view (POST /api/resources/:id/view and POST /api/events), favorite
// add, order pay/complete — never a cron or worker (R5 policy).
// Rules only: no model, and a rule-granted tag is a rule label, never
// presented as AI output (Q3 simulation boundary).
export async function evaluateAutoTags(ctx, userId) {
  if (!userId) return [];
  const rules = (await loadTagRules(ctx)).filter(
    (r) => r.mode === "auto" && r.enabled,
  );
  if (!rules.length) return [];
  const resources = await ctx.all("SELECT id, category, meta FROM resources");
  const byId = new Map(
    resources.map((r) => [r.id, { ...r, meta: parseMeta(r) }]),
  );
  const views = await ctx.all(
    "SELECT detail FROM events WHERE type='view' AND user_id=?",
    userId,
  );
  const clicks = await ctx.all(
    "SELECT detail FROM events WHERE type='click' AND user_id=?",
    userId,
  );
  const favorites = await ctx.all(
    "SELECT resource_id FROM favorites WHERE user_id=?",
    userId,
  );
  const paidOrders = await ctx.all(
    `SELECT resource_id FROM orders WHERE user_id=? AND status IN (${PAID_STATUSES.map((s) => `'${s}'`).join(",")})`,
    userId,
  );
  // Counters per signal kind. View events carry a bare resource id in
  // detail; click events carry `resource:{id}` (show:/ticket_type:
  // clicks have no resource and never count here).
  const genreViews = new Map();
  const catViews = new Map();
  const catClicks = new Map();
  const catFavs = new Map();
  const catOrders = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const e of views) {
    const r = byId.get(Number(e.detail));
    if (!r) continue;
    bump(catViews, r.category);
    if (r.meta.genre) bump(genreViews, r.meta.genre);
  }
  for (const e of clicks) {
    const m = /^resource:(\d+)$/.exec(String(e.detail || ""));
    const r = m && byId.get(Number(m[1]));
    if (!r) continue;
    bump(catClicks, r.category);
  }
  for (const f of favorites) {
    const r = byId.get(Number(f.resource_id));
    if (r) bump(catFavs, r.category);
  }
  for (const o of paidOrders) {
    const r = byId.get(Number(o.resource_id));
    if (r) bump(catOrders, r.category);
  }
  const granted = [];
  for (const rule of rules) {
    const s = rule.signal || {};
    const count =
      s.kind === "view_genre"
        ? genreViews.get(s.genre) || 0
        : s.kind === "view_category"
          ? catViews.get(s.category) || 0
          : s.kind === "click_category"
            ? catClicks.get(s.category) || 0
            : s.kind === "order_category"
              ? catOrders.get(s.category) || 0
              : s.kind === "favorite_category"
                ? catFavs.get(s.category) || 0
                : 0;
    if (typeof s.threshold !== "number" || count < s.threshold) continue;
    // 4 columns, 4 placeholders (count them on every new INSERT).
    await ctx.run(
      "INSERT INTO user_tags(user_id,tag,source,created_at) VALUES(?,?,?,?) ON CONFLICT (user_id,tag,source) DO NOTHING",
      userId,
      rule.name,
      "auto",
      time(),
    );
    granted.push(rule.name);
  }
  return granted;
}

// Port of insights.mjs recommendations(): per-category signals from the
// user's last 100 views + favorites + paid orders; view +2, favorite +5,
// paid +8, signal capped at 35, preference +20, same city +6. Sorted by
// score desc, then resource id asc. Each entry also embeds a short
// resource summary (Q9 default) so the client needs no second fetch.
// SCORING IS UNCHANGED by the 2026-11-12 portrait rework — only the
// reason TEXT names the matched portrait dimension: preference/category
// -> 演出类型/观演偏好; same city -> 活跃城市/区域; same meta.genre ->
// 剧种; same meta.team -> 艺人.
// R7-6 context buckets (rules only — never presented as AI):
// a performance's start_at hour maps to morning 06–11, afternoon
// 12–17, evening 18–21, night 22–05. Only performances of approved
// shows in status scheduled/on_sale count; cancelled ones never do.
function bucketOf(startAt) {
  const h = Number(String(startAt).slice(11, 13));
  if (!Number.isSafeInteger(h)) return null;
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}
const TIME_LABELS = {
  morning: "上午场",
  afternoon: "下午场",
  evening: "晚场",
  night: "深夜场",
};

export async function recommendationsFor(user, resources, ctx, opts = {}) {
  if (!user) return [];
  const { all, orderRows } = ctx;
  const views = await all(
    "SELECT detail FROM events WHERE type='view' AND user_id=? ORDER BY id DESC LIMIT 100",
    user.id,
  );
  const favorites = await all(
    "SELECT resource_id FROM favorites WHERE user_id=?",
    user.id,
  );
  const orders = await orderRows({ id: user.id });
  const byId = new Map(resources.map((r) => [r.id, { ...r, meta: parseMeta(r) }]));
  // The user's top 剧种 / 艺人, from the same paid + viewed + favorited
  // interactions that feed the portrait's showPref — used only to NAME
  // the matched dimension in the reason text, never to change a score.
  const genreCounts = new Map();
  const teamCounts = new Map();
  const paidIds = orders
    .filter((o) => PAID_STATUSES.includes(o.status))
    .map((o) => o.resource_id);
  for (const id of [
    ...views.map((v) => Number(v.detail)),
    ...favorites.map((f) => f.resource_id),
    ...paidIds,
  ]) {
    const meta = byId.get(Number(id))?.meta || {};
    if (meta.genre) genreCounts.set(meta.genre, (genreCounts.get(meta.genre) || 0) + 1);
    if (meta.team) teamCounts.set(meta.team, (teamCounts.get(meta.team) || 0) + 1);
  }
  const topGenre = topOf(genreCounts);
  const topTeam = topOf(teamCounts);
  // R7-6 context scoring (rules + real data only, weights documented
  // in the comment below; never presented as AI). `opts` is {} when
  // the caller passed no context params, and then the scores/reasons
  // below are identical to the old version.
  //   time_of_day +10: the resource has an approved show's
  //     performance (scheduled/on_sale) whose start_at hour falls in
  //     the requested bucket; the reason names the earliest matching
  //     start time from the real performance row. No performances at
  //     all -> no boost, no penalty, and no claim about a show time.
  //   city +8: resource.city equals the requested city (on top of
  //     the existing +6 for the user's own city).
  //   companion: family +6 when category='show' and meta.duration
  //     >= 60 (a full-length show suits a family outing; duration is
  //     seed data); couple +6 when the show has an evening
  //     performance (a date-night slot, same real performance rows);
  //     friends +6 when capacity >= 200 (room for a group; capacity
  //     is a real resource field); alone: no adjustment — any show
  //     suits a solo visit. Invalid values are rejected by the route
  //     (400) and ignored here.
  const contextOpts = opts || {};
  const hasContext = Boolean(
    contextOpts.time_of_day || contextOpts.city || contextOpts.companion,
  );
  // Evening (or other-bucket) show times come from the real
  // performances table, joined through approved shows — never from a
  // guessed time. Only queried when a context param needs it, so the
  // no-context path touches no extra table.
  const perfByResource = new Map(); // resourceId -> [start_at, ...]
  if (
    hasContext &&
    (contextOpts.time_of_day || contextOpts.companion === "couple")
  ) {
    const perfRows = await all(
      `SELECT s.resource_id AS resource_id, p.start_at AS start_at
         FROM performances p JOIN shows s ON s.id = p.show_id
        WHERE s.status='approved' AND p.status IN ('scheduled','on_sale')`,
    );
    for (const row of perfRows) {
      const list = perfByResource.get(Number(row.resource_id)) || [];
      list.push(String(row.start_at));
      perfByResource.set(Number(row.resource_id), list);
    }
  }
  const signals = new Map();
  for (const [rows, key, weight, label] of [
    [views, "detail", 2, "浏览"],
    [favorites, "resource_id", 5, "收藏"],
    [
      orders.filter((o) => PAID_STATUSES.includes(o.status)),
      "resource_id",
      8,
      "购买",
    ],
  ])
    for (const row of rows) {
      const c = byId.get(Number(row[key]))?.category;
      if (c) {
        const s = signals.get(c) || { score: 0, reasons: new Set() };
        s.score += weight;
        s.reasons.add(label);
        signals.set(c, s);
      }
    }
  return resources
    .map((r) => {
      let score = 0;
      const reasons = [];
      const meta = parseMeta(r);
      const signal = signals.get(r.category);
      if (r.category === user.preference) {
        score += 20;
        reasons.push("符合你的兴趣偏好（演出类型/观演偏好）");
      }
      if (signal) {
        score += Math.min(35, signal.score);
        reasons.push("你" + [...signal.reasons].join("、") + "过同类资源");
      }
      if (meta.genre && topGenre && meta.genre === topGenre) {
        reasons.push(`同剧种“${topGenre}”`);
      }
      if (meta.team && topTeam && meta.team === topTeam) {
        reasons.push(`同艺人“${topTeam}”`);
      }
      if (r.city === user.city) {
        score += 6;
        reasons.push("与你的所在城市相同（活跃城市/区域）");
      }
      if (hasContext && contextOpts.time_of_day) {
        const starts = (perfByResource.get(r.id) || [])
          .filter((s) => bucketOf(s) === contextOpts.time_of_day)
          .sort();
        if (starts.length) {
          score += 10;
          reasons.push(
            `${TIME_LABELS[contextOpts.time_of_day]}演出（${starts[0].slice(11, 16)} 开演）`,
          );
        }
      }
      if (hasContext && contextOpts.city && r.city === contextOpts.city) {
        score += 8;
        reasons.push(`位于${contextOpts.city}`);
      }
      if (hasContext && contextOpts.companion) {
        if (
          contextOpts.companion === "family" &&
          r.category === "show" &&
          Number.isSafeInteger(meta.duration) &&
          meta.duration >= 60
        ) {
          score += 6;
          reasons.push(`全场演出（${meta.duration} 分钟），适合全家同行`);
        } else if (
          contextOpts.companion === "couple" &&
          (perfByResource.get(r.id) || []).some(
            (s) => bucketOf(s) === "evening",
          )
        ) {
          score += 6;
          reasons.push("晚场演出，适合双人同行");
        } else if (
          contextOpts.companion === "friends" &&
          Number.isSafeInteger(r.capacity) &&
          r.capacity >= 200
        ) {
          score += 6;
          reasons.push("场地可容纳多人，适合结伴同行");
        }
        // alone: no adjustment (documented above).
      }
      return {
        resourceId: r.id,
        score,
        reason: reasons.join(" · ") || "发现更多广西文化资源",
        resource: {
          id: r.id,
          name: r.name,
          city: r.city,
          price: r.price,
          unit: r.unit,
          category: r.category,
          image: r.image,
        },
      };
    })
    .sort((a, b) => b.score - a.score || a.resourceId - b.resourceId);
}
