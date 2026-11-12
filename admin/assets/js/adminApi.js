/* Guiyan admin API client (React) — ESM port of admin/assets/js/api.js.
   Self-contained, no shared customer frontend. Same-origin by default
   (override via ?api=<origin>); API paths include the /api prefix (as in
   miniprogram/utils/api.js); token in sessionStorage under admin-only keys
   ("guiyan-admin-token" / "guiyan-admin-user"); 5s timeout; all money is
   INTEGER CENTS on the wire. */
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
  if (ctrl) { timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000); }
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
export function apiGet(path) { return apiFetch(path, { method: "GET" }); }
export function apiPost(path, body) { return apiFetch(path, { method: "POST", body }); }
export function apiPatch(path, body) { return apiFetch(path, { method: "PATCH", body }); }
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
