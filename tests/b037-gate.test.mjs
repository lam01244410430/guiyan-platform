/* B-037 gate tests — the per-tab loaders in web/assets/js/usrTabLoad.mjs.
 *
 * The gate behaviour they protect (verified live in the parent's step 4):
 * the tabs open as soon as the stored token + user are valid, even when an
 * API call is slower than the 5s apiFetch abort; one failing tab errors on
 * its own tab only; a 401 reports an expired session. These node:test
 * tests cover the pure loader logic with stub getters — no DOM, no React.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideGateOpen,
  TAB_KEYS,
  loadTabOrders,
  loadTabFavs,
  loadTabDemands,
  loadTabInfo,
  loadTabInbox,
  loadAllTabs,
} from "../web/assets/js/usrTabLoad.mjs";

function makeSetters(user) {
  const calls = {
    loading: [],
    error: [],
    orders: "unset",
    favs: "unset",
    demands: "unset",
    profile: "unset",
    recs: "unset",
    tier: "unset",
    gifts: "unset",
    stored: "unset",
    messages: "unset",
    unread: "unset",
    authExpired: 0,
  };
  const s = {
    setLoading: (k, v) => { calls.loading.push([k, v]); },
    setError: (k, v) => { calls.error.push([k, v]); },
    setOrders: (v) => { calls.orders = v; },
    setFavs: (v) => { calls.favs = v; },
    setDemands: (v) => { calls.demands = v; },
    setProfile: (v) => { calls.profile = v; },
    setRecs: (v) => { calls.recs = v; },
    setTier: (v) => { calls.tier = v; },
    setGifts: (v) => { calls.gifts = v; },
    setStoredValue: (v) => { calls.stored = v; },
    setMessages: (v) => { calls.messages = v; },
    setUnread: (v) => { calls.unread = v; },
    currentUser: () => user || null,
    onAuthExpired: () => { calls.authExpired += 1; },
  };
  return { s, calls };
}

function err401() {
  const e = new Error("Unauthorized");
  e.status = 401;
  return Promise.reject(e);
}
function err500() {
  return Promise.reject(new Error("boom"));
}
const delay = (ms, v) => new Promise((resolve) => setTimeout(() => resolve(v), ms));

test("b037 gate: decideGateOpen opens only on token + user (Q1 default)", () => {
  assert.equal(decideGateOpen("tok", { id: 1 }), true);
  assert.equal(decideGateOpen("", { id: 1 }), false);
  assert.equal(decideGateOpen(null, { id: 1 }), false);
  assert.equal(decideGateOpen("tok", null), false);
  assert.equal(decideGateOpen("tok", undefined), false);
  assert.equal(decideGateOpen(null, null), false);
});

test("b037 gate: the five tab keys exist", () => {
  assert.deepEqual([...TAB_KEYS].sort(), ["demands", "favs", "inbox", "info", "orders"]);
});

test("b037 tab: orders loader stores rows and clears loading on success", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabOrders(() => Promise.resolve({ orders: [{ id: 9 }] }), s);
  assert.deepEqual(calls.orders, [{ id: 9 }]);
  assert.deepEqual(calls.loading, [["orders", true], ["orders", false]]);
  assert.deepEqual(calls.error, [["orders", false]]);
  assert.equal(calls.authExpired, 0);
});

test("b037 tab: a slow orders call still resolves and stores (gate never waits on it)", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabOrders(() => delay(150, { orders: [{ id: 3 }] }), s);
  assert.deepEqual(calls.orders, [{ id: 3 }]);
  assert.deepEqual(calls.error, [["orders", false]]);
});

test("b037 tab: a rejecting orders call never rejects the loader and errors only its own tab", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabOrders(err500, s);
  assert.equal(calls.orders, "unset");
  assert.deepEqual(calls.error, [["orders", false], ["orders", true]]);
  assert.deepEqual(calls.loading, [["orders", true], ["orders", false]]);
  assert.equal(calls.authExpired, 0);
});

test("b037 tab: a 401 reports an expired session, never a tab error", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabOrders(err401, s);
  assert.equal(calls.authExpired, 1);
  assert.deepEqual(calls.error, [["orders", false]]);
});

test("b037 tab: demands loader keeps only the current user's rows", async () => {
  const { s, calls } = makeSetters({ id: 7 });
  await loadTabDemands(
    () => Promise.resolve({ demands: [{ id: 1, user_id: 7 }, { id: 2, user_id: 8 }, { id: 3, user_id: 7 }] }),
    s,
  );
  assert.deepEqual(calls.demands, [{ id: 1, user_id: 7 }, { id: 3, user_id: 7 }]);
});

test("b037 tab: inbox loader stores messages + unread count", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabInbox(() => Promise.resolve({ messages: [{ id: 5 }], unread: 2 }), s);
  assert.deepEqual(calls.messages, [{ id: 5 }]);
  assert.equal(calls.unread, 2);
  assert.deepEqual(calls.error, [["inbox", false]]);
});

test("b037 tab: info loader — profile fails alone, recommendations still show, no tab error (Q3 default)", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabInfo((p) => {
    if (p === "/api/profile") return err500();
    return Promise.resolve({ recommendations: [{ id: 11 }] });
  }, s);
  assert.equal(calls.profile, null);
  assert.deepEqual(calls.recs, [{ id: 11 }]);
  assert.deepEqual(calls.error, [["info", false]]);
});

test("b037 tab: info loader — both calls fail, the tab shows its light error", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabInfo(err500, s);
  assert.equal(calls.profile, null);
  assert.deepEqual(calls.recs, []);
  assert.deepEqual(calls.error, [["info", false], ["info", true]]);
});

test("b037 tab: info loader — a 401 is never swallowed, it reports an expired session", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadTabInfo((p) => {
    if (p === "/api/profile") return err401();
    return Promise.resolve({ recommendations: [] });
  }, s);
  assert.equal(calls.authExpired, 1);
  assert.deepEqual(calls.error, [["info", false]]);
});

test("b037 tabs: one rejecting tab never blocks the others (loadAllTabs)", async () => {
  const { s, calls } = makeSetters({ id: 7 });
  const seen = [];
  const get = (p) => {
    seen.push(p);
    if (p === "/api/demands") return err500();
    if (p === "/api/orders") return Promise.resolve({ orders: [{ id: 1 }] });
    if (p === "/api/favorites") return Promise.resolve({ favorites: [{ id: 2 }] });
    if (p === "/api/profile") return Promise.resolve({ profile: { name: "x" } });
    if (p === "/api/recommendations?limit=5") return Promise.resolve({ recommendations: [] });
    if (p === "/api/account/tier") return Promise.resolve({ tier: null, spending_cents: 0, next_tier: null, remaining_cents: 0, discount_pct: 0 });
    if (p === "/api/account/coupon-gifts") return Promise.resolve({ coupon_gifts: [{ id: 9 }] });
    if (p === "/api/account/stored-value") return Promise.resolve({ account: { balance_cents: 11000 }, plans: [], ledger: [], total: 0 });
    if (p === "/api/messages") return Promise.resolve({ messages: [], unread: 0 });
    throw new Error("unexpected path " + p);
  };
  await loadAllTabs(get, s);
  assert.deepEqual([...seen].sort(), [
    "/api/account/coupon-gifts", "/api/account/stored-value", "/api/account/tier", "/api/demands", "/api/favorites", "/api/messages",
    "/api/orders", "/api/profile", "/api/recommendations?limit=5",
  ]);
  assert.deepEqual(calls.orders, [{ id: 1 }]);
  assert.deepEqual(calls.favs, [{ id: 2 }]);
  assert.deepEqual(calls.profile, { name: "x" });
  assert.deepEqual(calls.gifts, [{ id: 9 }]);
  assert.deepEqual(calls.stored.account, { balance_cents: 11000 });
  assert.deepEqual(calls.messages, []);
  assert.deepEqual(calls.error.filter(([k, v]) => v === true), [["demands", true]]);
  assert.equal(calls.authExpired, 0);
});

test("b037 tabs: loadAllTabs never rejects even when every call fails", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadAllTabs(err500, s);
  assert.deepEqual(
    calls.error.filter(([k, v]) => v === true).map(([k]) => k).sort(),
    ["demands", "favs", "inbox", "info", "orders"],
  );
  assert.equal(calls.authExpired, 0);
});

test("b037 tabs: loadAllTabs with all 401s reports an expired session, no tab errors", async () => {
  const { s, calls } = makeSetters({ id: 1 });
  await loadAllTabs(err401, s);
  assert.ok(calls.authExpired >= 1);
  assert.deepEqual(calls.error.filter(([k, v]) => v === true), []);
});
