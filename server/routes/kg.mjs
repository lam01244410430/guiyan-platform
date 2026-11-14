// R7-3 — 知识图谱 (xlsx rows 46, 47, 48).
//
// GET /api/kg/related/:id — public. Returns the graph neighbours of
// one resource (by resource id, not node id): each entry carries the
// neighbour node (id/kind/ref_id/name) + the relation + the
// direction from this node ("out" = this node -> neighbour, "in" =
// neighbour -> this node) + the `source` that documents where the
// link came from (seeded data, the R7-6 verified public address, or
// a derived shared-genre link — see docs/03 R7-3). A resource with
// no node, or a node with no edges, answers an empty list — never an
// invented link. An invalid `?kind=` value -> 400; an unknown
// resource -> 404; a draft resource's graph is not public (same rule
// as GET /api/resources/:id, which only serves published rows).
import { assert } from "../lib/http.mjs";
import { KG_KINDS, nodeForResource, relatedForNode } from "../lib/kg.mjs";

export async function getRelated(ctx) {
  const { p, req, send, session, get, url } = ctx;
  const m = p.match(/^\/api\/kg\/related\/(\d+)$/);
  if (m && req.method === "GET") {
    const id = Number(m[1]);
    const kind = url.searchParams.get("kind") || null;
    if (kind !== null && !KG_KINDS.includes(kind))
      assert(false, "kind 非法", 400);
    const r = await get("SELECT id, status FROM resources WHERE id=?", id);
    assert(r, "资源不存在", 404);
    if (r.status !== "published" && session?.role !== "admin") {
      assert(false, "资源不存在", 404);
    }
    const node = await nodeForResource(ctx, id, kind);
    const related = node ? await relatedForNode(ctx, node.id) : [];
    send({ related });
    return true;
  }
  return false;
}
