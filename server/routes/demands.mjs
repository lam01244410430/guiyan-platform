import { assert, text, int } from "../lib/http.mjs";
import { resourceRow } from "../lib/http.mjs";
import { attachVenues } from "./resources.mjs";

export async function listDemands(ctx) {
  const { p, req, send, all, session } = ctx;
  if (p === "/api/demands" && req.method === "GET") {
    const demands = await all(
      `SELECT d.*,u.name AS user_name FROM demands d JOIN users u ON u.id=d.user_id
           ${session ? "WHERE d.status='approved' OR d.user_id=?" : "WHERE d.status='approved'"}
           ORDER BY d.id DESC`,
      ...(session ? [session.id] : []),
    );
    send({ demands });
    return true;
  }
  return false;
}

// R6-4 — rule-based auto-match (no model): same category + same city +
// unit price <= budget, rating desc then price asc. Login required
// (anonymous -> 401); pending/approved demands match, rejected
// demands -> 400 with a reason. Read-only: runs in the request
// REPEATABLE READ READ ONLY transaction like every GET. Every match
// carries its reasons (same city / same category / within budget) for
// the demand-detail UI.
export async function getDemandMatches(ctx) {
  const { p, req, send, get, all, needUser, resourceSelect } = ctx;
  const m = p.match(/^\/api\/demands\/(\d+)\/matches$/);
  if (m && req.method === "GET") {
    needUser();
    const id = Number(m[1]);
    const d = await get("SELECT * FROM demands WHERE id=?", id);
    assert(d, "需求不存在", 404);
    assert(d.status !== "rejected", "该需求已拒绝，无法匹配资源");
    const rows = await all(
      `${resourceSelect} WHERE r.status='published' AND r.category=? AND r.city=? AND r.price<=? ORDER BY rating DESC, r.price ASC`,
      d.category,
      d.city,
      d.budget,
    );
    const matches = (
      await attachVenues(
        all,
        rows.map(resourceRow),
      )
    ).map((r) => ({
      ...r,
      reasons: ["same_city", "same_category", "within_budget"],
    }));
    send({
      demand: {
        id: d.id,
        title: d.title,
        category: d.category,
        budget: d.budget,
        city: d.city,
        status: d.status,
      },
      matches,
    });
    return true;
  }
  return false;
}

export async function createDemand(ctx) {
  const { p, req, b, send, needUser, categories, run, audit, notify, time, cache } = ctx;
  if (p === "/api/demands" && req.method === "POST") {
    const u = needUser();
    assert(u.verified, "发布需求前请先完成演示身份认证", 403);
    // Accept both the category id ("artist") and the Chinese name
    // ("艺人团队") — both clients send the name.
    const catParam = b.category;
    const catEntry =
      categories.find((c) => c.id === catParam) ||
      categories.find((c) => c.name === catParam);
    assert(catEntry, "请选择需求分类");
    const result = await run(
      "INSERT INTO demands(user_id,title,category,budget,city,description,created_at) VALUES(?,?,?,?,?,?,?)",
      u.id,
      text(b.title, "标题", 80),
      catEntry.id,
      int(b.budget, "预算"),
      text(b.city, "城市", 30),
      text(b.description, "需求说明", 2000),
      time(),
    );
    await audit(u, "发布需求", b.title);
    await notify(u.id, "需求已提交", `“${b.title}”已提交，等待审核。`);
    // A new demand changes the demand count in cached admin stats.
    if (cache) await cache.bustStats();
    send({ ok: true, id: Number(result.lastInsertRowid) });
    return true;
  }
  return false;
}
