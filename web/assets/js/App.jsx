/* Guiyan customer SPA (React) — ESM/JSX port of web/assets/js/app.js.
   Same behaviour, same data: the mutable `state` object from data.js is
   kept as the single store (exactly like the classic script) and a tick
   state forces a re-render after every mutation that used to call a
   render*() function. API contract, booking state machine, favorites
   login gate and offline local fallback are unchanged. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  langState, t, fmt, money, CATS, RES, DEMANDS, CATIMG, CITYN,
  catName, catZh, cityName, unitName, li, state as store,
} from "./data.js";
import {
  APIRES, APIID2IDX, apiGet, apiPost, currentUser, getToken, setToken,
  clearToken, restoreUser, isApiAvailable, mergeCategories, mergeResources,
  mergeDemands, mapApiOrder, STATUS,
} from "./apiClient.js";
import { Header, LoginDialog, RegisterDialog, Toast } from "./chrome.jsx";
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
};
function metaValue(key, v) {
  /* deposit is stored in cents on the server; the UI shows yuan (label
     already carries the 模拟 marker). Arrays render as a short list. */
  if (key === "deposit") return money((typeof v === "number" ? v : 0) / 100);
  if (Array.isArray(v)) return v.join("、");
  return String(v);
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
  const [avail, setAvail] = useState(null); /* Wave 4 #12: {mode, available, capacity, dates} for the open detail + bkDate, null when unknown/offline */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [demSel, setDemSel] = useState(null); /* selected demand index */
  const [match, setMatch] = useState(null); /* {title, note, list} */
  const [heroQ, setHeroQ] = useState("");
  const [demTitle, setDemTitle] = useState("");
  const [demCat, setDemCat] = useState("show");
  const [demBudget, setDemBudget] = useState("");
  const [demCity, setDemCity] = useState("南宁");
  const [demDesc, setDemDesc] = useState("");
  const toastTimer = useRef(null);
  const chatLogRef = useRef(null);
  const matchBoxRef = useRef(null);

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
  function bookResource(i, qty, date) {
    const r = RES[i];
    function localBook() {
      const code = "GY2026" + String(store.seq++).padStart(6, "0");
      store.orders.unshift({ code, idx: i, qty, date, total: r[3] * qty, status: "pending" });
      setDetailIdx(null); rerender(); toast(fmt(t("orderCreated"), { code })); setDrawerOpen(true);
    }
    const rid = APIRES[i] && APIRES[i].id;
    if (!isApiAvailable() || !getToken() || rid == null) { localBook(); return; }
    apiPost("/api/orders", { resourceId: rid, quantity: qty, booking_date: date, channel: "web" }).then(function (d) {
      if (d && d.ok) {
        const code = d.code || ("GY2026" + String(store.seq++).padStart(6, "0"));
        const total = (typeof d.amount === "number") ? d.amount / 100 : r[3] * qty;
        store.orders.unshift({ code, idx: i, qty, date, total, status: "pending", apiId: d.id });
        setDetailIdx(null); rerender(); toast(fmt(t("orderCreated"), { code })); setDrawerOpen(true);
      } else { localBook(); }
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setLoginOpen(true); }
      localBook();
    });
  }

  function handleOrderAction(act, oi) {
    const o = store.orders[+oi]; if (!o) return;
    const map = { confirm: "confirmed", pay: "paid", complete: "completed", cancel: "cancelled", refund: "refunded" };
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
  function setCat(c) { store.cat = c; store.shown = 12; rerender(); }
  function gotoCat(c) {
    setCat(c);
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  }
  function doSearch(q) {
    store.q = q; store.cat = "all"; store.shown = 12; setHeroQ(q); rerender();
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  }
  function filtered() {
    const list = RES.map(function (r, i) { return { r, i }; }).filter(function (o) {
      const r = o.r;
      if (store.cat !== "all" && r[1] !== store.cat) return false;
      if (store.city !== "all" && r[2] !== store.city) return false;
      if (store.q) { const hay = (r[0] + r[2] + catZh(r[1]) + desc(r, lang)).toLowerCase(); if (hay.indexOf(store.q.toLowerCase()) < 0) return false; }
      return true;
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
  function openDetail(i) {
    setDetailIdx(i); setBkQty(1); setBkDate("2026-12-05");
    const rid = APIRES[i] && APIRES[i].id;
    if (rid != null && isApiAvailable()) {
      apiPost("/api/resources/" + rid + "/view", {}).catch(function () {});
    }
  }
  function selectDemand(i) {
    setDemSel(i);
    const d = DEMANDS[i];
    const m = RES.map(function (r, idx) { return { r, i: idx }; }).filter(function (o) { return o.r[1] === d[1] && o.r[3] <= d[2]; })
      .sort(function (a, b) { return (b.r[2] === d[3]) - (a.r[2] === d[3]) || b.r[5] - a.r[5]; }).slice(0, 5);
    setMatch({
      title: fmt(t("matchTitle"), { t: d[0][li()] }),
      note: fmt(t("matchNote"), { c: catName(d[1]), b: money(d[2]), city: cityName(d[3]), n: m.length }),
      list: m,
    });
  }

  /* ---- derived render data ---- */
  const list = filtered();
  const show = list.slice(0, store.shown);
  const cities = [];
  RES.forEach(function (r) { if (cities.indexOf(r[2]) < 0) cities.push(r[2]); });
  const maxCat = Math.max(1, ...CATS.map((c) => catCount(c[0])));
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

      <div className="wx-banner">{t("wxBanner")}</div>

      {/* ================= HERO ================= */}
      <div className="hero" id="top">
        <img className="hero-img" src={heroImg} alt="广西民族艺术舞台夜景" />
        <div className="hero-shade"></div>
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
      <section id="categories" style={{ paddingBottom: 8 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="no">其一</span>
            <h2><span>{t("catTitle")}</span><span className="sub">{t("catSub")}</span></h2>
            <p>{t("catNote")}</p>
          </div>
          <div className="catrail" id="catRail">
            {CATS.map((c) => {
              const n = catCount(c[0]);
              return (
                <button key={c[0]} type="button" className="cat" data-cat={c[0]} onClick={() => { setCat(c[0]); document.getElementById("catalog").scrollIntoView({ behavior: "smooth" }); }}>
                  <b>{n}</b><span className="zh">{c[1]}</span><span>{catName(c[0])}</span>
                  <span className="bar"><i style={{ width: Math.round((n / maxCat) * 100) + "%" }}></i></span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= CATALOG ================= */}
      <section id="catalog" style={{ paddingTop: 44 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="no">其二</span>
            <h2><span>{t("cat2Title")}</span><span className="sub">{t("cat2Sub")}</span></h2>
            <p>{t("cat2Note")}</p>
          </div>
          <div className="filters" id="catFilters">
            <button type="button" className={"chip" + (store.cat === "all" ? " on" : "")} data-c="all" onClick={() => setCat("all")}>{t("allChip")} ({RES.length})</button>
            {CATS.map((c) => (
              <button key={c[0]} type="button" className={"chip" + (store.cat === c[0] ? " on" : "")} data-c={c[0]} onClick={() => setCat(c[0])}>{catZh(c[0])} · {catName(c[0])}</button>
            ))}
          </div>
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
          </div>
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
      <section style={{ paddingTop: 10 }}>
        <div className="wrap">
          <div className="split">
            <div className="im"><img src={spotlightImg} alt="漓江畔露天舞台黄昏" loading="lazy" /></div>
            <div className="tx">
              <p className="zh">{t("spotKicker")}</p>
              <h3>{t("spotTitle")}</h3>
              <p>{t("spotText")}</p>
              <div className="spec">
                <div><b id="spotCities">7</b><span>{t("spotS1")}</span></div>
                <div><b>10</b><span>{t("spotS2")}</span></div>
                <div><b>9</b><span>{t("spotS3")}</span></div>
              </div>
              <button className="btn red" type="button" data-goto-cat="tourism" onClick={() => gotoCat("tourism")}>{t("spotBtn")}</button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DEMANDS ================= */}
      <section id="demands" style={{ paddingTop: 26 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="no">其三</span>
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
                </button>
              )) : t("matchNone"))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= AI ================= */}
      <section id="ai" style={{ paddingTop: 26 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="no">其四</span>
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
      <section id="wechat" style={{ paddingTop: 26 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="no" style={{ borderColor: "#07c160", color: "#07c160" }}>微</span>
            <h2><span>{t("wxTitle")}</span><span className="sub">{t("wxSub")}</span></h2>
            <p>{t("wxNote")}</p>
          </div>
          <div className="wx-grid">
            <div className="wx-copy">
              <h3>{t("wxCopyTitle")}</h3>
              <p>{t("wxCopyText")}</p>
              <ul>
                {[t("wxB1"), t("wxB2"), t("wxB3")].map((b, i) => (
                  <li key={i}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="wx-steps">
                <div><b>01</b><span>{t("wxS1")}</span></div>
                <div><b>02</b><span>{t("wxS2")}</span></div>
                <div><b>03</b><span>{t("wxS3")}</span></div>
              </div>
              <p style={{ marginTop: 16 }}><a href="https://github.com/lam01244410430/guiyan-platform.git" target="_blank" rel="noopener" style={{ fontWeight: 700 }}>{t("wxRepo")}</a></p>
            </div>
            <div className="wx-phone" role="region" aria-label="WeChat mini program preview">
              <div className="wx-screen">
                <div className="wx-status"><span>9:41</span><span>5G&nbsp;&nbsp;▰▰▰</span></div>
                <div className="wx-head"><b><span className="zh">桂演</span> · Guiyan</b><span className="wx-capsule">···&nbsp;&nbsp;│&nbsp;&nbsp;◎</span></div>
                <div className="wx-search">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input id="wxQ" type="search" value={store.wxQ} onChange={(e) => { store.wxQ = e.target.value; if (store.wxTab === "home") store.wxTab = "catalog"; rerender(); }} placeholder={t("heroSearchPhShort")} aria-label="Search mini program" />
                </div>
                <div className="wx-chips" id="wxChips" style={{ display: (store.wxTab === "home" || store.wxTab === "catalog") ? "" : "none" }}>
                  <button type="button" data-wxcat="all" className={store.wxCat === "all" ? "on" : ""} onClick={() => { store.wxCat = "all"; if (store.wxTab === "home") store.wxTab = "catalog"; rerender(); }}>{t("allChip")}</button>
                  {CATS.map((c) => (
                    <button key={c[0]} type="button" data-wxcat={c[0]} className={store.wxCat === c[0] ? "on" : ""}
                      onClick={() => { store.wxCat = c[0]; if (store.wxTab === "home") store.wxTab = "catalog"; rerender(); }}>{catName(c[0])}</button>
                  ))}
                </div>
                <div className="wx-body" id="wxBody">
                  <WxBody
                    lang={lang} onOpenDetail={openDetail}
                    onSelectDemand={(i) => {
                      const dem = DEMANDS[i];
                      const m = RES.map(function (r, idx) { return { r, i: idx }; }).filter(function (o) { return o.r[1] === dem[1] && o.r[3] <= dem[2]; }).sort(function (a, b) { return b.r[5] - a.r[5]; })[0];
                      if (m) openDetail(m.i);
                    }}
                  />
                </div>
                <nav className="wx-tabbar" id="wxTabs">
                  {[
                    ["home", "wxTabHome", <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg><span>{t("wxTabHome")}</span></>],
                    ["catalog", "navCatalog", <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg><span>{t("navCatalog")}</span></>],
                    ["demands", "navDemands", <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg><span>{t("navDemands")}</span></>],
                    ["orders", "myTickets", <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M5 4h14v16l-2.3-1.6L14.4 20l-2.4-1.6L9.6 20l-2.3-1.6L5 20z" /><path d="M9 8h6M9 12h6" /></svg><span>{t("myTickets")}</span><b id="wxOrderCount" style={{ display: store.orders.length ? "grid" : "none" }}>{store.orders.length}</b></>],
                  ].map(([tab, , content]) => (
                    <button key={tab} type="button" data-wxtab={tab} className={store.wxTab === tab ? "on" : ""}
                      onClick={() => { store.wxTab = tab; rerender(); }}>
                      {content}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                  <li key={id}><a href="#catalog" data-goto-cat={id} onClick={(e) => { e.preventDefault(); gotoCat(id); }}>{catZh(id)} · {catName(id)}</a></li>
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
                {cur[1] === "equipment" && <EquipmentPreview />}
                {cur[1] === "digital" && <DigitalPreview image={CATIMG[cur[1]].replace("-card", "")} />}
                <div className="flowline">
                  {t("flow").map((s, x) => (<span key={x} className={x === 0 ? "on" : undefined}>{s}</span>))}
                </div>
                <div className="bookrow">
                  <label>{t("dateLabel")}<input type="date" id="bkDate" value={bkDate} min="2026-11-11" onChange={(e) => setBkDate(e.target.value)} /></label>
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
                        ? t("availService")
                        : fmt(t("availLeft"), { a: avail.available, c: avail.capacity })}
                  </div>
                )}
                {avail && avail.mode === "rental" && avail.dates && avail.dates.length > 0 && (
                  <div className="availdates"><span>{t("bookedDates")}：</span>{avail.dates.map((d) => (<span key={d.booking_date} className="datechip">{d.booking_date}</span>))}</div>
                )}
                <div className="totalrow"><span>{t("totalLabel")}</span><b id="bkTotal">{money(cur[3] * bkQty)}</b></div>
                <div className="acts">
                  <button type="button" className="btn red" id="bkGo" onClick={() => bookResource(detailIdx, bkQty, bkDate || "2026-12-05")}>{t("bookNow")}</button>
                  <button type="button" className="btn ghost" id="bkFav" onClick={() => toggleFav(detailIdx)}>{store.favs[detailIdx] ? t("favOn") : t("favOff")}</button>
                </div>
                {cur[1] === "venue" && APIRES[detailIdx] && APIRES[detailIdx].meta && Number.isSafeInteger(APIRES[detailIdx].meta.seatRows) && Number.isSafeInteger(APIRES[detailIdx].meta.seatCols) && (
                  <div className="seatmap">
                    <h4>{t("seatTitle")}</h4>
                    <div className="seatgrid" aria-hidden="true">
                      {Array.from({ length: APIRES[detailIdx].meta.seatRows * APIRES[detailIdx].meta.seatCols }).map((_, i) => (<i key={i} />))}
                    </div>
                    <p className="seatnote">{t("seatNote")}</p>
                  </div>
                )}
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
            if (o.status === "paid") acts = (<><button type="button" className="mini red" data-act="complete" data-oi={oi} onClick={() => handleOrderAction("complete", oi)}>{t("actComplete")}</button><button type="button" className="mini" data-act="refund" data-oi={oi} onClick={() => handleOrderAction("refund", oi)}>{t("actRefund")}</button></>);
            if (o.status === "completed") acts = (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("doneNote")}</span>);
            return (
              <div key={o.code + oi} className="order">
                <h4>{r[0]}</h4>
                <span className="code">{o.code} · {o.date} · {o.qty} × {unitName(r[4])} · {money(o.total)}</span>
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

/* WeChat mini-program preview pane (same data & booking as the web page). */
function WxBody({ lang, onOpenDetail, onSelectDemand }) {
  function wxCard(o) {
    const r = o.r;
    return (
      <button key={o.i} type="button" className="wx-card" data-wxopen={o.i} onClick={() => onOpenDetail(o.i)}>
        <img src={CATIMG[r[1]]} alt={r[0]} loading="lazy" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <h4>{r[0]}</h4>
          <p>{desc(r, lang)}</p>
          <span style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 5 }}>
            <span className="pr">{money(r[3])}</span>
            <span className="mt">/ {unitName(r[4])} · {cityName(r[2])} · {r[5]} {t("viewsUnit")}</span>
          </span>
        </span>
      </button>
    );
  }

  if (store.wxTab === "orders") {
    return (
      <>
        {store.orders.length ? store.orders.map((o) => {
          const r = RES[o.idx];
          return (
            <div key={o.code} className="wx-order">
              <b style={{ fontFamily: "'Noto Serif SC',serif" }}>{r[0]}</b><br />
              <span style={{ color: "#999", fontSize: 11.5 }}>{o.code} · {o.date} · {o.qty} × {unitName(r[4])} · {money(o.total)}</span><br />
              <span className={"pill " + o.status} style={{ marginTop: 7, display: "inline-block" }}>{t(STATUS[o.status])}</span>
            </div>
          );
        }) : <div className="wx-order" style={{ textAlign: "center", color: "#999", padding: "28px 12px" }} dangerouslySetInnerHTML={{ __html: t("emptyOrders") }}></div>}
      </>
    );
  }
  if (store.wxTab === "demands") {
    return (
      <>
        {DEMANDS.map((d, i) => (
          <button key={i} type="button" className="wx-card" data-wxdem={i} onClick={() => onSelectDemand(i)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <h4>{d[0][li()]}</h4>
              <p>{lang === "zh" ? d[4][1] : lang === "en" ? d[4][2] : d[4][0]}</p>
              <span style={{ display: "flex", gap: 8, marginTop: 5 }}>
                <span className="pr">{money(d[2])}</span>
                <span className="mt">{cityName(d[3])} · {catName(d[1])}</span>
              </span>
            </span>
          </button>
        ))}
      </>
    );
  }
  const list = RES.map(function (r, i) { return { r, i }; }).filter(function (o) {
    if (store.wxTab === "catalog" && store.wxCat !== "all" && o.r[1] !== store.wxCat) return false;
    if (store.wxQ) { const hay = (o.r[0] + o.r[2] + catZh(o.r[1]) + desc(o.r, lang)).toLowerCase(); if (hay.indexOf(store.wxQ.toLowerCase()) < 0) return false; }
    return true;
  }).sort(function (a, b) { return b.r[5] - a.r[5]; });
  if (store.wxTab === "home") {
    return (
      <>
        <div className="wx-hero"><span className="zh">桂演 Guiyan</span><p>{t("heroSub")} · {RES.length} {t("sRes")}</p></div>
        <div style={{ fontWeight: 800, fontSize: 14, padding: "2px 2px 0" }}>{t("wxFeatured")}</div>
        {list.slice(0, 4).map(wxCard)}
      </>
    );
  }
  return (
    <>
      {list.length ? list.map(wxCard) : <div className="wx-order" style={{ textAlign: "center", color: "#999", padding: "28px 12px" }}>{t("emptyRes")}</div>}
    </>
  );
}
