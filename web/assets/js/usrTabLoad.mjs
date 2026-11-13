/* User dashboard per-tab data loading (B-037 fix).
 *
 * Before B-037, one Promise.all loaded all six dashboard calls and the
 * login gate only closed when every call resolved — one slow call (>5s,
 * aborted by apiFetch) stuck the whole page on "请先登录" forever for that
 * load. Now each tab loads its own data with its own loading/error state,
 * and the gate opens as soon as the stored token + user are valid (see
 * decideGateOpen). A loader never rejects: a failed tab reports its error
 * to its own tab, a 401 reports an expired session, and other tabs are
 * unaffected. Pure functions (no React, no JSX) so node:test can cover
 * them — same pattern as search.js / sortUtils.js.
 */

export const TAB_KEYS = ["orders", "favs", "demands", "info", "inbox"];

/* Gate decision (Q1 default): open the tabs as soon as a token + cached
   user exist client-side; never wait for a network call. */
export function decideGateOpen(token, user) {
  return Boolean(token && user);
}

/* A 401 means the stored token is dead — it must reach the caller as an
   expired session, never as a silent null. Any other failure degrades. */
function swallowUnlessAuth(e) {
  if (e && e.status === 401) throw e;
  return null;
}

/* Shared loader shell: marks the tab loading, runs the fetch, stores the
   result via onOk, and converts any failure into a per-tab error (or an
   expired-session report on 401). Always resolves. */
function loadOne(get, s, key, path, onOk) {
  s.setLoading(key, true);
  s.setError(key, false);
  return get(path).then(function (d) {
    onOk(d);
    s.setLoading(key, false);
  }).catch(function (e) {
    s.setLoading(key, false);
    if (e && e.status === 401) { s.onAuthExpired(); return; }
    s.setError(key, true);
  });
}

export function loadTabOrders(get, s) {
  return loadOne(get, s, "orders", "/api/orders", function (d) { s.setOrders(d.orders || []); });
}

export function loadTabFavs(get, s) {
  return loadOne(get, s, "favs", "/api/favorites", function (d) { s.setFavs(d.favorites || []); });
}

export function loadTabDemands(get, s) {
  return loadOne(get, s, "demands", "/api/demands", function (d) {
    const u = s.currentUser();
    s.setDemands((d.demands || []).filter(function (x) { return !u || x.user_id === u.id; }));
  });
}

export function loadTabInfo(get, s) {
  /* Profile + recommendations + member tier load together for the info
     tab. Either call failing on its own leaves its section empty, as
     before (Q3 default); only all three failing shows the tab's light
     error. A 401 is never swallowed — it reports an expired session
     like every other tab. */
  s.setLoading("info", true);
  s.setError("info", false);
  return Promise.all([
    get("/api/profile").catch(swallowUnlessAuth),
    get("/api/recommendations?limit=5").catch(swallowUnlessAuth),
    get("/api/account/tier").catch(() => null),
  ]).then(function (res) {
    const prof = res[0];
    const recs = res[1];
    const tier = res[2];
    if (!prof && !recs && !tier) { s.setError("info", true); }
    s.setProfile(prof ? prof.profile || null : null);
    s.setRecs(recs ? recs.recommendations || [] : []);
    if (s.setTier) s.setTier(tier || null);
    s.setLoading("info", false);
  }).catch(function (e) {
    s.setLoading("info", false);
    if (e && e.status === 401) { s.onAuthExpired(); return; }
    s.setError("info", true);
  });
}

export function loadTabInbox(get, s) {
  return loadOne(get, s, "inbox", "/api/messages", function (d) {
    s.setMessages(d.messages || []);
    s.setUnread(d.unread || 0);
  });
}

/* Load every tab's data in parallel. Each loader is guarded on its own,
   so one failing tab never blocks or rejects the others. Always resolves. */
export function loadAllTabs(get, s) {
  return Promise.all([
    loadTabOrders(get, s),
    loadTabFavs(get, s),
    loadTabDemands(get, s),
    loadTabInfo(get, s),
    loadTabInbox(get, s),
  ]);
}
