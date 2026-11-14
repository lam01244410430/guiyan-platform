// Alert rules + auto alerts + finance ledger + per-resource stats
// (Roadmap 82 Wave R5-5, 2026-11-14) — xlsx rows 62, 21, 76.
//
// alert_rules: id, shop_id (REFERENCES shops, NULL = platform-level),
// kind (sales_drop / scan_abuse / low_stock), config (TEXT JSON),
// status (active / disabled, default active), created_at. Config
// shapes are FIXED (see docs/10-she-ji-wen-dang/03-xiang-mu-jie-duan.md
// §"Lộ trình 82 module — Sóng R5" R5-5):
//   sales_drop {drop_pct, window_days}   defaults 50 / 7
//   scan_abuse {fail_count, window_minutes} defaults 10 / 60
//   low_stock  {stock_lt}                default 10
// Missing config keys are filled with the defaults on create; an
// unknown key is a 400. Rules CRUD: GET/POST/PATCH
// /api/admin/alert-rules (admin, shop-scoped — a shop-scoped admin
// naming another shop -> 403); creates audit "新增预警规则", edits
// audit "修改预警规则".
//
// Auto alerts (fixed): GET /api/admin/alerts returns the existing
// manual alerts (events `alert.*`) PLUS live-computed auto alerts
// (see computeAutoAlerts — also used by admin-insights.mjs). Each
// auto alert carries `auto: true`, `rule_kind`, and a stable id
// `auto:{kind}:{shop_id}` (`platform` when the rule is
// platform-level). Auto alerts are NOT stored — they are computed on
// read. Dismissing one means disabling its rule or fixing the
// underlying condition (there is no resolve button for auto alerts
// in the admin UI). The manual trigger/resolve endpoints stay
// untouched (back-compat — existing tests rely on them).
//   sales_drop: paid/completed revenue in the last N days vs the
//     previous N days; drop >= drop_pct -> alert. A previous window
//     of 0 with a recent window of 0 is NOT a drop (no signal);
//     previous > 0 and recent 0 is a 100% drop.
//   scan_abuse: verify_logs rows with result not_found /
//     already_used in the last `window_minutes` minutes >=
//     fail_count -> alert. A shop-scoped rule counts only failures
//     attributable to that shop (ticket -> order -> resource.shop_id);
//     a not_found failure has no ticket, so it cannot be attributed
//     to a shop and only counts for platform-level rules.
//   low_stock: resources with stock < stock_lt, lowest stock first,
//     at most 5 — ONE alert per resource (the docs bullet's "最多 5
//     条" is read as up to 5 alerts). The per-resource stable id is
//     `auto:low_stock:{shop_id}:{resource_id}` (the plain
//     `auto:{kind}:{shop_id}` form cannot tell five resources apart).
//
// finance_ledger: id, shop_id (REFERENCES shops), kind
// (order_income / refund_out / topup_in / card_refund), amount_cents
// (SIGNED: income positive, refunds negative — EXCEPT card_refund,
// which is POSITIVE, the same direction as the stored_value_ledger
// `refund` row it mirrors: money coming BACK onto the card),
// order_id (REFERENCES orders, NULL for top-ups), note (TEXT, ''), reconciled
// (INTEGER 0/1), created_at. Written in the SAME transaction as the
// money movement (see addFinanceLedger, called from routes/orders.mjs
// pay / approveRefund / auto partial refund, and from
// routes/stored-value.mjs topup / grant):
//   pay           -> order_income  (+amount)
//   approveRefund -> refund_out    (-refunded amount) + card_refund
//                    (+card-returned share, only when > 0)
//   auto partial refund (refund action, unprinted tickets) -> the
//     same two rows as approveRefund
//   topup / grant -> topup_in (+amount, +bonus as separate rows;
//     note `svl:{stored_value_ledger id}` so the backfill in
//     postgres.mjs can dedupe on re-run)
// Backfill (postgres.mjs, guard pattern): paid/completed orders get
// order_income, refunded orders get refund_out (-amount),
// stored-value topup/bonus rows get topup_in; dedupe by
// (order_id, kind) for orders and by note `svl:{id}` for top-ups, so
// re-runs never double-book.
// Ledger-vs-orders invariant (fixed): SUM(order_income) +
// SUM(refund_out) = SUM(amount) over paid/completed orders — the
// refund_out rows are negative, so income plus refunds nets to the
// orders still standing. (A partially-refunded order stays `paid`
// with its full amount in that SUM while its partial refund_out row
// already nets against income — the invariant is asserted in the
// test over full-refund orders only; partial refunds are covered by
// the refund_out rows themselves.)
//
// GET /api/admin/finance-ledger (admin, shop-scoped, ?kind=
// &reconciled=, paged, ?format=csv BOM CSV export — the export audits
// "导出财务账本", so /api/admin/finance-ledger?format=csv needs a
// write transaction, see server/index.mjs csvExportPath) +
// POST /api/admin/finance-ledger/:id/reconcile (admin; sets
// reconciled=1; audited "财务对账").
//
// GET /api/admin/resources/:id/stats (admin, shop-scoped): {views
// (the resources.views counter), event_views (events `view` rows
// for this resource — the audit trail, never conflated with the
// counter), clicks (events `click` rows with detail
// `resource:{id}`), orders (orders placed, excluding cancelled),
// revenue_cents (SUM(amount) over paid/completed), tickets_sold
// (tickets issued/used for this resource's orders), verify_count
// (verify_logs rows with result `used` for this resource's tickets)}.
import { assert, int, text } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";

const PAID_SQL = "('paid','completed')";
const LEDGER_KINDS = ["order_income", "refund_out", "topup_in", "card_refund"];
const KIND_LABELS = {
  order_income: "订单收入",
  refund_out: "退款支出",
  topup_in: "储值充值",
  card_refund: "退回文惠卡",
};
const RULE_KINDS = {
  sales_drop: {
    label: "销量下滑",
    keys: ["drop_pct", "window_days"],
    defaults: { drop_pct: 50, window_days: 7 },
    ranges: { drop_pct: [1, 100], window_days: [1, 90] },
  },
  scan_abuse: {
    label: "核销异常",
    keys: ["fail_count", "window_minutes"],
    defaults: { fail_count: 10, window_minutes: 60 },
    ranges: { fail_count: [1, 1000], window_minutes: [1, 1440] },
  },
  low_stock: {
    label: "库存不足",
    keys: ["stock_lt"],
    defaults: { stock_lt: 10 },
    ranges: { stock_lt: [0, 100000] },
  },
};

function assertAdminSession(session) {
  assert(session, "请先登录", 401);
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping (member-insights / stored-value pattern): a
// shop-scoped admin (session.shop_id set) is forced to their own
// shop whatever ?shop= / body shop_id says; the platform admin
// (shop_id NULL) picks a shop with ?shop= / body shop_id.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

// Resolve the shop a list/read request covers. `url` may carry
// ?shop=. Returns {shopId} where shopId is a number, or null for
// "all shops" (platform admin with no ?shop=). A shop-scoped admin
// naming another shop -> 403.
function resolveListShop(session, url) {
  const scope = scopedShopId(session);
  const raw = url.searchParams.get("shop");
  if (raw !== null && raw !== "") {
    const shopId = int(Number(raw), "店铺", 1);
    assert(scope === null || shopId === scope, "无权管理该店铺的数据", 403);
    return { shopId };
  }
  return { shopId: scope };
}

// Resolve the shop a CREATE covers from the request body
// (shop_id null/undefined = platform-level for the platform admin,
// forced to the admin's own shop for a shop-scoped admin).
// Returns null for a platform-level rule, else the shop id.
function resolveCreateShop(session, bodyShopId) {
  const scope = scopedShopId(session);
  if (bodyShopId === undefined || bodyShopId === null || bodyShopId === "") {
    return scope; // platform admin -> null (platform-level); shop admin -> own shop
  }
  const shopId = int(Number(bodyShopId), "店铺", 1);
  assert(scope === null || shopId === scope, "无权管理该店铺的数据", 403);
  return shopId;
}

function parsePage(url) {
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isSafeInteger(rawLimit)
    ? Math.min(200, Math.max(1, rawLimit))
    : 50;
  const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

// Validate + normalise a rule config: unknown keys -> 400, values
// must be integers in their fixed ranges, missing keys filled with
// the kind defaults. Returns the normalised config object.
function normaliseConfig(kind, raw) {
  const spec = RULE_KINDS[kind];
  const config = raw === undefined || raw === null ? {} : raw;
  assert(
    config && typeof config === "object" && !Array.isArray(config),
    "规则配置须为对象",
    400,
  );
  for (const key of Object.keys(config))
    assert(spec.keys.includes(key), `未知配置项：${key}`, 400);
  const out = { ...spec.defaults };
  for (const key of spec.keys) {
    if (config[key] === undefined || config[key] === null) continue;
    const [lo, hi] = spec.ranges[key];
    out[key] = int(config[key], `配置 ${key}`, lo, hi);
  }
  return out;
}

function ruleRow(r) {
  if (!r) return null;
  let config = {};
  try {
    config = JSON.parse(r.config || "{}") || {};
  } catch {
    config = {};
  }
  return {
    id: r.id,
    shop_id: r.shop_id,
    kind: r.kind,
    kind_label: RULE_KINDS[r.kind]?.label || r.kind,
    config,
    status: r.status,
    created_at: r.created_at,
  };
}

function ledgerRow(l) {
  if (!l) return null;
  return {
    id: l.id,
    shop_id: l.shop_id,
    kind: l.kind,
    kind_label: KIND_LABELS[l.kind] || l.kind,
    amount_cents: l.amount_cents,
    order_id: l.order_id,
    order_code: l.order_code ?? null,
    note: l.note ?? "",
    reconciled: Number(l.reconciled || 0),
    created_at: l.created_at,
  };
}

// One finance_ledger row, inside the caller's transaction. Called
// from the pay / approveRefund / topup / grant transactions — never
// on its own. `note` defaults to ''.
export async function addFinanceLedger(
  run,
  { shopId, kind, amountCents, orderId = null, note = "", now },
) {
  assert(LEDGER_KINDS.includes(kind), `未知账本类型：${kind}`, 400);
  return run(
    "INSERT INTO finance_ledger(shop_id,kind,amount_cents,order_id,note,created_at) VALUES(?,?,?,?,?,?)",
    shopId ?? MAIN_SHOP_ID,
    kind,
    amountCents,
    orderId,
    note || "",
    now,
  );
}

// --- Auto alerts (computed on read, never stored) -----------------
// `rules` are the ACTIVE alert_rules rows (already shop-filtered by
// the caller); `scope` is the requesting admin's shop (null =
// platform admin, sees every rule). Returns the auto alert objects
// to merge into the GET /api/admin/alerts response.
export async function computeAutoAlerts(ctx, rules) {
  const { all } = ctx;
  const alerts = [];
  for (const rule of rules) {
    const spec = RULE_KINDS[rule.kind];
    if (!spec) continue;
    let config = {};
    try {
      config = JSON.parse(rule.config || "{}") || {};
    } catch {
      config = {};
    }
    const shopPart = rule.shop_id ?? "platform";
    const shopFilter =
      rule.shop_id === null || rule.shop_id === undefined
        ? ""
        : " AND r.shop_id=?";
    const shopParams =
      rule.shop_id === null || rule.shop_id === undefined
        ? []
        : [rule.shop_id];
    if (rule.kind === "sales_drop") {
      const { drop_pct, window_days } = { ...spec.defaults, ...config };
      const now = new Date();
      const recentStart = new Date(
        now.getTime() - window_days * 86400000,
      ).toISOString();
      const prevStart = new Date(
        now.getTime() - 2 * window_days * 86400000,
      ).toISOString();
      const row = await all(
        `SELECT COALESCE(SUM(CASE WHEN o.created_at >= ? THEN o.amount ELSE 0 END),0) AS recent,
                COALESCE(SUM(CASE WHEN o.created_at >= ? AND o.created_at < ? THEN o.amount ELSE 0 END),0) AS prev
         FROM orders o JOIN resources r ON r.id=o.resource_id
         WHERE o.status IN ${PAID_SQL}${shopFilter}`,
        recentStart,
        prevStart,
        recentStart,
        ...shopParams,
      );
      const recent = Number(row?.[0]?.recent || 0);
      const prev = Number(row?.[0]?.prev || 0);
      if (prev > 0 && recent < prev) {
        const drop = Math.round(((prev - recent) / prev) * 1000) / 10;
        if (drop >= drop_pct)
          alerts.push({
            id: `auto:sales_drop:${shopPart}`,
            auto: true,
            rule_kind: "sales_drop",
            rule_id: rule.id,
            shop_id: rule.shop_id,
            severity: "warning",
            title: `销量下滑${drop}%（近${window_days}天）`,
            detail: `近${window_days}天收入¥${(recent / 100).toFixed(2)}，前${window_days}天¥${(prev / 100).toFixed(2)}，跌幅${drop}% ≥ 阈值${drop_pct}%。请检查库存与渠道活动。`,
          });
      }
    } else if (rule.kind === "scan_abuse") {
      const { fail_count, window_minutes } = { ...spec.defaults, ...config };
      const since = new Date(
        Date.now() - window_minutes * 60000,
      ).toISOString();
      // Shop-scoped rules count only failures attributable to that
      // shop (ticket -> order -> resource.shop_id); a not_found
      // failure has no ticket, so it only counts for platform rules.
      const row = await all(
        `SELECT COUNT(*) AS n FROM verify_logs v
         LEFT JOIN tickets t ON t.id=v.ticket_id
         LEFT JOIN orders o ON o.id=t.order_id
         LEFT JOIN resources r ON r.id=o.resource_id
         WHERE v.result IN ('not_found','already_used') AND v.created_at >= ?
         ${rule.shop_id === null || rule.shop_id === undefined ? "" : "AND r.shop_id=?"}`,
        since,
        ...shopParams,
      );
      const count = Number(row?.[0]?.n || 0);
      if (count >= fail_count)
        alerts.push({
          id: `auto:scan_abuse:${shopPart}`,
          auto: true,
          rule_kind: "scan_abuse",
          rule_id: rule.id,
          shop_id: rule.shop_id,
          severity: "warning",
          title: `核销失败激增（近${window_minutes}分钟${count}次）`,
          detail: `近${window_minutes}分钟核销失败${count}次 ≥ 阈值${fail_count}次，请核查扫码设备与票码。`,
        });
    } else if (rule.kind === "low_stock") {
      const { stock_lt } = { ...spec.defaults, ...config };
      const rows = await all(
        `SELECT * FROM resources WHERE status='published' AND stock < ?
         ${rule.shop_id === null || rule.shop_id === undefined ? "" : "AND shop_id=?"}
         ORDER BY stock ASC, id ASC LIMIT 5`,
        stock_lt,
        ...shopParams,
      );
      for (const r of rows)
        alerts.push({
          id: `auto:low_stock:${shopPart}:${r.id}`,
          auto: true,
          rule_kind: "low_stock",
          rule_id: rule.id,
          shop_id: rule.shop_id,
          severity: "warning",
          title: `${r.name}库存仅剩${r.stock}`,
          detail: `库存低于阈值${stock_lt}，建议补充库存或暂时下架，避免超卖。`,
        });
    }
  }
  return alerts;
}

// Rules visible to this admin: a shop-scoped admin sees their own
// shop's rules + platform-level rules; the platform admin sees all.
// Only ACTIVE rules feed computeAutoAlerts (a disabled rule stops
// its auto alerts — that is how an auto alert is dismissed).
export async function activeAlertRules(ctx, session) {
  const { all } = ctx;
  const scope = scopedShopId(session);
  if (scope === null)
    return all(
      "SELECT * FROM alert_rules WHERE status='active' ORDER BY id ASC",
    );
  return all(
    "SELECT * FROM alert_rules WHERE status='active' AND (shop_id=? OR shop_id IS NULL) ORDER BY id ASC",
    scope,
  );
}

export async function listAlertRules(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/alert-rules" || req.method !== "GET") return false;
  assertAdminSession(session);
  const { shopId } = resolveListShop(session, ctx.url);
  let rows;
  if (shopId === null) rows = await all("SELECT * FROM alert_rules ORDER BY id ASC");
  else
    rows = await all(
      "SELECT * FROM alert_rules WHERE shop_id=? OR shop_id IS NULL ORDER BY id ASC",
      shopId,
    );
  send({ rules: rows.map(ruleRow) });
  return true;
}

export async function createAlertRule(ctx) {
  const { req, p, send, session, get, run, audit, time, b } = ctx;
  if (p !== "/api/admin/alert-rules" || req.method !== "POST") return false;
  assertAdminSession(session);
  const kind = text(b.kind || "", "规则类型", 30);
  assert(RULE_KINDS[kind], "规则类型错误（sales_drop / scan_abuse / low_stock）", 400);
  const shopId = resolveCreateShop(session, b.shop_id);
  if (shopId !== null) {
    const shop = await get("SELECT * FROM shops WHERE id=?", shopId);
    assert(shop, "店铺不存在", 404);
  }
  const config = normaliseConfig(kind, b.config);
  const result = await run(
    "INSERT INTO alert_rules(shop_id,kind,config,status,created_at) VALUES(?,?,?,?,?)",
    shopId,
    kind,
    JSON.stringify(config),
    "active",
    time(),
  );
  const created = await get(
    "SELECT * FROM alert_rules WHERE id=?",
    Number(result.lastInsertRowid),
  );
  await audit(
    session,
    "新增预警规则",
    `${RULE_KINDS[kind].label}（${shopId === null ? "平台级" : `${shopId}号店`}）`,
  );
  send({ ok: true, rule: ruleRow(created) });
  return true;
}

export async function patchAlertRule(ctx) {
  const { req, p, send, session, get, run, audit, b } = ctx;
  const m = p.match(/^\/api\/admin\/alert-rules(?:\/(\d+))?$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdminSession(session);
  const id = int(
    Number(m[1] ?? b.id),
    "规则编号",
    1,
  );
  const rule = await get("SELECT * FROM alert_rules WHERE id=?", id);
  assert(rule, "预警规则不存在", 404);
  const scope = scopedShopId(session);
  assert(
    scope === null || rule.shop_id === scope,
    "无权管理该店铺的预警规则",
    403,
  );
  assert(
    b.shop_id === undefined ||
      b.shop_id === null ||
      Number(b.shop_id) === rule.shop_id,
    "预警规则的店铺不可修改",
    400,
  );
  assert(
    b.kind === undefined || b.kind === rule.kind,
    "预警规则的类型不可修改",
    400,
  );
  const updates = {};
  if (b.config !== undefined)
    updates.config = JSON.stringify(normaliseConfig(rule.kind, b.config));
  if (b.status !== undefined) {
    assert(
      ["active", "disabled"].includes(b.status),
      "规则状态错误（active / disabled）",
      400,
    );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "没有可修改的字段", 400);
  const sets = Object.keys(updates)
    .map((k) => `${k}=?`)
    .join(", ");
  await run(
    `UPDATE alert_rules SET ${sets} WHERE id=?`,
    ...Object.values(updates),
    id,
  );
  const fresh = await get("SELECT * FROM alert_rules WHERE id=?", id);
  await audit(
    session,
    "修改预警规则",
    `${RULE_KINDS[rule.kind]?.label || rule.kind} #${id}（${fresh.status}）`,
  );
  send({ ok: true, rule: ruleRow(fresh) });
  return true;
}

// --- Finance ledger ------------------------------------------------
export async function listFinanceLedger(ctx) {
  const { req, p, send, session, all, get, audit, res } = ctx;
  if (p !== "/api/admin/finance-ledger" || req.method !== "GET") return false;
  assertAdminSession(session);
  const { shopId } = resolveListShop(session, ctx.url);
  const kind = ctx.url.searchParams.get("kind") || "";
  if (kind) assert(LEDGER_KINDS.includes(kind), "账本类型错误", 400);
  const reconciledRaw = ctx.url.searchParams.get("reconciled");
  let reconciled = null;
  if (reconciledRaw !== null && reconciledRaw !== "") {
    reconciled = int(Number(reconciledRaw), "对账状态", 0, 1);
  }
  const format = ctx.url.searchParams.get("format") || "";
  assert(format === "" || format === "csv", "导出格式错误（csv）", 400);
  const where = [];
  const params = [];
  if (shopId !== null) {
    where.push("f.shop_id=?");
    params.push(shopId);
  }
  if (kind) {
    where.push("f.kind=?");
    params.push(kind);
  }
  if (reconciled !== null) {
    where.push("f.reconciled=?");
    params.push(reconciled);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  if (format === "csv") {
    const rows = await all(
      `SELECT f.*, o.code AS order_code FROM finance_ledger f
       LEFT JOIN orders o ON o.id=f.order_id ${whereSql}
       ORDER BY f.id DESC LIMIT 1000`,
      ...params,
    );
    const csv = (v) =>
      `"${String(v ?? "")
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
        ["流水号", "时间", "类型", "金额(元)", "订单号", "备注", "已对账"],
        ...rows.map((l) => [
          l.id,
          beijing(l.created_at),
          KIND_LABELS[l.kind] || l.kind,
          (l.amount_cents / 100).toFixed(2),
          l.order_code || "",
          l.note || "",
          Number(l.reconciled || 0) ? "是" : "否",
        ]),
      ]
        .map((r) => r.map(csv).join(","))
        .join("\r\n");
    await audit(session, "导出财务账本", `${rows.length}条记录`);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="guiyan-finance-ledger.csv"',
    });
    res.end(content);
    return true;
  }
  const { limit, offset } = parsePage(ctx.url);
  const rows = await all(
    `SELECT f.*, o.code AS order_code FROM finance_ledger f
     LEFT JOIN orders o ON o.id=f.order_id ${whereSql}
     ORDER BY f.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const totalRow = await get(
    `SELECT COUNT(*) AS n FROM finance_ledger f ${whereSql}`,
    ...params,
  );
  send({
    ledger: rows.map(ledgerRow),
    total: Number(totalRow?.n || 0),
    limit,
    offset,
  });
  return true;
}

export async function reconcileFinanceLedger(ctx) {
  const { req, p, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/finance-ledger\/(\d+)\/reconcile$/);
  if (!m || req.method !== "POST") return false;
  assertAdminSession(session);
  const id = int(Number(m[1]), "账本编号", 1);
  const row = await get("SELECT * FROM finance_ledger WHERE id=?", id);
  assert(row, "账本记录不存在", 404);
  const scope = scopedShopId(session);
  assert(scope === null || row.shop_id === scope, "无权对账该店铺的账本", 403);
  await run("UPDATE finance_ledger SET reconciled=1 WHERE id=?", id);
  const fresh = await get("SELECT * FROM finance_ledger WHERE id=?", id);
  await audit(session, "财务对账", `ledger ${id}`);
  send({ ok: true, ledger: ledgerRow(fresh) });
  return true;
}

// --- Per-resource stats --------------------------------------------
export async function getResourceStats(ctx) {
  const { req, p, send, session, get, all } = ctx;
  const m = p.match(/^\/api\/admin\/resources\/(\d+)\/stats$/);
  if (!m || req.method !== "GET") return false;
  assertAdminSession(session);
  const id = int(Number(m[1]), "资源编号", 1);
  const resource = await get("SELECT * FROM resources WHERE id=?", id);
  assert(resource, "资源不存在", 404);
  const scope = scopedShopId(session);
  assert(
    scope === null || resource.shop_id === scope,
    "无权查看该店铺的资源统计",
    403,
  );
  const viewRow = await get(
    "SELECT COUNT(*) AS n FROM events WHERE type='view' AND detail=?",
    String(id),
  );
  const clickRow = await get(
    "SELECT COUNT(*) AS n FROM events WHERE type='click' AND detail=?",
    `resource:${id}`,
  );
  const orderRow = await get(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ${PAID_SQL} THEN amount ELSE 0 END),0) AS revenue_cents
     FROM orders WHERE resource_id=? AND status NOT IN ('cancelled')`,
    id,
  );
  const ticketRow = await get(
    `SELECT COUNT(*) AS n FROM tickets t JOIN orders o ON o.id=t.order_id
     WHERE o.resource_id=? AND t.status IN ('issued','used')`,
    id,
  );
  const verifyRow = await get(
    `SELECT COUNT(*) AS n FROM verify_logs v JOIN tickets t ON t.id=v.ticket_id
     JOIN orders o ON o.id=t.order_id
     WHERE o.resource_id=? AND v.result='used'`,
    id,
  );
  send({
    resource_id: id,
    views: Number(resource.views || 0),
    event_views: Number(viewRow?.n || 0),
    clicks: Number(clickRow?.n || 0),
    orders: Number(orderRow?.orders || 0),
    revenue_cents: Number(orderRow?.revenue_cents || 0),
    tickets_sold: Number(ticketRow?.n || 0),
    verify_count: Number(verifyRow?.n || 0),
  });
  return true;
}
