import { assert, date, resourceRow } from "../lib/http.mjs";
import { evaluateAutoTags } from "../lib/profiles.mjs";
import { performancesForResource } from "./shows.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";

// R6-2 — talent library: the roles a talent resource can carry in
// meta.role. The list page filters by role (?role=); anything else
// is a 400, like an unknown category.
const TALENT_ROLES = ["演员", "导演", "编剧"];

// R2-4: attach the linked venue ({id, name, address} or null) to
// resource rows. One query for the whole list, never one per row;
// the venue object is what the H5/mini-program detail views render
// (they read the list merge, not a second detail fetch).
export async function attachVenues(all, rows) {
  const ids = [
    ...new Set(rows.map((r) => r.venue_id).filter((v) => v != null)),
  ];
  const byId = new Map();
  if (ids.length) {
    const found = await all(
      `SELECT id, name, address FROM venues WHERE id IN (${ids.map(() => "?").join(",")})`,
      ...ids,
    );
    for (const v of found)
      byId.set(v.id, { id: v.id, name: v.name, address: v.address });
  }
  return rows.map((r) => ({
    ...r,
    venue: r.venue_id == null ? null : byId.get(r.venue_id) || null,
  }));
}

export async function listResources(ctx) {
  const { p, req, url, send, categories, all, resourceSelect, cache, res } = ctx;
  if (p === "/api/resources" && req.method === "GET") {
    const category = url.searchParams.get("category");
    const city = url.searchParams.get("city");
    const q = url.searchParams.get("q");
    const role = url.searchParams.get("role");
    const sort = url.searchParams.get("sort") || "hot";
    // R6-4: price range (yuan, converted to cents), rating floor
    // (approved-only rating from resourceSelect) and region (alias
    // for city; the old param keeps working).
    const region = url.searchParams.get("region");
    const numParam = (value, label) => {
      if (value === null || value === "") return null;
      const n = Number(value);
      assert(Number.isFinite(n) && n >= 0, label + "必须为不小于 0 的数字");
      return n;
    };
    const minPriceYuan = numParam(url.searchParams.get("min_price"), "最低价");
    const maxPriceYuan = numParam(url.searchParams.get("max_price"), "最高价");
    const minRatingNum = numParam(url.searchParams.get("min_rating"), "最低评分");
    assert(minRatingNum === null || minRatingNum <= 5, "最低评分不能超过 5 分");
    assert(
      minPriceYuan === null ||
        maxPriceYuan === null ||
        minPriceYuan <= maxPriceYuan,
      "最低价不能高于最高价",
    );
    const cityVal = city && city !== "all" ? city : null;
    const regionVal = region && region !== "all" ? region : null;
    assert(
      !cityVal || !regionVal || cityVal === regionVal,
      "城市与地区参数不一致",
    );
    const effCity = cityVal || regionVal;
    assert(
      ["hot", "price_asc", "price_desc", "newest"].includes(sort),
      "无效排序方式",
    );
    // Cache only the unfiltered default list (sort=hot, no filters):
    // the single key guiyan:resources:list cannot encode every filter
    // combination, and filtered queries stay live Postgres reads.
    // R6-2: ?role= is a filter too — a role-filtered list must never
    // be served from the unfiltered cache key.
    const cacheable =
      !category &&
      !city &&
      !region &&
      !q &&
      !role &&
      minPriceYuan === null &&
      maxPriceYuan === null &&
      minRatingNum === null &&
      sort === "hot";
    if (cacheable && cache?.enabled) {
      const hit = await cache.get(CACHE_KEYS.resourcesList);
      if (hit) {
        res.setHeader("X-Cache", "HIT");
        send({ resources: hit });
        return true;
      }
    }
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
    if (effCity) {
      where.push("r.city=?");
      params.push(effCity);
    }
    if (minPriceYuan !== null) {
      where.push("r.price>=?");
      params.push(Math.round(minPriceYuan * 100));
    }
    if (maxPriceYuan !== null) {
      where.push("r.price<=?");
      params.push(Math.round(maxPriceYuan * 100));
    }
    if (minRatingNum !== null && minRatingNum > 0) {
      // Same approved-only rating as resourceSelect: a resource with
      // no approved review rates 0, so it never matches an active
      // rating filter (Wave 4 #14 Q8, same rule as the client).
      where.push(
        "COALESCE((SELECT AVG(rating) FROM comments c WHERE c.resource_id=r.id AND c.status='approved'),0)>=?",
      );
      params.push(minRatingNum);
    }
    if (role) {
      // R6-2 — talent library: match meta.role exactly. Resources
      // with no role simply do not match a role filter.
      assert(TALENT_ROLES.includes(role), "无效人才角色");
      where.push("r.meta::jsonb->>'role'=?");
      params.push(role);
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
    const resources = await attachVenues(
      all,
      (
        await all(
          `${resourceSelect} WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`,
          ...params,
        )
      ).map(resourceRow),
    );
    if (cacheable && cache?.enabled) {
      res.setHeader("X-Cache", "MISS");
      await cache.set(
        CACHE_KEYS.resourcesList,
        resources,
        CACHE_TTLS.resourcesList,
      );
    }
    send({ resources });
    return true;
  }
  return false;
}

export async function getResource(ctx) {
  const { p, req, send, get, all, resourceSelect } = ctx;
  let m = p.match(/^\/api\/resources\/(\d+)$/);
  if (m && req.method === "GET") {
    const r = await get(
      `${resourceSelect} WHERE r.id=? AND r.status='published'`,
      Number(m[1]),
    );
    assert(r, "资源不存在", 404);
    // R2-4: the detail carries the linked venue when set.
    const [resource] = await attachVenues(all, [resourceRow(r)]);
    send({ resource });
    return true;
  }
  return false;
}

// Wave 4 #12 — availability by date (port of zhou
// guiyan-demo/server/index.mjs GET /api/availability, re-routed to Lam's
// REST shape GET /api/resources/:id/availability). Public for published
// resources; unpublished only for admin (non-admin gets 404, same as
// GET /api/resources/:id which only serves published rows). No cache
// (Q16): a new order must be visible immediately. No schema change.
// Mode map (Q1): Lam has no daily_capacity column, so `stock` is the
// daily capacity for mode `date`; `capacity` is total capacity and is
// never used as the daily capacity.
function beijingToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function getAvailability(ctx) {
  const { p, req, send, session, get, all, url } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/availability$/);
  if (m && req.method === "GET") {
    const id = Number(m[1]);
    const r = await get(
      "SELECT id, category, stock, status FROM resources WHERE id=?",
      id,
    );
    assert(r, "资源不存在", 404);
    assert(
      r.status === "published" || session?.role === "admin",
      "资源不存在",
      404,
    );
    const raw = url.searchParams.get("date");
    const d = raw ? date(raw) : beijingToday();
    // R6-2: equipment rents per unit per day, so it reads the
    // date-mode stock (stock minus the quantity already booked that
    // day) instead of the old rental 0/1. Venue resources stay
    // rental (one whole-venue booking per day, no stock).
    const mode =
      r.category === "venue"
        ? "rental"
        : r.category === "service" || r.category === "creative"
          ? "none"
          : ["show", "heritage", "tourism", "digital", "artist", "equipment"].includes(
                r.category,
              )
            ? "date"
            : "global";
    const active = "status NOT IN ('cancelled','refunded')";
    const dates = await all(
      `SELECT booking_date, status FROM orders WHERE resource_id=? AND ${active} ORDER BY booking_date`,
      id,
    );
    let available;
    if (mode === "rental") {
      available = dates.some((o) => o.booking_date === d) ? 0 : 1;
    } else if (mode === "date") {
      const booked = await get(
        `SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE resource_id=? AND booking_date=? AND ${active}`,
        id,
        d,
      );
      available = Math.max(0, r.stock - (booked?.n || 0));
    } else if (mode === "none") {
      available = null;
    } else {
      available = r.stock;
    }
    send({ id, date: d, mode, available, capacity: r.stock, dates, performances: await performancesForResource(all, get, id) });
    return true;
  }
  return false;
}

// Real view recording (Wave 3 #11a, port of zhou
// guiyan-demo/server/index.mjs POST /api/resources/:id/view): the seeded
// `views` counter was a constant, so no real view was ever recorded.
// Anonymous views count too (user_id NULL) — viewing needs no login.
// No cache bust (Q7): the cached list may show a stale `views` for up to
// the 300 s TTL; GET /api/resources/:id reads live, so it is always right.
// No abuse limit in this wave (Q8): rate limiting is Wave 5 (#29).
export async function viewResource(ctx) {
  const { p, req, send, session, get, run, time } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/view$/);
  if (m && req.method === "POST") {
    const id = Number(m[1]);
    const r = await get(
      "SELECT id FROM resources WHERE id=? AND status='published'",
      id,
    );
    assert(r, "资源不存在", 404);
    await run("UPDATE resources SET views=views+1 WHERE id=?", id);
    await run(
      "INSERT INTO events(user_id,type,detail,created_at) VALUES(?,?,?,?)",
      session?.id || null,
      "view",
      String(id),
      time(),
    );
    // R7-5: evaluate stored auto-tags on every view write (no cron /
    // worker — the R5 policy). Anonymous views (user_id NULL) have no
    // user to tag.
    if (session?.id) await evaluateAutoTags(ctx, session.id);
    send({ ok: true });
    return true;
  }
  return false;
}
