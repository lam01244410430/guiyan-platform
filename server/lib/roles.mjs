// Admin redesign Item 5 (2026-11-15) — Oracle-style RBAC, Q1(a).
// Three roles, stored in users.role (no CHECK constraint on the
// column, schema.mjs — "root" is just a third value):
//   root  — the default admin account (id 1, highest). NOBODY can
//           edit / disable / demote it through the dashboard, not
//           even itself; ONLY root grants / revokes the admin role.
//   admin — full dashboard EXCEPT: cannot touch the root account,
//           cannot grant / revoke roles.
//   user  — no admin access, 403 on every admin endpoint.
// Every rule is enforced in the API (403), never only in the UI;
// every role change writes an audit-log row.
//
// PERMISSION MATRIX (enforcement audit, Item 5 — every admin
// endpoint below was grepped; each handler enforces its row):
//   root-only (403 for a non-root admin, 403 for user, 401 anon):
//     PATCH /api/admin/users/:id/role — grant/revoke admin
//     (admin-account.mjs). Anything touching the root account:
//     PATCH /api/admin/users/:id (edit), DELETE /api/admin/users/:id
//     (delete) and PATCH /api/admin/users/:id/status (disable) all
//     refuse the root target with 403 (admin-account.mjs).
//   admin + root (platform admin only, shop_id NULL — a shop-scoped
//     admin gets 403; user gets 403; anon 401):
//     POST /api/admin/users, PATCH /api/admin/users/:id,
//     DELETE /api/admin/users/:id, PATCH /api/admin/users/:id/status
//     (admin-account.mjs).
//   admin + root (any admin, shop-scoped included; user 403):
//     GET /api/admin/stats, /api/admin/orders, /api/admin/users,
//     /api/admin/demands (admin.mjs), every other /api/admin/*
//     resource endpoint (shops, shows, venues, seats, tickets,
//     coupons, flash-sales, tiers, stored-value, tag-rules,
//     member-insights, bi, alerts, audit-logs, finance-ledger,
//     sms-tasks, ip, licenses, comments, pickup, …), the owner-or-
//     admin reads/writes on orders/tickets, and the unpublished-
//     visibility checks on resources/shows/itineraries/kg.
//     PATCH /api/admin/profile + POST /api/admin/change-password
//     (own account only; the dashboard no longer exposes them,
//     Item 4 Q2(a) — the endpoints stay for out-of-dashboard use).
//   public (no role check by design — customer flow, not admin):
//     /api/auth/*, /api/demands, /api/resources, /api/orders
//     (owner-only parts), /api/account/*, /api/assistant/chat.
// See FINDING-1 in the Item 5 verification package: a non-root
// platform admin CAN disable another non-root admin (status
// endpoint) — Item 4's approved shape, kept unchanged here; Lam
// decides whether that needs a root-only rule.

export const ROOT_ROLE = "root";
export const ADMIN_ROLE = "admin";
export const USER_ROLE = "user";

// True for both admin-class roles: root passes every admin gate.
export function isAdminRole(role) {
  return role === "admin" || role === "root";
}

export function isRootRole(role) {
  return role === "root";
}

// Defensive root check (documented rule): role === "root" OR
// id === 1. The backfill in postgres.mjs promotes id 1 at boot, but
// the OR costs nothing and keeps an old DB safe even before the
// backfill runs. Use this — never a bare id === 1 — in guards.
export function isRootUser(user) {
  return !!user && (user.role === "root" || user.id === 1);
}
