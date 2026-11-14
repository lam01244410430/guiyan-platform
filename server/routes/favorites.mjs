import { assert, int, resourceRow } from "../lib/http.mjs";
import { evaluateAutoTags } from "../lib/profiles.mjs";

export async function listFavorites(ctx) {
  const { p, req, send, needUser, all, resourceSelect } = ctx;
  if (p === "/api/favorites" && req.method === "GET") {
    const u = needUser();
    const favorites = (
      await all(
        `${resourceSelect} JOIN favorites f ON f.resource_id=r.id WHERE f.user_id=? ORDER BY r.id`,
        u.id,
      )
    ).map(resourceRow);
    send({ favorites });
    return true;
  }
  return false;
}

export async function toggleFavorite(ctx) {
  const { p, req, b, send, needUser, get, run } = ctx;
  if (p === "/api/favorites" && req.method === "POST") {
    const u = needUser(),
      rid = int(b.resourceId, "资源编号", 1);
    assert(
      await get("SELECT id FROM resources WHERE id=?", rid),
      "资源不存在",
    );
    const exists = await get(
      "SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?",
      u.id,
      rid,
    );
    if (exists)
      await run(
        "DELETE FROM favorites WHERE user_id=? AND resource_id=?",
        u.id,
        rid,
      );
    else {
      await run("INSERT INTO favorites VALUES(?,?)", u.id, rid);
      // R7-5: a new favorite is a tagging signal — evaluate now (an
      // unfavorite removes no tag; tags are never deleted by evaluation).
      await evaluateAutoTags(ctx, u.id);
    }
    send({ ok: true, favorite: !exists });
    return true;
  }
  return false;
}

export async function deleteFavorite(ctx) {
  const { p, req, send, needUser, run } = ctx;
  const m = p.match(/^\/api\/favorites\/(\d+)$/);
  if (m && req.method === "DELETE") {
    const u = needUser();
    await run(
      "DELETE FROM favorites WHERE user_id=? AND resource_id=?",
      u.id,
      Number(m[1]),
    );
    send({ ok: true });
    return true;
  }
  return false;
}
