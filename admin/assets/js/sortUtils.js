// Sort helpers (sortable columns 2026-11-11) — plain JS, no JSX, no
// React, so a future node:test can import this file without a JSX
// transform. Generic: per-table field knowledge lives in the
// SORT_ACCESSORS map in AdminDashboard.jsx, not here.

// cycleDirection(dir) — null -> "asc" -> "desc" -> null
export function cycleDirection(dir) {
  if (!dir) return "asc";
  if (dir === "asc") return "desc";
  return null;
}

function isEmpty(v) {
  return v === null || v === undefined || v === ""
    || (typeof v === "number" && Number.isNaN(v));
}

// compareValues(a, b) — one comparator for every column type.
// - null/undefined (and "" / NaN) count as empty: they sort FIRST
//   ascending, LAST descending (direction is applied by the caller
//   flipping the sign).
// - numbers (after Number() coercion, NaN counts as empty) compare
//   numerically.
// - everything else compares as strings via localeCompare(b, "zh",
//   { numeric: true }) — digit runs compare numerically, so
//   "visitor2" sorts before "visitor10" (plain lexicographic order
//   would put "visitor10" first, which reads as a bug).
// - JS Array.sort is stable (ES2019+), so equal keys keep original order.
export function compareValues(a, b) {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  const na = Number(a);
  const nb = Number(b);
  if ((typeof a === "number" || typeof b === "number")
    && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), "zh", { numeric: true });
}

// sortRows(rows, accessor, dir) — returns a NEW sorted array, never
// mutates. rows: already-filtered array; accessor(row) -> raw cell
// value; dir: "asc" | "desc" | null. dir null (or no accessor) returns
// rows untouched (same reference is fine — no copy needed when nothing
// is sorted).
export function sortRows(rows, accessor, dir) {
  if (!dir || !accessor) return rows;
  const m = dir === "desc" ? -1 : 1;
  return [...rows].sort((x, y) => m * compareValues(accessor(x), accessor(y)));
}
