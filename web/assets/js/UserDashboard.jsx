/* Guiyan user dashboard (React) — port of web/assets/js/user.js +
   web/user.html. Uses only existing customer endpoints (GET /api/orders,
   /api/favorites, /api/demands; POST /api/orders/:id/<action>). Order
   actions follow the same state machine as the SPA's My Tickets drawer.
   Account tabs (2026-11-12): the page is split into tabs instead of one
   long stacked page — info / orders / favs / demands / inbox first
   (password / email / social tabs land with their own steps). */
import { useCallback, useEffect, useRef, useState } from "react";
import { langState, t, fmt, CATS, catName, unitName } from "./data.js";
import {
  apiGet, apiPost, apiPatch, currentUser, getToken, setToken, clearToken,
  restoreUser, fmtMoney, statusKey, demandStatusKey, downloadText,
} from "./apiClient.js";
import { Header, LoginDialog, RegisterDialog, Toast } from "./chrome.jsx";
import AiChat from "./AiChat.jsx";
import SortButton from "./SortButton.jsx";
import { sortRows, cycleDirection } from "./sortUtils.js";
import { useTheme } from "./useTheme.mjs";
import { decideGateOpen, loadAllTabs, loadTabOrders, loadTabFavs, loadTabDemands, loadTabInfo, loadTabInbox } from "./usrTabLoad.mjs";

/* Account tabs (step 1: the five tabs with content; password / email /
   social join in their own steps). Labels reuse existing i18n keys where
   the text matches (usrOrders / usrFavs / usrDemands / inboxTitle). */
const ACCT_TABS = [
  ["info", "tabInfo"],
  ["password", "tabPassword"],
  ["email", "tabEmail"],
  ["phone", "tabPhone"],
  ["social", "tabSocial"],
  ["orders", "usrOrders"],
  ["favs", "usrFavs"],
  ["demands", "usrDemands"],
  ["inbox", "inboxTitle"],
  ["settings", "tabSettings"],
];
const ACCT_TAB_IDS = ACCT_TABS.map(([id]) => id);
/* Orders table: filter tabs in status order + "all" first. */
const ORDER_STATUSES = ["pending", "confirmed", "paid", "completed", "cancelled", "refunded", "refund_requested", "disputed"];
/* R4-1: ticket status -> i18n key (issued/used/void). */
const TICKET_STATUS_KEY = { issued: "ticketIssued", used: "ticketUsed", void: "ticketVoid" };
/* R6-5: inbox message type -> i18n key (messages carry a type since
   this wave; older rows are 'general'). The inbox groups by type. */
const MSG_TYPE_KEY = { general: "msgTypeGeneral", resource_update: "msgTypeResourceUpdate", comment_reply: "msgTypeCommentReply", order_status: "msgTypeOrderStatus" };
const MSG_TYPE_ORDER = ["general", "resource_update", "comment_reply", "order_status"];
/* R4-2: print the order's ticket layout with the browser
   (window.print). The customer print is browser-only — the
   server-side print log (POST /api/admin/tickets/print) is
   admin-only, so no print event is recorded here; paper output is
   the browser print, no physical printer is connected. */
function openTicketPrintWindow(order, tickets, statusLabel) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const w = window.open("", "_blank");
  if (!w) return;
  const rows = (tickets || []).map((tk) => "<tr><td>" + esc(tk.code) + "</td><td>" + esc(statusLabel(tk.status)) + "</td></tr>").join("");
  w.document.write("<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\"><title>桂演纸质票</title><style>body{font-family:\"Noto Sans SC\",sans-serif;color:#1c1710;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left;font-size:14px}@media print{body{padding:0}}</style></head><body><h1>桂演纸质票</h1><p>订单号：" + esc(order.code || order.id) + (order.resource_name ? " · " + esc(order.resource_name) : "") + "</p><table><thead><tr><th>票码</th><th>状态</th></tr></thead><tbody>" + rows + "</tbody></table><p style=\"font-size:12px;color:#5d5344\">纸质票由浏览器打印出票；本系统不连接实体打印机。</p></body></html>");
  w.document.close();
  w.focus();
  w.print();
}
/* R4-1: only these order statuses can hold tickets (issued at pay). */
const TICKET_ORDER_STATUSES = ["paid", "completed", "disputed", "refund_requested"];
const ORDER_SORTS = {
  code: (o) => o.code || "",
  amount: (o) => o.amount || 0,
  booking_date: (o) => o.booking_date || "",
};

function readTabFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get("tab");
    if (v && ACCT_TAB_IDS.includes(v)) return v;
  } catch (e) {}
  return "info";
}

export default function UserDashboard() {
  const [lang, setLangState] = useState(langState.lang);
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerErr, setRegisterErr] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [gate, setGate] = useState(true); /* true = show login gate, false = show main */
  const [usrOrders, setUsrOrders] = useState([]);
  const [usrFavs, setUsrFavs] = useState([]);
  const [usrDemands, setUsrDemands] = useState([]);
  // Wave 3 #11b: own portrait + recommendations (fetched with the rest of
  // the dashboard data; a failure here must not block the whole page, so
  // both calls degrade to null instead of blocking the info tab).
  const [usrProfile, setUsrProfile] = useState(null);
  const [usrRecs, setUsrRecs] = useState([]);
  // R7-6: context filters for the recommendations (time of day / city /
  // companion). Empty = no filter; applied on demand, never on mount.
  const [ctxTime, setCtxTime] = useState("");
  const [ctxCity, setCtxCity] = useState("");
  const [ctxComp, setCtxComp] = useState("");
  // R3-1: own member tier + next-tier progress (same info-tab loader).
  const [usrTier, setUsrTier] = useState(null);
  // R3-4: own gifted coupons (same info-tab loader).
  const [usrGifts, setUsrGifts] = useState(null);
  // R3-6: own stored-value account + plans + ledger (same info-tab
  // loader); top-up is busy-guarded like the other account writes.
  const [usrStored, setUsrStored] = useState(null);
  const [topupBusy, setTopupBusy] = useState(false);
  // R4-1: tickets per order ("我的票", order id -> ticket rows).
  // Fetched after the orders tab loads, only for orders that can
  // hold tickets; a failed fetch leaves the order without a ticket
  // block (same degrade-to-hidden pattern as the 文惠卡 block).
  const [usrTickets, setUsrTickets] = useState({});
  useEffect(() => {
    const ids = usrOrders
      .filter((o) => TICKET_ORDER_STATUSES.includes(o.status))
      .map((o) => o.id);
    if (!ids.length) return;
    let cancelled = false;
    Promise.all(ids.map((id) =>
      apiGet("/api/orders/" + encodeURIComponent(id) + "/tickets")
        .then((d) => [id, d.tickets || []])
        .catch(() => [id, null]),
    )).then((pairs) => {
      if (cancelled) return;
      setUsrTickets((prev) => {
        const next = { ...prev };
        for (const [id, tk] of pairs) if (tk) next[id] = tk;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [usrOrders]);
  // Wave 4 #13: per-order refund/dispute reason typed by the user (sent
  // as {reason} with the refund/dispute call) + the order id currently
  // running an action (buttons disabled meanwhile, demands pattern).
  const [refundReasons, setRefundReasons] = useState({});
  // R4-4: per-order partial-refund quantity picked by the user
  // (1..remaining, default 1); the same reason box serves the
  // partial request. Sent as {quantity} with the refund call.
  const [refundQtys, setRefundQtys] = useState({});
  const [usrActBusyId, setUsrActBusyId] = useState(null);
  const [contractBusyId, setContractBusyId] = useState(null);
  // Wave 4 #14 fix (working-tree defect from #15): openContract() and the
  // modal below use `contract` / `setContract`, but no state for them was
  // ever declared — the dashboard would throw on render. Declared here.
  const [contract, setContract] = useState(null);
  // Wave 4 #14 — inbox (system messages only; #13's decision messages
  // are read out here). Clicking a message marks it read.
  const [usrMessages, setUsrMessages] = useState([]);
  const [usrUnread, setUsrUnread] = useState(0);
  // B-037: per-tab loading/error state — each tab loads its own data and
  // reports its own failure; no tab (and never the gate) waits on another.
  const [tabLoading, setTabLoading] = useState({ orders: false, favs: false, demands: false, info: false, inbox: false });
  const [tabErr, setTabErr] = useState({ orders: false, favs: false, demands: false, info: false, inbox: false });
  // Account tabs: which tab is shown (default "info", or ?tab= when valid).
  const [acctTab, setAcctTab] = useState(readTabFromUrl);
  /* Theme toggle + account settings: same state as the header toggle —
     useTheme() subscribes, so a change in either place re-renders both. */
  const { choice: themeChoice, setTheme } = useTheme();
  // Orders table (Shopee-format, client-side only): status filter, search
  // box, and sort (order number / amount / booking date, admin pattern).
  const [ordFilter, setOrdFilter] = useState("all");
  const [ordQuery, setOrdQuery] = useState("");
  const [ordSort, setOrdSort] = useState(null); // {key, dir} | null
  // Account tabs step 2: avatar display URL + profile edit form state.
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [profForm, setProfForm] = useState({ name: "", city: "", age: "", gender: "" });
  const [profMsg, setProfMsg] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const avatarInputRef = useRef(null);
  // Account tabs step 3: change-password form state.
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");
  // Account tabs step 4: change-email form state.
  const [emailForm, setEmailForm] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  // OTP for contact changes (2026-11-12): the 6-digit code typed by the
  // user + the demo code returned by send-otp (simulated delivery — the
  // code is shown in the UI, labelled 模拟，未真实发送） + the in-flight
  // flag for the send button. Email and phone each keep their own copy.
  const [emailCode, setEmailCode] = useState("");
  const [emailDemo, setEmailDemo] = useState(null);
  const [emailOtpBusy, setEmailOtpBusy] = useState(false);
  // OTP phone tab (2026-11-12): mirrors the email tab exactly.
  const [phoneForm, setPhoneForm] = useState("");
  const [phoneMsg, setPhoneMsg] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneDemo, setPhoneDemo] = useState(null);
  const [phoneOtpBusy, setPhoneOtpBusy] = useState(false);
  // Account tabs step 5: social-links form state. The server stores the
  // links as one JSON string (user.social_links); parse defensively.
  const [socialForm, setSocialForm] = useState({ douyin: "", wechat: "", xiaohongshu: "", maoyan: "" });
  const [socialMsg, setSocialMsg] = useState("");
  function parseSocial(u) {
    try {
      const v = typeof u?.social_links === "string" ? JSON.parse(u.social_links) : u?.social_links;
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  function switchTab(id) {
    if (!ACCT_TAB_IDS.includes(id)) id = "info";
    setAcctTab(id);
    try {
      const u = new URL(location.href);
      u.searchParams.set("tab", id);
      history.replaceState(null, "", u.toString());
    } catch (e) {}
  }

  function changeLang(l) {
    if (l === lang) return;
    langState.lang = l;
    setLangState(l);
    setMenuOpen(false);
    loadAllTabsNow();
  }

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  /* B-037: setters handed to the pure tab loaders (usrTabLoad.mjs). A 401
     from any tab reports an expired session: token cleared, gate back on. */
  const tabSetters = {
    setLoading: (key, v) => setTabLoading((prev) => ({ ...prev, [key]: v })),
    setError: (key, v) => setTabErr((prev) => ({ ...prev, [key]: v })),
    setOrders: setUsrOrders,
    setFavs: setUsrFavs,
    setDemands: setUsrDemands,
    setProfile: setUsrProfile,
    setRecs: setUsrRecs,
    setTier: setUsrTier,
    setGifts: setUsrGifts,
    setStoredValue: setUsrStored,
    setMessages: setUsrMessages,
    setUnread: setUsrUnread,
    currentUser: () => currentUser(),
    onAuthExpired: () => { clearToken(); setUser(null); setGate(true); },
  };

  /* B-037: reload every tab's data. Each tab is guarded on its own, so one
     failing tab never blocks the others — and the gate is never touched
     here: it opens on mount/login as soon as the token + cached user are
     valid, and only a 401 closes it again. */
  function loadAllTabsNow() {
    loadAllTabs(apiGet, tabSetters);
  }

  /* R7-6: re-fetch the recommendations with the chosen context
     (rules only, server-side). A failed fetch leaves the list as-is. */
  function applyCtx() {
    const qs = new URLSearchParams({ limit: "5" });
    if (ctxTime) qs.set("time_of_day", ctxTime);
    if (ctxCity.trim()) qs.set("city", ctxCity.trim());
    if (ctxComp) qs.set("companion", ctxComp);
    apiGet("/api/recommendations?" + qs.toString())
      .then((d) => setUsrRecs((d && d.recommendations) || []))
      .catch(() => {});
  }

  /* R3-6: top up the 文惠卡 with one of the shop's plans, then reload
     the info tab (balance + ledger come back with it). */
  function doTopup(planId) {
    if (topupBusy) return;
    setTopupBusy(true);
    apiPost("/api/account/topup", { plan_id: planId }).then(function () {
      setTopupBusy(false);
      loadTabInfo(apiGet, tabSetters);
    }).catch(function () { setTopupBusy(false); });
  }

  /* R3-6: download the own stored-value ledger as CSV (BOM, same
     columns as the server export); a raw fetch is needed because
     apiFetch parses JSON and would drop the CSV text. */
  function downloadStoredValueCsv() {
    fetch("/api/account/stored-value?format=csv", { headers: { Authorization: "Bearer " + getToken() } })
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.text(); })
      .then(function (txt) { downloadText(txt, "guiyan-stored-value.csv"); })
      .catch(function () {});
  }

  /* Avatar: resolve the stored key to a presigned URL for the header chip +
     the info tab. Any failure falls back to the initial letter. */
  function resolveAvatar(u) {
    if (u && u.avatar) {
      apiGet("/api/storage/url?key=" + encodeURIComponent(u.avatar)).then(function (d) {
        setAvatarUrl(d.url);
      }).catch(function () { setAvatarUrl(null); });
    } else setAvatarUrl(null);
  }

  useEffect(() => {
    restoreUser();
    const u0 = currentUser();
    setUser(u0);
    /* B-037: open the tabs as soon as the stored token + user are valid
       — never wait for a network call. Each tab then loads its own data. */
    if (decideGateOpen(getToken(), u0)) {
      setGate(false);
      loadAllTabsNow();
      resolveAvatar(u0);
    } else {
      setGate(true);
    }
    const onKey = (e) => {
      if (e.key === "Escape") { setMenuOpen(false); setNavOpen(false); setContract(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    const soc = parseSocial(user);
    setSocialForm({ douyin: soc.douyin || "", wechat: soc.wechat || "", xiaohongshu: soc.xiaohongshu || "", maoyan: soc.maoyan || "" });
    setProfForm({
      name: user.name || "",
      city: user.city || "",
      age: user.age == null ? "" : String(user.age),
      gender: user.gender || "",
    });
  }, [user]);

  function doLogin(u, pw) {
    setLoginErr("");
    apiPost("/api/auth/login", { username: u, password: pw }).then(function (d) {
      if (d && d.token) {
        setToken(d.token, d.user || { username: u, name: u });
        setUser(currentUser()); setLoginOpen(false); setGate(false); loadAllTabsNow();
      } else { setLoginErr(t("loginFailed")); }
    }).catch(function (e) {
      if (e && e.status === 401) { setLoginErr(t("loginFailed")); }
      else if (e && e.status === 429) { setLoginErr(t("loginLocked")); }
      else { setLoginErr(t("loadErr")); }
    });
  }
  function doRegister(f) {
    setRegisterErr("");
    apiPost("/api/auth/register", f).then(function (d) {
      if (d && d.token) {
        setToken(d.token, d.user || { username: f.username, name: f.name });
        setUser(currentUser()); setRegisterOpen(false); setGate(false); loadAllTabsNow();
      } else { setRegisterErr(t("registerFailed")); }
    }).catch(function (e) {
      setRegisterErr((e && e.data && e.data.error) || t("registerFailed"));
    });
  }
  function doLogout() {
    const tk = getToken();
    if (tk) apiPost("/api/auth/logout", {}).catch(function () {});
    clearToken(); setUser(null); setMenuOpen(false);
    /* B-037: drop the previous account's tab data so the next login never
       sees stale rows, and show the login gate again. */
    setUsrOrders([]); setUsrFavs([]); setUsrDemands([]);
    setUsrProfile(null); setUsrRecs([]); setUsrMessages([]); setUsrUnread(0);
    setTabLoading({ orders: false, favs: false, demands: false, info: false, inbox: false });
    setTabErr({ orders: false, favs: false, demands: false, info: false, inbox: false });
    setAvatarUrl(null);
    setGate(true);
  }

  function doSaveProfile() {
    setProfMsg("");
    const ageNum = profForm.age.trim() === "" ? null : Number(profForm.age);
    if (ageNum !== null && !Number.isSafeInteger(ageNum)) {
      setProfMsg(t("loadErr"));
      return;
    }
    apiPatch("/api/account/profile", {
      name: profForm.name.trim(),
      city: profForm.city.trim(),
      age: ageNum,
      gender: profForm.gender,
    }).then(function (d) {
      if (d && d.user) { setToken(getToken(), d.user); setUser(d.user); }
      toast(t("admResSaved"));
    }).catch(function (e) {
      setProfMsg((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  /* Avatar upload: downscale on a canvas first (phone photos are several
     MB and the storage limit is 200KB), then POST the JPEG base64. The
     server generates the key — the client never chooses one. */
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const maxDim = 512;
        if (w > maxDim || h > maxDim) {
          const k = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const attempt = (q) => {
          canvas.toBlob((blob) => {
            if (!blob) { reject(new Error("bad image")); return; }
            if (blob.size <= 200000 || q <= 0.5) resolve(blob);
            else attempt(q - 0.2);
          }, "image/jpeg", q);
        };
        attempt(0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  async function doAvatarUpload(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) { setAvatarMsg(t("avatarBadType")); return; }
    setAvatarBusy(true); setAvatarMsg("");
    try {
      const blob = await downscaleImage(file);
      if (blob.size > 200000) { setAvatarMsg(t("avatarTooBig")); setAvatarBusy(false); return; }
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("read"));
        r.readAsDataURL(blob);
      });
      const d = await apiPost("/api/account/avatar", { content_base64: b64, content_type: "image/jpeg" });
      if (d && d.avatarKey) {
        const nu = { ...currentUser(), avatar: d.avatarKey };
        setToken(getToken(), nu); setUser(nu);
        const u2 = await apiGet("/api/storage/url?key=" + encodeURIComponent(d.avatarKey));
        setAvatarUrl(u2.url);
        toast(t("admResSaved"));
      }
    } catch (err) {
      setAvatarMsg((err && err.data && err.data.error) || t("loadErr"));
    }
    setAvatarBusy(false);
  }

  function doChangePassword() {
    setPwMsg("");
    if (pwForm.next !== pwForm.confirm) { setPwMsg(t("pwMismatch")); return; }
    apiPost("/api/auth/change-password", {
      currentPassword: pwForm.current,
      newPassword: pwForm.next,
    }).then(function () {
      setPwForm({ current: "", next: "", confirm: "" });
      toast(t("admResSaved"));
    }).catch(function (e) {
      setPwMsg((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  // OTP for contact changes (2026-11-12): ask the server for a code for
  // the target currently typed in the tab's form. The server returns the
  // demo code (simulated delivery) and the UI shows it in the note below
  // the code input. A server error (bad format, duplicate, cooldown)
  // lands in the tab's message line, like every other save error.
  function doSendOtp(channel) {
    const target = channel === "email" ? emailForm : phoneForm;
    if (channel === "email") { setEmailMsg(""); setEmailOtpBusy(true); }
    else { setPhoneMsg(""); setPhoneOtpBusy(true); }
    apiPost("/api/account/send-otp", { channel, target }).then(function (res) {
      if (channel === "email") {
        setEmailDemo(res && res.code ? String(res.code) : null);
        setEmailOtpBusy(false);
      } else {
        setPhoneDemo(res && res.code ? String(res.code) : null);
        setPhoneOtpBusy(false);
      }
    }).catch(function (e) {
      if (channel === "email") {
        setEmailMsg((e && e.data && e.data.error) || t("loadErr"));
        setEmailOtpBusy(false);
      } else {
        setPhoneMsg((e && e.data && e.data.error) || t("loadErr"));
        setPhoneOtpBusy(false);
      }
    });
  }

  // OTP for contact changes (2026-11-12): save = verify first, then
  // patch. verify-otp always answers 200 with {valid} (a wrong code must
  // increment the server-side attempts counter, and a 400 response would
  // roll the increment back — see server/routes/account.mjs), so an
  // invalid code lands in the tab message and PATCH never runs.
  function doChangeEmail() {
    setEmailMsg("");
    apiPost("/api/account/verify-otp", { channel: "email", target: emailForm, code: emailCode }).then(function (v) {
      if (!v || !v.valid) { setEmailMsg((v && v.error) || t("loadErr")); return; }
      return apiPatch("/api/account/email", { email: emailForm, code: emailCode }).then(function (res) {
        setEmailForm("");
        setEmailCode("");
        setEmailDemo(null);
        if (res && res.user) { setUser(res.user); setToken(getToken(), res.user); }
        toast(t("admResSaved"));
      });
    }).catch(function (e) {
      setEmailMsg((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  function doChangePhone() {
    setPhoneMsg("");
    apiPost("/api/account/verify-otp", { channel: "phone", target: phoneForm, code: phoneCode }).then(function (v) {
      if (!v || !v.valid) { setPhoneMsg((v && v.error) || t("loadErr")); return; }
      return apiPatch("/api/account/phone", { phone: phoneForm, code: phoneCode }).then(function (res) {
        setPhoneForm("");
        setPhoneCode("");
        setPhoneDemo(null);
        if (res && res.user) { setUser(res.user); setToken(getToken(), res.user); }
        toast(t("admResSaved"));
      });
    }).catch(function (e) {
      setPhoneMsg((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  function doSaveSocial() {
    setSocialMsg("");
    apiPatch("/api/account/social", socialForm).then(function (res) {
      if (res && res.social) {
        const nu = { ...user, social_links: JSON.stringify(res.social) };
        setUser(nu); setToken(getToken(), nu);
      }
      toast(t("admResSaved"));
    }).catch(function (e) {
      setSocialMsg((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  function usrOrderAction(act, id, reason, extra) {
    if (usrActBusyId !== null) return;
    setUsrActBusyId(id);
    apiPost("/api/orders/" + encodeURIComponent(id) + "/" + act, { ...(reason ? { reason } : {}), ...(extra || {}) }).then(function () {
      toast(t("statusToast"));
      setUsrActBusyId(null);
      loadTabOrders(apiGet, tabSetters);
    }).catch(function (e) {
      setUsrActBusyId(null);
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      if (e && e.data && e.data.error) toast(e.data.error);
      loadTabOrders(apiGet, tabSetters);
    });
  }

  /* Wave 4 #15 — simulated agreement per order (具体功能 #12, port of
     zhou Transactions.jsx): fetch the server-generated text and show it
     in a modal; the .txt download is named <order-code>-模拟协议.txt. */
  function openContract(o) {
    setContractBusyId(o.id);
    apiGet("/api/orders/" + encodeURIComponent(o.id) + "/contract").then(function (d) {
      setContract({ title: d.title, content: d.content, code: o.code });
      setContractBusyId(null);
    }).catch(function (e) {
      setContractBusyId(null);
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      toast((e && e.data && e.data.error) || t("loadErr"));
    });
  }
  function downloadContract() {
    if (contract) downloadText(contract.content, contract.code + "-模拟协议.txt");
  }

  /* Wave 4 #14 — inbox: mark one message read, or all of them. The list
     and the badge update locally; a 401 re-opens the login gate. */
  function markMessageRead(m) {
    if (m.is_read) return;
    apiPatch("/api/messages/" + encodeURIComponent(m.id) + "/read", {}).then(function () {
      setUsrMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_read: 1 } : x)));
      setUsrUnread((n) => Math.max(0, n - 1));
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      toast(t("loadErr"));
    });
  }
  function markAllMessagesRead() {
    apiPatch("/api/messages/read-all", {}).then(function () {
      setUsrMessages((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
      setUsrUnread(0);
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      toast(t("loadErr"));
    });
  }

  /* Wave 4 #13 — refund/dispute flow. A paid order offers 申请退款
     (refund, with a reason input — the same reason box serves 申诉) and
     申诉 (dispute). refund_requested/disputed orders show the waiting
     status; a refunded order shows the admin's decision. R4-4: a paid
     order with >= 2 tickets left also offers a partial refund — a
     quantity picker (1..remaining) + 申请部分退款; unprinted tickets
     refund automatically, printed ones wait for admin review (the
     note under the picker says so). */
  function usrActs(o) {
    if (o.status === "pending") return (<><button type="button" className="mini" data-act="confirm" data-id={o.id} onClick={() => usrOrderAction("confirm", o.id)}>{t("actConfirm")}</button><button type="button" className="mini" data-act="cancel" data-id={o.id} onClick={() => usrOrderAction("cancel", o.id)}>{t("actCancel")}</button></>);
    if (o.status === "confirmed") return (<><button type="button" className="mini red" data-act="pay" data-id={o.id} onClick={() => usrOrderAction("pay", o.id)}>{fmt(t("actPay"), { amt: fmtMoney(o.amount) })}</button><button type="button" className="mini" data-act="cancel" data-id={o.id} onClick={() => usrOrderAction("cancel", o.id)}>{t("actCancel")}</button></>);
    if (o.status === "paid") {
      const remaining = o.quantity - (o.refund_quantity || 0);
      const picked = Math.min(Math.max(refundQtys[o.id] || 1, 1), Math.max(remaining, 1));
      return (<><button type="button" className="mini red" data-act="complete" data-id={o.id} onClick={() => usrOrderAction("complete", o.id)}>{t("actComplete")}</button><input type="text" maxLength={500} placeholder={t("refundReasonPh")} aria-label={t("refundReasonPh")} style={{ width: 150 }} value={refundReasons[o.id] || ""} onChange={(e) => setRefundReasons((prev) => ({ ...prev, [o.id]: e.target.value }))} /><button type="button" className="mini" data-act="refund" data-id={o.id} disabled={usrActBusyId === o.id} onClick={() => usrOrderAction("refund", o.id, refundReasons[o.id] || "")}>{t("actRefund")}</button><button type="button" className="mini" data-act="dispute" data-id={o.id} disabled={usrActBusyId === o.id} onClick={() => usrOrderAction("dispute", o.id, refundReasons[o.id] || "")}>{t("actDispute")}</button>{remaining >= 2 ? (<><label style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("partialRefundQty")} <input type="number" min={1} max={remaining} value={picked} aria-label={t("partialRefundQty")} style={{ width: 52 }} onChange={(e) => setRefundQtys((prev) => ({ ...prev, [o.id]: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), remaining) }))} /></label><button type="button" className="mini" data-act="partial-refund" data-id={o.id} disabled={usrActBusyId === o.id} onClick={() => usrOrderAction("refund", o.id, refundReasons[o.id] || "", { quantity: picked })}>{t("partialRefundBtn")}</button><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("partialRefundPrintedNote")}</span></>) : null}</>);
    }
    if (o.status === "completed") return (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("doneNote")}</span>);
    if (o.status === "refund_requested") return (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("refundWaiting")}</span>);
    if (o.status === "disputed") return (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("disputeWaiting")}</span>);
    if (o.status === "refunded" && o.refund_decision) return (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{o.refund_decision}</span>);
    return null;
  }

  /* Orders table (Shopee-format, client-side only): filter by status,
     search by code / resource name, sort by code / amount / date. The
     server order (ORDER BY o.id DESC, newest first) is the default. */
  function ordToggleSort(tableId, sortKey) {
    setOrdSort((prev) => {
      if (prev && prev.key === sortKey) return { key: sortKey, dir: cycleDirection(prev.dir) };
      return { key: sortKey, dir: "asc" };
    });
  }
  const ordCounts = {};
  for (const o of usrOrders) ordCounts[o.status] = (ordCounts[o.status] || 0) + 1;
  const ordShown = sortRows(usrOrders.filter((o) => {
    if (ordFilter !== "all" && o.status !== ordFilter) return false;
    if (ordQuery) {
      const q = ordQuery.trim().toLowerCase();
      if (q && !((o.code || "").toLowerCase().includes(q) || (o.resource_name || "").toLowerCase().includes(q))) return false;
    }
    return true;
  }), ordSort ? ORDER_SORTS[ordSort.key] : null, ordSort ? ordSort.dir : null);

  const u = user;
  const prof = u ? [
    ["lblUsername", u.username || ""],
    ["lblId", u.id],
    ["lblChannel", u.channel || "—"],
    ["lblPref", catName(u.preference || "—")],
    ["lblVerified", u.verified ? t("verifiedYes") : t("verifiedNo")],
    ["lblCreated", String(u.created_at || "").slice(0, 10)],
  ] : [];

  return (
    <>
      <Header
        variant="user" user={user ? { ...user, avatarUrl } : null} lang={lang} onLangChange={changeLang}
        cartCount={0} onOpenDrawer={() => {}}
        onLoginClick={() => setLoginOpen(true)} onLogout={doLogout}
        onMenuOrders={() => switchTab("orders")}
        menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} onCloseMenu={() => setMenuOpen(false)}
        navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} onNavLinkClick={() => setNavOpen(false)}
      />

      <main className="db-page">
        <div className="wrap">
          <div className="sec-head">
            <h2><span>{t("usrTitle")}</span><span className="sub">{t("usrSub")}</span></h2>
          </div>

          {gate && (
            <div id="usrGate">
              <div className="db-empty">{t("needLogin")}</div>
              <div style={{ textAlign: "center" }}><button className="btn red" type="button" id="gateLoginBtn" onClick={() => setLoginOpen(true)}>{t("loginBtn")}</button></div>
            </div>
          )}

          {!gate && (
            <div id="usrMain">
              <div className="acct-tabs" role="tablist" id="acctTabs">
                {ACCT_TABS.map(([id, labelKey]) => (
                  <button key={id} type="button" role="tab" aria-selected={acctTab === id}
                    className={"acct-tab" + (acctTab === id ? " on" : "")}
                    onClick={() => switchTab(id)}>
                    {t(labelKey)}
                    {id === "inbox" && usrUnread > 0 && (<span className="pill paid" style={{ marginLeft: 6 }}>{usrUnread}</span>)}
                  </button>
                ))}
              </div>

              {acctTab === "info" && (<>
                <section className="db-sec">
                  <h3>{t("avatarTitle")}</h3>
                  <div className="db-profile">
                    <div className="row" style={{ alignItems: "center" }}>
                      <span className="k">{t("avatarTitle")}</span>
                      <span className="v">
                        <span className="avatar-lg">{avatarUrl ? <img src={avatarUrl} alt="" /> : (u.name || u.username || "?").charAt(0).toUpperCase()}</span>
                      </span>
                      <span>
                        <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doAvatarUpload} />
                        <button type="button" className="mini" disabled={avatarBusy} onClick={() => avatarInputRef.current && avatarInputRef.current.click()}>{t("avatarChange")}</button>
                      </span>
                    </div>
                    <div className="row"><span className="k"></span><span className="v" style={{ fontWeight: 400, color: "var(--ink2)", fontSize: 13 }}>{t("avatarHint")}</span></div>
                    {avatarMsg ? <div className="row"><span className="k"></span><span className="v" style={{ color: "var(--red)" }}>{avatarMsg}</span></div> : null}
                  </div>
                </section>

                <section className="db-sec">
                  <h3>{t("profEditTitle")}</h3>
                  <div className="db-profile">
                    <div className="row"><span className="k">{t("lblName")}</span><span className="v"><input type="text" maxLength={50} value={profForm.name} onChange={(e) => setProfForm((p) => ({ ...p, name: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("lblCity")}</span><span className="v"><input type="text" maxLength={20} value={profForm.city} onChange={(e) => setProfForm((p) => ({ ...p, city: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("lblAge")}</span><span className="v"><input type="number" min={1} max={120} value={profForm.age} onChange={(e) => setProfForm((p) => ({ ...p, age: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("profileGender")}</span><span className="v"><select value={profForm.gender} onChange={(e) => setProfForm((p) => ({ ...p, gender: e.target.value }))}><option value="">{t("genderNone")}</option><option value="男">{t("genderMale")}</option><option value="女">{t("genderFemale")}</option></select></span></div>
                    <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn red" onClick={doSaveProfile}>{t("admResSave")}</button>{profMsg ? <span style={{ color: "var(--red)", marginLeft: 12 }}>{profMsg}</span> : null}</span></div>
                  </div>
                </section>

                <section className="db-sec">
                  <h3>{t("usrProfile")}</h3>
                  <div className="db-profile" id="profileRows">
                    {prof.map(([k, v]) => (
                      <div key={k} className="row"><span className="k">{t(k)}</span><span className="v">{String(v)}</span></div>
                    ))}
                  </div>
                </section>

                <div className="db-stats">
                  <div className="db-stat"><b id="myStatOrders">{usrOrders.length}</b><span>{t("usrOrders")}</span></div>
                  <div className="db-stat"><b id="myStatFavs">{usrFavs.length}</b><span>{t("usrFavs")}</span></div>
                  <div className="db-stat"><b id="myStatDemands">{usrDemands.length}</b><span>{t("usrDemands")}</span></div>
                </div>

                {tabLoading.info ? <div className="db-empty">{t("tabLoading")}</div>
                : tabErr.info ? (<><div className="db-empty">{t("tabLoadErr")}</div><div style={{ textAlign: "center" }}><button type="button" className="btn ghost" onClick={() => loadTabInfo(apiGet, tabSetters)}>{t("retryBtn")}</button></div></>)
                : null}

                {usrTier ? (
                  <section className="db-sec">
                    <h3>{t("memberTierTitle")}</h3>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("memberTierCurrent")}</span><span className="v">{usrTier.tier ? usrTier.tier.name : "—"}{usrTier.discount_pct ? " · " + fmt(t("memberTierDiscount"), { p: usrTier.discount_pct }) : ""}</span></div>
                      {usrTier.next_tier ? (
                        <div className="row"><span className="k">{t("memberTierNext")}</span><span className="v">{usrTier.next_tier.name} · {fmt(t("memberTierSpendMore"), { a: usrTier.remaining_cents / 100 })}</span></div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {usrGifts ? (
                  <section className="db-sec">
                    <h3>{t("giftCouponTitle")}</h3>
                    <div className="db-profile">
                      {usrGifts.length ? usrGifts.map((g) => (
                        <div className="row" key={g.id}><span className="k">{g.coupon_code}</span><span className="v">{g.kind === "fixed" ? "−¥" + ((g.value_cents || 0) / 100) : "−" + (g.discount_pct || 0) + "%"}{g.status === "redeemed" ? " · " + t("giftCouponUsed") : ""}</span></div>
                      )) : <div className="row"><span className="v">{t("giftCouponEmpty")}</span></div>}
                    </div>
                  </section>
                ) : null}

                {usrStored ? (
                  <section className="db-sec">
                    <h3>{t("storedValueTitle")}</h3>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("storedValueBalance")}</span><span className="v">{fmtMoney(usrStored.account ? usrStored.account.balance_cents : 0)}</span></div>
                      {(usrStored.plans || []).map((pl) => (
                        <div className="row" key={pl.id}><span className="k">{fmt(t("storedValuePlan"), { a: pl.amount_cents / 100, b: pl.bonus_cents / 100 })}</span><span className="v"><button type="button" className="btn ghost" disabled={topupBusy} onClick={() => doTopup(pl.id)}>{t("storedValueTopup")}</button></span></div>
                      ))}
                      {(usrStored.ledger || []).length ? usrStored.ledger.slice(0, 5).map((l) => (
                        <div className="row" key={l.id}><span className="k">{l.kind_label}</span><span className="v">{l.amount_cents >= 0 ? "+¥" + (l.amount_cents / 100) : "−¥" + (Math.abs(l.amount_cents) / 100)}{l.order_code ? " · " + l.order_code : ""}</span></div>
                      )) : <div className="row"><span className="v">{t("storedValueEmpty")}</span></div>}
                      <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn ghost" onClick={downloadStoredValueCsv}>CSV</button></span></div>
                    </div>
                  </section>
                ) : null}

                {usrProfile && usrProfile.portrait ? (
                  <section className="db-sec">
                    <h3>{t("profileTitle")}</h3>
                    {/* 5 grouped blocks, verbatim 甲方 group titles. TBD
                        placeholders (暂无 / 暂无数据 / 尚未接入) are shown
                        literally, never hidden — see profiles.mjs. */}
                    <h4 className="db-group">{t("profileBasic")}</h4>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("profileAge")}</span><span className="v">{usrProfile.portrait.basic.age == null ? "—" : usrProfile.portrait.basic.age}</span></div>
                      <div className="row"><span className="k">{t("profileGender")}</span><span className="v">{usrProfile.portrait.basic.gender}</span></div>
                      <div className="row"><span className="k">{t("profileRegion")}</span><span className="v">{usrProfile.portrait.basic.region}（{t("profileRegionNote")}）</span></div>
                      <div className="row"><span className="k">{t("profileActiveCity")}</span><span className="v">{usrProfile.portrait.basic.activeCity}</span></div>
                    </div>
                    <h4 className="db-group">{t("profileSpending")}</h4>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("profilePricePref")}</span><span className="v">{fmtMoney(usrProfile.portrait.spending.pricePreference)}</span></div>
                      <div className="row"><span className="k">{t("profilePriceBand")}</span><span className="v">{usrProfile.portrait.spending.priceBand}{usrProfile.portrait.spending.priceDistribution.length ? "（" + usrProfile.portrait.spending.priceDistribution.map(function (d) { return d.name + " ×" + d.count; }).join("、") + "）" : ""}</span></div>
                      <div className="row"><span className="k">{t("profileFrequency")}</span><span className="v">{fmt(t("profileFrequencyValue"), { paid: usrProfile.portrait.spending.frequency.paidCount, total: usrProfile.portrait.spending.frequency.orderCount })}</span></div>
                      <div className="row"><span className="k">{t("profileStoredValue")}</span><span className="v">{usrProfile.portrait.spending.storedValue}</span></div>
                    </div>
                    <h4 className="db-group">{t("profileShowPref")}</h4>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("profileGenre")}</span><span className="v">{usrProfile.portrait.showPref.genre}</span></div>
                      <div className="row"><span className="k">{t("profileArtist")}</span><span className="v">{usrProfile.portrait.showPref.artist}</span></div>
                      <div className="row"><span className="k">{t("profileVenue")}</span><span className="v">{usrProfile.portrait.showPref.venue}</span></div>
                      <div className="row"><span className="k">{t("profileShowType")}</span><span className="v">{catName(usrProfile.portrait.showPref.showType)}</span></div>
                    </div>
                    <h4 className="db-group">{t("profileBehavior")}</h4>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("profileTimeSlot")}</span><span className="v">{usrProfile.portrait.behavior.purchaseWindow}（{t("profileTimeNote")}）</span></div>
                      <div className="row"><span className="k">{t("profilePayment")}</span><span className="v">{usrProfile.portrait.behavior.payment}</span></div>
                      <div className="row"><span className="k">{t("profileSharing")}</span><span className="v">{usrProfile.portrait.behavior.sharing}</span></div>
                      <div className="row"><span className="k">{t("profileRepeat")}</span><span className="v">{usrProfile.portrait.behavior.repeat}</span></div>
                    </div>
                    <h4 className="db-group">{t("profileChannel")}</h4>
                    <div className="db-profile">
                      <div className="row"><span className="k">{t("profileSource")}</span><span className="v">{usrProfile.portrait.channel.source}</span></div>
                      <div className="row"><span className="k">{t("profileSuggestion")}</span><span className="v">{usrProfile.suggestion}</span></div>
                    </div>
                  </section>
                ) : null}

                {usrRecs.length ? (
                  <section className="db-sec">
                    <h3>{t("recTitle")}</h3>
                    {/* R7-6: context filters (time / city / companion). */}
                    <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13 }}>{t("ctxTitle")}</span>
                      <label style={{ fontSize: 13 }}>{t("ctxTime")}
                        <select value={ctxTime} onChange={(e) => setCtxTime(e.target.value)} style={{ marginLeft: 4 }}>
                          <option value="">{t("ctxAny")}</option>
                          <option value="morning">{t("ctxMorning")}</option>
                          <option value="afternoon">{t("ctxAfternoon")}</option>
                          <option value="evening">{t("ctxEvening")}</option>
                          <option value="night">{t("ctxNight")}</option>
                        </select>
                      </label>
                      <label style={{ fontSize: 13 }}>{t("ctxCity")}
                        <input value={ctxCity} onChange={(e) => setCtxCity(e.target.value)} placeholder={t("ctxCityPh")} style={{ marginLeft: 4, width: 110 }} />
                      </label>
                      <label style={{ fontSize: 13 }}>{t("ctxCompanion")}
                        <select value={ctxComp} onChange={(e) => setCtxComp(e.target.value)} style={{ marginLeft: 4 }}>
                          <option value="">{t("ctxAny")}</option>
                          <option value="alone">{t("ctxAlone")}</option>
                          <option value="couple">{t("ctxCouple")}</option>
                          <option value="family">{t("ctxFamily")}</option>
                          <option value="friends">{t("ctxFriends")}</option>
                        </select>
                      </label>
                      <button type="button" className="btn" onClick={applyCtx}>{t("ctxApply")}</button>
                    </div>
                    <div className="db-list" id="recsList">
                      {usrRecs.map((r) => (
                        <div key={r.resourceId} className="order">
                          <h4><a href={"index.html?detail=" + r.resourceId}>{r.resource ? r.resource.name : ""}</a></h4>
                          <span className="code">{r.resource ? r.resource.city + " · " + fmtMoney(r.resource.price) + "/" + unitName(r.resource.unit || "") : ""}</span>
                          <div className="row"><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{r.reason}</span><span className="code">{fmt(t("recScore"), { n: r.score })}</span></div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>)}

              {acctTab === "password" && (
                <section className="db-sec">
                  <h3>{t("tabPassword")}</h3>
                  <div className="db-profile">
                    <div className="row"><span className="k">{t("pwCurrent")}</span><span className="v"><input type="password" autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm((p) => ({ ...p, current: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("pwNew")}</span><span className="v"><input type="password" autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm((p) => ({ ...p, next: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("pwConfirm")}</span><span className="v"><input type="password" autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm((p) => ({ ...p, confirm: e.target.value }))} /></span></div>
                    <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn red" onClick={doChangePassword}>{t("admResSave")}</button>{pwMsg ? <span style={{ color: "var(--red)", marginLeft: 12 }}>{pwMsg}</span> : null}</span></div>
                  </div>
                </section>
              )}

              {acctTab === "email" && (
                <section className="db-sec">
                  <h3>{t("tabEmail")}</h3>
                  <div className="db-profile">
                    <div className="row"><span className="k">{t("emailCurrent")}</span><span className="v">{user.email || t("emailNone")}</span></div>
                    <div className="row"><span className="k">{t("emailNew")}</span><span className="v"><input type="email" value={emailForm} placeholder={user.email || "example@mail.com"} onChange={(e) => setEmailForm(e.target.value)} /></span></div>
                    <div className="row"><span className="k">{t("otpCode")}</span><span className="v"><input type="text" inputMode="numeric" maxLength={6} value={emailCode} placeholder={t("otpCodePh")} onChange={(e) => setEmailCode(e.target.value)} /> <button type="button" className="btn" disabled={emailOtpBusy} onClick={() => doSendOtp("email")}>{t("otpSend")}</button></span></div>
                    {emailDemo ? <div className="row"><span className="k"></span><span className="v"><span className="acct-note">{fmt(t("otpDemoNote"), { code: emailDemo })}</span></span></div> : null}
                    <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn red" onClick={doChangeEmail}>{t("admResSave")}</button>{emailMsg ? <span style={{ color: "var(--red)", marginLeft: 12 }}>{emailMsg}</span> : null}</span></div>
                  </div>
                </section>
              )}

              {acctTab === "phone" && (
                <section className="db-sec">
                  <h3>{t("tabPhone")}</h3>
                  <div className="db-profile">
                    <div className="row"><span className="k">{t("phoneCurrent")}</span><span className="v">{user.phone || t("phoneNone")}</span></div>
                    <div className="row"><span className="k">{t("phoneNew")}</span><span className="v"><input type="tel" value={phoneForm} placeholder="+84 912 345 678" onChange={(e) => setPhoneForm(e.target.value)} /></span></div>
                    <div className="row"><span className="k">{t("otpCode")}</span><span className="v"><input type="text" inputMode="numeric" maxLength={6} value={phoneCode} placeholder={t("otpCodePh")} onChange={(e) => setPhoneCode(e.target.value)} /> <button type="button" className="btn" disabled={phoneOtpBusy} onClick={() => doSendOtp("phone")}>{t("otpSend")}</button></span></div>
                    {phoneDemo ? <div className="row"><span className="k"></span><span className="v"><span className="acct-note">{fmt(t("otpDemoNote"), { code: phoneDemo })}</span></span></div> : null}
                    <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn red" onClick={doChangePhone}>{t("admResSave")}</button>{phoneMsg ? <span style={{ color: "var(--red)", marginLeft: 12 }}>{phoneMsg}</span> : null}</span></div>
                  </div>
                </section>
              )}

              {acctTab === "social" && (
                <section className="db-sec">
                  <h3>{t("tabSocial")}</h3>
                  <p className="acct-note">{t("socialNote")}</p>
                  <div className="db-profile">
                    <div className="row"><span className="k">{t("socDouyin")}</span><span className="v"><input type="text" maxLength={100} value={socialForm.douyin} placeholder={t("socDouyin")} onChange={(e) => setSocialForm((f) => ({ ...f, douyin: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("socWechat")}</span><span className="v"><input type="text" maxLength={100} value={socialForm.wechat} placeholder={t("socWechat")} onChange={(e) => setSocialForm((f) => ({ ...f, wechat: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("socXiaohongshu")}</span><span className="v"><input type="text" maxLength={100} value={socialForm.xiaohongshu} placeholder={t("socXiaohongshu")} onChange={(e) => setSocialForm((f) => ({ ...f, xiaohongshu: e.target.value }))} /></span></div>
                    <div className="row"><span className="k">{t("socMaoyan")}</span><span className="v"><input type="text" maxLength={100} value={socialForm.maoyan} placeholder={t("socMaoyan")} onChange={(e) => setSocialForm((f) => ({ ...f, maoyan: e.target.value }))} /></span></div>
                    <div className="row"><span className="k"></span><span className="v"><button type="button" className="btn red" onClick={doSaveSocial}>{t("admResSave")}</button>{socialMsg ? <span style={{ color: "var(--red)", marginLeft: 12 }}>{socialMsg}</span> : null}</span></div>
                    {Object.entries(parseSocial(user)).map(function ([key, val]) {
                      const label = key === "douyin" ? t("socDouyin") : key === "wechat" ? t("socWechat") : key === "xiaohongshu" ? t("socXiaohongshu") : t("socMaoyan");
                      const isUrl = typeof val === "string" && val.startsWith("https://");
                      return (
                        <div className="row" key={key}><span className="k">{label}</span><span className="v">{isUrl ? <a href={val} target="_blank" rel="noreferrer">{val}</a> : val}</span></div>
                      );
                    })}
                  </div>
                </section>
              )}

              {acctTab === "orders" && (
                <section className="db-sec">
                  <h3>{t("usrOrders")}</h3>
                  <div className="filters" id="ordFilters">
                    <button key="all" type="button" className={"chip" + (ordFilter === "all" ? " on" : "")} onClick={() => setOrdFilter("all")}>{t("allChip")} ({usrOrders.length})</button>
                    {ORDER_STATUSES.map((s) => (
                      <button key={s} type="button" className={"chip" + (ordFilter === s ? " on" : "")} onClick={() => setOrdFilter(s)}>{t(statusKey(s))} ({ordCounts[s] || 0})</button>
                    ))}
                  </div>
                  <div className="filters" style={{ marginTop: 10 }}>
                    <input className="q" type="search" value={ordQuery} onChange={(e) => setOrdQuery(e.target.value)} placeholder={t("ordSearchPh")} aria-label={t("ordSearchPh")} />
                  </div>
                  <div className="db-scroll">
                    <table className="db-table" id="ordersTable">
                      <thead><tr>
                        <th>{t("colResource")}</th>
                        <th>{t("ordColCode")} <SortButton label={t("ordColCode")} sortKey="code" tableId="orders" sort={ordSort} onToggle={ordToggleSort} /></th>
                        <th>{t("ordColDate")} <SortButton label={t("ordColDate")} sortKey="booking_date" tableId="orders" sort={ordSort} onToggle={ordToggleSort} /></th>
                        <th>{t("ordColQty")}</th>
                        <th className="num">{t("ordColAmount")} <SortButton label={t("ordColAmount")} sortKey="amount" tableId="orders" sort={ordSort} onToggle={ordToggleSort} /></th>
                        <th>{t("colStatus")}</th>
                        <th>{t("ordColActions")}</th>
                      </tr></thead>
                      <tbody id="ordersBody">
                        {tabLoading.orders ? <tr><td colSpan="7"><div className="db-empty">{t("tabLoading")}</div></td></tr>
                        : tabErr.orders ? <tr><td colSpan="7"><div className="db-empty">{t("tabLoadErr")}</div><div style={{ textAlign: "center" }}><button type="button" className="btn ghost" onClick={() => loadTabOrders(apiGet, tabSetters)}>{t("retryBtn")}</button></div></td></tr>
                        : ordShown.length ? ordShown.map((o) => (
                          <>
                            <tr key={o.id}>
                              <td>
                                <span className="ord-res">
                                  {o.image ? <img src={o.image} alt="" className="ord-thumb" /> : null}
                                  <span>{o.resource_name || ""}<small>{(o.city || "") + " · " + catName(o.category || "")}</small></span>
                                </span>
                              </td>
                              <td><span className="code">{o.code}</span></td>
                              <td>{o.booking_date || ""}</td>
                              <td>{o.quantity} × {unitName(o.unit || "")}</td>
                              <td className="num">{fmtMoney(o.amount)}</td>
                              <td><span className={"pill " + o.status}>{t(statusKey(o.status))}</span></td>
                              <td><span className="db-actions">{usrActs(o)}<button type="button" className="mini" disabled={contractBusyId === o.id} onClick={() => openContract(o)}>{t("contractBtn")}</button></span></td>
                            </tr>
                            {/* R4-1: the order's tickets ("我的票") —
                                codes + status; hidden when the fetch
                                failed or the order holds no tickets.
                                R4-4: the 自助取票 note — the code
                                itself IS the e-ticket (scan it at the
                                gate); no physical kiosk is connected. */}
                            {usrTickets[o.id] && usrTickets[o.id].length ? (
                              <tr key={o.id + "-tickets"}>
                                <td colSpan="7"><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("ticketTitle")}：{usrTickets[o.id].map((tk) => tk.code + "（" + t(TICKET_STATUS_KEY[tk.status] || "ticketIssued") + "）").join("、")}</span>{" "}<button type="button" className="mini" onClick={() => openTicketPrintWindow(o, usrTickets[o.id], (st) => t(TICKET_STATUS_KEY[st] || "ticketIssued"))}>{t("printTicket")}</button><br /><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("pickupNote")}</span></td>
                              </tr>
                            ) : null}
                            {/* R4-4: what a partial refund already
                                returned on this order (tickets +
                                money), shown while the order still
                                carries refund history. */}
                            {(o.refund_quantity || 0) > 0 ? (
                              <tr key={o.id + "-refunded"}>
                                <td colSpan="7"><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{fmt(t("partialRefundDone"), { n: o.refund_quantity, a: (o.refunded_cents || 0) / 100 })}</span></td>
                              </tr>
                            ) : null}
                            {/* Wave 4 #13: the reason already sent, while the
                                after-sales case is waiting for an admin decision. */}
                            {(o.status === "refund_requested" || o.status === "disputed") && o.refund_reason ? (
                              <tr key={o.id + "-reason"}>
                                <td colSpan="7"><span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("refundReasonLbl")}：{o.refund_reason}</span></td>
                              </tr>
                            ) : null}
                          </>
                        )) : <tr><td colSpan="7"><div className="db-empty" dangerouslySetInnerHTML={{ __html: t("emptyOrders") }}></div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {acctTab === "inbox" && (
                <section className="db-sec">
                  <h3>{t("inboxTitle")}</h3>
                  <div className="db-list" id="inboxList">
                    {tabLoading.inbox ? <div className="db-empty">{t("tabLoading")}</div>
                    : tabErr.inbox ? (<><div className="db-empty">{t("tabLoadErr")}</div><div style={{ textAlign: "center" }}><button type="button" className="btn ghost" onClick={() => loadTabInbox(apiGet, tabSetters)}>{t("retryBtn")}</button></div></>)
                    : usrMessages.length ? (function () {
                      /* R6-5: group the inbox by message type, in a
                         fixed order; an unknown type falls back to the
                         general group. */
                      const groups = {};
                      usrMessages.forEach(function (m) {
                        const k = MSG_TYPE_KEY[m.type] ? m.type : "general";
                        (groups[k] = groups[k] || []).push(m);
                      });
                      return MSG_TYPE_ORDER.filter(function (k) { return groups[k]; }).map(function (k) { return (
                        <div key={k}>
                          <h4 style={{ margin: "10px 0 4px", fontSize: 13, color: "var(--ink2)" }}>{t(MSG_TYPE_KEY[k])}</h4>
                          {groups[k].map((m) => (
                            <div key={m.id} className="order" role="button" tabIndex={0} onClick={() => markMessageRead(m)} onKeyDown={(e) => { if (e.key === "Enter") markMessageRead(m); }}>
                              <h4>{!m.is_read && (<span aria-label="unread" style={{ color: "var(--red)" }}>● </span>)}{m.title}</h4>
                              <span className="code">{String(m.created_at || "").slice(0, 16)}</span>
                              <div className="row"><span style={{ fontSize: 13 }}>{m.content}</span></div>
                            </div>
                          ))}
                        </div>
                      ); });
                    })() : <div className="db-empty">{t("inboxEmpty")}</div>}
                  </div>
                  {usrUnread > 0 && (<div style={{ marginTop: 10 }}><button type="button" className="mini" onClick={markAllMessagesRead}>{t("inboxMarkAll")}</button></div>)}
                </section>
              )}

              {acctTab === "favs" && (
                <section className="db-sec">
                  <h3>{t("usrFavs")}</h3>
                  <div className="db-scroll">
                    <table className="db-table">
                      <thead><tr><th>{t("colName")}</th><th>{t("colResource")}</th><th>{t("colCity")}</th><th className="num">{t("colPrice")}</th><th></th></tr></thead>
                      <tbody id="favsBody">
                        {tabLoading.favs ? <tr><td colSpan="5"><div className="db-empty">{t("tabLoading")}</div></td></tr>
                        : tabErr.favs ? <tr><td colSpan="5"><div className="db-empty">{t("tabLoadErr")}</div><div style={{ textAlign: "center" }}><button type="button" className="btn ghost" onClick={() => loadTabFavs(apiGet, tabSetters)}>{t("retryBtn")}</button></div></td></tr>
                        : usrFavs.length ? usrFavs.map((r) => (
                          <tr key={r.id}>
                            <td>{r.name}</td><td>{catName(r.category)}</td><td>{r.city}</td>
                            <td className="num">{fmtMoney(r.price)}</td>
                            <td><a href="index.html#catalog">{t("goCatalog")}</a></td>
                          </tr>
                        )) : <tr><td colSpan="5"><div className="db-empty">{t("emptyFavs")}</div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {acctTab === "demands" && (
                <section className="db-sec">
                  <h3>{t("usrDemands")}</h3>
                  <div className="db-scroll">
                    <table className="db-table">
                      <thead><tr><th>{t("colTitle")}</th><th>{t("colResource")}</th><th className="num">{t("colBudget")}</th><th>{t("colCity")}</th><th>{t("colStatus")}</th></tr></thead>
                      <tbody id="demsBody">
                        {tabLoading.demands ? <tr><td colSpan="6"><div className="db-empty">{t("tabLoading")}</div></td></tr>
                        : tabErr.demands ? <tr><td colSpan="6"><div className="db-empty">{t("tabLoadErr")}</div><div style={{ textAlign: "center" }}><button type="button" className="btn ghost" onClick={() => loadTabDemands(apiGet, tabSetters)}>{t("retryBtn")}</button></div></td></tr>
                        : usrDemands.length ? usrDemands.map((d) => (
                          <tr key={d.id}>
                            <td>{d.title}</td><td>{catName(d.category)}</td>
                            <td className="num">{fmtMoney(d.budget)}</td><td>{d.city}</td><td>{t(demandStatusKey(d.status))}</td>
                          </tr>
                        )) : <tr><td colSpan="5"><div className="db-empty">{t("emptyMyDemands")}</div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Settings tab: appearance (theme) + language, then grouped
                 links to the existing account sections — profile, security,
                 social. No new features: only the existing sections plus
                 the new appearance section, arranged like a standard
                 marketplace account page. Client-side only, no loader. */}
              {acctTab === "settings" && (<>
                <section className="db-sec">
                  <h3>{t("setAppearance")}</h3>
                  <div className="db-profile">
                    <div className="row">
                      <span className="k">{t("setTheme")}</span>
                      <span className="v">
                        <span className="theme-seg" role="group" aria-label={t("setTheme")}>
                          {[["light", "themeLight"], ["dark", "themeDark"], ["system", "themeSystem"]].map(([v, key]) => (
                            <button key={v} type="button" aria-pressed={themeChoice === v}
                              className={themeChoice === v ? "on" : ""} onClick={() => setTheme(v)}>
                              {t(key)}
                            </button>
                          ))}
                        </span>
                        <div className="set-note">{t("themeNote")}</div>
                      </span>
                    </div>
                    <div className="row">
                      <span className="k">{t("setLanguage")}</span>
                      <span className="v">
                        <select value={lang} onChange={(e) => changeLang(e.target.value)} aria-label={t("setLanguage")}>
                          <option value="zh">中文</option>
                          <option value="vi">Tiếng Việt</option>
                          <option value="en">English</option>
                        </select>
                      </span>
                    </div>
                  </div>
                </section>

                <section className="db-sec">
                  <h3>{t("setProfile")}</h3>
                  <div className="db-profile">
                    <button type="button" className="set-link" onClick={() => switchTab("info")}>
                      <span>{t("tabInfo")}</span><span className="chev">›</span>
                    </button>
                  </div>
                </section>

                <section className="db-sec">
                  <h3>{t("setSecurity")}</h3>
                  <div className="db-profile">
                    <button type="button" className="set-link" onClick={() => switchTab("password")}>
                      <span>{t("tabPassword")}</span><span className="chev">›</span>
                    </button>
                    <button type="button" className="set-link" onClick={() => switchTab("email")}>
                      <span>{t("tabEmail")}</span><span className="chev">›</span>
                    </button>
                    <button type="button" className="set-link" onClick={() => switchTab("phone")}>
                      <span>{t("tabPhone")}</span><span className="chev">›</span>
                    </button>
                  </div>
                </section>

                <section className="db-sec">
                  <h3>{t("setSocial")}</h3>
                  <div className="db-profile">
                    <button type="button" className="set-link" onClick={() => switchTab("social")}>
                      <span>{t("tabSocial")}</span><span className="chev">›</span>
                    </button>
                  </div>
                </section>
              </>)}
            </div>
          )}
        </div>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <span className="zh">桂演 · Guiyan</span>
              <p style={{ margin: "10px 0 0", maxWidth: 420 }}>{t("footBlurb")}</p>
            </div>
            <div>
              <h5>{t("footExplore")}</h5>
              <ul>
                <li><a href="index.html#catalog">{t("navCatalog")}</a></li>
                <li><a href="index.html#demands">{t("navDemands")}</a></li>
                <li><a href="index.html#ai">{t("navAssistant")}</a></li>
                <li><button type="button" className="linklike" onClick={() => { location.href = "user.html"; }}>{t("myTickets")}</button></li>
              </ul>
            </div>
            <div>
              <h5>{t("footCats")}</h5>
              <ul id="footCats">
                {CATS.map((c) => (
                  <li key={c[0]}><a href="index.html#catalog">{catName(c[0])}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h5>{t("footHelp")}</h5>
              <ul>
                <li><button type="button" className="linklike" onClick={() => { location.href = "index.html#ai"; }}>{t("helpRefund")}</button></li>
                <li><button type="button" className="linklike" onClick={() => { location.href = "index.html#ai"; }}>{t("helpBook")}</button></li>
                <li><button type="button" className="linklike" onClick={() => { location.href = "index.html#ai"; }}>{t("helpResched")}</button></li>
              </ul>
            </div>
          </div>
          <div className="foot-note">
            <span>© 2026 桂演 Guiyan</span>
            <span>{t("footPrice")}</span>
            <a href="https://github.com/lam01244410430/guiyan-platform.git" target="_blank" rel="noopener">GitHub · lam01244410430/guiyan-platform</a>
          </div>
        </div>
      </footer>

      <LoginDialog open={loginOpen} err={loginErr} onClose={() => setLoginOpen(false)} onLogin={doLogin}
        onRegisterClick={() => { setLoginOpen(false); setRegisterErr(""); setRegisterOpen(true); }} />
      {/* Wave 4 #15: simulated agreement modal (具体功能 #12). */}
      {contract && (
        <div className="overlay open" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setContract(null); }}>
          <div className="sheet">
            <div className="in">
              <h3>{contract.title}</h3>
              <pre className="contract-text">{contract.content}</pre>
              <div className="acts">
                <button type="button" className="btn red" onClick={downloadContract}>{t("contractDownload")}</button>
                <button type="button" className="btn ghost" aria-label="Close" onClick={() => setContract(null)}>✕</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <RegisterDialog open={registerOpen} err={registerErr} onClose={() => setRegisterOpen(false)} onRegister={doRegister}
        onLoginClick={() => { setRegisterOpen(false); setLoginOpen(true); }} />
      <AiChat lang={lang} />
      <Toast msg={toastMsg} />
    </>
  );
}
