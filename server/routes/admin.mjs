import { assert, safeUser } from "../lib/http.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";
import { profileRows } from "../lib/profiles.mjs";

// The five cumulative totals — the ONE query text behind both
// GET /api/admin/stats and the BI KPIs (routes/bi.mjs). Shared so
// the two endpoints can never drift apart; the BI test asserts
// equality. (R5-3.)
export async function adminStatsTotals(get) {
  return get(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status IN ('paid','completed')) AS revenue_cents,
      (SELECT COUNT(*) FROM resources) AS resources,
      (SELECT COUNT(*) FROM demands) AS demands`);
}

export async function adminStats(ctx) {
  const { req, p, send, session, get, all, url, cache, res } = ctx;
  if (p !== "/api/admin/stats" || req.method !== "GET") return false;
  // With ?period= the time-series handler in admin-insights.mjs answers
  // (registered after the admin routes); without it, the cumulative
  // totals below stay the response, as before.
  if (url.searchParams.has("period")) return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
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
  assert(session?.role === "admin", "无权访问管理后台", 403);
  const orders = await all(
    `SELECT o.*,u.name AS user_name,r.name AS resource_name FROM orders o
     JOIN users u ON u.id=o.user_id JOIN resources r ON r.id=o.resource_id
     ORDER BY o.id DESC LIMIT 200`,
  );
  send({ orders });
  return true;
}

export async function adminUsers(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/users" || req.method !== "GET") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
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

export async function adminDemands(ctx) {
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/demands" || req.method !== "GET") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
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
