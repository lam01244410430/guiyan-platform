/* Guiyan customer SPA (React) — ESM/JSX port of web/assets/js/app.js.
   Same behaviour, same data: the mutable `state` object from data.js is
   kept as the single store (exactly like the classic script) and a tick
   state forces a re-render after every mutation that used to call a
   render*() function. API contract, booking state machine, favorites
   login gate and offline local fallback are unchanged. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  langState, t, fmt, money, CATS, RES, DEMANDS, CATIMG, CITYN,
  catName, catZh, catBoth, cityName, unitName, li, state as store,
} from "./data.js";
import {
  APIRES, APIID2IDX, APIDEMANDS, apiGet, apiPost, currentUser, getToken, setToken,
  clearToken, restoreUser, isApiAvailable, mergeCategories, mergeResources,
  mergeDemands, mapApiOrder, STATUS,
} from "./apiClient.js";
import { Header, LoginDialog, RegisterDialog, Toast } from "./chrome.jsx";
import { matchesSearch } from "./search.js";
import AiChat from "./AiChat.jsx";
import heroImg from "../img/hero.webp";
import spotlightImg from "../img/spotlight.webp";

function desc(r, lang) { return lang === "zh" ? r[6][1] : lang === "en" ? r[6][2] : r[6][0]; }
function catCount(id) { return RES.filter(function (r) { return r[1] === id; }).length; }

/* Wave 4 #15 — meta label map, port of zhou Resources.jsx:515-544,
   adjusted to Lam's real meta keys (plan §4.3b). Only keys in this map
   are rendered: seatRows/seatCols (seat-map #12), schedule (availability
   #12) and preview (boolean flag) are excluded by omission, as is any
   key with no label here. Labels are i18n keys; values come from the API
   meta via APIRES (shared #12 change). */
const META_LABELS = {
  duration: "metaDuration", team: "metaTeam", genre: "metaGenre",
  experience: "metaExperience", agency: "metaAgency", process: "metaProcess",
  address: "metaAddress", facilities: "metaFacilities", model: "metaModel",
  deposit: "metaDeposit", usage: "metaUsage", scope: "metaScope",
  term: "metaTerm", territory: "metaTerritory", rights: "metaRights",
  certificate: "metaCertificate", specification: "metaSpecification",
  shipping: "metaShipping", delivery: "metaShipping", playback: "metaPlayback",
  includes: "metaIncludes", partner: "metaPartner", kind: "metaKind",
  channels: "metaChannels", serviceNote: "metaServiceNote",
  /* R6-2 library: daily rent (equipment), appearance fee + role
     (talent). Rendered only when the API meta actually carries them. */
  daily_rent_cents: "dailyRent", talent_fee_cents: "talentFee",
  role: "talentRole",
};
function metaValue(key, v) {
  /* deposit is stored in cents on the server; the UI shows yuan (label
     already carries the 模拟 marker). Arrays render as a short list. */
  if (key === "deposit") return money((typeof v === "number" ? v : 0) / 100);
  /* R6-2: the library money fields are cents too — daily rent and
     appearance fee show in yuan. The role value is stored in Chinese;
     render it through the i18n role keys so vi/en see their own word. */
  if (key === "daily_rent_cents" || key === "talent_fee_cents")
    return money((typeof v === "number" ? v : 0) / 100);
  if (key === "role") {
    if (v === "演员") return t("roleActor");
    if (v === "导演") return t("roleDirector");
    if (v === "编剧") return t("roleWriter");
    return String(v);
  }
  if (Array.isArray(v)) return v.join("、");
  return String(v);
}

/* R6-2 — venue free-day calendar (read-only): one month grid for the
   venue linked to the open venue resource. Days with a performance
   are marked occupied (red chip + show titles); the other days are
   free. Month navigation re-fetches
   GET /api/venues/available?venue_id=&month=. Weekday/month names
   come from Intl in the current language, so no extra i18n keys are
   needed. Navigation stops at the demo-baseline month 2026-11 (the
   server rejects earlier months). A failed fetch just leaves the
   occupied marks empty — the calendar never blocks the detail view
   and never shows an error. */
function VenueCalendar({ venueId }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));
  const [occupied, setOccupied] = useState(null);
  useEffect(() => {
    let alive = true;
    setOccupied(null);
    apiGet("/api/venues/available?venue_id=" + venueId + "&month=" + month)
      .then(function (d) { if (alive) setOccupied(d.occupied || []); })
      .catch(function () { if (alive) setOccupied([]); });
    return () => { alive = false; };
  }, [venueId, month]);
  const locale = ["zh-CN", "vi-VN", "en-US"][li()];
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const byDate = {};
  (occupied || []).forEach(function (o) { byDate[o.date] = o.performances || []; });
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map(function (d) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2026, 10, 1 + d));
  });
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(new Date(y, m - 1, 1));
  function shift(delta) {
    const d = new Date(y, m - 1 + delta, 1);
    const next = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (next < "2026-11") return;
    setMonth(next);
  }
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const occupiedList = (occupied || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return (
    <div className="venuecal">
      <h4>{t("venueCalendar")}</h4>
      <div className="cal-nav">
        <button type="button" className="btn ghost" onClick={() => shift(-1)} disabled={month <= "2026-11"} aria-label="Previous month">‹</button>
        <b>{monthLabel}</b>
        <button type="button" className="btn ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid" role="grid" aria-label={t("venueCalendar")}>
        {weekdays.map(function (w, i) { return (<span key={i} className="cal-wd">{w}</span>); })}
        {cells.map(function (d, i) {
          if (d === null) return (<span key={"b" + i} className="cal-day blank" />);
          const key = month + "-" + String(d).padStart(2, "0");
          const perfs = byDate[key];
          const occ = perfs && perfs.length > 0;
          return (
            <span key={key} className={"cal-day" + (occ ? " occ" : "")}
              title={occ ? perfs.map(function (p) { return p.show_title; }).join("、") : t("venueFree")}>
              {d}
            </span>
          );
        })}
      </div>
      <p className="cal-legend"><span className="cal-day occ">●</span> {t("venueOccupied")} · <span className="cal-day">○</span> {t("venueFree")}</p>
      {occupiedList.length > 0 && (
        <div className="availdates"><span>{t("venueOccupiedDays")}：</span>{occupiedList.map(function (o) {
          return (<span key={o.date} className="datechip">{o.date} {o.performances.map(function (p) { return p.show_title; }).join("、")}</span>);
        })}</div>
      )}
    </div>
  );
}

/* Wave 4 #15 — lighting demo, port of zhou EquipmentPreview
   (Resources.jsx:280-322). Equipment only, for ALL equipment (Q11),
   not just meta.preview. Rotate +30° per click, colour picker recolours
   the stage, 6 fixed dots. Simulation only — no real equipment is used. */
function EquipmentPreview() {
  const [angle, setAngle] = useState(0);
  const [color, setColor] = useState("#26c6a1");
  return (
    <div className="equip-preview">
      <div className="preview-controls">
        <strong>{t("lightTitle")}</strong>
        <button type="button" className="linklike" onClick={() => setAngle((a) => a + 30)}>{t("lightRotate")}</button>
        <input aria-label={t("lightColor")} type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="stage-view" style={{ perspective: 600 }}>
        <div style={{ transform: `rotateX(45deg) rotateZ(${angle}deg)`, background: color }} className="stage-platform">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span key={n} style={{ left: `${10 + ((n - 1) % 3) * 35}%`, top: n > 3 ? "80%" : "8%" }}>●</span>
          ))}
        </div>
      </div>
      <p className="preview-note">{t("lightNote")}</p>
    </div>
  );
}

/* Wave 4 #15 — digital preview, port of zhou DigitalPreview
   (Resources.jsx:323-346). Digital only: cover image + simulated
   play/pause + progress bar (+1% per 500ms, 100 -> 0). No <video>
   element: there is no real video stream. */
function DigitalPreview({ image }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setProgress((p) => (p >= 100 ? 0 : p + 1)), 500);
    return () => clearInterval(timer);
  }, [playing]);
  return (
    <div className="digital-preview">
      <img src={image} alt="" />
      <button type="button" className="btn ghost" onClick={() => setPlaying((p) => !p)}>
        {playing ? t("digiPause") : t("digiStart")}
      </button>
      <div className="progress"><i style={{ width: progress + "%" }} /></div>
      <p className="preview-note">{t("digiNote")}</p>
    </div>
  );
}

const PREFS = [
  ["show", "爱看演出", "Thích xem diễn", "Live shows"],
  ["heritage", "迷非遗", "Mê di sản", "Heritage crafts"],
  ["creative", "爱文创", "Thích văn sáng", "Creative goods"],
  ["digital", "玩数字", "Trải nghiệm số", "Digital experiences"],
  ["tourism", "跟着演出旅行", "Đi theo vở diễn", "Travel for shows"],
];
const HERO_TAGS = ["刘三姐", "壮锦", "非遗体验", "漓江", "数字演出"];

export default function App() {
  const [lang, setLangState] = useState(langState.lang);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((x) => x + 1), []);
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerErr, setRegisterErr] = useState("");
  const [demandOpen, setDemandOpen] = useState(false);
  const [detailIdx, setDetailIdx] = useState(null);
  const [bkQty, setBkQty] = useState(1);
  const [bkDate, setBkDate] = useState("2026-12-05");
  const [couponCode, setCouponCode] = useState(""); /* R3-2: coupon code typed in the detail modal (optional, sent with the order) */
  const [flashLeft, setFlashLeft] = useState(null); /* R3-3: seconds left on the selected tier's live flash sale (null = none), ticked once a second while the detail modal is open */
  const [perfSel, setPerfSel] = useState(null); /* R2-2: selected performance id (null = resource-price flow) */
  const [tierSel, setTierSel] = useState(null); /* R2-2: selected ticket_type id within perfSel */
  const [pickupPoints, setPickupPoints] = useState(null); /* R2-3: pickup points of the selected performance's show (null = not loaded for this performance); empty = the show needs no pickup point */
  const [pickupSel, setPickupSel] = useState(null); /* R2-3: selected pickup_point id within pickupPoints */
  const [seats, setSeats] = useState(null); /* R2-5: seats of the selected performance (null = not loaded); empty = no seats generated */
  const [seatSel, setSeatSel] = useState([]); /* R2-5: selected seat ids within seats */
  const [avail, setAvail] = useState(null); /* Wave 4 #12: {mode, available, capacity, dates} for the open detail + bkDate, null when unknown/offline */
  const [licKind, setLicKind] = useState("all"); /* R6-1: 版权库 kind filter (all/buy/sell) */
  const [licStatus, setLicStatus] = useState("all"); /* R6-1: 版权库 status filter (all/pending/active/expired) */
  const [licenses, setLicenses] = useState([]); /* R6-1: public licence rows for the open 版权库 category, [] = none loaded */

  const [comments, setComments] = useState([]); /* R6-5: approved comments (+ the caller's own pending/rejected) for the open detail */
  const [kgRelated, setKgRelated] = useState([]); /* R7-3: knowledge-graph neighbours for the open detail ([] = none) */
  const [cmtRating, setCmtRating] = useState(5); /* R6-5: rating picked in the comment form */
  const [cmtText, setCmtText] = useState(""); /* R6-5: comment text being typed */
  const [cmtBusy, setCmtBusy] = useState(false); /* R6-5: comment submit in flight */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [demSel, setDemSel] = useState(null); /* selected demand index */
  const [match, setMatch] = useState(null); /* {title, note, list} */
  const [heroQ, setHeroQ] = useState("");
  const [shopTheme, setShopTheme] = useState(null); /* R1-3: per-shop storefront theme (?shop=, default 1); null = brand defaults */
  const [demTitle, setDemTitle] = useState("");
  const [demCat, setDemCat] = useState("show");
  const [demBudget, setDemBudget] = useState("");
  const [demCity, setDemCity] = useState("南宁");
  const [demDesc, setDemDesc] = useState("");
  const toastTimer = useRef(null);
  const chatLogRef = useRef(null);
  const matchBoxRef = useRef(null);
  const detailOpenedAt = useRef(null); /* R5-1: {rid, started} of the open detail, for the dwell event (see the effect below) */

  /* R5-1 埋点采集: fire-and-forget event send (never awaits, never
     retries, never blocks the UI, never toasts on failure). Offline
     the send is simply dropped — the client never claims an event
     was recorded when it was not. Anonymous sends count too
     (server-side, like the view recording). */
  function recordEvent(type, detail, durationMs) {
    if (!isApiAvailable()) return;
    const body = { type, detail };
    if (durationMs != null) body.duration_ms = durationMs;
    apiPost("/api/events", body).catch(function () {});
  }

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  function changeLang(l) {
    if (l === lang) return;
    langState.lang = l;
    setLangState(l);
    store.shown = 12;
    setMenuOpen(false);
    setDetailIdx(null);
    setChatMsgs([{ me: false, text: t("greeting") }]);
  }

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  useEffect(() => {
    if (!chatMsgs.length) return;
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMsgs]);

  useEffect(() => {
    if (match && matchBoxRef.current) matchBoxRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [match]);

  /* R5-1 停留时长: when a detail opens, note the time; when it
     closes (or another detail opens — the cleanup runs first), send
     one dwell event for the detail just left, capped at the server's
     3600000 ms. Fire-and-forget like the view recording; offline the
     send is dropped. The cleanup also runs on unmount. */
  useEffect(() => {
    if (detailIdx == null) return;
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    detailOpenedAt.current = { rid: rid != null ? rid : null, started: Date.now() };
    return function () {
      const prev = detailOpenedAt.current;
      detailOpenedAt.current = null;
      if (prev && prev.rid != null) {
        recordEvent("dwell", "resource:" + prev.rid, Math.min(Date.now() - prev.started, 3600000));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailIdx]);

  /* Wave 4 #12: availability for the open detail, re-fetched when the
     date changes. Fire-and-forget like the view recording in openDetail:
     a failed fetch just hides the availability row (offline fallback
     keeps the local behaviour, no error is ever shown). */
  useEffect(() => {
    if (detailIdx == null) { setAvail(null); return; }
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    if (rid == null) { setAvail(null); return; }
    let alive = true;
    apiGet("/api/resources/" + rid + "/availability?date=" + encodeURIComponent(bkDate || "2026-12-05"))
      .then(function (d) { if (alive) setAvail(d); })
      .catch(function () { if (alive) setAvail(null); });
    return function () { alive = false; };
  }, [detailIdx, bkDate]);

  /* R6-1 版权库: when the catalog category is copyright/show-license,
     load the public licence list (kind/status filter server-side, the
     category filters client-side — GET /api/licenses has no category
     parameter). Fire-and-forget like the availability fetch: a failed
     fetch just leaves the panel empty (offline fallback keeps the local
     behaviour, no error is ever shown). */
  useEffect(() => {
    if (store.cat !== "copyright" && store.cat !== "show-license") { if (licenses.length) setLicenses([]); return; }
    if (!isApiAvailable()) { setLicenses([]); return; }
    let alive = true;
    let qs = "";
    if (licKind !== "all") qs += (qs ? "&" : "?") + "kind=" + licKind;
    if (licStatus !== "all") qs += (qs ? "&" : "?") + "status=" + licStatus;
    apiGet("/api/licenses" + qs)
      .then(function (d) { if (alive) setLicenses((d.licenses || []).filter(function (l) { return l.resource_category === store.cat; })); })
      .catch(function () { if (alive) setLicenses([]); });
    return function () { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.cat, licKind, licStatus]);

  /* R6-5: comments for the open detail. Public list shows approved
     rows; a logged-in caller additionally sees their own
     pending/rejected rows (server-side). A failed fetch just leaves
     the section empty (offline fallback keeps the local behaviour). */
  useEffect(() => {
    if (detailIdx == null) { setComments([]); return; }
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    if (rid == null) { setComments([]); return; }
    let alive = true;
    apiGet("/api/resources/" + rid + "/comments")
      .then(function (d) { if (alive) setComments((d && d.comments) || []); })
      .catch(function () { if (alive) setComments([]); });
    return function () { alive = false; };
  }, [detailIdx]);

  useEffect(() => {
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    let alive = true;
    return function () { alive = false; };
  }, [detailIdx]);

  /* R7-3: knowledge-graph neighbours for the open detail (related
     recommendations, each with its kind label; [] when the graph has
     nothing for this show). Same best-effort pattern as the itinerary. */
  useEffect(() => {
    if (detailIdx == null) { setKgRelated([]); return; }
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    if (rid == null) { setKgRelated([]); return; }
    let alive = true;
    apiGet("/api/kg/related/" + rid)
      .then(function (d) { if (alive) setKgRelated((d && d.related) || []); })
      .catch(function () { if (alive) setKgRelated([]); });
    return function () { alive = false; };
  }, [detailIdx]);

  /* R6-5: submit a comment (login-gated; the server starts it as
     pending and only the author sees it until an admin approves it). */
  function submitComment() {
    if (cmtBusy || detailIdx == null) return;
    const rid = APIRES[detailIdx] && APIRES[detailIdx].id;
    if (rid == null || !user) return;
    if (!cmtText.trim()) return;
    setCmtBusy(true);
    apiPost("/api/resources/" + rid + "/comments", { rating: cmtRating, content: cmtText.trim() })
      .then(function () {
        setCmtText(""); setCmtRating(5);
        toast(t("commentPosted"));
        return apiGet("/api/resources/" + rid + "/comments");
      })
      .then(function (d) { setComments((d && d.comments) || []); })
      .catch(function (e) { toast((e && e.data && e.data.error) || t("loadErr")); })
      .finally(function () { setCmtBusy(false); });
  }

  /* R1-3: per-shop storefront theme (?shop=, default 1). Fire-and-
     forget like the availability fetch: a failed fetch just keeps the
     brand defaults (offline fallback keeps the local behaviour). */
  useEffect(() => {
    let alive = true;
    let shopId = "1";
    try {
      const q = new URLSearchParams(window.location.search).get("shop");
      if (q) shopId = q;
    } catch {}
    apiGet("/api/shops/" + encodeURIComponent(shopId) + "/theme")
      .then(function (d) { if (alive && d && d.theme) setShopTheme(d.theme); })
      .catch(function () {});
    return function () { alive = false; };
  }, []);

  /* ---- API sync (same as loadApiData / refreshOrdersApi / loadFavoritesApi) ---- */
  const loadFavoritesApi = useCallback(() => {
    if (!isApiAvailable() || !getToken()) return Promise.resolve(false);
    return apiGet("/api/favorites").then(function (d) {
      if (!d || !d.favorites) return false;
      d.favorites.forEach(function (r) {
        let idx = -1;
        if (r.id != null && APIID2IDX[r.id] != null) idx = APIID2IDX[r.id];
        if (idx < 0) { for (let i = 0; i < RES.length; i++) { if (RES[i][0] === r.name) { idx = i; break; } } }
        if (idx >= 0) store.favs[idx] = true;
      });
      rerender(); return true;
    }).catch(function () { return false; });
  }, [rerender]);

  const refreshOrdersApi = useCallback(() => {
    if (!isApiAvailable() || !getToken()) return Promise.resolve(false);
    return apiGet("/api/orders").then(function (d) {
      if (!d || !d.orders) return false;
      const mapped = [];
      d.orders.forEach(function (o) { const m = mapApiOrder(o); if (m) mapped.push(m); });
      store.orders = mapped; rerender(); return true;
    }).catch(function () { return false; });
  }, [rerender]);

  const loadApiData = useCallback(() => {
    return apiGet("/api/health").then(function () {
      return Promise.all([
        apiGet("/api/resources?sort=hot").catch(function () { return null; }),
        apiGet("/api/categories").catch(function () { return null; }),
        apiGet("/api/demands").catch(function () { return null; }),
      ]);
    }).then(function (arr) {
      if (!arr) return false;
      mergeCategories(arr[1]); mergeResources(arr[0]); mergeDemands(arr[2]);
      rerender();
      if (getToken()) { loadFavoritesApi(); refreshOrdersApi(); }
      return true;
    }).catch(function () { return false; });
  }, [loadFavoritesApi, refreshOrdersApi, rerender]);

  /* ---- boot (same as bootApi + the init block) ---- */
  useEffect(() => {
    restoreUser();
    setUser(currentUser());
    setChatMsgs([{ me: false, text: t("greeting") }]);
    if (/MicroMessenger/i.test(navigator.userAgent)) document.body.classList.add("is-wechat");
    loadApiData().then(function () {
      // Wave 3 #11b deep link: the user dashboard's recommendation cards
      // link here as ?detail=<api resource id>. Open that resource's
      // detail overlay once the API catalog has merged (APIID2IDX is
      // only populated after loadApiData); opening via openDetail also
      // records the view, like any other detail open. A bad/unknown id
      // is ignored — the homepage just loads normally.
      try {
        const id = Number(new URLSearchParams(window.location.search).get("detail") || "");
        if (Number.isSafeInteger(id) && id >= 1 && APIID2IDX[id] != null) openDetail(APIID2IDX[id]);
      } catch (e) { /* ignore a malformed deep link */ }
    }).catch(function () { /* offline: embedded data stays exactly as-is */ });
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDetailIdx(null); setDrawerOpen(false); setMenuOpen(false); setNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- favorites (login-gated, server-confirmed, no local fallback) ---- */
  function toggleFav(i) {
    const rid = APIRES[i] && APIRES[i].id;
    function done() { rerender(); toast(store.favs[i] ? t("favAdd") : t("favRemove")); }
    if (!getToken()) { toast(t("favLogin")); setLoginOpen(true); return Promise.resolve(); }
    if (rid == null) { toast(t("loadErr")); return Promise.resolve(); }
    return apiPost("/api/favorites", { resourceId: rid }).then(function (d) {
      if (d && typeof d.favorite === "boolean") store.favs[i] = d.favorite; else store.favs[i] = !store.favs[i];
      done();
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setLoginOpen(true); return; }
      toast((e && e.data && e.data.error) || t("loadErr"));
    });
  }

  /* ---- booking ---- */
  // tier (R2-2): null for the old resource-price flow, else
  // {performance_id, ticket_type_id, price_cents, start_at}. The server
  // prices tier orders and takes booking_date from the performance; the
  // offline local order mirrors that with the tier price + perf date.
  // pickup (R2-3): the selected pickup point object, or null. Only a
  // tier order carries one; the server requires it when the show has
  // pickup points configured.
  function bookResource(i, qty, date, tier, pickup, seatIds, coupon) {
    const r = RES[i];
    function localBook() {
      const code = "GY2026" + String(store.seq++).padStart(6, "0");
      const total = tier ? (tier.price_cents / 100) * qty : r[3] * qty;
      store.orders.unshift({ code, idx: i, qty, date, total, status: "pending", escrow: "未支付", pickup: pickup || null, template: null });
      setDetailIdx(null); rerender(); toast(fmt(t("orderCreated"), { code })); setDrawerOpen(true);
    }
    const rid = APIRES[i] && APIRES[i].id;
    if (!isApiAvailable() || !getToken() || rid == null) { localBook(); return; }
    const body = { resourceId: rid, quantity: qty, booking_date: date, channel: "web" };
    if (tier) { body.performance_id = tier.performance_id; body.ticket_type_id = tier.ticket_type_id; }
    if (tier && pickup) body.pickup_point_id = pickup.id;
    // R3-2: a typed coupon code rides along; the server validates it
    // (shop, window, min spend, quota, per-user limit) and prices it.
    if (coupon) body.coupon_code = coupon;
    apiPost("/api/orders", body).then(function (d) {
      if (d && d.ok) {
        const code = d.code || ("GY2026" + String(store.seq++).padStart(6, "0"));
        const total = (typeof d.amount === "number") ? d.amount / 100 : r[3] * qty;
        store.orders.unshift({ code, idx: i, qty, date, total, status: "pending", escrow: "未支付", apiId: d.id, pickup: d.pickup_point || pickup || null, template: d.ticket_template || null, coupon_cents: (typeof d.coupon_cents === "number" ? d.coupon_cents : 0), flash_cents: (typeof d.flash_cents === "number" ? d.flash_cents : 0) });
        setCouponCode("");
        // R2-5: hold the seats the buyer picked on the pending order.
        // A failed hold leaves the order standing (pending) — the
        // server error is shown, and the buyer can retry from the
        // order (the hold is a separate step, never a silent loss).
        if (seatIds && seatIds.length > 0) {
          apiPost("/api/orders/" + d.id + "/seats", { seat_ids: seatIds }).catch(function (e) {
            toast((e && e.data && e.data.error) || "选座失败，请稍后重试");
          });
        }
        setDetailIdx(null); rerender(); toast(fmt(t("orderCreated"), { code })); setDrawerOpen(true);
      } else { localBook(); }
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setLoginOpen(true); }
      // R3-2: the server refused the coupon (400) — show its message
      // and do NOT fall back to a full-price local order for a
      // booking the buyer tried to discount.
      else if (e && e.status === 400 && coupon) { toast((e && e.data && e.data.error) || t("loadErr")); }
      else localBook();
    });
  }

  function handleOrderAction(act, oi) {
    const o = store.orders[+oi]; if (!o) return;
    // R6-6: escrow hold (owner or admin) — a separate endpoint, not a
    // status transition: 模拟托管中 -> 已托管 on a paid order.
    if (act === "escrowHold") {
      if (o.apiId != null && isApiAvailable() && getToken()) {
        apiPost("/api/orders/" + encodeURIComponent(o.apiId) + "/escrow", { action: "hold" }).then(function (d) {
          o.escrow = (d && d.escrow) || "已托管"; rerender();
          toast(t("escrowHold")); refreshOrdersApi();
        }).catch(function (e) {
          if (e && e.status === 401) { clearToken(); setUser(null); setLoginOpen(true); return; }
          if (e && e.data && e.data.error) toast(e.data.error);
          refreshOrdersApi();
        });
      }
      return;
    }
    const map = { confirm: "confirmed", pay: "paid", complete: "completed", cancel: "cancelled", refund: "refund_requested" };
    if (!map[act]) return;
    if (o.apiId != null && isApiAvailable() && getToken()) {
      const ep = { confirm: "confirm", pay: "pay", complete: "complete", cancel: "cancel", refund: "refund" }[act];
      apiPost("/api/orders/" + encodeURIComponent(o.apiId) + "/" + ep, {}).then(function () {
        o.status = map[act]; rerender();
        toast(fmt(t("statusToast"), { code: o.code, st: t(STATUS[o.status]) }));
        refreshOrdersApi();
      }).catch(function (e) {
        if (e && e.status === 401) { clearToken(); setUser(null); setLoginOpen(true); return; }
        if (e && e.data && e.data.error) toast(e.data.error);
        refreshOrdersApi();
      });
      return;
    }
    o.status = map[act]; rerender();
    toast(fmt(t("statusToast"), { code: o.code, st: t(STATUS[o.status]) }));
  }

  /* ---- auth ---- */
  function doLogin(u, pw) {
    setLoginErr("");
    apiPost("/api/auth/login", { username: u, password: pw }).then(function (d) {
      if (d && d.token) {
        setToken(d.token, d.user || { username: u, name: u });
        setUser(currentUser()); setLoginOpen(false);
        loadFavoritesApi(); refreshOrdersApi();
      } else { setLoginErr(t("loginFailed")); }
    }).catch(function (e) {
      setLoginErr((e && e.data && e.data.error) || t("loginFailed"));
    });
  }
  function doRegister(f) {
    setRegisterErr("");
    apiPost("/api/auth/register", f).then(function (d) {
      if (d && d.token) {
        setToken(d.token, d.user || { username: f.username, name: f.name });
        setUser(currentUser()); setRegisterOpen(false);
        loadFavoritesApi(); refreshOrdersApi();
      } else { setRegisterErr(t("registerFailed")); }
    }).catch(function (e) {
      setRegisterErr((e && e.data && e.data.error) || t("registerFailed"));
    });
  }
  function doLogout() {
    clearToken(); setUser(null); setMenuOpen(false);
    store.favs = {}; rerender();
  }

  /* ---- post-demand ---- */
  function submitDemand(e) {
    e.preventDefault();
    const title = demTitle.trim(); if (!title) return;
    const cat = demCat, city = demCity;
    const by = parseFloat(demBudget) || 0;
    const descText = demDesc.trim();
    function localAdd() {
      DEMANDS.unshift([[title, title, title], cat, by, city, [descText, descText, descText]]);
      rerender(); setDemandOpen(false);
    }
    if (!isApiAvailable() || !getToken()) { if (!getToken()) { setDemandOpen(false); setLoginOpen(true); return; } localAdd(); return; }
    apiPost("/api/demands", { title, category: catZh(cat), budget: Math.round(by * 100), city, description: descText }).then(function () {
      localAdd();
    }).catch(function (err) {
      if (err && err.status === 401) { clearToken(); setUser(null); setDemandOpen(false); setLoginOpen(true); return; }
      localAdd();
    });
  }

  /* ---- assistant (rule-based, answers from live catalog data) ---- */
  function botAnswer(q) {
    const s = q.toLowerCase();
    if (/退款|退票|refund|hoàn/.test(s)) return t("ansRefund");
    if (/改签|resched|đổi lịch|dời/.test(s)) return t("ansResched");
    if (/非遗|heritage|di sản|壮锦|tráng cẩm/.test(s)) {
      const h = RES.filter(function (r) { return r[1] === "heritage"; });
      const list = h.map(function (r) { return "• " + r[0] + " — " + cityName(r[2]) + " · " + money(r[3]) + "/" + unitName(r[4]); }).join("\n");
      return fmt(t("ansHeritage"), { n: h.length, list });
    }
    if (/预订|预约|订票|book|đặt/.test(s)) return t("ansBook");
    if (/今晚|热门|推荐|tonight|hot|popular|gợi ý|hôm nay|vở nào/.test(s)) {
      const top = RES.map(function (r, i) { return { r, i }; }).sort(function (a, b) { return b.r[5] - a.r[5]; }).slice(0, 3);
      const list2 = top.map(function (o) { return "• " + o.r[0] + " — " + cityName(o.r[2]) + " · " + money(o.r[3]) + "/" + unitName(o.r[4]); }).join("\n");
      return fmt(t("ansHot"), { list: list2 });
    }
    if (/你好|您好|hello|chào|hi\b/.test(s)) return t("ansHello");
    return t("ansFallback");
  }
  function addMsg(txt, me) { setChatMsgs((prev) => [...prev, { me, text: txt }]); }
  function askBot(q) {
    addMsg(q, true);
    setTimeout(function () {
      if (!isApiAvailable()) { addMsg(botAnswer(q), false); return; }
      apiGet("/api/assistant?q=" + encodeURIComponent(q)).then(function (d) {
        if (d && d.answer) addMsg(d.answer, false); else addMsg(botAnswer(q), false);
      }).catch(function () { addMsg(botAnswer(q), false); });
    }, 280);
  }

  /* ---- catalog ---- */
  /* R6-2: switching category clears the talent role filter. */
  function setCat(c) { store.cat = c; store.role = null; store.shown = 12; rerender(); }
  function setRole(r) { store.role = r; store.shown = 12; rerender(); }
  function gotoCat(c) {
    setCat(c);
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  }
  function doSearch(q) {
    store.q = q; store.cat = "all"; store.role = null; store.shown = 12; setHeroQ(q); rerender();
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  }
  /* Wave 4 #14 — search via matchesSearch (search.js, port of zhou
     src/search.js): alias groups + lexicon splitting, every token must
     match; tags come from APIRES (the RES tuple has none). R6-4: the
     price (r[3], yuan) / rating / region filters live inside
     matchesSearch now, with exactly the server's rules — min > max
     counts as no price filter (Q8); rating reads APIRES[idx].rating
     and review_count === 0 never matches while a rating filter is
     active (Q8); region is the city alias (store.city). Client
     filtering only applies to the already-loaded list, never replaces
     the server query. */
  function filtered() {
    const pMin = parseFloat(store.priceMin), pMax = parseFloat(store.priceMax);
    const list = RES.map(function (r, i) { return { r, i }; }).filter(function (o) {
      const r = o.r;
      if (store.cat !== "all" && r[1] !== store.cat) return false;
      /* R6-2 — talent library: when a role is picked, keep only
         artists whose API meta carries that role. Items with no API
         meta (offline fallback) cannot be judged, so they stay. */
      if (store.cat === "artist" && store.role) {
        const api = APIRES[o.i];
        if (api && api.meta && api.meta.role !== store.role) return false;
      }
      const api = APIRES[o.i];
      return matchesSearch(
        { name: r[0], description: desc(r, lang), city: r[2], category: catZh(r[1]), tags: api ? api.tags : [], price: r[3], rating: api ? api.rating : undefined, reviewCount: api ? api.review_count : undefined },
        store.q,
        { minPrice: pMin, maxPrice: pMax, minRating: store.minRating, region: store.city },
      );
    });
    if (store.pref) { list.sort(function (a, b) { return (b.r[1] === store.pref) - (a.r[1] === store.pref) || b.r[5] - a.r[5]; }); }
    else if (store.sort === "asc") list.sort(function (a, b) { return a.r[3] - b.r[3]; });
    else if (store.sort === "desc") list.sort(function (a, b) { return b.r[3] - a.r[3]; });
    else if (store.sort === "name") list.sort(function (a, b) { return a.r[0].localeCompare(b.r[0], "zh"); });
    else list.sort(function (a, b) { return b.r[5] - a.r[5]; });
    return list;
  }

  // Wave 3 #11a: record one real view per detail open (fire-and-forget:
  // never blocks the UI, never toasts on failure). API id comes from
  // APIRES (RES index -> API id); offline/embedded data has no id, so
  // nothing is recorded then. Anonymous views count too (server-side).
  // R5-1: opening a detail is also a click on that resource
  // (detail `resource:{id}`).
  function openDetail(i) {
    setDetailIdx(i); setBkQty(1); setBkDate("2026-12-05"); setPerfSel(null); setTierSel(null); setPickupPoints(null); setPickupSel(null); setSeats(null); setSeatSel([]);
    const rid = APIRES[i] && APIRES[i].id;
    if (rid != null && isApiAvailable()) {
      apiPost("/api/resources/" + rid + "/view", {}).catch(function () {});
      recordEvent("click", "resource:" + rid);
    }
  }
  /* R6-4 — match reasons, in display order (same city / same category /
     within budget). The local fallback filters by category + budget and
     sorts same-city first, so same-city only applies when the cities
     match; the server requires all three. */
  function matchReasons(o, d) {
    return ["same_city", "same_category", "within_budget"].filter(function (k) {
      return k !== "same_city" || o.r[2] === d[3];
    });
  }
  function reasonLabel(k) {
    return t({ same_city: "matchReasonCity", same_category: "matchReasonCat", within_budget: "matchReasonBudget" }[k] || "matchReasonCat");
  }
  function selectDemand(i) {
    setDemSel(i);
    const d = DEMANDS[i];
    const local = RES.map(function (r, idx) { return { r, i: idx }; }).filter(function (o) { return o.r[1] === d[1] && o.r[3] <= d[2]; })
      .sort(function (a, b) { return (b.r[2] === d[3]) - (a.r[2] === d[3]) || b.r[5] - a.r[5]; }).slice(0, 5)
      .map(function (o) { return { r: o.r, i: o.i, reasons: matchReasons(o, d) }; });
    const localMatch = {
      title: fmt(t("matchTitle"), { t: d[0][li()] }),
      note: fmt(t("matchNote"), { c: catName(d[1]), b: money(d[2]), city: cityName(d[3]), n: local.length }),
      list: local,
    };
    // R6-4: logged in + live API + a known API demand id -> the server
    // match (same city + same category + within budget, rating desc).
    // Anything else (anonymous, offline, a just-posted local demand, a
    // failed fetch) falls back to the local rule above — the box never
    // stays empty because the server could not be reached.
    const apiId = APIDEMANDS[d[0][0]];
    if (apiId == null || !getToken() || !isApiAvailable()) { setMatch(localMatch); return; }
    setMatch({ title: localMatch.title, note: t("matchLoading"), list: [] });
    apiGet("/api/demands/" + apiId + "/matches").then(function (data) {
      const rows = (data && data.matches) || [];
      mergeResources({ resources: rows });
      const list = rows.map(function (m) {
        const idx = APIID2IDX[m.id];
        return { r: RES[idx], i: idx, reasons: m.reasons || [] };
      }).filter(function (o) { return o.i != null && o.r; });
      setMatch({
        title: localMatch.title,
        note: fmt(t("matchNoteServer"), { c: catName(d[1]), b: money(d[2]), city: cityName(d[3]), n: list.length }),
        list: list,
      });
    }).catch(function (err) {
      if (err && err.status === 400) {
        setMatch({ title: localMatch.title, note: t("matchRejected"), list: [] });
        return;
      }
      setMatch(localMatch);
    });
  }

  /* ---- derived render data ---- */
  /* Wave 4 #14 — the rating select only exists on the live catalog
     (APIRES); the offline fallback catalog has no rating, so it hides. */
  const hasApiRatings = Object.keys(APIRES).length > 0;
  const list = filtered();
  const show = list.slice(0, store.shown);
  const cities = [];
  RES.forEach(function (r) { if (cities.indexOf(r[2]) < 0) cities.push(r[2]); });
  const maxCat = Math.max(1, ...CATS.map((c) => catCount(c[0])));
  /* R1-3: section order/visibility from the shop theme. No theme =
     every section keeps its own style; with a theme, unlisted sections
     hide and listed ones take their theme order. */
  function secStyle(name) {
    if (!shopTheme) return undefined;
    const i = shopTheme.sections.indexOf(name);
    return i < 0 ? { display: "none" } : { order: i };
  }
  const heroStats = [[RES.length, t("sRes")], [catCount("show"), t("sShow")], [catCount("venue"), t("sVenue")], [7, t("sCity")], [CATS.length, t("sCat")], [DEMANDS.length, t("sDem")]];
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  const cur = detailIdx != null ? RES[detailIdx] : null;
  /* Wave 4 #15: renderable meta entries for the open detail (API meta via
     APIRES; the offline fallback catalog has no meta, so the block hides).
     Only keys in META_LABELS with a real value render — absent keys are
     hidden, never invented, never shown as 暂无. */
  const detailMeta = detailIdx != null && APIRES[detailIdx] ? APIRES[detailIdx].meta : null;
  const metaEntries = detailMeta ? Object.entries(detailMeta).filter(function ([k, v]) {
    return META_LABELS[k] && v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0);
  }) : [];
  /* R2-2: the selected performance + ticket type for the open detail
     (null = the old resource-price flow). Derived from avail, so a
     re-fetch never leaves a stale selection behind. */
  const selPf = avail && avail.performances ? avail.performances.find(function (pf) { return pf.id === perfSel; }) : null;
  const selTier = selPf && selPf.ticket_types ? selPf.ticket_types.find(function (tt) { return tt.id === tierSel; }) : null;
  /* R3-3: the live flash sale on the selected tier (null = none).
     The countdown ticks once a second from ends_at while the detail
     modal is open; it stops (and clears) when the modal closes or
     the selection changes. */
  const selFlash = selTier && selTier.flash_sale ? selTier.flash_sale : null;
  useEffect(() => {
    if (!selFlash || detailIdx === null) { setFlashLeft(null); return; }
    function tick() {
      setFlashLeft(Math.max(0, Math.floor((new Date(selFlash.ends_at).valueOf() - Date.now()) / 1000)));
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [selFlash ? selFlash.sale_id : null, selFlash ? selFlash.ends_at : null, detailIdx]);
  /* R2-3: pickup is required for a tier order when the selected
     performance's show has pickup points; the chosen point (or null).
     pickupPoints === null means not loaded yet for this performance. */
  const pickupRequired = !!(selTier && pickupPoints && pickupPoints.length > 0);
  const selPickup = pickupPoints ? pickupPoints.find(function (pp) { return pp.id === pickupSel; }) || null : null;
  /* R2-3: pick a performance (tap again to deselect). Selecting loads
     the show's pickup points (public, best-effort like the tier list);
     a failed fetch means "no points known" and the server still
     enforces the requirement at order time.
     R2-5: selecting also loads the performance's seats (public,
     best-effort); a failed fetch means "no seats known" and the old
     display-only seat map stays the fallback. */
  function pickPerf(pf) {
    if (pf.id === perfSel) { setPerfSel(null); setTierSel(null); setPickupPoints(null); setPickupSel(null); setSeats(null); setSeatSel([]); return; }
    setPerfSel(pf.id); setTierSel(null); setPickupSel(null); setPickupPoints(null); setSeats(null); setSeatSel([]);
    // R5-1: picking a performance is a click on that show.
    recordEvent("click", "show:" + pf.id);
    if (pf.show_id) apiGet("/api/shows/" + pf.show_id + "/pickup-points").then(function (d) { setPickupPoints(d.pickup_points || []); }).catch(function () { setPickupPoints([]); });
    else setPickupPoints([]);
    apiGet("/api/performances/" + pf.id + "/seats").then(function (d) { setSeats(d.seats || []); }).catch(function () { setSeats([]); });
  }
  /* R2-5: toggle one seat (available seats only; held/sold seats are
     disabled in the grid). */
  function toggleSeat(seat) {
    if (!seat || seat.status !== "available") return;
    setSeatSel(function (sel) {
      return sel.indexOf(seat.id) >= 0 ? sel.filter(function (id) { return id !== seat.id; }) : sel.concat([seat.id]);
    });
  }
  /* R2-5: seats grouped by zone for the picker (zones in first-seen
     order; each zone renders its rows x cols grid). */
  const seatZones = (function () {
    if (!seats || !seats.length) return [];
    const order = [];
    const byZone = {};
    seats.forEach(function (s) {
      const z = s.zone || "";
      if (!byZone[z]) { byZone[z] = { name: z, rows: 0, cols: 0, cells: {} }; order.push(byZone[z]); }
      byZone[z].rows = Math.max(byZone[z].rows, s.row);
      byZone[z].cols = Math.max(byZone[z].cols, s.col);
      byZone[z].cells[s.row + ":" + s.col] = s;
    });
    return order;
  })();
  const quicks = t("quicks");

  return (
    <>
      <Header
        variant="index" user={user} lang={lang} onLangChange={changeLang}
        cartCount={store.orders.length} onOpenDrawer={() => setDrawerOpen(true)}
        onLoginClick={() => setLoginOpen(true)} onLogout={doLogout}
        onMenuOrders={() => setDrawerOpen(true)}
        menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} onCloseMenu={() => setMenuOpen(false)}
        navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} onNavLinkClick={() => setNavOpen(false)}
      />

      {/* ================= HERO ================= */}
      <div className="hero" id="top" style={{ ...secStyle("hero"), ...(shopTheme ? { "--shop-primary": shopTheme.primaryColor } : {}) }}>
        <img className="hero-img" src={heroImg} alt="广西民族艺术舞台夜景" />
        <div className="hero-shade"></div>
        {shopTheme && shopTheme.banner ? (<div className="shop-banner">{shopTheme.banner}</div>) : null}
        <div className="wrap hero-in">
          <div className="hero-kicker">{t("heroKicker")}</div>
          <h1>桂<em>演</em></h1>
          <p className="hero-sub">{t("heroSub")}</p>
          <p className="hero-lead">{t("heroLead")}</p>
          <form className="hero-search" id="heroSearch" onSubmit={(e) => { e.preventDefault(); doSearch(heroQ.trim()); }}>
            <input id="heroQ" type="search" value={heroQ} onChange={(e) => setHeroQ(e.target.value)}
              placeholder={narrow ? t("heroSearchPhShort") : t("heroSearchPh")} aria-label="Search" />
            <button type="submit">{t("searchBtn")}</button>
          </form>
          <div className="hero-tags" id="heroTags">
            {HERO_TAGS.map((x) => (
              <button key={x} type="button" data-q={x} onClick={() => { setHeroQ(x); doSearch(x); }}>{x}</button>
            ))}
          </div>
          <div className="hero-stats" id="heroStats">
            {heroStats.map(([n, label], i) => (
              <div key={i}><b>{n}</b><span>{label}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= CATEGORIES ================= */}
      <div className="shop-sections" style={shopTheme ? { "--shop-primary": shopTheme.primaryColor } : undefined}>
      <section id="categories" style={{ paddingBottom: 8, ...secStyle("categories") }}>
        <div className="wrap">
          <div className="sec-head">
            <h2><span>{t("catTitle")}</span><span className="sub">{t("catSub")}</span></h2>
            <p>{t("catNote")}</p>
          </div>
          <div className="catrail" id="catRail">
            {CATS.map((c) => {
              const n = catCount(c[0]);
              return (
                <button key={c[0]} type="button" className="cat" data-cat={c[0]} onClick={() => { setCat(c[0]); document.getElementById("catalog").scrollIntoView({ behavior: "smooth" }); }}>
                  <b>{n}</b><span className="zh">{c[1]}</span>{li() !== 0 && (<span>{catName(c[0])}</span>)}
                  <span className="bar"><i style={{ width: Math.round((n / maxCat) * 100) + "%" }}></i></span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= CATALOG ================= */}
      <section id="catalog" style={{ paddingTop: 44, ...secStyle("catalog") }}>
        <div className="wrap">
          <div className="sec-head">
            <h2><span>{t("cat2Title")}</span><span className="sub">{t("cat2Sub")}</span></h2>
            <p>{t("cat2Note")}</p>
          </div>
          <div className="filters" id="catFilters">
            <button type="button" className={"chip" + (store.cat === "all" ? " on" : "")} data-c="all" onClick={() => setCat("all")}>{t("allChip")} ({RES.length})</button>
            {CATS.map((c) => (
              <button key={c[0]} type="button" className={"chip" + (store.cat === c[0] ? " on" : "")} data-c={c[0]} onClick={() => setCat(c[0])}>{catBoth(c[0])}</button>
            ))}
          </div>
          {/* R6-2 — library entries: venue / equipment / talent jump
              straight into their category. */}
          <div className="filters" id="libFilters">
            <button type="button" className={"chip" + (store.cat === "venue" ? " on" : "")} data-c="venue" onClick={() => setCat("venue")}>{t("libVenue")}</button>
            <button type="button" className={"chip" + (store.cat === "equipment" ? " on" : "")} data-c="equipment" onClick={() => setCat("equipment")}>{t("libEquipment")}</button>
            <button type="button" className={"chip" + (store.cat === "artist" ? " on" : "")} data-c="artist" onClick={() => setCat("artist")}>{t("libTalent")}</button>
          </div>
          {/* R6-2 — talent role filter: only for the artist category,
              only on the live catalog (the offline fallback has no
              role data to filter by). */}
          {store.cat === "artist" && hasApiRatings && (
            <div className="filters" id="roleFilters">
              <button type="button" className={"chip" + (!store.role ? " on" : "")} onClick={() => setRole(null)}>{t("allChip")}</button>
              {[["演员", "roleActor"], ["导演", "roleDirector"], ["编剧", "roleWriter"]].map(function ([role, key]) {
                return (<button key={role} type="button" className={"chip" + (store.role === role ? " on" : "")} onClick={() => setRole(role)}>{t(key)}</button>);
              })}
            </div>
          )}
          <div className="filters">
            <input className="q" id="q" type="search" value={store.q} onChange={(e) => { store.q = e.target.value; store.shown = 12; rerender(); }} placeholder={t("searchPh")} aria-label="Search" />
            <select id="citySel" aria-label="City" value={store.city} onChange={(e) => { store.city = e.target.value; store.shown = 12; rerender(); }}>
              <option value="all">{t("allCities")}</option>
              {cities.map((c) => (
                <option key={c} value={c}>{cityName(c)} {c}</option>
              ))}
            </select>
            <select id="sortSel" aria-label="Sort" value={store.sort} onChange={(e) => { store.sort = e.target.value; store.shown = 12; rerender(); }}>
              <option value="hot">{t("sortHot")}</option>
              <option value="asc">{t("sortAsc")}</option>
              <option value="desc">{t("sortDesc")}</option>
              <option value="name">{t("sortName")}</option>
            </select>
            {/* Wave 4 #14 — price min/max (yuan) + rating filter. Rating
                reads APIRES (live catalog only); hidden on the fallback
                catalog, which has no rating. */}
            <input id="priceMin" type="number" min="0" step="1" style={{ width: 110 }} value={store.priceMin} onChange={(e) => { store.priceMin = e.target.value; store.shown = 12; rerender(); }} placeholder={t("priceMinPh")} aria-label={t("priceMinPh")} />
            <input id="priceMax" type="number" min="0" step="1" style={{ width: 110 }} value={store.priceMax} onChange={(e) => { store.priceMax = e.target.value; store.shown = 12; rerender(); }} placeholder={t("priceMaxPh")} aria-label={t("priceMaxPh")} />
            {hasApiRatings && (
              <select id="ratingSel" aria-label="Rating" value={store.minRating} onChange={(e) => { store.minRating = Number(e.target.value); store.shown = 12; rerender(); }}>
                <option value={0}>{t("ratingAll")}</option>
                <option value={4}>{t("rating4")}</option>
                <option value={4.5}>{t("rating45")}</option>
              </select>
            )}
          </div>
          {(store.cat === "copyright" || store.cat === "show-license") && (
            <div className="lic-panel">
              <h3>{t("licLibrary")}</h3>
              <div className="filters">
                <label>{t("licKind")}
                  <select value={licKind} onChange={(e) => setLicKind(e.target.value)}>
                    <option value="all">{t("allChip")}</option>
                    <option value="buy">{t("licBuy")}</option>
                    <option value="sell">{t("licSell")}</option>
                  </select>
                </label>
                <label>{t("licStatus")}
                  <select value={licStatus} onChange={(e) => setLicStatus(e.target.value)}>
                    <option value="all">{t("allChip")}</option>
                    <option value="pending">{t("licPending")}</option>
                    <option value="active">{t("licActive")}</option>
                    <option value="expired">{t("licExpired")}</option>
                  </select>
                </label>
              </div>
              {licenses.length ? (
                <div className="lic-list">
                  {licenses.map((l) => (
                    <div key={l.id} className="lic-row">
                      <b>{l.resource_name}</b>
                      <span>{l.licensor} → {l.licensee}</span>
                      <span>{l.kind === "buy" ? t("licBuy") : t("licSell")} · {l.status === "pending" ? t("licPending") : l.status === "active" ? t("licActive") : t("licExpired")}</span>
                      <span>{money(l.price_cents / 100)}</span>
                      <span>{[l.start_at, l.end_at].filter(Boolean).join(" ~ ")}</span>
                    </div>
                  ))}
                </div>
              ) : (<div className="empty">{t("emptyRes")}</div>)}
            </div>
          )}
          <p className="resultline" id="resultLine">
            {fmt(t("results"), { a: show.length, b: list.length })}{store.pref ? fmt(t("prefSuffix"), { c: catName(store.pref) }) : ""}
          </p>
          <div className="grid" id="grid">
            {!list.length && <div className="empty">{t("emptyRes")}</div>}
            {show.map((o) => {
              const r = o.r, fav = store.favs[o.i];
              return (
                <article key={o.i} className="card" data-open={o.i} tabIndex={0} role="button" aria-label={r[0]}
                  onClick={() => openDetail(o.i)}
                  onKeyDown={(e) => { if (e.key === "Enter") openDetail(o.i); }}>
                  <div className="ph">
                    <img src={CATIMG[r[1]]} alt={r[0]} loading="lazy" />
                    <span className="city">{cityName(r[2])}</span>
                    <button type="button" className={"fav" + (fav ? " on" : "")} data-fav={o.i} aria-label="Favourite"
                      onClick={(e) => { e.stopPropagation(); toggleFav(o.i); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z" />
                      </svg>
                    </button>
                  </div>
                  <div className="bd">
                    <span className="catline">{catName(r[1])} · {cityName(r[2])}</span>
                    <h3>{r[0]}</h3>
                    <p>{desc(r, lang)}</p>
                    <div className="ft">
                      <span className="price">{money(r[3])}</span>
                      <span className="unit">/ {unitName(r[4])}</span>
                      <span className="views">{r[5]} {t("viewsUnit")}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="more-row">
            <button className="btn" id="moreBtn" type="button" style={{ display: list.length > store.shown ? "" : "none" }}
              onClick={() => { store.shown += 12; rerender(); }}>{t("moreBtn")}</button>
          </div>
        </div>
      </section>

      {/* ================= SPOTLIGHT ================= */}
      <section style={{ paddingTop: 10, ...secStyle("spot") }}>
        <div className="wrap">
          <div className="split">
            <div className="im"><img src={spotlightImg} alt="漓江畔露天舞台黄昏" loading="lazy" /></div>
            <div className="tx">
              <p className="zh">{t("spotKicker")}</p>
              <h3>{t("spotTitle")}</h3>
              <p>{t("spotText")}</p>
              <div className="spec">
                <div><b id="spotCities">7</b><span>{t("spotS1")}</span></div>
                <div><b>{CATS.length}</b><span>{t("spotS2")}</span></div>
                <div><b>9</b><span>{t("spotS3")}</span></div>
              </div>
              <button className="btn red" type="button" data-goto-cat="tourism" onClick={() => gotoCat("tourism")}>{t("spotBtn")}</button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DEMANDS ================= */}
      <section id="demands" style={{ paddingTop: 26, ...secStyle("demands") }}>
        <div className="wrap">
          <div className="sec-head">
            <h2><span>{t("demTitle")}</span><span className="sub">{t("demSub")}</span></h2>
            <p>{t("demNote")}</p>
            <p style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost" id="postDemandBtn" onClick={() => { if (!getToken()) { setLoginOpen(true); return; } setDemandOpen(true); }}>{t("postDemandBtn")}</button>
            </p>
          </div>
          <div className="demands" id="demandGrid">
            {DEMANDS.map((d, i) => {
              const dd = lang === "zh" ? d[4][1] : lang === "en" ? d[4][2] : d[4][0];
              return (
                <button key={i} type="button" className={"demand" + (demSel === i ? " sel" : "")} data-d={i} onClick={() => selectDemand(i)}>
                  <h3>{d[0][li()]}</h3>
                  <p>{dd}</p>
                  <div className="meta">
                    <span>{t("budget")} <b>{money(d[2])}</b></span>
                    <span>{cityName(d[3])}</span>
                    <span>{catName(d[1])}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className={"matchbox" + (match ? " show" : "")} id="matchBox" ref={matchBoxRef}>
            <h4 id="matchTitle">{match ? match.title : ""}</h4>
            <p id="matchNote">{match ? match.note : ""}</p>
            <div className="matchlist" id="matchList">
              {match && (match.list.length ? match.list.map((o) => (
                <button key={o.i} type="button" data-m={o.i} onClick={() => openDetail(o.i)}>
                  {o.r[0]} · {cityName(o.r[2])} · {money(o.r[3])}
                  {o.reasons && o.reasons.length ? (
                    <span className="match-reasons">{o.reasons.map(reasonLabel).join(" · ")}</span>
                  ) : null}
                </button>
              )) : t("matchNone"))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= AI ================= */}
      <section id="ai" style={{ paddingTop: 26, ...secStyle("ai") }}>
        <div className="wrap">
          <div className="sec-head">
            <h2><span>{t("aiTitle")}</span><span className="sub">{t("aiSub")}</span></h2>
            <p>{t("aiNote")}</p>
          </div>
          <div className="ai-grid">
            <div className="ai-copy">
              <p className="zh">{t("aiCopyTitle")}</p>
              <p>{t("aiCopyText")}</p>
              <ul>
                {[t("aiB1"), t("aiB2"), t("aiB3")].map((b, i) => (
                  <li key={i}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 18, fontWeight: 700, color: "var(--ink)" }}>{t("prefAsk")}</p>
              <div className="pref-tags" id="prefTags">
                {PREFS.map((p) => (
                  <button key={p[0]} type="button" data-p={p[0]} className={store.pref === p[0] ? "on" : ""}
                    onClick={() => {
                      store.pref = store.pref === p[0] ? null : p[0];
                      rerender();
                      toast(store.pref ? fmt(t("prefOn"), { c: catName(store.pref) }) : t("prefOff"));
                      if (store.pref) document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
                    }}>
                    {p[1 + li()]}
                  </button>
                ))}
              </div>
            </div>
            <div className="chat" aria-label="Guiyan assistant">
              <div className="chat-head"><span className="dot"></span><b>{t("chatName")}</b><span>{t("chatMode")}</span></div>
              <div className="chat-log" id="chatLog" ref={chatLogRef}>
                {chatMsgs.map((m, i) => (
                  <div key={i} className={"msg " + (m.me ? "me" : "bot")}>{m.text}</div>
                ))}
              </div>
              <div className="chat-quick" id="chatQuick">
                {quicks.map((q, i) => (
                  <button key={i} type="button" onClick={() => askBot(q)}>{q}</button>
                ))}
              </div>
              <form className="chat-form" id="chatForm" onSubmit={(e) => { e.preventDefault(); const v = e.target.chatIn.value.trim(); if (!v) return; e.target.chatIn.value = ""; askBot(v); }}>
                <input id="chatIn" name="chatIn" type="text" placeholder={t("chatPh")} aria-label="Chat" />
                <button type="submit">{t("sendBtn")}</button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ================= WECHAT MINI PROGRAM ================= */}
      <section id="wechat" style={{ paddingTop: 26, ...secStyle("wechat") }}>
        <div className="wrap">
          <div className="wx-mini-card">
            <h2>{t("wxCardTitle")}</h2>
            <p>{t("wxCardText")}</p>
            <p className="wx-mini-hint">{t("wxCardHint")}</p>
          </div>
        </div>
      </section>
      </div>

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
                <li><a href="#catalog">{t("navCatalog")}</a></li>
                <li><a href="#demands">{t("navDemands")}</a></li>
                <li><a href="#ai">{t("navAssistant")}</a></li>
                <li><button type="button" className="linklike" id="footOrders" onClick={() => setDrawerOpen(true)}>{t("myTickets")}</button></li>
              </ul>
            </div>
            <div>
              <h5>{t("footCats")}</h5>
              <ul id="footCats">
                {["show", "heritage", "tourism", "digital"].map((id) => (
                  <li key={id}><a href="#catalog" data-goto-cat={id} onClick={(e) => { e.preventDefault(); gotoCat(id); }}>{catBoth(id)}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h5>{t("footHelp")}</h5>
              <ul>
                <li><button type="button" className="linklike" data-help="refund" onClick={() => { document.getElementById("ai").scrollIntoView({ behavior: "smooth" }); askBot(quicks[0]); }}>{t("helpRefund")}</button></li>
                <li><button type="button" className="linklike" data-help="book" onClick={() => { document.getElementById("ai").scrollIntoView({ behavior: "smooth" }); askBot(quicks[3]); }}>{t("helpBook")}</button></li>
                <li><button type="button" className="linklike" data-help="resched" onClick={() => {
                  document.getElementById("ai").scrollIntoView({ behavior: "smooth" });
                  addMsg(t("helpResched"), true);
                  setTimeout(function () { addMsg(t("ansResched"), false); }, 280);
                }}>{t("helpResched")}</button></li>
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

      {/* detail / booking sheet */}
      <div className={"overlay" + (detailIdx !== null ? " open" : "")} id="overlay" role="dialog" aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) setDetailIdx(null); }}>
        <div className="sheet" id="sheet">
          {cur && (
            <>
              <div className="ph">
                <img src={CATIMG[cur[1]].replace("-card", "")} alt={cur[0]} />
                <button type="button" className="x" id="sheetX" aria-label="Close" onClick={() => setDetailIdx(null)}>✕</button>
              </div>
              <div className="in">
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", color: "var(--gold)" }}>{catName(cur[1])} · {cityName(cur[2])}</span>
                <h3>{cur[0]}</h3>
                <p className="desc">{desc(cur, lang)}</p>
                <div className="meta">
                  <span>{fmt(t("viewsMeta"), { n: cur[5] })}</span>
                  <span>{fmt(t("priceMeta"), { p: money(cur[3]), u: unitName(cur[4]) })}</span>
                </div>
                {metaEntries.length > 0 && (
                  <div className="metalist">
                    <h4>{t("metaTitle")}</h4>
                    {metaEntries.map(([k, v]) => (
                      <div key={k} className="row"><span className="k">{t(META_LABELS[k])}</span><span className="v">{metaValue(k, v)}</span></div>
                    ))}
                  </div>
                )}
                {detailMeta && (detailMeta.copyright_holder || detailMeta.license_type || detailMeta.ip_region) && (
                  <div className="metalist">
                    <h4>{t("licInfo")}</h4>
                    {detailMeta.copyright_holder ? (<div className="row"><span className="k">{t("licHolder")}</span><span className="v">{detailMeta.copyright_holder}</span></div>) : null}
                    {detailMeta.license_type ? (<div className="row"><span className="k">{t("licType")}</span><span className="v">{detailMeta.license_type}</span></div>) : null}
                    {detailMeta.ip_region ? (<div className="row"><span className="k">{t("licRegion")}</span><span className="v">{detailMeta.ip_region}</span></div>) : null}
                  </div>
                )}
                {cur[1] === "equipment" && <EquipmentPreview />}
                {cur[1] === "digital" && <DigitalPreview image={CATIMG[cur[1]].replace("-card", "")} />}
                <div className="flowline">
                  {t("flow").map((s, x) => (<span key={x} className={x === 0 ? "on" : undefined}>{s}</span>))}
                </div>
                <div className="bookrow">
                  <label>{cur[1] === "creative" ? t("creativeDateLabel") : t("dateLabel")}<input type="date" id="bkDate" value={bkDate} min="2026-11-11" onChange={(e) => setBkDate(e.target.value)} /></label>
                  <label>{fmt(t("qtyLabel"), { u: unitName(cur[4]) })}
                    <select id="bkQty" value={bkQty} onChange={(e) => setBkQty(+e.target.value)}>
                      {[1, 2, 3, 4, 5, 10, 20].map((n) => (<option key={n} value={n}>{n}</option>))}
                    </select>
                  </label>
                </div>
                {avail && (
                  <div className="availrow">
                    {avail.mode === "rental"
                      ? (avail.available ? t("availFree") : t("availBooked"))
                      : avail.mode === "none"
                        ? (cur[1] === "creative"
                          ? t("availCreative")
                          : t("availService"))
                        : fmt(t("availLeft"), { a: avail.available, c: avail.capacity })}
                  </div>
                )}
                {avail && avail.mode === "rental" && avail.dates && avail.dates.length > 0 && (
                  <div className="availdates"><span>{t("bookedDates")}：</span>{avail.dates.map((d) => (<span key={d.booking_date} className="datechip">{d.booking_date}</span>))}</div>
                )}
                {/* R2-1: on-sale performances of the resource's approved
                    shows (avail.performances, already fetched with the
                    availability above). Only for show resources.
                    R2-2: pick a performance, then a ticket type — the
                    total and the order follow the tier price. */}
                {cur[1] === "show" && avail && (
                  <div className="perf-list">
                    <h4>{t("perfTitle")}</h4>
                    {avail.performances && avail.performances.length ? (
                      avail.performances.map((pf) => (
                        <div key={pf.id}>
                          <button type="button" className="perf-row" style={{ width: "100%", background: pf.id === perfSel ? "var(--sand)" : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                            onClick={() => pickPerf(pf)}>
                            <span>{pf.start_at}</span><span>{money(pf.price_cents / 100)}</span><span className="perf-status">{t("perfOnSale")}</span>
                          </button>
                          {pf.id === perfSel && (
                            <div className="tier-list">
                              {pf.ticket_types && pf.ticket_types.length ? (
                                pf.ticket_types.map((tt) => (
                                  <button key={tt.id} type="button" className="perf-row" style={{ width: "100%", background: tt.id === tierSel ? "var(--sand)" : "transparent", border: "none", cursor: tt.available > 0 ? "pointer" : "not-allowed", textAlign: "left", opacity: tt.available > 0 ? 1 : 0.55 }}
                                    disabled={tt.available <= 0}
                                    onClick={() => { setTierSel(tt.id); recordEvent("click", "ticket_type:" + tt.id); }}>
                                    <span>{tt.name}</span>{tt.flash_sale ? (<span><s>{money(tt.price_cents / 100)}</s> {money(tt.flash_sale.sale_price_cents / 100)}</span>) : (<span>{money(tt.price_cents / 100)}</span>)}
                                    <span className="perf-status">{tt.available > 0 ? fmt(t("tierLeft"), { a: tt.available }) : t("tierSoldOut")}</span>
                                  </button>
                                ))
                              ) : (<p className="perf-empty">{t("tierEmpty")}</p>)}
                              {pf.ticket_types && pf.ticket_types.length > 0 && !tierSel && (
                                <p className="perf-empty">{t("tierPick")}</p>
                              )}
                            </div>
                          )}
                          {/* R3-3: live flash-sale countdown for the
                              selected tier (sale price already shown
                              struck-through above; the server prices
                              the order — this line is display only). */}
                          {selTier && selTier.flash_sale && (
                            <p className="perf-empty">{t("flashSale")} · {fmt(t("flashSaleLeft"), { s: flashLeft == null ? selTier.flash_sale.remaining_seconds : flashLeft })}</p>
                          )}
                          {/* R2-5: clickable seat grid for the selected
                              performance, when it has seats. It replaces
                              the B-041 display-only grid for this
                              performance; with no seats the old display
                              grid below stays the fallback. */}
                          {pf.id === perfSel && seatZones.length > 0 && (
                            <div className="seatpick">
                              <h5>{t("seatPick")}</h5>
                              {seatZones.map((z) => (
                                <div key={z.name || "default"}>
                                  {z.name ? (<div className="seatzone">{z.name}</div>) : null}
                                  <div className="seatgrid-pick" style={{ gridTemplateColumns: "repeat(" + z.cols + ", 26px)" }}>
                                    {Array.from({ length: z.rows * z.cols }).map((_, i) => {
                                      const r = Math.floor(i / z.cols) + 1;
                                      const c = (i % z.cols) + 1;
                                      const s = z.cells[r + ":" + c];
                                      if (!s) return (<i key={i} />);
                                      const sel = seatSel.indexOf(s.id) >= 0;
                                      return (
                                        <button key={s.id} type="button" className={s.status === "sold" ? "sold" : (sel ? "sel" : "")}
                                          disabled={s.status !== "available"} onClick={() => toggleSeat(s)}
                                          aria-label={z.name + " " + r + "排" + c + "座" + (s.status === "available" ? "" : "（" + s.status + "）")}>
                                          {r + "-" + c}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                              {seatSel.length > 0 && (<p className="perf-empty">{fmt(t("seatSelected"), { n: seatSel.length })}</p>)}
                            </div>
                          )}
                          {/* R2-3: pickup-point picker for the selected
                              performance's show. Shown whenever the show
                              has points; required (the order button is
                              blocked) once a tier is picked. */}
                          {pf.id === perfSel && pickupPoints && pickupPoints.length > 0 && (
                            <div className="pickup-list">
                              <h4>{t("pickupTitle")}</h4>
                              {pickupPoints.map((pp) => (
                                <button key={pp.id} type="button" className="perf-row" style={{ width: "100%", background: pp.id === pickupSel ? "var(--sand)" : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                                  onClick={() => setPickupSel(pp.id)}>
                                  <span>{pp.name}</span><span>{pp.address}</span>
                                </button>
                              ))}
                              {!pickupSel && (<p className="perf-empty">{t("pickupPick")}</p>)}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (<p className="perf-empty">{t("perfEmpty")}</p>)}
                  </div>
                )}
                {/* R3-2: optional coupon code, sent with the order. */}
                <div className="bookrow">
                  <label>{t("couponCode")}<input type="text" value={couponCode} maxLength={20} placeholder={t("couponCodePh")} onChange={(e) => setCouponCode(e.target.value)} /></label>
                </div>
                <div className="totalrow"><span>{t("totalLabel")}</span><b id="bkTotal">{money((selTier ? (selTier.flash_sale ? selTier.flash_sale.sale_price_cents : selTier.price_cents) / 100 : cur[3]) * bkQty)}</b></div>
                <div className="acts">
                  <button type="button" className="btn red" id="bkGo" disabled={pickupRequired && !pickupSel} onClick={() => {
                    if (pickupRequired && !pickupSel) { toast(t("pickupPick")); return; }
                    bookResource(detailIdx, bkQty, selTier ? selPf.start_at.slice(0, 10) : (bkDate || "2026-12-05"), selTier ? { performance_id: selPf.id, ticket_type_id: selTier.id, price_cents: selTier.price_cents, start_at: selPf.start_at } : null, selTier ? selPickup : null, selTier ? seatSel : [], couponCode.trim() || null);
                  }}>{t("bookNow")}</button>
                  <button type="button" className="btn ghost" id="bkFav" onClick={() => toggleFav(detailIdx)}>{store.favs[detailIdx] ? t("favOn") : t("favOff")}</button>
                </div>
                {APIRES[detailIdx] && APIRES[detailIdx].venue && (
                  <div className="venuebox">
                    <h4>{t("venueTitle")}</h4>
                    <p>{APIRES[detailIdx].venue.name}{APIRES[detailIdx].venue.address ? " · " + APIRES[detailIdx].venue.address : ""}</p>
                  </div>
                )}
                {cur[1] === "venue" && APIRES[detailIdx] && APIRES[detailIdx].meta && Number.isSafeInteger(APIRES[detailIdx].meta.seatRows) && Number.isSafeInteger(APIRES[detailIdx].meta.seatCols) && (
                  <div className="seatmap">
                    <h4>{t("seatTitle")}</h4>
                    <div className="seatgrid" aria-hidden="true" style={{ gridTemplateColumns: "repeat(" + APIRES[detailIdx].meta.seatCols + ", 8px)" }}>
                      {Array.from({ length: APIRES[detailIdx].meta.seatRows * APIRES[detailIdx].meta.seatCols }).map((_, i) => (<i key={i} />))}
                    </div>
                    <p className="seatnote">{t("seatNote")}</p>
                  </div>
                )}
                {/* R6-2 — venue free-day calendar (read-only): only when
                    the resource is staged in a real venue row. */}
                {cur[1] === "venue" && APIRES[detailIdx] && APIRES[detailIdx].venue && (
                  <VenueCalendar venueId={APIRES[detailIdx].venue.id} />
                )}

                {/* R6-5: comments — only approved rows are public; the
                    author additionally sees their own pending/rejected
                    rows (server-side). New comments start pending. */}
                <div className="metalist">
                  <h4>{t("commentTitle")}</h4>
                  {comments.length ? comments.map((c) => (
                    <div key={c.id} className="row" style={{ display: "block", padding: "6px 0" }}>
                      <span style={{ color: "var(--gold)", fontWeight: 700 }}>{"★".repeat(c.rating)}{"☆".repeat(5 - c.rating)}</span>
                      {" "}<span style={{ fontWeight: 700 }}>{c.user_name || ""}</span>
                      {c.status === "pending" ? (<span className="pill" style={{ marginLeft: 6 }}>{t("commentPending")}</span>)
                        : c.status === "rejected" ? (<span className="pill" style={{ marginLeft: 6 }}>{t("commentRejected")}</span>) : null}
                      <div style={{ fontSize: 13.5 }}>{c.content}</div>
                      {c.reply ? (<div style={{ fontSize: 13, color: "var(--ink2)" }}>{t("commentReplyLabel")}：{c.reply}</div>) : null}
                    </div>
                  )) : (<div style={{ fontSize: 13.5, color: "var(--ink2)" }}>{t("commentEmpty")}</div>)}
                  {user ? (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ display: "block", fontSize: 13 }}>{t("commentRating")}
                        <select value={cmtRating} onChange={(e) => setCmtRating(+e.target.value)} style={{ marginLeft: 6 }}>
                          {[5, 4, 3, 2, 1].map((n) => (<option key={n} value={n}>{n} ★</option>))}
                        </select>
                      </label>
                      <textarea value={cmtText} maxLength={500} rows={2} placeholder={t("commentPh")}
                        onChange={(e) => setCmtText(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                      <button type="button" className="btn" disabled={cmtBusy || !cmtText.trim()} onClick={submitComment} style={{ marginTop: 6 }}>{t("commentSubmit")}</button>
                    </div>
                  ) : null}
                </div>
                  <div className="metalist">
                  </div>
                ) : null}
                {/* R7-3: knowledge-graph neighbours — related
                    recommendations with their kind label (a genre node
                    carries no label; the name is the genre). */}
                {kgRelated.length ? (
                  <div className="metalist">
                    <h4>{t("kgRelated")}</h4>
                    <div style={{ fontSize: 13.5 }}>{kgRelated.map((n) => n.name + (n.kind === "genre" ? "" : "（" + catName(n.kind === "ip" ? "copyright" : n.kind) + "）")).join("、")}</div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* orders drawer */}
      <aside className={"drawer" + (drawerOpen ? " open" : "")} id="drawer" aria-label="My tickets">
        <header>
          <h3>{t("myTickets")}</h3>
          <button type="button" id="closeDrawer" aria-label="Close" onClick={() => setDrawerOpen(false)}>✕</button>
        </header>
        <div className="list" id="orderList">
          {!store.orders.length && <div className="emptybox" dangerouslySetInnerHTML={{ __html: t("emptyOrders") }}></div>}
          {store.orders.map((o, oi) => {
            const r = RES[o.idx];
            let acts = null;
            if (o.status === "pending") acts = (<><button type="button" className="mini" data-act="confirm" data-oi={oi} onClick={() => handleOrderAction("confirm", oi)}>{t("actConfirm")}</button><button type="button" className="mini" data-act="cancel" data-oi={oi} onClick={() => handleOrderAction("cancel", oi)}>{t("actCancel")}</button></>);
            if (o.status === "confirmed") acts = (<><button type="button" className="mini red" data-act="pay" data-oi={oi} onClick={() => handleOrderAction("pay", oi)}>{fmt(t("actPay"), { amt: money(o.total) })}</button><button type="button" className="mini" data-act="cancel" data-oi={oi} onClick={() => handleOrderAction("cancel", oi)}>{t("actCancel")}</button></>);
            if (o.status === "paid") acts = (<><button type="button" className="mini red" data-act="complete" data-oi={oi} onClick={() => handleOrderAction("complete", oi)}>{t("actComplete")}</button><button type="button" className="mini" data-act="refund" data-oi={oi} onClick={() => handleOrderAction("refund", oi)}>{t("actRefund")}</button>{o.escrow === "模拟托管中" ? (<button type="button" className="mini" data-act="escrowHold" data-oi={oi} onClick={() => handleOrderAction("escrowHold", oi)}>{t("escrowHold")}</button>) : null}</>);
            if (o.status === "completed") acts = (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("doneNote")}</span>);
            return (
              <div key={o.code + oi} className="order">
                <h4>{r[0]}</h4>
                <span className="code">{o.code} · {o.date} · {o.qty} × {unitName(r[4])} · {money(o.total)}</span>
                {o.coupon_cents ? (<span className="code">{fmt(t("couponSaved"), { a: (o.coupon_cents / 100).toFixed(2) })}</span>) : null}
                {o.flash_cents ? (<span className="code">{fmt(t("flashSaleSaved"), { a: (o.flash_cents / 100).toFixed(2) })}</span>) : null}
                {o.pickup ? (<span className="code">{t("pickupTitle")}：{o.pickup.name} · {o.pickup.address}</span>) : null}
                {o.template ? (<span className="code"><i style={{ display: "inline-block", width: 10, height: 10, background: o.template.color, borderRadius: 2, marginRight: 4, verticalAlign: "-1px" }} />{o.template.name}</span>) : null}
                {o.escrow ? (<span className="code">{t("escrowTitle")}：{o.escrow}</span>) : null}
                {o.status === "paid" && o.escrow ? (<span className="code">{t("escrowNote")}</span>) : null}
                {o.status === "disputed" ? (<span className="code">{t("escrowFrozen")}</span>) : null}
                <div className="row"><span className={"pill " + o.status}>{t(STATUS[o.status])}</span>{acts}</div>
              </div>
            );
          })}
        </div>
      </aside>

      <LoginDialog open={loginOpen} err={loginErr} onClose={() => setLoginOpen(false)} onLogin={doLogin}
        onRegisterClick={() => { setLoginOpen(false); setRegisterErr(""); setRegisterOpen(true); }} />
      <RegisterDialog open={registerOpen} err={registerErr} onClose={() => setRegisterOpen(false)} onRegister={doRegister}
        onLoginClick={() => { setRegisterOpen(false); setLoginOpen(true); }} />

      {/* post-demand dialog */}
      <div className={"auth-overlay" + (demandOpen ? " open" : "")} id="demandOverlay" role="dialog" aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) setDemandOpen(false); }}>
        <form className="auth-card" id="demandForm" onSubmit={submitDemand}>
          <button type="button" className="x" id="demandCancel" aria-label="Close" onClick={() => setDemandOpen(false)}>✕</button>
          <h3>{t("postDemandTitle")}</h3>
          <input id="demTitle" type="text" value={demTitle} onChange={(e) => setDemTitle(e.target.value)} placeholder={t("demTitlePh")} />
          <select id="demCat" value={demCat} onChange={(e) => setDemCat(e.target.value)}>
            {CATS.map((c) => (<option key={c[0]} value={c[0]}>{c[1]}</option>))}
          </select>
          <input id="demBudget" type="number" min="0" step="1" value={demBudget} onChange={(e) => setDemBudget(e.target.value)} placeholder={t("demBudgetPh")} />
          <select id="demCity" value={demCity} onChange={(e) => setDemCity(e.target.value)}>
            {Object.keys(CITYN).map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
          <textarea id="demDesc" value={demDesc} onChange={(e) => setDemDesc(e.target.value)} placeholder={t("demDescPh")}></textarea>
          <div className="row"><button className="btn red" type="submit">{t("postDemandBtn")}</button></div>
        </form>
      </div>

      <AiChat lang={lang} />
      <Toast msg={toastMsg} />
    </>
  );
}
