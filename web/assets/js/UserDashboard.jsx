/* Guiyan user dashboard (React) — port of web/assets/js/user.js +
   web/user.html. Uses only existing customer endpoints (GET /api/orders,
   /api/favorites, /api/demands; POST /api/orders/:id/<action>). Order
   actions follow the same state machine as the SPA's My Tickets drawer. */
import { useCallback, useEffect, useRef, useState } from "react";
import { langState, t, fmt, CATS, catName, unitName } from "./data.js";
import {
  apiGet, apiPost, currentUser, getToken, setToken, clearToken,
  restoreUser, fmtMoney, statusKey,
} from "./apiClient.js";
import { Header, LoginDialog, Toast } from "./chrome.jsx";

export default function UserDashboard() {
  const [lang, setLangState] = useState(langState.lang);
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [gate, setGate] = useState(true); /* true = show login gate, false = show main */
  const [usrOrders, setUsrOrders] = useState([]);
  const [usrFavs, setUsrFavs] = useState([]);
  const [usrDemands, setUsrDemands] = useState([]);
  const toastTimer = useRef(null);
  const ordersHRef = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  function changeLang(l) {
    if (l === lang) return;
    langState.lang = l;
    setLangState(l);
    setMenuOpen(false);
    usrLoad();
  }

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  const usrLoadOrders = useCallback(() => {
    return apiGet("/api/orders").then(function (d) { setUsrOrders(d.orders || []); });
  }, []);

  const usrLoad = useCallback(() => {
    const u = currentUser();
    if (!getToken() || !u) { setGate(true); return; }
    Promise.all([usrLoadOrders(), apiGet("/api/favorites"), apiGet("/api/demands")]).then(function (res) {
      setUsrFavs(res[1].favorites || []);
      setUsrDemands((res[2].demands || []).filter(function (d) { return d.user_id === u.id; }));
      setGate(false);
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      toast(t("loadErr"));
    });
  }, [toast, usrLoadOrders]);

  useEffect(() => {
    restoreUser();
    setUser(currentUser());
    usrLoad();
    const onKey = (e) => {
      if (e.key === "Escape") { setMenuOpen(false); setNavOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doLogin(u, pw) {
    setLoginErr("");
    apiPost("/api/auth/login", { username: u, password: pw }).then(function (d) {
      if (d && d.token) {
        setToken(d.token, d.user || { username: u, name: u });
        setUser(currentUser()); setLoginOpen(false); usrLoad();
      } else { setLoginErr(t("loginFailed")); }
    }).catch(function (e) {
      if (e && e.status === 401) { setLoginErr(t("loginFailed")); }
      else { setLoginErr(t("loadErr")); }
    });
  }
  function doLogout() {
    const tk = getToken();
    if (tk) apiPost("/api/auth/logout", {}).catch(function () {});
    clearToken(); setUser(null); setMenuOpen(false);
    usrLoad();
  }

  function usrOrderAction(act, id) {
    apiPost("/api/orders/" + encodeURIComponent(id) + "/" + act, {}).then(function () {
      toast(t("statusToast"));
      usrLoadOrders();
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); setUser(null); setGate(true); return; }
      if (e && e.data && e.data.error) toast(e.data.error);
      usrLoadOrders();
    });
  }

  function usrActs(o) {
    if (o.status === "pending") return (<><button type="button" className="mini" data-act="confirm" data-id={o.id} onClick={() => usrOrderAction("confirm", o.id)}>{t("actConfirm")}</button><button type="button" className="mini" data-act="cancel" data-id={o.id} onClick={() => usrOrderAction("cancel", o.id)}>{t("actCancel")}</button></>);
    if (o.status === "confirmed") return (<><button type="button" className="mini red" data-act="pay" data-id={o.id} onClick={() => usrOrderAction("pay", o.id)}>{fmt(t("actPay"), { amt: fmtMoney(o.amount) })}</button><button type="button" className="mini" data-act="cancel" data-id={o.id} onClick={() => usrOrderAction("cancel", o.id)}>{t("actCancel")}</button></>);
    if (o.status === "paid") return (<><button type="button" className="mini red" data-act="complete" data-id={o.id} onClick={() => usrOrderAction("complete", o.id)}>{t("actComplete")}</button><button type="button" className="mini" data-act="refund" data-id={o.id} onClick={() => usrOrderAction("refund", o.id)}>{t("actRefund")}</button></>);
    if (o.status === "completed") return (<span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("doneNote")}</span>);
    return null;
  }

  const u = user;
  const prof = u ? [
    ["lblName", u.name || ""],
    ["lblUsername", u.username || ""],
    ["lblCity", u.city || "—"],
    ["lblAge", (u.age == null ? "—" : u.age)],
    ["lblChannel", u.channel || "—"],
    ["lblPref", u.preference || "—"],
    ["lblVerified", u.verified ? t("verifiedYes") : t("verifiedNo")],
  ] : [];

  return (
    <>
      <Header
        variant="user" user={user} lang={lang} onLangChange={changeLang}
        cartCount={0} onOpenDrawer={() => {}}
        onLoginClick={() => setLoginOpen(true)} onLogout={doLogout}
        onMenuOrders={() => { if (ordersHRef.current) ordersHRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }}
        menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} onCloseMenu={() => setMenuOpen(false)}
        navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} onNavLinkClick={() => setNavOpen(false)}
      />

      <main className="db-page">
        <div className="wrap">
          <div className="sec-head">
            <span className="no">01</span>
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

              <section className="db-sec">
                <h3 ref={ordersHRef}>{t("usrOrders")}</h3>
                <div className="db-list" id="ordersList">
                  {usrOrders.length ? usrOrders.map((o) => (
                    <div key={o.id} className="order">
                      <h4>{o.resource_name || ""}</h4>
                      <span className="code">{o.code} · {o.booking_date || ""} · {o.quantity} × {unitName(o.unit || "")} · {fmtMoney(o.amount)}</span>
                      <div className="row">
                        <span className={"pill " + o.status}>{t(statusKey(o.status))}</span>
                        <span className="db-actions">{usrActs(o)}</span>
                      </div>
                    </div>
                  )) : <div className="db-empty">{t("emptyOrders")}</div>}
                </div>
              </section>

              <section className="db-sec">
                <h3>{t("usrFavs")}</h3>
                <div className="db-scroll">
                  <table className="db-table">
                    <thead><tr><th>{t("colName")}</th><th>{t("colResource")}</th><th>{t("colCity")}</th><th className="num">{t("colPrice")}</th><th></th></tr></thead>
                    <tbody id="favsBody">
                      {usrFavs.length ? usrFavs.map((r) => (
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

              <section className="db-sec">
                <h3>{t("usrDemands")}</h3>
                <div className="db-scroll">
                  <table className="db-table">
                    <thead><tr><th>{t("colTitle")}</th><th>{t("colResource")}</th><th className="num">{t("colBudget")}</th><th>{t("colCity")}</th><th>{t("colStatus")}</th></tr></thead>
                    <tbody id="demsBody">
                      {usrDemands.length ? usrDemands.map((d) => (
                        <tr key={d.id}>
                          <td>{d.title}</td><td>{catName(d.category)}</td>
                          <td className="num">{fmtMoney(d.budget)}</td><td>{d.city}</td><td>{d.status || ""}</td>
                        </tr>
                      )) : <tr><td colSpan="5"><div className="db-empty">{t("emptyMyDemands")}</div></td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
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

      <LoginDialog open={loginOpen} err={loginErr} onClose={() => setLoginOpen(false)} onLogin={doLogin} />
      <Toast msg={toastMsg} />
    </>
  );
}
