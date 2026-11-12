/* Shared sort button (sortable columns 2026-11-11) — one per sortable
   table header. Controlled: the sort state lives in AdminDashboard
   (`sorts` map); this component only renders the button and reports
   clicks. No fetch, no filtering, no sorting of its own.
   Icon paths copied verbatim from Lucide `arrow-up-down` (unsorted),
   `arrow-up` (ascending) and `arrow-down` (descending). */
export default function SortButton({ label, sortKey, tableId, sort, onToggle }) {
  const active = sort && sort.key === sortKey;
  const dir = active ? sort.dir : null; // "asc" | "desc" | null
  const stateText = !active ? "" : dir === "asc" ? "升序" : "降序";
  const nextText = !active ? "点击升序" : dir === "asc" ? "点击降序" : "点击取消排序";
  return (
    <button type="button" className={"sort-btn" + (active ? " active" : "")}
      aria-label={`按${label}排序${stateText}，${nextText}`}
      title={`按${label}排序${stateText ? "（" + stateText + "）" : ""}`}
      onClick={() => onToggle(tableId, sortKey)}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        {!active ? (
          <><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></>
        ) : dir === "asc" ? (
          <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>
        ) : (
          <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>
        )}
      </svg>
    </button>
  );
}
