/* Guiyan admin header (layout restructure 2026-11-14) — page head only.
   Split out of AdminDashboard.jsx: breadcrumb + page title + badge +
   notification bell + 返回首页 + operator card. The bell reuses the
   alerts + audit state the alerts view already loads (passed in as
   props from AdminDashboard — no fetching here, no new endpoints).
   The title node (h1 with #pageTitle / #pageSub) and the badge text are
   passed in from AdminDashboard — the source-grepping tests (B-030 /
   B-040 in tests/p3bugs.test.mjs) read AdminDashboard.jsx, so those
   literals must stay there. The bell badge counts UNREAD alerts only
   (red = any unread critical, yellow = any unread warning, hidden at
   zero); audit events are listed as activity and never affect the
   badge. Read state is client-side only, per account, in localStorage
   (see bellUtils.js); opening the bell marks the listed alerts read. */
import { useEffect, useRef, useState } from "react";
import {
  alertKey,
  alertSeverity,
  bellBadge,
  loadBellReadKeys,
  markBellRead,
  BELL_ALERT_LIMIT,
  BELL_AUDIT_LIMIT,
} from "./bellUtils.js";

export default function AppHeader({ viewLabel, title, badge, whoName, onLogout, drawerOpen, onToggleDrawer, hamburgerRef, alerts, auditLogs, userId, onViewAlerts }) {
  const [bellOpen, setBellOpen] = useState(false);
  const [readKeys, setReadKeys] = useState(() => loadBellReadKeys(userId));
  const bellRef = useRef(null);
  const bellBtnRef = useRef(null);

  // The signed-in account id arrives after mount (AdminDashboard
  // loads the session first), so reload the per-account read state
  // whenever it changes.
  useEffect(() => {
    setReadKeys(loadBellReadKeys(userId));
  }, [userId]);

  // Close on outside click / Esc; Esc returns focus to the bell.
  useEffect(() => {
    if (!bellOpen) return;
    function onDown(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        setBellOpen(false);
        if (bellBtnRef.current) bellBtnRef.current.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  const list = alerts || [];
  const logs = auditLogs || [];
  const badgeState = bellBadge(list, readKeys);

  function toggleBell() {
    if (bellOpen) {
      setBellOpen(false);
      return;
    }
    // Opening marks the currently listed alerts as read, so the
    // badge clears; alerts that arrive later are unread again.
    setReadKeys(markBellRead(userId, list));
    setBellOpen(true);
  }

  function viewAll() {
    setBellOpen(false);
    if (onViewAlerts) onViewAlerts();
  }

  const shownAlerts = list.slice(0, BELL_ALERT_LIMIT);
  const shownAudit = logs.slice(0, BELL_AUDIT_LIMIT);

  return (
    <header className="app-header">
      <button type="button" className="menu-btn" ref={hamburgerRef}
        aria-expanded={drawerOpen ? "true" : "false"} aria-controls="adminSidebar" aria-label="打开导航菜单"
        onClick={onToggleDrawer}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="app-header-main">
        <nav className="crumbs" aria-label="面包屑">
          {viewLabel === "总览" ? "总览" : (<>总览 <span aria-hidden="true">/</span> {viewLabel}</>)}
        </nav>
        {title}
      </div>
      <span className="badge">{badge}</span>
      <div className="bell-wrap" ref={bellRef}>
        <button type="button" className="bell-btn" ref={bellBtnRef}
          aria-label="通知" aria-expanded={bellOpen ? "true" : "false"} aria-haspopup="true"
          onClick={toggleBell}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          {badgeState.count > 0 ? (
            <span className={"bell-badge " + badgeState.level} aria-label={badgeState.count + " 条未读预警"}>{badgeState.count}</span>
          ) : null}
        </button>
        {bellOpen ? (
          <div className="bell-dropdown thin-scroll" role="dialog" aria-label="通知">
            <h3>预警</h3>
            {shownAlerts.length ? shownAlerts.map((a) => (
              <div key={alertKey(a)} className="bell-item">
                <span className={"bell-dot " + alertSeverity(a)} aria-hidden="true"></span>
                <div><div className="t">{a.title}</div>{a.detail ? <div className="d">{a.detail}</div> : null}</div>
              </div>
            )) : <div className="bell-empty">暂无预警</div>}
            <h3>最近操作</h3>
            {shownAudit.length ? shownAudit.map((l) => (
              <div key={l.id} className="bell-audit">
                {l.user_name ? l.user_name + " · " : ""}{l.action}{l.detail ? " — " + l.detail : ""}
              </div>
            )) : <div className="bell-empty">暂无操作记录</div>}
            <button type="button" className="bell-view-all" onClick={viewAll}>查看全部 →</button>
          </div>
        ) : null}
      </div>
      <a className="home-link" href="/">
        <svg className="ic" data-icon="ui:home" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>
        <span>返回首页</span>
      </a>
      <div className="op-card">
        <div><div className="nm" id="whoName">{whoName}</div><div className="rl">管理员</div></div>
        <button type="button" id="logoutBtn" onClick={onLogout}>退出</button>
      </div>
    </header>
  );
}
