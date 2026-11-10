import { assert, safeUser } from "../lib/http.mjs";

export async function adminStats(ctx) {
  const { req, p, send, session, get, all } = ctx;
  if (p !== "/api/admin/stats" || req.method !== "GET") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
  const stats = await get(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status IN ('paid','completed')) AS revenue_cents,
      (SELECT COUNT(*) FROM resources) AS resources,
      (SELECT COUNT(*) FROM demands) AS demands`);
  const statuses = await all(
    "SELECT status,COUNT(*) AS count FROM orders GROUP BY status ORDER BY status",
  );
  send({
    ...stats,
    orders_by_status: Object.fromEntries(statuses.map((s) => [s.status, s.count])),
  });
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
  const { req, p, send, session, all } = ctx;
  if (p !== "/api/admin/users" || req.method !== "GET") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
  send({ users: (await all("SELECT * FROM users ORDER BY id DESC")).map(safeUser) });
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
