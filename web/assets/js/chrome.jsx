/* Shared customer chrome (React): header with the "Hi + name" user menu,
   login dialog and toast. Ported 1:1 from web/index.html + web/user.html
   (same markup, classes, ids and behaviour); the two pages shared this
   markup before and must stay in sync, so it lives here once.
   Registration dialog added in phase 3 (POST /api/auth/register). */
import { useEffect, useRef, useState } from "react";
import { t, fmt } from "./data.js";
import { useTheme } from "./useTheme.mjs";

/* R7-7 elderly-friendly: large-text mode. The toggle lives in the
   header; the state is stored locally (localStorage key
   `guiyan-large-text`, "1" = on, default off) and applied as the
   `large-text` class on <html> (see web/assets/css/main.css). It is a
   display preference only and never affects ordering logic. */
export function isLargeText() {
  try { return localStorage.getItem("guiyan-large-text") === "1"; } catch { return false; }
}
export function applyLargeText(on) {
  try {
    if (on) localStorage.setItem("guiyan-large-text", "1");
    else localStorage.removeItem("guiyan-large-text");
  } catch { /* storage unavailable — the class still applies for this page */ }
  if (typeof document !== "undefined")
    document.documentElement.classList.toggle("large-text", !!on);
}
try { if (isLargeText() && typeof document !== "undefined") document.documentElement.classList.add("large-text"); } catch { /* no DOM/storage — default off */ }

export function GlobeIcon() {
  return (
    <svg className="globe" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function WxIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.7 4C5 4 2 6.6 2 9.8c0 1.8 1 3.4 2.5 4.5l-.6 2.1 2.4-1.2c.5.2 1.1.3 1.7.3.2 0 .4 0 .6-.1A5.6 5.6 0 0 1 8.2 12c0-3.4 3.3-6.1 7.3-6.1h.4C15 4.7 12.1 4 8.7 4zm7.3 3.6c-3.2 0-5.8 2-5.8 4.4s2.6 4.4 5.8 4.4c.6 0 1.1-.1 1.6-.2l2 1-.5-1.8c1.4-.8 2.3-2 2.3-3.4 0-2.4-2.6-4.4-5.8-4.4zM6.6 8.6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.7 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm2.5 2.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm4.1 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 7h15l-1.5 9h-12z" /><path d="M6 7L5 3H2" /><circle cx="9" cy="20" r="1.6" /><circle cx="17" cy="20" r="1.6" />
    </svg>
  );
}

/* Theme toggle icons (vector, stroke 2 like the other header icons).
   Moon = switch to dark, sun = switch to light. */
function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19" />
    </svg>
  );
}

/* props:
   variant "index" | "user" — nav hrefs, brand href, WeChat + cart buttons
   (index only) differ; everything else is identical.
   user: null when logged out, else {name, username, ...}
   cartCount, onOpenDrawer, onMenuOrders, onLoginClick, onLogout,
   lang, onLangChange, menuOpen, onToggleMenu, onCloseMenu,
   navOpen, onToggleNav, onNavLinkClick */
export function Header(props) {
  const { variant, user, lang } = props;
  const menuRef = useRef(null);
  const [largeText, setLargeTextState] = useState(() => isLargeText());
  /* Theme toggle (header, compact): same state as the settings control —
     useTheme() subscribes, so a change in either place re-renders both. */
  const { effective: themeEffective, toggleTheme } = useTheme();

  /* Close the user menu on an outside click (same as the old listener). */
  useEffect(() => {
    if (!props.menuOpen) return undefined;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) props.onCloseMenu();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [props.menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const navLinks = variant === "index"
    ? [["#catalog", "navCatalog"], ["#demands", "navDemands"], ["#ai", "navAssistant"], ["#wechat", "navWechat"]]
    : [["index.html#catalog", "navCatalog"], ["index.html#demands", "navDemands"], ["index.html#ai", "navAssistant"], ["user.html", "navUser"]];
  const name = user ? (user.name || user.username || "demo") : "demo";

  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href={variant === "index" ? "#top" : "index.html"}>
          <span className="zh">桂演</span><small>{t("brandTag")}</small>
        </a>
        <button className="menuBtn" id="menuBtn" type="button" aria-label="Menu" aria-expanded={props.navOpen ? "true" : "false"} aria-controls="mainNav" onClick={props.onToggleNav}>
          <MenuIcon />
        </button>
        <nav className={"mainnav" + (props.navOpen ? " open" : "")} id="mainNav">
          {navLinks.map(([href, key]) => (
            <a key={key} href={href} onClick={props.onNavLinkClick}>{t(key)}</a>
          ))}
        </nav>
        <label className="langsel" aria-label="Language">
          <GlobeIcon />
          <select id="langSel" aria-label="Language" value={lang} onChange={(e) => props.onLangChange(e.target.value)}>
            <option value="zh">中文</option>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
            <option value="th">ภาษาไทย</option>
            <option value="ms">Bahasa Melayu</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </label>
        <button className="largetextbtn" type="button" aria-pressed={largeText ? "true" : "false"} title={t("largeText")}
          onClick={() => { const next = !largeText; setLargeTextState(next); applyLargeText(next); }}>
          <span>{t("largeText")}</span>
        </button>
        <button className="themebtn" id="themeBtn" type="button" onClick={toggleTheme}
          aria-label={t("themeToggle")} title={t("themeToggle")}
          aria-pressed={themeEffective === "dark" ? "true" : "false"}>
          {themeEffective === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        {variant === "index" && (
          <a className="wxbtn" href="#wechat"><WxIcon /><span>{t("navWechat")}</span></a>
        )}
        {variant === "index" && (
          <button className="cartbtn" id="openOrders" type="button" onClick={props.onOpenDrawer}>
            <CartIcon />
            <span className="lbl">{t("myTickets")}</span> <b id="orderCount">{props.cartCount}</b>
          </button>
        )}
        {!user && (
          <button className="cartbtn" id="loginBtn" type="button" onClick={props.onLoginClick}>
            <span>{t("loginBtn")}</span>
          </button>
        )}
        {user && (
          <div className={"user-menu" + (props.menuOpen ? " open" : "")} id="loginState" ref={menuRef}>
            <button className="user-chip" id="userChip" type="button" aria-haspopup="menu" aria-expanded={props.menuOpen ? "true" : "false"}
              onClick={(e) => { e.stopPropagation(); props.onToggleMenu(); }}>
              <span className="avatar" id="userAvatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : name.charAt(0).toUpperCase()}</span>
              <span id="loginName">{fmt(t("hiName"), { name })}</span>
              <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div className="user-drop" id="userDrop" role="menu">
              <a href="user.html" role="menuitem">{t("navUser")}</a>
              <hr />
              <button type="button" id="menuOrders" role="menuitem" onClick={() => { props.onCloseMenu(); props.onMenuOrders(); }}>{t("usrOrders")}</button>
              <hr />
              <button type="button" className="danger" id="logoutBtn" role="menuitem" onClick={props.onLogout}>{t("logoutBtn")}</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/* Login dialog (PostgreSQL API auth; password field is empty by design).
   Always mounted, shown with the .open class — same as before, so the
   typed values survive closing and reopening. */
export function LoginDialog({ open, err, onClose, onLogin, onRegisterClick }) {
  const [loginUser, setLoginUser] = useState("demo");
  const [loginPass, setLoginPass] = useState("");
  const userRef = useRef(null);

  useEffect(() => {
    if (open && userRef.current) userRef.current.focus();
  }, [open ]);

  return (
    <div className={"auth-overlay" + (open ? " open" : "")} id="loginOverlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="auth-card" id="loginForm" onSubmit={(e) => { e.preventDefault(); onLogin(loginUser.trim() || "demo", loginPass); }}>
        <button type="button" className="x" id="loginCancel" aria-label="Close" onClick={onClose}>✕</button>
        <h3>{t("loginTitle")}</h3>
        <input id="loginUser" ref={userRef} type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" placeholder={t("userPh")} />
        <input id="loginPass" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} autoComplete="current-password" placeholder={t("passPh")} />
        <div className="err" id="loginErr">{err || ""}</div>
        <div className="row"><button className="btn red" type="submit">{t("loginBtn")}</button></div>
        <div className="row"><button type="button" className="linklike" id="toRegister" onClick={onRegisterClick}>{t("regToRegister")}</button></div>
      </form>
    </div>
  );
}

/* Register dialog (phase 3). Client validation mirrors the API exactly:
   username 3–20 [A-Za-z0-9_], password >= 6, name required, email
   optional but must match the API format when given. Server errors
   (e.g. duplicate username) arrive via the err prop. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterDialog({ open, err, onClose, onRegister, onLoginClick }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [localErr, setLocalErr] = useState("");
  const userRef = useRef(null);

  useEffect(() => {
    if (open && userRef.current) userRef.current.focus();
  }, [open ]);

  useEffect(() => { if (!open) setLocalErr(""); }, [open]);

  function submit(e) {
    e.preventDefault();
    const u = username.trim();
    if (!USERNAME_RE.test(u)) { setLocalErr(t("regUserInvalid")); return; }
    if (password.trim().length < 6) { setLocalErr(t("regPassShort")); return; }
    if (!name.trim()) { setLocalErr(t("regNameRequired")); return; }
    const em = email.trim();
    if (em && !EMAIL_RE.test(em)) { setLocalErr(t("regEmailInvalid")); return; }
    setLocalErr("");
    onRegister({ username: u, password: password.trim(), name: name.trim(), email: em || undefined });
  }

  return (
    <div className={"auth-overlay" + (open ? " open" : "")} id="registerOverlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="auth-card" id="registerForm" onSubmit={submit}>
        <button type="button" className="x" id="registerCancel" aria-label="Close" onClick={onClose}>✕</button>
        <h3>{t("registerTitle")}</h3>
        <input id="regUser" ref={userRef} type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder={t("userPh")} />
        <input id="regPass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={t("passPh")} />
        <input id="regName" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t("namePh")} />
        <input id="regEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={t("emailPh")} />
        <div className="err" id="registerErr">{localErr || err || ""}</div>
        <div className="row"><button className="btn red" type="submit">{t("registerBtn")}</button></div>
        <div className="row"><button type="button" className="linklike" id="toLogin" onClick={onLoginClick}>{t("regToLogin")}</button></div>
      </form>
    </div>
  );
}

export function Toast({ msg }) {
  return <div className={"toast" + (msg ? " show" : "")} id="toast" role="status">{msg || ""}</div>;
}
