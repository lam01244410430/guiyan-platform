/* Guiyan admin API client (React) — ESM port of admin/assets/js/api.js.
   Self-contained, no shared customer frontend. Same-origin by default
   (override via ?api=<origin>); API paths include the /api prefix (as in
   miniprogram/utils/api.js); token in sessionStorage under admin-only keys
   ("guiyan-admin-token" / "guiyan-admin-user"); 5s timeout by default — a
   call may pass opts.timeoutMs for a longer one (AI copy waits on the live
   agent, ~6s observed); all money is INTEGER CENTS on the wire. */
export function $(id) { return document.getElementById(id); }
export function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

export function apiBase() {
  let b = "";
  try { const m = /[?&]api=([^&]+)/.exec(location.search); if (m) b = decodeURIComponent(m[1]); } catch (e) {}
  if (!b && window.GUIYAN_API_BASE) b = window.GUIYAN_API_BASE;
  return String(b || "").replace(/\/+$/, "");
}
export function getToken() { try { return sessionStorage.getItem("guiyan-admin-token") || ""; } catch (e) { return ""; } }
export function setToken(token, user) {
  try {
    if (token) { sessionStorage.setItem("guiyan-admin-token", token); sessionStorage.setItem("guiyan-admin-user", JSON.stringify(user || {})); }
    else { sessionStorage.removeItem("guiyan-admin-token"); sessionStorage.removeItem("guiyan-admin-user"); }
  } catch (e) {}
}
export function clearToken() { setToken("", null); }
export function currentUser() {
  try { const u = JSON.parse(sessionStorage.getItem("guiyan-admin-user") || "null"); return u || null; } catch (e) { return null; }
}
export function apiFetch(path, opts) {
  opts = opts || {};
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
  let timer = null;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 5000;
  if (ctrl) { timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs); }
  const headers = { "Content-Type": "application/json" };
  const tk = getToken(); if (tk) headers.Authorization = "Bearer " + tk;
  return fetch(apiBase() + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (txt) {
        let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) { const err = new Error((data && data.error) || ("HTTP " + res.status)); err.status = res.status; err.data = data; throw err; }
        return data;
      });
    })
    .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
}
export function apiGet(path, opts) { return apiFetch(path, { method: "GET", timeoutMs: opts && opts.timeoutMs }); }
export function apiPost(path, body, opts) { return apiFetch(path, { method: "POST", body, timeoutMs: opts && opts.timeoutMs }); }
export function apiPatch(path, body) { return apiFetch(path, { method: "PATCH", body }); }
export function apiDelete(path) { return apiFetch(path, { method: "DELETE" }); }
/* File download (not apiFetch: the payload is not JSON). Sends the
   Bearer token, saves as the given filename. Errors carry .status
   like apiFetch (403 for a non-admin account). R5-3: the BI view
   downloads XLSX + CSV through this; apiDownloadCsv below stays
   the orders-CSV path. */
export function apiDownloadFile(path, filename) {
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
  let timer = null;
  if (ctrl) { timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000); }
  const headers = {};
  const tk = getToken(); if (tk) headers.Authorization = "Bearer " + tk;
  return fetch(apiBase() + path, { method: "GET", headers, signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (txt) {
          let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          const err = new Error((data && data.error) || ("HTTP " + res.status));
          err.status = res.status; err.data = data; throw err;
        });
      }
      return res.blob().then(function (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename || "download";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return true;
      });
    })
    .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
}
/* CSV download (not apiFetch: CSV is not JSON). Sends the Bearer token,
   keeps the server's UTF-8 BOM intact for Excel, saves as the filename
   the server advertises (guiyan-orders.csv). Errors carry .status like
   apiFetch (403 for a non-admin account). */
export function apiDownloadCsv(path, filename) {
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
  let timer = null;
  if (ctrl) { timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000); }
  const headers = {};
  const tk = getToken(); if (tk) headers.Authorization = "Bearer " + tk;
  return fetch(apiBase() + path, { method: "GET", headers, signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (txt) {
          let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          const err = new Error((data && data.error) || ("HTTP " + res.status));
          err.status = res.status; err.data = data; throw err;
        });
      }
      return res.blob().then(function (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename || "guiyan-orders.csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return true;
      });
    })
    .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
}

/* Wave 4 #15 — download a text file in the browser (simulated agreement).
   The customer bundle has its own copy in web/assets/js/apiClient.js
   (admin must not import that file, which pulls in data.js). */
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

export function fmtMoney(cents) { return "¥" + ((typeof cents === "number" ? cents : 0) / 100).toLocaleString("zh-CN"); }
export const STATUS = { pending: "待确认", confirmed: "已确认", paid: "已支付", completed: "已完成", cancelled: "已取消", refunded: "已退款", refund_requested: "退款申请中", disputed: "纠纷处理中" };

/* Dashboard redesign (D1, 2026-11-16) — pure helpers, no DOM, so they
   are unit-tested in tests/admin-dashboard-windowed.test.mjs. */

/* Delta badge (D1): compare the current windowed value against the
   previous window (same elapsed time). `prevBase` is the base the
   small-base rule judges (orders for the orders tile, paid-order
   count for the revenue tile). A zero previous or a base under 5
   never shouts a percent — it reads grey "was N". `goodWhenUp`:
   true = up is good (revenue/orders), false = up is bad (lower is
   better), null = neutral (users/resources: grey either way).
   Returns { text, tone } with tone in "up" | "down" | "neutral". */
export function formatDelta(cur, prev, prevBase, formatPrev, goodWhenUp) {
  const fmt = typeof formatPrev === "function" ? formatPrev : function (v) { return String(v); };
  if (prev === null || prev === undefined) return { text: "", tone: "neutral" };
  if (prev === 0 || (typeof prevBase === "number" && prevBase < 5)) {
    return { text: "was " + fmt(prev), tone: "neutral" };
  }
  const pct = ((cur - prev) / prev) * 100;
  if (pct === 0) return { text: "±0%", tone: "neutral" };
  const up = pct > 0;
  const text = up
    ? "▲ " + (pct > 999 ? "10×+" : pct.toFixed(1) + "%")
    : "▼ " + (pct < -99 ? "99%" : Math.abs(pct).toFixed(1) + "%");
  const tone = goodWhenUp === null || goodWhenUp === undefined
    ? "neutral"
    : (up === goodWhenUp ? "up" : "down");
  return { text, tone };
}

/* Compact Y-axis tick: 1k / ¥4k (never 2,103). */
export function fmtCompactTick(v, money) {
  const n = Math.round(v);
  if (Math.abs(n) >= 1000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, "");
    return (money ? "¥" : "") + k + "k";
  }
  return (money ? "¥" : "") + String(n);
}

/* Summary chips under the main chart, computed client-side from the
   series already loaded (same window as the chart). `metric` is
   "amount" (cents) or "count". Returns { avg, best: {label, value} |
   null, weekdayAvg, weekendAvg } — the weekday/weekend split only
   exists for period=day (other periods cannot split it), so the
   other two are null there. */
export function summarizeSeries(series, period, metric) {
  const data = Array.isArray(series) ? series : [];
  const val = (s) => (metric === "amount" ? Number(s.amount || 0) : Number(s.count || 0));
  if (!data.length) return { avg: 0, best: null, weekdayAvg: null, weekendAvg: null };
  const total = data.reduce((n, s) => n + val(s), 0);
  const avg = total / data.length;
  let best = data[0];
  for (const s of data) if (val(s) > val(best)) best = s;
  let weekdayAvg = null;
  let weekendAvg = null;
  if (period === "day") {
    let wdSum = 0;
    let wdN = 0;
    let weSum = 0;
    let weN = 0;
    for (const s of data) {
      const dow = new Date(String(s.date) + "T00:00:00Z").getUTCDay();
      if (dow === 0 || dow === 6) { weSum += val(s); weN += 1; }
      else { wdSum += val(s); wdN += 1; }
    }
    weekdayAvg = wdN ? wdSum / wdN : 0;
    weekendAvg = weN ? weSum / weN : 0;
  }
  return { avg, best: { label: best.label, value: val(best) }, weekdayAvg, weekendAvg };
}
