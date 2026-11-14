// Guiyan admin insights — port of the original group demo's analysis
// (guiyan-demo/server/insights.mjs: analysis(), bucket(), profileRows(),
// ruleMatches() + server/index.mjs: /api/analytics, /api/alerts,
// /api/export, /api/moderate), rewritten for this repo's stack:
// plain Node + PostgreSQL, ctx helpers from lib/http.mjs + lib/context.mjs.
//
// Honest-data rules (Lam's seed has no paid_at / refunded_at columns and
// no venue<->show link, so this file states that everywhere it matters):
// - Every time series and every analysis figure is grouped by
// orders.created_at (Beijing date), NEVER "按支付日". The definitions
// object and the text report both say so.
// - Sources with no feed (票房 / 核销 / 文惠卡 / 消费卡) are labelled
// 未接入 in `sources`; no number is invented for them.
// - Venue seatOccupancy / performances come from the venues table
// (R2-4/R2-5: shows link via resources.venue_id, seats via the seats
// table); they are null / 0 with the label "暂无关联售票样本" when
// a venue has no linked performances or no seats.
// - No marketing ROI is computed (no ad-spend data); no 淡旺季 claim is
// made from a few months of sample (the insight says so in words).
// - Inventory: bookingType resources (venue / equipment, see
// lib/http.mjs) are per-day stock, everything else is global stock.
// A per-day remainder uses capacity when set, else stock (equipment
// rows seed capacity 0, meaning "no daily quota set").
// - "Today" is the real current date (Beijing), like the original's clock.

import { assert, int, text, bookingType, resourceRow} from "../lib/http.mjs";
import { profileRows } from "../lib/profiles.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";
import { resolveTier, MAIN_SHOP_ID } from "./member-tiers.mjs";

const PERIODS = ["day", "week", "month", "quarter"];
const PAID_STATUSES = ["paid", "completed", "disputed", "refund_requested"];
const SOURCES = {
票房: "未接入",
核销: "未接入",
文惠卡: "未接入",
消费卡: "未接入",
};

// Beijing "today", like the original's dayOf() (+8h shift).
const todayBeijing = () =>
new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const dayOfBeijing = (value) =>
value
? new Date(new Date(value).getTime() + 8 * 3600000)
.toISOString()
.slice(0, 10)
: null;
const shiftDay = (d, n) =>
new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
.toISOString()
.slice(0, 10);
const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);

// Port of insights.mjs bucket(): week starts Monday, like Postgres
// DATE_TRUNC('week',...) below, so the SQL buckets and these JS keys agree.
function bucketKey(d, period) {
if (period === "week") {
const n = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
return shiftDay(d, -n);
}
if (period === "month") return d.slice(0, 7);
if (period === "quarter")
return `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
return d;
}
function bucketLabel(key, period) {
if (period === "week") return key.slice(5) + "～" + shiftDay(key, 6).slice(5);
return period === "day"? key.slice(5): key;
}

// Fill zero-transaction buckets from the earliest bucket through today,
// in chronological order. `rows` are {bucket, amount, count} from SQL.
// Steps bucket-by-bucket (not day-by-day): a quarter bucket key like
// "2026 Q4" is not a valid date, so day-stepping from it throws
// (B-014). Bucket keys sort lexicographically in time order within one
// period ("2026-08" < "2026-09", "2026 Q3" < "2026 Q4"), so string
// comparison is a safe stop condition.
function nextBucket(key, period) {
  if (period === "week") return shiftDay(key, 7);
  if (period === "month") {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return m === 12
      ? `${y + 1}-01`
      : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  if (period === "quarter") {
    const y = Number(key.slice(0, 4));
    const q = Number(key.slice(6, 7));
    return q === 4 ? `${y + 1} Q1` : `${y} Q${q + 1}`;
  }
  return shiftDay(key, 1);
}

function buildSeries(rows, period, today) {
  const byKey = new Map(rows.map((r) => [bucketKey(r.bucket, period), r]));
  const start = rows.length
    ? bucketKey(rows.map((r) => r.bucket).sort()[0], period)
    : bucketKey(shiftDay(today, -29), period);
  const endKey = bucketKey(today, period);
  const series = new Map();
  for (let key = start; key <= endKey; key = nextBucket(key, period)) {
    if (!series.has(key)) {
      const found = byKey.get(key);
      series.set(key, {
        date: key,
        label: bucketLabel(key, period),
        amount: found ? Number(found.amount) : 0,
        count: found ? Number(found.count) : 0,
      });
    }
  }
  return [...series.values()];
}

async function seriesFor(ctx, period) {
const { all} = ctx;
const rows = await all(
`SELECT TO_CHAR(DATE_TRUNC(?, (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')), 'YYYY-MM-DD') AS bucket,
SUM(amount) AS amount, COUNT(*) AS count
FROM orders WHERE status IN ('paid','completed') GROUP BY 1 ORDER BY 1`,
period === "week"
? "week"
: period === "month"
? "month"
: period === "quarter"
? "quarter"
: "day",
);
return buildSeries(rows, period, todayBeijing());
}

function requireAdmin(session) {
assert(session?.role === "admin", "无权访问管理后台", 403);
}
function requirePeriod(ctx) {
const period = ctx.url.searchParams.get("period") || "day";
assert(PERIODS.includes(period), "无效统计周期");
return period;
}


export async function adminStatsSeries(ctx) {
const { req, p, send, session, cache, res} = ctx;
if (p!== "/api/admin/stats" || req.method!== "GET") return false;
requireAdmin(session);
const period = requirePeriod(ctx);
if (cache?.enabled) {
const hit = await cache.get(CACHE_KEYS.adminStats(period));
if (hit) {
res.setHeader("X-Cache", "HIT");
send(hit);
return true;
}
}
const payload = { period, series: await seriesFor(ctx, period), sources: SOURCES};
if (cache?.enabled) {
res.setHeader("X-Cache", "MISS");
await cache.set(CACHE_KEYS.adminStats(period), payload, CACHE_TTLS.adminStats);
}
send(payload);
return true;
}

async function loadAnalysisData(ctx) {
const { all, get} = ctx;
const today = todayBeijing();
const orders = await all(
`SELECT o.*,r.name AS resource_name,r.category,r.city FROM orders o
JOIN resources r ON r.id=o.resource_id ORDER BY o.id`,
);
const resources = (await all("SELECT * FROM resources")).map(resourceRow);
const users = await all(
"SELECT * FROM users WHERE role<>'admin' ORDER BY id",
);
const favorites = await all("SELECT user_id,resource_id FROM favorites");
// R2-4/R2-5: the venues table + the show/performance/seat rows the
// venue analysis reads (shows -> resources.venue_id links a show to
// its venue; seats carry the sold counts).
const venueRows = await all("SELECT * FROM venues ORDER BY id ASC");
const shows = await all("SELECT * FROM shows");
const performances = await all("SELECT * FROM performances");
const seats = await all("SELECT * FROM seats");
// R5-4: the promo + member inputs the analysis aggregates. Coupon
// redemptions are the redemption truth (a cancelled order's
// redemption row is released, see routes/orders.mjs); orders carry
// the coupon/flash snapshots (coupon_id, coupon_cents,
// flash_sale_id, flash_cents) written at creation.
const coupons = await all("SELECT * FROM coupons");
const redemptions = await all("SELECT * FROM coupon_redemptions");
const flashSales = await all("SELECT * FROM flash_sales");
const thresholdRow = await get(
"SELECT value FROM settings WHERE key='alertThreshold'",
);
let threshold = 5;
try {
threshold = JSON.parse(thresholdRow?.value?? "5");
} catch {
threshold = 5;
}
return { today, orders, resources, users, favorites, threshold, venueRows, shows, performances, seats, coupons, redemptions, flashSales };
}

function computeAlerts({ today, orders, resources, threshold}, events) {
const alerts = resources
.filter(
(r) =>
r.status === "published" &&
!bookingType(r) &&
r.stock <= threshold,
)
.map((r) => ({
severity: "warning",
title: `${r.name}库存仅剩${r.stock}`,
detail: "建议补充库存或暂时下架，避免超卖。",
}));
for (const r of resources.filter(
(r) => r.status === "published" && bookingType(r),
)) {
const held = new Map();
for (const o of orders.filter(
(o) =>
o.resource_id === r.id &&
o.booking_date >= today &&
!["cancelled", "refunded"].includes(o.status),
))
held.set(o.booking_date, (held.get(o.booking_date) || 0) + o.quantity);
for (const [date, quantity] of held) {
const quota = r.capacity || r.stock;
const left = Math.max(0, quota - quantity);
if (left <= threshold)
alerts.push({
severity: "warning",
title: `${r.name} ${date}余量${left}`,
detail: "该日期配额紧张，请核对场次库存；其他日期独立计算。",
});
}
}
const pending = orders.filter((o) => o.status === "pending").length;
const abnormal = orders.filter((o) =>
["disputed", "refund_requested"].includes(o.status),
).length;
if (pending)
alerts.push({
severity: "info",
title: `${pending}笔预约等待确认`,
detail: "请在交易管理中确认档期和资源，及时处理预约。",
});
if (abnormal)
alerts.push({
severity: "warning",
title: `${abnormal}笔售后或纠纷待处理`,
detail: "请核实退款和申诉信息。",
});
for (const event of events) {
let item;
try {
item = JSON.parse(event.detail);
} catch {
continue;
}
alerts.push({
id: event.id,
severity: "warning",
title: item.title + "（模拟事件）",
detail: item.detail,
});
}
return alerts;
}

// Wave 3 #9: the analysis computation, exported so the operator branch
// of the assistant (server/routes/assistant.mjs) can answer from the same
// numbers without an internal HTTP call or a second implementation.
// Returns the exact payload adminAnalysis sends; no admin check, no
// cache, no send here. Operator calls go direct (no cache) — admin-only,
// low frequency — and the cached wrapper below stays the HTTP path.
export async function buildAnalysis(ctx, period) {
const { all, get } = ctx;
const { today, orders, resources, users, threshold, venueRows, shows, performances, seats, coupons, redemptions, flashSales } =
await loadAnalysisData(ctx);
const resourcesById = new Map(resources.map((r) => [r.id, r]));
const paid = orders.filter((o) => PAID_STATUSES.includes(o.status));
const series = await seriesFor(ctx, period);

// User profiles (tags, portrait, suggestion) come from the shared
// module, so GET /api/admin/users tags and this userSummary always agree.
const profiles = await profileRows(ctx);


const ranking = resources
.map((r) => {
const rows = paid.filter((o) => o.resource_id === r.id);
return {
...r,
sales: rows.length,
quantity: sum(rows, "quantity"),
revenue: sum(rows, "amount"),
};
})
.sort((a, b) => b.revenue - a.revenue);
const cold = ranking
.filter((r) => r.status === "published" && r.sales === 0)
.slice(0, 5);

const venues = venueRows.map((v) => {
// R2-4/R2-5: venues are real rows now (venues table); a show links
// to a venue through its resource (shows -> resources.venue_id), and
// a venue resource's own rental bookings still drive occupancy.
// The venue's own resources: the backfilled venue-category rows that
// link here (usually one — the venue's own listing).
const ownResources = resources.filter((r) => r.venue_id === v.id);
const ownIds = new Set(ownResources.map((r) => r.id));
const booked = orders.filter(
(o) =>
ownIds.has(o.resource_id) &&
!["cancelled", "refunded"].includes(o.status) &&
o.booking_date >= today &&
o.booking_date <= shiftDay(today, 29),
);
const bookedDays = new Set(booked.map((o) => o.booking_date)).size;
const occupancy = Math.round((bookedDays / 30) * 1000) / 10;
// Linked shows: shows whose resource links this venue.
const linkedShows = shows.filter((s) => {
const r = resourcesById.get(s.resource_id);
return r && r.venue_id === v.id;
});
const linkedShowIds = new Set(linkedShows.map((s) => s.id));
const linkedResourceIds = new Set(linkedShows.map((s) => s.resource_id));
// Performances are real rows now (not show-date combos with orders).
const linkedPerfs = performances.filter((pf) =>
linkedShowIds.has(pf.show_id),
);
const perfIds = new Set(linkedPerfs.map((pf) => pf.id));
const showOrders = orders.filter(
(o) =>
linkedResourceIds.has(o.resource_id) &&
!["cancelled", "refunded"].includes(o.status),
);
// Seats: rows of the linked performances; sold = status 'sold'
// (held seats do not count — only paid orders sell seats).
const venueSeats = seats.filter((s) => perfIds.has(s.performance_id));
const soldSeats = venueSeats.filter((s) => s.status === "sold").length;
const revenue = sum(
paid.filter((o) => ownIds.has(o.resource_id)),
"amount",
);
const ticketRevenue = sum(
showOrders.filter((o) => PAID_STATUSES.includes(o.status)),
"amount",
);
const weekday = new Map();
for (const o of booked) {
const k = new Date(o.booking_date + "T00:00:00Z").getUTCDay();
weekday.set(k, (weekday.get(k) || 0) + 1);
}
const genre = ["歌舞", "音乐", "话剧", "民歌", "舞蹈"];
const content =
v.name +
ownResources
.map((r) => r.description + r.tags.join("") + JSON.stringify(r.meta))
.join("");
const venueCity = ownResources[0]?.city || "";
const recommendations = resources
.filter((s) => s.category === "show" && s.status === "published")
.map((s) => {
const tags = genre.filter(
(t) =>
content.includes(t) &&
(s.name + s.description + s.tags.join("")).includes(t),
);
return {
id: s.id,
name: s.name,
score: tags.length * 10 + (s.city === venueCity ? 3 : 0),
reason: tags.length
? "适配" + tags.join("、") + "演出"
: s.city === venueCity
? "同城剧目，需核实舞台条件"
: "需核实设备与舞台条件",
};
})
.sort((a, b) => b.score - a.score || a.id - b.id)
.slice(0, 3);
return {
id: v.id,
name: v.name,
bookedDays,
occupancy,
idleRate: Math.round((100 - occupancy) * 10) / 10,
revenue,
performances: linkedPerfs.length,
seatOccupancy: venueSeats.length
? Math.round((soldSeats / venueSeats.length) * 1000) / 10
: null,
ticketRevenue,
averageRevenue: linkedPerfs.length
? Math.round(ticketRevenue / linkedPerfs.length)
: null,
peak: weekday.size
? "周" +
["日", "一", "二", "三", "四", "五", "六"][
[...weekday].sort((a, b) => b[1] - a[1])[0][0]
]
: "暂无预约样本",
recommendations,
};
});

const byMonth = new Map();

// R5-4 — data aggregation + smart analysis (xlsx rows 59, 61).
// Three new sections, all computed from real R2–R4 data; nothing
// here is a model and nothing may be presented as AI (row 61: the
// AI-suggestion half stays in R7).
//
// (a) shows: one row per show. The FK path is verified in code,
// never guessed: orders.performance_id -> performances.show_id is
// the primary link (orders.mjs writes performance_id for
// performance orders); old-flow orders have performance_id NULL
// and link through orders.resource_id = shows.resource_id
// instead. The two branches are disjoint, so no order is counted
// twice. orders / revenue_cents count PAID_STATUSES orders only
// (the same `paid` scope as the rest of this analysis); occupancy
// is sold seats / all seats of the show's performances, null when
// the show has no seats at all (same honesty rule as venue
// seatOccupancy below).
const seatsByPerf = new Map();
for (const s of seats) {
const list = seatsByPerf.get(s.performance_id) || [];
list.push(s);
seatsByPerf.set(s.performance_id, list);
}
const showRows = shows.map((s) => {
const showPerfs = performances.filter((pf) => pf.show_id === s.id);
const showPerfIds = new Set(showPerfs.map((pf) => pf.id));
const showOrders = paid.filter(
(o) =>
(showPerfIds.has(o.performance_id) ||
((o.performance_id === null || o.performance_id === undefined) &&
o.resource_id === s.resource_id)),
);
const showSeats = showPerfs.flatMap((pf) => seatsByPerf.get(pf.id) || []);
const soldSeats = showSeats.filter((x) => x.status === "sold").length;
return {
show_id: s.id,
title: s.title,
performances: showPerfs.length,
orders: showOrders.length,
revenue_cents: sum(showOrders, "amount"),
occupancy: showSeats.length
? Math.round((soldSeats / showSeats.length) * 1000) / 10
: null,
};
});

// (b) promos: coupon effectiveness from the real
// coupon_redemptions table (redemption count + total discount per
// coupon) plus paid orders with a coupon vs without; flash-sale
// effectiveness from orders.flash_sale_id (sold count + revenue +
// total discount per sale).
const redemptionsByCoupon = new Map();
for (const r of redemptions) {
const list = redemptionsByCoupon.get(r.coupon_id) || [];
list.push(r);
redemptionsByCoupon.set(r.coupon_id, list);
}
const couponRows = coupons.map((c) => {
const list = redemptionsByCoupon.get(c.id) || [];
return {
coupon_id: c.id,
code: c.code,
redemptions: list.length,
total_discount_cents: sum(list, "amount_cents"),
};
});
const ordersWithCoupon = paid.filter(
(o) => o.coupon_id !== null && o.coupon_id !== undefined,
).length;
const promos = {
coupons: couponRows,
total_redemptions: sum(couponRows, "redemptions"),
total_discount_cents: sum(couponRows, "total_discount_cents"),
orders_with_coupon: ordersWithCoupon,
orders_without_coupon: paid.length - ordersWithCoupon,
flash_sales: flashSales.map((f) => {
const rows = paid.filter((o) => o.flash_sale_id === f.id);
return {
flash_sale_id: f.id,
name: f.name,
sold: rows.length,
revenue_cents: sum(rows, "amount"),
total_discount_cents: sum(rows, "flash_cents"),
};
}),
};

// (c) members: tier distribution + spending buckets for the MAIN
// shop (shop 1 — the only shop with a stored tier column; the live
// resolution below is the R5-2 / member-tiers.mjs definition, so
// this section and member-insights can never disagree). One
// resolveTier call per non-admin user also yields that user's
// spending, which feeds both the tier count and the bucket count.
// Churn (no paid order in the last 90 days, same default as the
// member-insight rules) is read off the in-memory paid orders —
// no extra query per user.
const CHURN_DAYS = 90;
const SPENDING_BUCKETS = [
{ label: "未消费", min_cents: 0, max_cents: 0 },
{ label: "100元以下", min_cents: 1, max_cents: 9999 },
{ label: "100–1000元", min_cents: 10000, max_cents: 99999 },
{ label: "1000–5000元", min_cents: 100000, max_cents: 499999 },
{ label: "5000元以上", min_cents: 500000, max_cents: null },
];
const lastPaidByUser = new Map();
for (const o of paid) {
const prev = lastPaidByUser.get(o.user_id);
if (!prev || o.created_at > prev) lastPaidByUser.set(o.user_id, o.created_at);
}
const churnCutoff = Date.now() - CHURN_DAYS * 86400000;
const tierCounts = new Map();
const bucketCounts = SPENDING_BUCKETS.map((b) => ({ ...b, users: 0 }));
for (const u of users) {
const resolved = await resolveTier(get, all, u.id, MAIN_SHOP_ID);
const tierName = resolved.tier ? resolved.tier.name : "未定级";
const entry = tierCounts.get(tierName) || {
tier_id: resolved.tier ? resolved.tier.id : null,
name: tierName,
users: 0,
churned_users: 0,
};
entry.users += 1;
const last = lastPaidByUser.get(u.id);
if (!last || new Date(last).valueOf() < churnCutoff)
entry.churned_users += 1;
tierCounts.set(tierName, entry);
const bucket = bucketCounts.find(
(b) =>
resolved.spending_cents >= b.min_cents &&
(b.max_cents === null || resolved.spending_cents <= b.max_cents),
);
if (bucket) bucket.users += 1;
}
const tierRows = [...tierCounts.values()].map((t) => ({
...t,
churn_rate: t.users
? Math.round((t.churned_users / t.users) * 1000) / 10
: 0,
}));
const members = {
total_users: users.length,
tiers: tierRows,
buckets: bucketCounts.map((b) => ({
label: b.label,
min_cents: b.min_cents,
max_cents: b.max_cents,
users: b.users,
})),
};

// Rule-text recommendations ONLY (fixed thresholds over the real
// sections above — no model, no prediction, never "AI"):
// - a show with seats and occupancy below 50% -> 考虑限时抢购
//   (lowest occupancy first, at most 3);
// - a tier whose churn rate is at least 50% (and at least one
//   churned member) -> 召回该等级用户;
// - the highest-revenue show -> 加大推广.
const recommendations = [];
for (const s of showRows
.filter((x) => x.occupancy !== null && x.occupancy < 50)
.sort((a, b) => a.occupancy - b.occupancy)
.slice(0, 3)) {
recommendations.push({
type: "flash_sale",
show_id: s.show_id,
title: s.title,
occupancy: s.occupancy,
text: `“${s.title}”上座率仅${s.occupancy}%，考虑限时抢购。`,
});
}
for (const t of tierRows.filter(
(t) => t.users > 0 && t.churned_users >= 1 && t.churn_rate >= 50,
)) {
recommendations.push({
type: "callback",
tier_id: t.tier_id,
tier: t.name,
churned_users: t.churned_users,
churn_rate: t.churn_rate,
text: `“${t.name}”等级${t.churned_users}人超90天未购（流失率${t.churn_rate}%），召回该等级用户。`,
});
}
const topShow = [...showRows].sort(
(a, b) => b.revenue_cents - a.revenue_cents || b.orders - a.orders,
)[0];
if (topShow && topShow.revenue_cents > 0) {
recommendations.push({
type: "promote",
show_id: topShow.show_id,
title: topShow.title,
revenue_cents: topShow.revenue_cents,
text: `“${topShow.title}”收入最高（${(topShow.revenue_cents / 100).toFixed(2)}元），加大推广。`,
});
}

for (const o of paid) {
const k = dayOfBeijing(o.created_at).slice(0, 7);
byMonth.set(k, (byMonth.get(k) || 0) + o.amount);
}
const seasons = [...byMonth].sort((a, b) => b[1] - a[1]);
const channels = new Map();
for (const o of paid)
channels.set(o.channel, (channels.get(o.channel) || 0) + o.amount);
const channelRows = [...channels]
.map(([name, amount]) => ({
name,
amount,
orders: paid.filter((o) => o.channel === name).length,
}))
.sort((a, b) => b.amount - a.amount);

const monthStart = shiftDay(today, -29);
const profileIds = new Set(profiles.map((p) => p.id));
const active = new Set(
orders
.filter(
(o) =>
profileIds.has(o.user_id) && dayOfBeijing(o.created_at) >= monthStart,
)
.map((o) => o.user_id),
);
const pending = orders.filter((o) => o.status === "pending").length;
const abnormal = orders.filter((o) =>
["disputed", "refund_requested"].includes(o.status),
).length;
const high = profiles.filter((u) => u.tags.includes("高价值用户")).length;
const silent = profiles.filter((u) => u.tags.includes("沉默用户")).length;
const potential = profiles.filter((u) => u.tags.includes("潜力会员")).length;

const insights = [
`热销引进：${ranking[0]?.name || "暂无"}当前交易额领先，建议评估同类剧目联动。`,
`冷门资源：${cold.map((r) => r.name).join("、") || "暂无零成交资源"}；建议补充介绍与小规模曝光，先验证需求再调价。`,
`场馆经营：未来30天平均档期占用率${venues.length? (sum(venues, "occupancy") / venues.length).toFixed(1): 0}%；空闲场馆可采用工作日套餐。`,
`季节观察：${seasons[0]?.[0] || "暂无"}为当前样本交易额最高月份；仅有${seasons.length}个月样本，不能据此认定长期淡旺季。`,
`渠道复盘：${channelRows[0]?.name || "暂无"}成交额最高；缺少投放成本、曝光和转化数据，暂不计算营销ROI。`,
`定价建议：按付费用户的票价区间与冷门资源表现设计小额试验，避免直接全量降价。`,
`用户运营：高价值用户${high}人、沉默用户${silent}人；优先分群触达并观察复购。`,
`预约跟进：${pending}笔待确认，${abnormal}笔售后待处理。`,
];
const kpis = {
revenue: sum(paid, "amount"),
orders: orders.length,
paidOrders: paid.length,
resources: resources.filter((r) => r.status === "published").length,
users: active.size,
};
const report = [
"模拟经营分析报告",
`生成日期：${today}；金额按有效已支付订单统计，退款成功订单剔除。`,
`交易总额：${(kpis.revenue / 100).toFixed(2)}元；历史订单：${kpis.orders}笔；有效付费订单：${paid.length}笔。`,
...venues.map(
(v) =>
`${v.name}：未来30天档期占用${v.occupancy}%，闲置${v.idleRate}%，热门预约星期${v.peak}；关联剧目${v.performances}场，上座率${v.seatOccupancy === null? "暂无关联售票样本": v.seatOccupancy + "%"}，场均票房${v.averageRevenue === null? "暂无": (v.averageRevenue / 100).toFixed(2) + "元"}。`,
),
...insights,
"说明：租赁档期占用率与售票上座率分别计算；仅有日期，不推断一天内的热门小时。按订单创建时间统计（无支付时间字段）。",
].join("\n");

const events = await all(
"SELECT * FROM events WHERE type LIKE 'alert.%' ORDER BY id DESC LIMIT 5",
);
const alerts = computeAlerts(
{ today, orders, resources, threshold},
events,
);
const payload = {
period,
today,
kpis,
series,
channels: channelRows,
ranking,
alerts,
insights,
venues,
cold,
shows: showRows,
promos,
members,
recommendations,
report,
sources: SOURCES,
userSummary: {
total: profiles.length,
newUsers: profiles.filter((u) => dayOfBeijing(u.created_at) >= monthStart)
.length,
highValue: high,
potential,
silent,
},
definitions: {
revenue: "有效已支付金额（剔除退款成功及取消订单）",
orders: "历史全部订单，包含取消与退款",
series:
"按订单创建时间（北京时间）归集，补齐零交易周期；无支付时间字段",
users: "近30天提交订单的去重用户数",
},
};
return payload;
}

// HTTP wrapper: admin check + 60 s cache around buildAnalysis().
// ?source=snapshot returns the stored snapshot for the period
// (payload + computed_at); the default live source recomputes (or
// serves the cache). A period with no snapshot yet is a 404, not a
// silent live fallback — the caller asked for stored data.
export async function adminAnalysis(ctx) {
const { req, p, send, session, cache, res, get } = ctx;
if (p!== "/api/admin/analysis" || req.method!== "GET") return false;
requireAdmin(session);
const period = requirePeriod(ctx);
const source = ctx.url.searchParams.get("source") || "live";
assert(source === "live" || source === "snapshot", "数据来源错误（live 或 snapshot）");
if (source === "snapshot") {
const row = await get(
"SELECT * FROM analysis_snapshots WHERE period=?",
period,
);
assert(row, "暂无该周期快照，请先刷新", 404);
let stored;
try {
stored = JSON.parse(row.payload);
} catch {
assert(false, "快照数据损坏", 500);
}
send({ ...stored, source: "snapshot", computed_at: row.created_at });
return true;
}
if (cache?.enabled) {
const hit = await cache.get(CACHE_KEYS.adminAnalysis(period));
if (hit) {
res.setHeader("X-Cache", "HIT");
send(hit);
return true;
}
}
const payload = await buildAnalysis(ctx, period);
const out = { ...payload, source: "live" };
if (cache?.enabled) {
res.setHeader("X-Cache", "MISS");
await cache.set(CACHE_KEYS.adminAnalysis(period), out, CACHE_TTLS.adminAnalysis);
}
send(out);
return true;
}

// POST /api/admin/analysis/refresh (R5-4) — recompute buildAnalysis
// for the requested period (body or ?period=, default day) and
// upsert it as that period's snapshot in analysis_snapshots. Admin
// only: anonymous -> 401, non-admin -> 403 (member-insights / BI
// pattern, not the bare-403 requireAdmin of the GET above). A POST,
// so it runs in a write transaction and can audit; the GET stays
// read-only. The live cache is busted so the next live read cannot
// serve numbers older than the refresh.
export async function refreshAnalysis(ctx) {
const { req, p, send, session, run, audit, time, b } = ctx;
if (p!== "/api/admin/analysis/refresh" || req.method!== "POST") return false;
assert(session, "请先登录", 401);
assert(session?.role === "admin", "无权访问管理后台", 403);
const rawPeriod =
(b && typeof b.period === "string" && b.period) ||
ctx.url.searchParams.get("period") ||
"day";
assert(PERIODS.includes(rawPeriod), "无效统计周期");
const period = rawPeriod;
const payload = await buildAnalysis(ctx, period);
const computedAt = time();
await run(
"INSERT INTO analysis_snapshots(period,payload,created_at) VALUES(?,?,?) ON CONFLICT (period) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at",
period,
JSON.stringify(payload),
computedAt,
);
await audit(session, "刷新经营分析", `period=${period}`);
if (ctx.cache) await ctx.cache.bustAnalysis();
send({ ok: true, period, computed_at: computedAt });
return true;
}

export async function adminAlerts(ctx) {
const { req, p, send, session, all, run, audit, time} = ctx;
if (p!== "/api/admin/alerts") return false;
requireAdmin(session);
if (req.method === "GET") {
const { today, orders, resources, threshold} =
await loadAnalysisData(ctx);
const events = await all(
"SELECT * FROM events WHERE type LIKE 'alert.%' ORDER BY id DESC LIMIT 5",
);
send({
alerts: computeAlerts({ today, orders, resources, threshold}, events),
threshold,
});
return true;
}
if (req.method === "POST") {
const { b} = ctx;
if (b.resolve) {
await run(
"DELETE FROM events WHERE id=? AND type LIKE 'alert.%'",
int(b.resolve, "事件编号", 1),
);
await audit(session, "处理模拟预警", String(b.resolve));
// Resolving an event changes the alert list embedded in the cached
// analysis payload.
if (ctx.cache) await ctx.cache.bustAnalysis();
send({ ok: true});
return true;
}
// Simulated alert cases, copied verbatim from the original demo.
const cases = {
sales: [
"销量突降",
"模拟渠道销量较上一周期下降40%，建议检查库存与渠道活动。",
],
verification: [
"核销异常",
"模拟检测到一张演示票重复核销，已标记待核实。",
],
inventory: [
"库存异常",
"模拟渠道库存与本地记录不一致，请进行库存核对。",
],
data: ["数据异常", "模拟导入记录缺少场馆标识，已进入待补全队列。"],
sentiment: [
"潜在舆情风险",
"模拟收到低评分集中反馈，请联系资源方核实服务情况。",
],
};
assert(cases[b.kind], "请选择预警类型");
const [title, detail] = cases[b.kind];
await run(
"INSERT INTO events(user_id,type,detail,created_at) VALUES(?,?,?,?)",
session.id,
"alert." + b.kind,
JSON.stringify({ title, detail}),
time(),
);
await audit(session, "触发模拟预警", title);
// Triggering an event changes the alert list embedded in the cached
// analysis payload.
if (ctx.cache) await ctx.cache.bustAnalysis();
send({ ok: true});
return true;
}
return false;
}

// CSV export, same shape as the original /api/export minus the paid /
// refunded time columns Lam has no data for. Writes its own headers
// (res.writeHead + res.end, not the JSON send()) and audits the export.
export async function adminOrdersCsv(ctx) {
const { req, p, session, all, audit, res} = ctx;
if (p!== "/api/admin/orders.csv" || req.method!== "GET") return false;
requireAdmin(session);
const rows = await all(
`SELECT o.*,u.name AS user_name,r.name AS resource_name FROM orders o
JOIN users u ON u.id=o.user_id JOIN resources r ON r.id=o.resource_id
ORDER BY o.id DESC`,
);
const csv = (v) =>
`"${String(v?? "")
.replace(/"/g, '""')
.replace(/^[=+@-]/, "'$&")}"`;
const beijing = (value) =>
new Date(new Date(value).getTime() + 8 * 3600000)
.toISOString()
.slice(0, 19)
.replace("T", " ");
const content =
"\uFEFF" +
[
[
"订单编号",
"资源",
"用户",
"金额(元)",
"演出/使用日期",
"状态",
"渠道",
"下单时间(北京时间)",
"历史时间说明",
],
...rows.map((o) => [
o.code,
o.resource_name,
o.user_name,
(o.amount / 100).toFixed(2),
o.booking_date,
o.status,
o.channel,
beijing(o.created_at),
"按订单创建时间统计（无支付时间字段）",
]),
]
.map((r) => r.map(csv).join(","))
.join("\r\n");
await audit(session, "导出报表", `${rows.length}条订单`);
res.writeHead(200, {
"Content-Type": "text/csv; charset=utf-8",
"Content-Disposition": 'attachment; filename="guiyan-orders.csv"',
});
res.end(content);
return true;
}

// Demand review, trimmed from the original /api/moderate (demands only).
export async function adminReviewDemand(ctx) {
const { req, p, send, session, get, run, notify, audit} = ctx;
const m = p.match(/^\/api\/admin\/demands\/(\d+)$/);
if (!m || req.method!== "PATCH") return false;
requireAdmin(session);
const { b} = ctx;
assert(["approved", "rejected"].includes(b.status), "审核状态错误");
const id = int(Number(m[1]), "编号", 1);
const r = await get("SELECT * FROM demands WHERE id=?", id);
assert(r, "需求不存在", 404);
await run("UPDATE demands SET status=? WHERE id=?", b.status, id);
// Reviewing a demand changes the demand counts in cached admin stats.
if (ctx.cache) await ctx.cache.bustStats();
await notify(
r.user_id,
"内容审核结果",
`${r.title}：${b.status === "approved"? "审核通过": "未通过审核"}`,
);
await audit(session, "内容审核", `demand ${id} ${b.status}`);
send({ ok: true, status: b.status});
return true;
}

export async function adminAuditLogs(ctx) {
const { req, p, send, session, all} = ctx;
if (p!== "/api/admin/audit-logs" || req.method!== "GET") return false;
requireAdmin(session);
send({
logs: await all(
"SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 60",
),
});
return true;
}
