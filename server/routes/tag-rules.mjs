// Tag-rule administration (Wave 3 #9) — the rule store is the existing
// `settings` table (key `tagRules`, seeded by guard-key INSERT on boot +
// in server/seed.mjs); no migration, no new table. Validation is the
// zhou rule check (guiyan-demo/server/index.mjs PATCH /api/settings),
// moved into lib/profiles.mjs so the API and the engine share one rule.
import { assert } from "../lib/http.mjs";
import {
  loadTagRules,
  validateTagRules,
} from "../lib/profiles.mjs";

export async function adminTagRules(ctx) {
  const { req, p, send, session, run, audit, cache } = ctx;
  if (p !== "/api/admin/tag-rules") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
  if (req.method === "GET") {
    send({ tagRules: await loadTagRules(ctx) });
    return true;
  }
  if (req.method === "PATCH") {
    const rules = validateTagRules(ctx.b?.tagRules);
    await run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT (key) DO UPDATE SET value=?",
      "tagRules",
      JSON.stringify(rules),
      JSON.stringify(rules),
    );
    // userSummary in the cached analysis payload counts tags from these
    // rules, so the cached analysis must go with the old rules.
    if (cache) await cache.bustAnalysis();
    await audit(session, "更新标签规则", `${rules.length}条规则`);
    send({ ok: true, tagRules: rules });
    return true;
  }
  return false;
}
