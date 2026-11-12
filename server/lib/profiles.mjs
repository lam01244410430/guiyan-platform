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

import { assert, int, text } from "./http.mjs";

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

// Port of review-upgrade.mjs defaultTagRules (4 rules, money in 分).
export const defaultTagRules = [
  {
    id: "high",
    name: "高价值用户",
    enabled: true,
    match: "all",
    conditions: [{ field: "spent", op: "gte", value: 1000000 }],
  },
  {
    id: "potential",
    name: "潜力会员",
    enabled: true,
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
    match: "all",
    conditions: [
      { field: "view_category", op: "eq", value: "heritage" },
      { field: "paid_count", op: "eq", value: 0 },
    ],
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
export function validateTagRules(rules) {
  assert(Array.isArray(rules) && rules.length <= 20, "最多配置20条标签规则");
  const ids = new Set();
  const names = new Set();
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
    assert(
      typeof r.enabled === "boolean" &&
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
  }
  return rules;
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
  const matched = rules
    .filter((r) => r.enabled && ruleMatches(metrics, r))
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
  // Full resource rows: the portrait needs category + city + name +
  // meta.genre/meta.team, not just the id/category the tags need.
  const resources = await all("SELECT id,category,city,name,meta FROM resources");
  const byId = new Map(
    resources.map((r) => [r.id, { ...r, meta: parseMeta(r) }]),
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
    const tags = computeTags(metrics, rules, categories);
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
          // TBD: Lam has NO stored-value / 文惠卡 system — never invent
          // a balance. balance stays null, storedValue says so in words.
          balance: null,
          storedValue: "尚未接入",
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

// Port of insights.mjs recommendations(): per-category signals from the
// user's last 100 views + favorites + paid orders; view +2, favorite +5,
// paid +8, signal capped at 35, preference +20, same city +6. Sorted by
// score desc, then resource id asc. Each entry also embeds a short
// resource summary (Q9 default) so the client needs no second fetch.
// SCORING IS UNCHANGED by the 2026-11-12 portrait rework — only the
// reason TEXT names the matched portrait dimension: preference/category
// -> 演出类型/观演偏好; same city -> 活跃城市/区域; same meta.genre ->
// 剧种; same meta.team -> 艺人.
export async function recommendationsFor(user, resources, ctx) {
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
