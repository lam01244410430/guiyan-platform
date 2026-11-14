// User portrait + recommendations (Wave 3 #11b). Portrait data comes from
// the shared profileRows() in lib/profiles.mjs; recommendations from
// recommendationsFor(). Portrait shape (2026-11-12 甲方 update): 5 nested
// groups basic/spending/showPref/behavior/channel — no flat fields, no
// endpoint change. No admin profile API in this wave (Q10): an admin
// reads the internal profiles inside GET /api/admin/analysis instead.
import { assert, resourceRow } from "../lib/http.mjs";
import { profileRows, recommendationsFor } from "../lib/profiles.mjs";

export async function getProfile(ctx) {
  const { p, req, send, session } = ctx;
  if (p !== "/api/profile" || req.method !== "GET") return false;
  ctx.needUser();
  const row = (await profileRows(ctx)).find((r) => r.id === session.id);
  assert(row, "用户不存在", 404);
  send({ profile: row });
  return true;
}

export async function getRecommendations(ctx) {
  const { p, req, send, session, all, url, get } = ctx;
  if (p !== "/api/recommendations" || req.method !== "GET") return false;
  ctx.needUser();
  const id = Number(url.searchParams.get("userId") || session.id);
  assert(Number.isSafeInteger(id) && id >= 1, "用户编号错误");
  if (id !== session.id)
    assert(session.role === "admin", "无权查看他人推荐", 403);
  const target = await get("SELECT * FROM users WHERE id=?", id);
  assert(target, "用户不存在", 404);
  const limitRaw = Number(url.searchParams.get("limit") || 10);
  const limit = Number.isSafeInteger(limitRaw)
    ? Math.min(20, Math.max(1, limitRaw))
    : 10;
  // R7-6 context params (rules only, see profiles.mjs):
  // time_of_day (morning/afternoon/evening/night), city (any
  // non-empty string), companion (alone/couple/family/friends).
  // Unknown enum values -> 400; absent params -> the old behaviour.
  const TIME_OF_DAY = ["morning", "afternoon", "evening", "night"];
  const COMPANIONS = ["alone", "couple", "family", "friends"];
  const timeOfDay = url.searchParams.get("time_of_day") || undefined;
  const city = (url.searchParams.get("city") || "").trim() || undefined;
  const companion = url.searchParams.get("companion") || undefined;
  assert(!timeOfDay || TIME_OF_DAY.includes(timeOfDay), "时段参数错误", 400);
  assert(
    !companion || COMPANIONS.includes(companion),
    "同行人参数错误",
    400,
  );
  assert(!city || city.length <= 20, "城市参数过长", 400);
  const contextOpts = { time_of_day: timeOfDay, city, companion };
  const hasContext = Boolean(timeOfDay || city || companion);
  const resources = (
    await all("SELECT * FROM resources WHERE status='published'")
  ).map(resourceRow);
  const recs = await recommendationsFor(target, resources, ctx, contextOpts);
  // Echo the applied context only when the caller passed one, so the
  // no-context response shape is unchanged.
  send({
    recommendations: recs.slice(0, limit),
    ...(hasContext
      ? {
          context: {
            time_of_day: timeOfDay || null,
            city: city || null,
            companion: companion || null,
          },
        }
      : {}),
  });
  return true;
}
