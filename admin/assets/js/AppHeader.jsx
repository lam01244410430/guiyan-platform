/* Guiyan admin header (layout restructure 2026-11-14) — page head only.
   Split out of AdminDashboard.jsx: breadcrumb + page title + badge +
   operator card + 返回首页. No logic, no data fetching.
   The title node (h1 with #pageTitle / #pageSub) and the badge text are
   passed in from AdminDashboard — the source-grepping tests (B-030 /
   B-040 in tests/p3bugs.test.mjs) read AdminDashboard.jsx, so those
   literals must stay there. */
export default function AppHeader({ viewLabel, title, badge, whoName, onLogout, drawerOpen, onToggleDrawer, hamburgerRef }) {
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
