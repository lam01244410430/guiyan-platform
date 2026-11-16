// Notification bell helpers (admin redesign Item 2) — plain JS, no JSX,
// no React, so node:test can import this file without a JSX transform
// (same pattern as sortUtils.js). The bell reuses the alerts + audit
// state the alerts view already loads (GET /api/admin/alerts and
// GET /api/admin/audit-logs); no new endpoints.
//
// Severity mapping (alert -> bell colour):
//   scan_abuse  -> critical (red)   — a flood of failed verifications
//                                     is treated as an incident.
//   low_stock   -> warning (yellow)
//   sales_drop  -> warning (yellow)
//   manual alerts (triggered / simulated events, no rule_kind) use
//     their `severity` field when present: "critical"/"error" ->
//     critical, "warning" -> warning, "info" -> info (shown in the
//     dropdown but never counted in the badge); missing severity
//     defaults to warning.
//   audit events never affect the badge (badge counts unread ALERTS
//     only); they are listed in the dropdown as activity, with no
//     warning styling.
// Auto alerts carry severity "warning" from the server for every
// kind, so rule_kind is checked FIRST — otherwise scan_abuse would
// never turn the badge red.
//
// Inline-mark mapping (which alerts get a `!` on a row, and why):
//   low_stock -> the matching resource row. The auto alert id is
//     `auto:low_stock:{shop}:{resource_id}` (alerts-ledger.mjs), so
//     the resource id parses out cleanly; the read-time computed
//     low-stock alert (admin-insights.mjs computeAlerts) carries no
//     id, but it fires on exactly the same condition (published,
//     non-booking resource, stock <= threshold), so the mark also
//     fires on that condition. Booking resources are category
//     "venue" (bookingType in server/lib/http.mjs) — their quota
//     alerts are per-date with no resource id, so they get NO inline
//     mark: bell + alerts view only.
//   disputed / refund_requested orders -> the matching order row.
//     No alert object carries an order id (the read-time alert is
//     one aggregate "N笔售后或纠纷待处理"), but the order row itself
//     carries the status, which IS the clean mapping: disputed ->
//     red `!`, refund_requested -> yellow `!`.
//   sales_drop, scan_abuse, pending-confirmation aggregates and all
//     manual (simulated) alerts carry no resource/order id, so they
//     get NO inline mark: bell + alerts view only. No link is ever
//     invented from a title string.
//
// Read state (Q3(a)): client-side only, per account, in localStorage
// under `guiyan-bell-read-<userId>` (seen alert keys). Opening the
// bell marks the currently listed alerts as read and the badge
// clears. The server does not store read state (follow-up, not
// this item).

export const BELL_READ_KEY_PREFIX = "guiyan-bell-read-";
export const BELL_ALERT_LIMIT = 10;
export const BELL_AUDIT_LIMIT = 5;

export function bellReadKey(userId) {
  return BELL_READ_KEY_PREFIX + String(userId ?? "anon");
}

// Stable key for one alert. Read-time computed alerts (low stock,
// quota, pending/abnormal aggregates) carry no id, so the title is
// the fallback key.
export function alertKey(a) {
  if (!a) return "";
  if (a.id !== undefined && a.id !== null && a.id !== "") return String(a.id);
  return "title:" + String(a.title || "");
}

// "critical" | "warning" | "info" — see the mapping comment above.
export function alertSeverity(a) {
  if (!a) return "warning";
  if (a.rule_kind === "scan_abuse") return "critical";
  if (a.rule_kind === "low_stock" || a.rule_kind === "sales_drop") return "warning";
  const s = String(a.severity || "").toLowerCase();
  if (s === "critical" || s === "error") return "critical";
  if (s === "info") return "info";
  return "warning";
}

// Badge over the unread alerts: { count, level }. level is
// "critical" if any unread alert is critical, else "warning" if any
// unread alert is warning, else null (badge hidden when count is 0).
// `readKeys` is a Set (or array) of alertKey values already seen.
// Audit events are never passed here — the badge counts alerts only.
export function bellBadge(alerts, readKeys) {
  const read = readKeys instanceof Set ? readKeys : new Set(readKeys || []);
  let count = 0;
  let level = null;
  for (const a of alerts || []) {
    const sev = alertSeverity(a);
    if (sev !== "critical" && sev !== "warning") continue;
    if (read.has(alertKey(a))) continue;
    count += 1;
    if (sev === "critical") level = "critical";
    else if (level === null) level = "warning";
  }
  return { count, level };
}

// Resource ids behind auto low_stock alerts, parsed from the stable
// id `auto:low_stock:{shop}:{resource_id}`.
export function lowStockResourceIds(alerts) {
  const ids = new Set();
  for (const a of alerts || []) {
    const m = /^auto:low_stock:[^:]+:(\d+)$/.exec(String((a && a.id) || ""));
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

// Inline mark level for one order row, from the order's own status
// (the aggregate after-sales alert carries no order id).
// disputed -> "critical" (red), refund_requested -> "warning"
// (yellow), anything else -> null (no mark).
export function orderMarkLevel(o) {
  if (!o) return null;
  if (o.status === "disputed") return "critical";
  if (o.status === "refund_requested") return "warning";
  // Dashboard redesign: pending orders await confirmation, so they
  // get the same warning flag as refund_requested — the row mark is
  // the attention flag, and the breakdown's 查看订单 action is the
  // way to open them filtered.
  if (o.status === "pending") return "warning";
  return null;
}

// Inline mark level for one resource row. `lowStockIds` is the set
// from lowStockResourceIds(alerts); `threshold` is the stock alert
// threshold from GET /api/admin/alerts (default 5). Returns
// "warning" or null. Booking resources (category "venue") are
// excluded: their quota alerts are per-date with no resource id.
export function resourceMarkLevel(r, lowStockIds, threshold) {
  if (!r) return null;
  if (lowStockIds && lowStockIds.has(r.id)) return "warning";
  const t = threshold === undefined || threshold === null ? 5 : Number(threshold);
  if (
    r.status === "published" &&
    r.category !== "venue" &&
    Number(r.stock) <= t
  )
    return "warning";
  return null;
}

function readStore() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch (e) {
    return null;
  }
}

// Seen alert keys for one account (a Set, empty when nothing stored).
export function loadBellReadKeys(userId) {
  const store = readStore();
  if (!store) return new Set();
  try {
    const raw = store.getItem(bellReadKey(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

export function saveBellReadKeys(userId, keys) {
  const store = readStore();
  if (!store) return;
  try {
    store.setItem(bellReadKey(userId), JSON.stringify(Array.from(keys || [])));
  } catch (e) {
    // Read state is best-effort client-side state; a full or
    // unavailable store must never break the dashboard.
  }
}

// Mark the currently listed alerts as read for one account; returns
// the updated Set of seen keys.
export function markBellRead(userId, alerts) {
  const next = loadBellReadKeys(userId);
  for (const a of alerts || []) next.add(alertKey(a));
  saveBellReadKeys(userId, next);
  return next;
}
