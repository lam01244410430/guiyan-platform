import { assert, text, int } from "../lib/http.mjs";

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
