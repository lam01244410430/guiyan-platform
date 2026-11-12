/* Guiyan customer API client (React) — ESM port of web/assets/js/app.js
   (API layer) + web/assets/js/api.js (dashboard client), merged: the two
   classic-script clients were near-identical and shared the same contract.
   Same contract, unchanged: same-origin by default, override via
   window.GUIYAN_API_BASE or ?api=<origin>; API paths include the /api
   prefix (as in miniprogram/utils/api.js); token in sessionStorage
   ("guiyan-token", user JSON in "guiyan-user"); 5s timeout; all money is
   INTEGER CENTS on the wire — divide by 100 before money(). RES rows stay
   in YUAN. If the API is unreachable, apiAvailable stays false and every
   feature silently keeps its original local in-memory behaviour. No error
   is ever shown for an unreachable API (the login form is the one
   exception: a user-initiated sign-in shows its failure inline). */
import { CATS, RES, DEMANDS, money } from "./data.js";

let apiAvailable = false;
export function isApiAvailable() { return apiAvailable; }
let apiUser = null;

export const APIRES = {};    /* RES index -> {id, stock, capacity, rating, review_count, status, tags} */
export const APIID2IDX = {}; /* API resource id -> RES index */
export const APICAT = {};    /* API category Chinese name -> CATS id */

export function apiBase() {
  let b = "";
  try { const m = /[?&]api=([^&]+)/.exec(location.search); if (m) b = decodeURIComponent(m[1]); } catch (e) {}
  if (!b && window.GUIYAN_API_BASE) b = window.GUIYAN_API_BASE;
  return String(b || "").replace(/\/+$/, "");
}
export function getToken() { try { return sessionStorage.getItem("guiyan-token") || ""; } catch (e) { return ""; } }
export function setToken(token, user) {
  apiUser = user || null;
  try {
    if (token) { sessionStorage.setItem("guiyan-token", token); sessionStorage.setItem("guiyan-user", JSON.stringify(user || {})); }
    else { sessionStorage.removeItem("guiyan-token"); sessionStorage.removeItem("guiyan-user"); }
  } catch (e) {}
}
export function clearToken() { setToken("", null); }
export function currentUser() {
  if (apiUser) return apiUser;
  try { const u = JSON.parse(sessionStorage.getItem("guiyan-user") || "null"); if (u) apiUser = u; } catch (e) {}
  return apiUser;
}
export function restoreUser() {
  try { const u = sessionStorage.getItem("guiyan-user"); if (u) apiUser = JSON.parse(u); } catch (e) { apiUser = null; }
  return apiUser;
}

export function apiFetch(path, opts) {
  opts = opts || {};
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
  let timer = null;
  if (ctrl) { timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000); }
  const headers = { "Content-Type": "application/json" };
  const tk = getToken(); if (tk) headers.Authorization = "Bearer " + tk;
  return fetch(apiBase() + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (txt) {
        let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) { const err = new Error((data && data.error) || ("HTTP " + res.status)); err.status = res.status; err.data = data; throw err; }
        apiAvailable = true; return data;
      });
    })
    .catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.status) { apiAvailable = true; } /* HTTP answer = API reachable, even on 4xx/5xx */
      else { apiAvailable = false; }           /* network failure / timeout / abort = offline */
      throw e;
    });
}
export function apiGet(path) { return apiFetch(path, { method: "GET" }); }
export function apiPost(path, body) { return apiFetch(path, { method: "POST", body }); }
export function apiDel(path) { return apiFetch(path, { method: "DELETE" }); }
/* Wave 4 #14 — PATCH (inbox mark-read). The admin bundle has its own copy
   in adminApi.js; this one is for the customer dashboard. */
export function apiPatch(path, body) { return apiFetch(path, { method: "PATCH", body }); }

/* Wave 4 #15 — download a text file in the browser (simulated agreement).
   The admin bundle has its own copy in adminApi.js (admin must not import
   this file, which pulls in data.js). */
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* API amounts are integer cents; the SPA's money() formats a yuan number. */
export function fmtMoney(cents) { return money((typeof cents === "number" ? cents : 0) / 100); }

/* Wave 4 #13: refund_requested / disputed are real Lam states now (the
   approval flow); they get their own labels instead of being folded into
   another status. */
export const STATUS = { pending: "stPending", confirmed: "stConfirmed", paid: "stPaid", completed: "stCompleted", cancelled: "stCancelled", refunded: "stRefunded", refund_requested: "stRefundRequested", disputed: "stDisputed" };
export function statusKey(status) { return STATUS[status] || "stPending"; }

/* ---- server data merged into the embedded catalog (unchanged logic) ---- */
export function apiCatId(name) {
  if (!name) return "show";
  for (let i = 0; i < CATS.length; i++) { if (CATS[i][0] === name) return name; }
  if (APICAT[name]) return APICAT[name];
  for (let j = 0; j < CATS.length; j++) { if (CATS[j][1] === name) return CATS[j][0]; }
  return "show";
}
export function mergeCategories(data) {
  if (!data || !data.categories) return;
  data.categories.forEach(function (c) {
    if (!c || !c.name) return;
    for (let i = 0; i < CATS.length; i++) { if (CATS[i][1] === c.name) APICAT[c.name] = CATS[i][0]; }
  });
}
export function mergeResources(data) {
  if (!data || !data.resources) return;
  data.resources.forEach(function (a) {
    if (!a || !a.name) return;
    let idx = -1;
    for (let i = 0; i < RES.length; i++) { if (RES[i][0] === a.name) { idx = i; break; } }
    const priceYuan = (typeof a.price === "number") ? a.price / 100 : (idx >= 0 ? RES[idx][3] : 0);
    if (idx < 0) {
      const dsc = a.description || a.name;
      RES.push([a.name, apiCatId(a.category), a.city || "南宁", priceYuan, a.unit || "张", (typeof a.views === "number" ? a.views : 0), [dsc, dsc, dsc]]);
      idx = RES.length - 1;
    } else {
      RES[idx][3] = priceYuan;
      if (typeof a.views === "number") RES[idx][5] = a.views;
      /* embedded trilingual desc, category, city and unit are kept */
    }
    /* Wave 4 shared (#12 seat-map, #15 meta render): keep the API meta
       (seatRows/seatCols and the per-category detail fields). It was
       dropped here before, so the detail overlay never saw it. */
    APIRES[idx] = { id: a.id, stock: a.stock, capacity: a.capacity, rating: a.rating, review_count: a.review_count, status: a.status, tags: a.tags || [], meta: a.meta || {} };
    if (a.id != null) APIID2IDX[a.id] = idx;
  });
}
export function mergeDemands(data) {
  if (!data || !data.demands) return;
  data.demands.forEach(function (a) {
    if (!a || !a.title) return;
    const budgetYuan = (typeof a.budget === "number") ? a.budget / 100 : 0;
    const catId = apiCatId(a.category);
    let idx = -1;
    for (let i = 0; i < DEMANDS.length; i++) { if (DEMANDS[i][0][0] === a.title) { idx = i; break; } }
    if (idx < 0) {
      const dsc = a.description || a.title;
      DEMANDS.push([[a.title, a.title, a.title], catId, budgetYuan, a.city || "南宁", [dsc, dsc, dsc]]);
    } else {
      DEMANDS[idx][1] = catId; DEMANDS[idx][2] = budgetYuan;
      if (a.city) DEMANDS[idx][3] = a.city;
      if (a.description) DEMANDS[idx][4][1] = a.description; /* zh slot; vi/en stay embedded */
    }
  });
}
export function mapApiOrder(o) {
  if (!o) return null;
  let idx = -1;
  if (o.resource_id != null && APIID2IDX[o.resource_id] != null) idx = APIID2IDX[o.resource_id];
  if (idx < 0) { for (let i = 0; i < RES.length; i++) { if (RES[i][0] === o.resource_name) { idx = i; break; } } }
  if (idx < 0) return null;
  let st = o.status;
  if (!STATUS[st]) st = "pending";
  return { code: o.code || ("GY" + o.id), idx, qty: o.quantity || 1, date: String(o.booking_date || "").slice(0, 10), total: (o.amount || 0) / 100, status: st, apiId: o.id };
}
