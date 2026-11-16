/* Shared ranked-row list (dashboard redesign): rank + name + value +
   share, 3px share bar on the row's bottom edge. Used by the analysis
   channel + resource breakdowns. Rows are plain data —
   { key, name, value (node), sub (node, optional), pct (string),
     share (0..1 of the max value), fill (CSS colour) } — so the same
   component renders channels and resources with the same fill:
   DONUT_SHADES by rank - the same four per-rank colours as the
   overview donut (rank 1 money green, rank 2 accent blue, rank 3
   gold, rank 4 warm grey, cycling past 4). The name keeps its title attribute
   (full value on hover) like .cell-ellipsis elsewhere. */
export default function RankedList({ rows }) {
  const data = Array.isArray(rows) ? rows : [];
  return (
    <ul className="rk-list">
      {data.map((r, i) => (
        <li key={r.key} className="rk-row">
          <span className="rk-rank">{i + 1}</span>
          <span className="rk-name cell-ellipsis" title={r.name}>
            {r.name}
          </span>
          {r.sub ? <span className="rk-sub">{r.sub}</span> : null}
          <span className="rk-val">{r.value}</span>
          {r.pct ? <span className="rk-pct">{r.pct}</span> : null}
          <span className="rk-bar">
            <span
              className="rk-fill"
              style={{
                width: Math.max(0, Math.min(100, (r.share || 0) * 100)) + "%",
                background: r.fill,
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
