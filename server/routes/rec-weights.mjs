// Recommendation-weight administration (P1 G1) — the weights behind
// recommendationsFor() in lib/profiles.mjs live in the existing
// `settings` table (key `recWeights`, seeded by the postgres.mjs
// guard-key backfill + server/seed.mjs); no migration, no new table.
// GET /api/admin/rec-weights returns {recWeights}; PATCH merges the
// provided keys (validated before any write: unknown keys -> 400,
// browse/favorite/purchase int 0–100, cap int 1–200) and the new
// weights take effect on the next recommendation call — no stored
// scores, no migration of old data.
import { assert } from "../lib/http.mjs";
import { isAdminRole } from "../lib/roles.mjs";
import {
  loadRecWeights,
  validateRecWeights,
} from "../lib/profiles.mjs";

export async function adminRecWeights(ctx) {
  const { req, p, b, send, session, run, audit } = ctx;
  if (p !== "/api/admin/rec-weights") return false;
  assert(isAdminRole(session?.role), "无权访问管理后台", 403);
  if (req.method === "GET") {
    send({ recWeights: await loadRecWeights(ctx) });
    return true;
  }
  if (req.method === "PATCH") {
    // Validate everything BEFORE any write (OTP lesson).
    const updates = validateRecWeights(b);
    const recWeights = { ...(await loadRecWeights(ctx)), ...updates };
    await run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT (key) DO UPDATE SET value=?",
      "recWeights",
      JSON.stringify(recWeights),
      JSON.stringify(recWeights),
    );
    await audit(session, "更新推荐权重", JSON.stringify(recWeights));
    send({ ok: true, recWeights });
    return true;
  }
  return false;
}
