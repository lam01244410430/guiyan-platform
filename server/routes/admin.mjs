import { assert, safeUser } from "../lib/http.mjs";
import { isAdminRole } from "../lib/roles.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";
import { profileRows } from "../lib/profiles.mjs";

// The five cumulative totals — the ONE query text behind both
// GET /api/admin/stats and the BI KPIs (routes/bi.mjs). Shared so
// the two endpoints can never drift apart; the BI test asserts
// equality. (R5-3.)
// Admin overview (2026-11-16): two more fields for the KPI cards —
// published_resources (resources with status 'published') and
// active_users_30d (non-admin users with >=1 order in the last 30
// Beijing days, same window/definition as the analysis `active` set
// in admin-insights.mjs: Beijing today minus 29 days, any status).
export async function adminStatsTotals(get) {
  return get(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status IN ('paid','completed')) AS revenue_cents,
      (SELECT COUNT(*) FROM resources) AS resources,
      (SELECT COUNT(*) FROM demands) AS demands,
      (SELECT COUNT(*) FROM resources WHERE status = 'published') AS published_resources,
      (SELECT COUNT(DISTINCT user_id) FROM orders
         WHERE DATE(created_at::timestamptz AT TIME ZONE 'Asia/Shanghai') >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - 29)
           AND user_id IN (SELECT id FROM users WHERE role <> 'admin')) AS active_users_30d`);
}

export async function adminStats(ctx) {
  const { req, p, send, session, get, all, url, cache, res } = ctx;
  if (p !== "/api/admin/stats" || req.method !== "GET") return false;
  // With ?period= the time-series handler in admin-insights.mjs answers
  // (registered after the admin routes); without it, the cumulative
  // totals below stay the response, as before.
  if (url.searchParams.has("period")) return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  if (cache?.enabled) {
    const hit = await cache.get(CACHE_KEYS.adminStatsTotal);
    if (hit) {
      res.setHeader("X-Cache", "HIT");
      send(hit);
      return true;
    }
  }
  const stats = await adminStatsTotals(get);
  const statuses = await all(
    "SELECT status,COUNT(*) AS count FROM orders GROUP BY status ORDER BY status",
  );
  const payload = {
    ...stats,
    orders_by_status: Object.fromEntries(statuses.map((s) => [s.status, s.count])),
  };
  if (cache?.enabled) {
    res.setHeader("X-Cache", "MISS");
    await cache.set(
      CACHE_KEYS.adminStatsTotal,
      payload,
      CACHE_TTLS.adminStats,
    );
  }
  send(payload);
  return true;
}

export async function adminOrders(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/orders" || req.method !== "GET") return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  const orders = await all(
    `SELECT o.*,u.name AS user_name,r.name AS resource_name,r.shop_id AS shop_id FROM orders o
     JOIN users u ON u.id=o.user_id JOIN resources r ON r.id=o.resource_id
     ORDER BY o.id DESC LIMIT 200`,
  );
  send({ orders });
  return true;
}

export async function adminUsers(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/users" || req.method !== "GET") return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  // Wave 3 #9: tags are computed at read time from the shared rule
  // engine (same tags as the analysis userSummary), never stored — so a
  // rule change is reflected immediately, with no migration.
  const byId = new Map(
    (await profileRows(ctx)).map((r) => [r.id, r.tags]),
  );
  let users = (await all("SELECT * FROM users ORDER BY id DESC")).map(
    (u) => ({ ...safeUser(u), tags: byId.get(u.id) || [] }),
  );
  const tag = url.searchParams.get("tag");
  if (tag) users = users.filter((u) => u.tags.includes(tag));
  send({ users });
  return true;
}

// P1 G2 — export the grouped user list as CSV: the same rows the 全部用户
// table shows after its current filters (tag filter + search box), not
// the whole user table. Same CSV shape as adminOrdersCsv (UTF-8 BOM,
// quoted cells, formula-injection guard) and the same audit entry.
// Filename carries the Beijing date. Admin-only.
export async function adminUsersCsv(ctx) {
  const { req, p, session, all, url, audit, res } = ctx;
  if (p !== "/api/admin/users.csv" || req.method !== "GET") return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  const byId = new Map(
    (await profileRows(ctx)).map((r) => [r.id, r.tags]),
  );
  let users = (await all("SELECT * FROM users ORDER BY id DESC")).map(
    (u) => ({ ...safeUser(u), tags: byId.get(u.id) || [] }),
  );
  // Same filter as the admin users table (AdminDashboard.jsx
  // filteredUsers / userMatch): tag first, then the search box over
  // id / name / username / email / city / channel / role / verified.
  const tag = url.searchParams.get("tag");
  if (tag) users = users.filter((u) => u.tags.includes(tag));
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q) {
    const has = (v) => String(v ?? "").toLowerCase().includes(q);
    users = users.filter(
      (u) =>
        has(String(u.id)) ||
        has(u.name) ||
        has(u.username) ||
        has(u.email) ||
        has(u.city) ||
        has(u.channel) ||
        has(u.role) ||
        has(u.verified ? "已认证" : "未认证"),
    );
  }
  const csv = (v) =>
    `"${String(v ?? "")
      .replace(/"/g, '""')
      .replace(/^[=+@-]/, "'$&")}"`;
  const today = new Date(Date.now() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const content =
    "\uFEFF" +
    [
      ["ID", "姓名", "账号", "角色", "城市", "渠道", "认证", "标签", "状态"],
      ...users.map((u) => [
        u.id,
        u.name || "",
        u.username,
        u.role,
        u.city || "",
        u.channel || "",
        u.verified ? "已认证" : "未认证",
        (u.tags || []).join("、"),
        u.status === "disabled" ? "停用" : "启用",
      ]),
    ]
      .map((r) => r.map(csv).join(","))
      .join("\r\n");
  await audit(session, "导出报表", `${users.length}位用户`);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="guiyan-users-${today}.csv"`,
  });
  res.end(content);
  return true;
}

export async function adminDemands(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/demands" || req.method !== "GET") return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  // Admin sees ALL demands, including pending ones awaiting review — the
  // public /api/demands list only returns approved ones (plus the caller's
  // own), which is why the stat card count and the table disagreed before.
  const demands = await all(
    `SELECT d.*,u.name AS user_name FROM demands d JOIN users u ON u.id=d.user_id
     ORDER BY d.id DESC`,
  );
  send({ demands });
  return true;
}
