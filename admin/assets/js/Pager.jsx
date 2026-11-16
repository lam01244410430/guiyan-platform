/* Shared table pager — tables-pagination-fit round (2026-11-17, Lam-approved
   plan Q1(a)). One pager per list table: 25 rows/page, bottom-right of the
   table, shown only when the list has more than 25 rows. Client-side
   slicing only — the page state lives in AdminDashboard (`tablePage` /
   `goTablePage`); this component only renders and reports clicks. No
   fetch, no filtering, no sorting of its own.
   Props: p = { id, total, page, totalPages, sig } (from tablePage()),
   onPage = (page) => void. */
export const PAGE_SIZE = 25;

function pageItems(page, totalPages) {
  // Compact window: 1 … p-1 p p+1 … N (7 or fewer pages: show all).
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const nums = new Set([1, totalPages, page - 1, page, page + 1]);
  const list = [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] > list[i - 1] + 1) out.push("…");
    out.push(list[i]);
  }
  return out;
}

export default function Pager({ p, onPage }) {
  if (!p || p.total <= PAGE_SIZE) return null;
  return (
    <div className="pager" data-table={p.id}>
      <span className="pager-total">共 {p.total} 条 · 第 {p.page}/{p.totalPages} 页</span>
      <button type="button" className="pager-btn" disabled={p.page <= 1} aria-label="上一页"
        onClick={() => onPage(p.page - 1)}>‹</button>
      {pageItems(p.page, p.totalPages).map((n, i) => (n === "…" ? (
        <span key={"e" + i} className="pager-ellipsis" aria-hidden="true">…</span>
      ) : (
        <button key={n} type="button" className={"pager-btn" + (n === p.page ? " on" : "")}
          aria-label={"第 " + n + " 页"} aria-current={n === p.page ? "page" : undefined}
          onClick={() => onPage(n)}>{n}</button>
      )))}
      <button type="button" className="pager-btn" disabled={p.page >= p.totalPages} aria-label="下一页"
        onClick={() => onPage(p.page + 1)}>›</button>
    </div>
  );
}
