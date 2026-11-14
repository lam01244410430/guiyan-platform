/* Guiyan admin login (React) — port of admin/assets/js/login.js +
   admin/index.html. Simple screen, username + password. On success stores
   the admin token and goes to dashboard.html. */
import { useEffect, useState } from "react";
import { apiPost, clearToken, currentUser, getToken, setToken } from "./adminApi.js";
import AppFooter from "./AppFooter.jsx";

export default function AdminLogin() {
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /* Already logged in as admin? Skip the form. */
  useEffect(() => {
    if (getToken()) {
      const u = currentUser();
      if (u && u.role === "admin") location.href = "/admin/dashboard.html";
    }
  }, []);

  function onSubmit(ev) {
    ev.preventDefault();
    const u = loginUser.trim(), p = loginPass;
    setErr("");
    setBusy(true);
    apiPost("/api/auth/login", { username: u, password: p }).then(function (d) {
      if (d && d.token) {
        if (d.user && d.user.role !== "admin") {
          clearToken();
          setErr("该账号无权访问管理后台");
          setBusy(false);
          return;
        }
        setToken(d.token, d.user || { username: u, name: u });
        location.href = "/admin/dashboard.html";
      } else {
        setErr("账号或密码不正确");
        setBusy(false);
      }
    }).catch(function (e) {
      setErr((e && e.data && e.data.error) || "登录失败，请稍后重试");
      setBusy(false);
    });
  }

  /* Layout restructure 2026-11-14: same header/footer shell as the
     dashboard — the brand mark in the card is the page header; the
     footer line sits below it. Behaviour unchanged. */
  return (
    <div className="login-shell">
    <div className="login-page">
      <div className="login-card">
        <div className="mark">桂演</div>
        <h1>管理后台</h1>
        <p className="sub">桂演文化惠票务 · 仅管理员可登录</p>
        <form id="loginForm" onSubmit={onSubmit}>
          <label htmlFor="loginUser">账号</label>
          <input id="loginUser" name="username" type="text" autoComplete="username" required
            value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
          <label htmlFor="loginPass">密码</label>
          <input id="loginPass" name="password" type="password" autoComplete="current-password" required
            value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
          <p className="err" id="loginErr" role="alert">{err}</p>
          <button type="submit" className="login-btn" id="loginBtn" disabled={busy}>登录</button>
        </form>
        <p className="sub" style={{ margin: "14px 0 0", textAlign: "center" }}>演示账号：admin / admin123</p>
        <a className="login-back" href="/">← 返回首页</a>
      </div>
    </div>
    <AppFooter />
    </div>
  );
}
