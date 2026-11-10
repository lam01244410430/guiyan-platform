import { assert, resourceRow } from "../lib/http.mjs";

export async function listResources(ctx) {
  const { p, req, url, send, categories, all, resourceSelect } = ctx;
  if (p === "/api/resources" && req.method === "GET") {
    const category = url.searchParams.get("category");
    const city = url.searchParams.get("city");
    const q = url.searchParams.get("q");
    const sort = url.searchParams.get("sort") || "hot";
    assert(
      ["hot", "price_asc", "price_desc", "newest"].includes(sort),
      "无效排序方式",
    );
    const where = ["r.status='published'"];
    const params = [];
    if (category && category !== "all") {
      // Accept both the category id ("show") and the Chinese name
      // ("演出剧目") — the mini-program sends the name.
      const byId = categories.some((c) => c.id === category);
      const byName = categories.find((c) => c.name === category);
      assert(byId || byName, "无效资源分类");
      const categoryId = byId ? category : byName.id;
      where.push("r.category=?");
      params.push(categoryId);
    }
    if (city && city !== "all") {
      where.push("r.city=?");
      params.push(city);
    }
    if (q) {
      where.push("(r.name ILIKE ? OR r.description ILIKE ? OR r.city ILIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const orderBy =
      sort === "price_asc"
        ? "r.price ASC"
        : sort === "price_desc"
          ? "r.price DESC"
          : sort === "newest"
            ? "r.id DESC"
            : "r.views DESC";
    const resources = (
      await all(
        `${resourceSelect} WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`,
        ...params,
      )
    ).map(resourceRow);
    send({ resources });
    return true;
  }
  return false;
}

export async function getResource(ctx) {
  const { p, req, send, get, resourceSelect } = ctx;
  let m = p.match(/^\/api\/resources\/(\d+)$/);
  if (m && req.method === "GET") {
    const r = await get(
      `${resourceSelect} WHERE r.id=? AND r.status='published'`,
      Number(m[1]),
    );
    assert(r, "资源不存在", 404);
    send({ resource: resourceRow(r) });
    return true;
  }
  return false;
}
