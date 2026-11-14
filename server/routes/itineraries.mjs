// R7-6 — 情境推荐 + 行程 (xlsx rows 51, 55).
//
// GET /api/resources/:id/itinerary — public. Returns the hand-entered
// itinerary template for a show resource, or { itinerary: null } when
// no template was entered for it (never an invented one). A template
// is four sections: the show itself + eat + parking + sleep. Place
// names are hand-entered from publicly verifiable sources only; no
// merchant links, phone numbers or prices are stored or returned.
// This wave has no admin write API for templates (seed-only); the
// table is `itineraries` (see server/schema.mjs), seeded in
// server/postgres.mjs. A draft resource's template is not public
// (same rule as GET /api/resources/:id, which only serves published
// rows).
import { assert } from "../lib/http.mjs";

function itineraryRow(row) {
  let eat = [];
  let sleep = [];
  try {
    eat = JSON.parse(row.eat || "[]") || [];
  } catch {
    eat = [];
  }
  try {
    sleep = JSON.parse(row.sleep || "[]") || [];
  } catch {
    sleep = [];
  }
  return {
    id: row.id,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    venue_name: row.venue_name,
    venue_address: row.venue_address || "",
    eat,
    parking: row.parking || "",
    sleep,
    note: row.note || "",
    created_at: row.created_at,
  };
}

export async function getItinerary(ctx) {
  const { p, req, send, session, get } = ctx;
  const m = p.match(/^\/api\/resources\/(\d+)\/itinerary$/);
  if (m && req.method === "GET") {
    const id = Number(m[1]);
    const r = await get(
      "SELECT id, status FROM resources WHERE id=?",
      id,
    );
    assert(r, "资源不存在", 404);
    if (r.status !== "published" && session?.role !== "admin") {
      assert(false, "资源不存在", 404);
    }
    const row = await get(
      `SELECT i.*, r.name AS resource_name FROM itineraries i
         JOIN resources r ON r.id = i.resource_id
        WHERE i.resource_id=?`,
      id,
    );
    send({ itinerary: row ? itineraryRow(row) : null });
    return true;
  }
  return false;
}
