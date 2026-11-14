// R7-3 — 知识图谱 (xlsx rows 46, 47, 48): shared read helpers for
// the public GET /api/kg/related/:id route (server/routes/kg.mjs)
// and the assistant's graph branch (server/routes/assistant.mjs).
//
// The graph is hand-seeded in server/postgres.mjs from real data only
// (Lam decision (c) 2026-11-14) — see docs/03 R7-3 for the 26-node /
// 7-edge hand list and the source of every link. No link is ever
// invented here: a show with no edges answers an empty list, and a
// question the graph cannot answer returns null so the caller falls
// through to the existing rule engine.
export const KG_KINDS = ["show", "artist", "genre", "venue", "ip"];

// Words that make a question a graph question (about a show's
// performers, its other shows, or its venue). Checked BEFORE any DB
// query, so ordinary questions never touch the kg tables.
const GRAPH_WORDS = /演员|团队|还有什么|演什么|哪些戏|同台|相关|在哪演|场馆/;

// The kg node for one resource id (any of the 4 graph categories), or
// null when the resource has no node. When `kind` is given, the node
// must be of that kind (a valid kind that does not match answers no
// node — only an invalid kind value is a 400, and the route checks
// that before calling here).
export async function nodeForResource(ctx, resourceId, kind = null) {
  const node = await ctx.get(
    "SELECT * FROM kg_nodes WHERE ref_id=?",
    resourceId,
  );
  if (!node) return null;
  if (kind !== null && node.kind !== kind) return null;
  return node;
}

// Related nodes for one kg node id, both directions: an edge stored
// as team -> show reads from the show as its performer (direction
// "in"), and as show -> genre reads as its genre ("out"). Ordered by
// name so the response is stable. `meta` is deliberately NOT
// returned: a venue node's meta carries the resource's demo address,
// while the verified address lives on the held_at edge's `source`.
export async function relatedForNode(ctx, nodeId) {
  const rows = await ctx.all(
    `SELECT n.id, n.kind, n.ref_id, n.name, e.relation, e.source,
            CASE WHEN e.from_id=? THEN 'out' ELSE 'in' END AS direction
       FROM kg_edges e
       JOIN kg_nodes n ON n.id = CASE WHEN e.from_id=? THEN e.to_id ELSE e.from_id END
      WHERE e.from_id=? OR e.to_id=?
      ORDER BY n.name`,
    nodeId,
    nodeId,
    nodeId,
    nodeId,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ref_id: r.ref_id,
    name: r.name,
    relation: r.relation,
    direction: r.direction,
    source: r.source || "",
  }));
}

// Match keys for a show name: the full name, the 《...》 inner title
// (刘三姐 inside 民族歌舞剧《刘三姐》 — that is how users ask), and
// the part before "·" (壮乡情 inside 壮乡情·民族歌舞专场）.
function showKeys(name) {
  const keys = [name];
  const bracket = name.match(/《([^》]+)》/);
  if (bracket) keys.push(bracket[1]);
  const head = name.split("·")[0];
  if (head && head !== name) keys.push(head);
  return keys.filter((k) => k.length >= 2);
}

// Answer a graph question from the graph, or null when the question
// is not a graph question / names no show / the show has no graph
// data. The answer names its sources: seeded data, plus the verified
// public address (R7-6) when a venue line is included. Any DB error
// (e.g. an old database without the kg tables) fails open to null —
// the assistant must never 500 on a graph question.
export async function graphAnswer(ctx, q) {
  if (!GRAPH_WORDS.test(q)) return null;
  try {
    const shows = await ctx.all(
      "SELECT id, name FROM resources WHERE category='show' AND status='published' ORDER BY id",
    );
    const show = shows.find((s) =>
      showKeys(s.name).some((k) => q.includes(k)),
    );
    if (!show) return null;
    const node = await nodeForResource(ctx, show.id);
    if (!node) return null;
    const related = await relatedForNode(ctx, node.id);
    if (!related.length) return null;
    const performers = related.filter((r) => r.relation === "performs");
    const genre = related.find(
      (r) => r.relation === "belongs_to" && r.kind === "genre",
    );
    const sameGenre = related.filter(
      (r) => r.relation === "related_to" && r.kind === "show",
    );
    const venue = related.find((r) => r.relation === "held_at");
    let sameArtist = [];
    for (const p of performers) {
      const others = await relatedForNode(ctx, p.id);
      for (const o of others)
        if (
          o.kind === "show" &&
          o.relation === "performs" &&
          o.ref_id !== show.id &&
          !sameArtist.some((s) => s.ref_id === o.ref_id)
        )
          sameArtist.push(o);
    }
    const lines = [];
    if (performers.length) {
      const names = performers.map((p) => p.name).join("、");
      lines.push(
        `${show.name}的演出团队是${names}；` +
          (sameArtist.length
            ? `该团队的其他演出：${sameArtist.map((s) => s.name).join("、")}。`
            : "该团队在平台上没有其他演出。"),
      );
    }
    if (sameGenre.length)
      lines.push(
        `同体裁演出：${sameGenre.map((s) => s.name).join("、")}` +
          (genre ? `（同为${genre.name}）。` : "。"),
      );
    if (venue) {
      const address = (venue.source.match(/address: (.+)$/) || [])[1];
      lines.push(
        `演出场馆：${venue.name}` + (address ? `（${address}）。` : "。"),
      );
    }
    if (!lines.length) return null;
    const sources = ["平台种子数据"];
    if (venue) sources.push("已核实公开地址（R7-6）");
    return {
      kind: "kg",
      answer:
        "【知识图谱，未接入大模型】\n" +
        lines.join("\n") +
        `\n来源：${sources.join(" + ")}。`,
    };
  } catch {
    return null;
  }
}
