// R9-1 brand site (row 80, 品牌官网) — a read-only intro page for the
// Guiyan platform: hero, about, live stats, real venues, featured shows
// and the client's existing channels. No sales here: there are no
// buy/pay/book actions on this page — every call to action is a link back
// to the home page, where booking happens. All numbers on this page are
// read from the public API at load time; nothing is hardcoded.
//
// The three partner channels below (Damai / WeChat Pay / 北京银行） are
// the client's existing channels only — no new channel is added.
import { useEffect, useState } from "react";
import { apiGet, apiPost, getToken, setToken, clearToken, restoreUser, apiCatId } from "./apiClient.js";
import { langState, t, money, catName, cityName, unitName, catBoth, CATIMG } from "./data.js";
import { Header, LoginDialog, RegisterDialog } from "./chrome.jsx";
import heroImg from "../img/hero.webp";

// The client's existing channels, listed only — no new channel.
// (Damai ticketing, WeChat Pay, Beijing Bank.)
const CHANNELS = ["大麦", "微信支付", "北京银行"];

export default function Brand() {
  const [lang, setLang] = useState(langState.lang);
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showReg, setShowReg] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [regErr, setRegErr] = useState("");
  const [resources, setResources] = useState([]);
  const [venues, setVenues] = useState([]);
  const [failed, setFailed] = useState(false);

  function changeLang(l) {
    langState.lang = l;
    setLang(l);
  }
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (getToken()) setUser(restoreUser() || null);
  }, []);

  // Live data: the same public endpoints the home page reads.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [res, ven] = await Promise.all([
          apiGet("/api/resources?sort=hot"),
          apiGet("/api/venues"),
        ]);
        if (!alive) return;
        setResources(Array.isArray(res.resources) ? res.resources : []);
        setVenues(Array.isArray(ven.venues) ? ven.venues : []);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function doLogin(u, p) {
    setLoginErr("");
    try {
      const d = await apiPost("/api/auth/login", { username: u, password: p });
      setToken(d.token, d.user);
      setUser(d.user);
      setShowLogin(false);
    } catch (e) {
      setLoginErr(String(e.message || t("loginErr")));
    }
  }
  async function doRegister(u, p, name) {
    setRegErr("");
    try {
      const d = await apiPost("/api/auth/register", { username: u, password: p, name });
      setToken(d.token, d.user);
      setUser(d.user);
      setShowReg(false);
    } catch (e) {
      setRegErr(String(e.message || t("regErr")));
    }
  }
  function doLogout() {
    clearToken();
    setUser(null);
    setMenuOpen(false);
  }

  // Featured shows: real resources in the show category, by real views.
  const shows = resources
    .filter((r) => apiCatId(r.category) === "show")
    .slice()
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 4);
  const showCount = resources.filter((r) => apiCatId(r.category) === "show").length;
  const catCount = new Set(resources.map((r) => apiCatId(r.category))).size;

  const stats = [
    [resources.length, t("sRes")],
    [showCount, t("sShow")],
    [venues.length, t("sVenue")],
    [catCount, t("sCat")],
  ];

  return (
    <>
      <Header
        variant="brand" user={user} lang={lang} onLangChange={changeLang}
        cartCount={0} onOpenDrawer={() => {}}
        onLoginClick={() => setShowLogin(true)} onLogout={doLogout}
        onMenuOrders={() => { window.location.href = "user.html"; }}
        menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} onCloseMenu={() => setMenuOpen(false)}
        navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} onNavLinkClick={() => setNavOpen(false)}
      />

      <main>
        {/* Hero — the platform name + the mission line from the project
            design doc (01-xiang-mu-gai-shu.md:7), never a new slogan. */}
        <section className="hero brand-hero" id="top">
          <img className="hero-img" src={heroImg} alt="" />
          <div className="hero-shade"></div>
          <div className="wrap hero-in">
            <p className="hero-kicker">{t("brandHeroKicker")}</p>
            <h1>桂<em>演</em></h1>
            <p className="hero-sub">{t("brandHeroSub")}</p>
            <p className="hero-lead">{t("heroLead")}</p>
            <div className="brand-cta">
              <a className="btn red" href="index.html#catalog">{t("brandCtaBook")}</a>
              <a className="btn ghost" href="index.html#catalog">{t("navCatalog")}</a>
            </div>
          </div>
        </section>

        {/* About — short intro from the project docs; anything the docs
            do NOT contain stays 待补充 and is never invented. */}
        <section className="brand-sec" id="about">
          <div className="wrap">
            <div className="sec-head">
              <h2>{t("brandAboutTitle")}</h2>
            </div>
            <p className="brand-about">{t("brandAboutText")}</p>
          </div>
        </section>

        {/* Live stats — read from the public API at page load. */}
        <section className="brand-sec" id="stats">
          <div className="wrap">
            <div className="sec-head">
              <h2>{t("brandStatsTitle")}</h2>
            </div>
            {failed ? (
              <p className="brand-failed">{t("loadErr")}</p>
            ) : (
              <div className="brand-stats">
                {stats.map(([n, label]) => (
                  <div className="brand-stat" key={label}>
                    <b>{n}</b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Real venues — names + addresses from GET /api/venues. */}
        <section className="brand-sec" id="venues">
          <div className="wrap">
            <div className="sec-head">
              <h2>{t("brandVenuesTitle")}<span className="sub">{t("brandVenuesSub")}</span></h2>
            </div>
            <div className="brand-venues">
              {venues.map((v) => (
                <div className="brand-venue" key={v.id}>
                  <b>{v.name}</b>
                  <span>{v.address}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured shows — real resources, ordered by real views.
            Cards link to the home page detail overlay, where booking
            happens; this page itself sells nothing. */}
        <section className="brand-sec" id="shows">
          <div className="wrap">
            <div className="sec-head">
              <h2>{t("brandShowsTitle")}<span className="sub">{t("brandShowsSub")}</span></h2>
            </div>
            <div className="grid">
              {shows.map((a) => {
                const priceYuan = typeof a.price === "number" ? a.price / 100 : 0;
                return (
                  <a className="card" key={a.id} href={`index.html?detail=${a.id}`}>
                    <div className="ph">
                      <img src={CATIMG[apiCatId(a.category)] || CATIMG.show} alt={a.name} loading="lazy" />
                      <span className="city">{cityName(a.city)}</span>
                    </div>
                    <div className="bd">
                      <span className="catline">{catName(a.category)} · {cityName(a.city)}</span>
                      <h3>{a.name}</h3>
                      <p>{a.description || a.name}</p>
                      <div className="ft">
                        <span className="price">{money(priceYuan)}</span>
                        <span className="unit">/ {unitName(a.unit || "张")}</span>
                        <span className="views">{a.views || 0} {t("viewsUnit")}</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>

        {/* Partner channels — the client's existing channels only. */}
        <section className="brand-sec" id="channels">
          <div className="wrap">
            <div className="sec-head">
              <h2>{t("brandChannelsTitle")}<span className="sub">{t("brandChannelsSub")}</span></h2>
            </div>
            <div className="brand-channels">
              {CHANNELS.map((c) => (
                <div className="brand-channel" key={c}>{c}</div>
              ))}
            </div>
          </div>
        </section>
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
                <li><a href="brand.html">{t("brandNav")}</a></li>
              </ul>
            </div>
            <div>
              <h5>{t("footCats")}</h5>
              <ul>
                {["show", "heritage", "tourism", "digital"].map((id) => (
                  <li key={id}><a href="index.html#catalog">{catBoth(id)}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h5>{t("footHelp")}</h5>
              <ul>
                <li><a href="index.html#ai">{t("helpRefund")}</a></li>
                <li><a href="index.html#ai">{t("helpBook")}</a></li>
                <li><a href="index.html#ai">{t("helpResched")}</a></li>
              </ul>
            </div>
          </div>
          <div className="foot-note">
            <span>© 2026 桂演 Guiyan</span>
            <span>{t("footPrice")}</span>
            <a href="https://github.com/lam01244410430/guiyan-platform" target="_blank" rel="noreferrer">GitHub · lam01244410430/guiyan-platform</a>
          </div>
        </div>
      </footer>

      <LoginDialog
        open={showLogin}
        err={loginErr}
        onClose={() => setShowLogin(false)}
        onLogin={doLogin}
        onRegisterClick={() => {
          setShowLogin(false);
          setShowReg(true);
        }}
      />
      <RegisterDialog
        open={showReg}
        err={regErr}
        onClose={() => setShowReg(false)}
        onRegister={doRegister}
        onLoginClick={() => {
          setShowReg(false);
          setShowLogin(true);
        }}
      />
    </>
  );
}
