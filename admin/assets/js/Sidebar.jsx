/* Guiyan admin sidebar (layout restructure 2026-11-14) — nav only.
   Split out of AdminDashboard.jsx: the 27-item NAV config (2 groups
   main/premium) + the inlined nav icons. No logic, no data fetching —
   it only renders the nav and calls onSelect(view). The operator card
   + 返回首页 live in AppHeader (shell split). */
/* Nav icons are inlined (not <img>) so currentColor inherits the button
   colour — the gold active icon (DESIGN.md §5) is impossible through
   <img>, where currentColor resolves to black. Path data copied verbatim
   from admin/assets/icons/*.svg (stroke-width 1.7 per §6, 1.6–1.8px);
   the icon files themselves are untouched. */
const NAV_ICONS = {
  overview: (<><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>),
  orders: (<><path d="M12 17V7m4 1h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" /><path d="M4 3a1 1 0 0 1 1-1a1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1a1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2a1 1 0 0 1-1-1z" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></>),
  resources: (<><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" /></>),
  demands: (<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m4 7h4m-4 5h4m-8-5h.01M8 16h.01" /></>),
  // R6-5 评论审核: Lucide message-square glyph (verbatim path data).
  comments: (<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>),
  shops: (<><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M9 21v-6h6v6" /></>),
  shows: (<><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></>),
  venues: (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  trends: (<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></>),
  analysis: (<><path d="M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></>),
  alerts: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  tagrules: (<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>),
  aicopy: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  account: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  tiers: (<><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></>),
  // R3-6 文惠卡: same crown glyph as 会员等级 (member card) — there is
  // no dedicated wallet glyph in admin/assets/icons/ yet.
  storedvalue: (<><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></>),
  // R4-1 核销: same ticket glyph as 演出 (no dedicated scan glyph in
  // admin/assets/icons/ yet). Staff = admin role — there is no
  // separate staff role in this system.
  verify: (<><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></>),
};
function NavIcon({ v }) {
  return (
    <svg className="ic" data-icon={v.iconName} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS[v.id]}</svg>
  );
}

const VIEWS = [
  { id: "overview", label: "总览", iconName: "ui:layout-dashboard", group: "main" },
  { id: "orders", label: "订单", iconName: "ui:receipt", group: "main" },
  { id: "users", label: "用户", iconName: "ui:users", group: "main" },
  { id: "account", label: "账号", iconName: "ui:user", group: "main" },
  { id: "tagrules", label: "标签规则", iconName: "ui:tags", group: "main" },
  { id: "aicopy", label: "文案生成", iconName: "ui:pen", group: "main" },
  { id: "ipconfig", label: "IP 配置", iconName: "ui:pen", group: "main" },
  { id: "resources", label: "资源", iconName: "ui:layers", group: "main" },
  { id: "licenses", label: "版权登记", iconName: "ui:scroll-text", group: "main" },
  { id: "shows", label: "演出", iconName: "ui:ticket", group: "main" },
  { id: "venues", label: "场馆", iconName: "ui:map-pin", group: "main" },
  { id: "tiers", label: "会员等级", iconName: "ui:crown", group: "main" },
  { id: "coupons", label: "优惠券", iconName: "ui:percent", group: "main" },
  { id: "flashsales", label: "限时抢购", iconName: "ui:percent", group: "main" },
  { id: "autorules", label: "自动发券", iconName: "ui:gift", group: "main" },
  { id: "smstasks", label: "短信群发", iconName: "ui:pen", group: "main" },
  { id: "storedvalue", label: "文惠卡", iconName: "ui:crown", group: "main" },
  { id: "verify", label: "核销", iconName: "ui:ticket", group: "main" },
  { id: "shops", label: "店铺", iconName: "ui:store", group: "main" },
  { id: "demands", label: "需求", iconName: "ui:clipboard-list", group: "main" },
  { id: "comments", label: "评论审核", iconName: "ui:message-square", group: "main" },
  { id: "trends", label: "趋势统计", iconName: "ui:chart-line", group: "premium" },
  { id: "analysis", label: "经营分析", iconName: "ui:scroll-text", group: "premium" },
  { id: "alerts", label: "预警中心", iconName: "ui:triangle-alert", group: "premium" },
  { id: "events", label: "数据运营", iconName: "ui:chart-line", group: "premium" },
  { id: "memberinsights", label: "会员数据", iconName: "ui:crown", group: "premium" },
  { id: "bi", label: "数据大屏", iconName: "ui:chart-line", group: "premium" },
  { id: "financeledger", label: "财务账本", iconName: "ui:scroll-text", group: "premium" },
];

export default function Sidebar({ view, onSelect, drawerOpen }) {
  return (
    <aside className={"sidebar" + (drawerOpen ? " open" : "")} id="adminSidebar">
      <div className="mark">桂演<small>Admin Console</small></div>
      <nav>
        {VIEWS.filter((v) => v.group === "main").map((v) => (
          <button key={v.id} type="button" data-view={v.id} className={view === v.id ? "on" : ""}
            aria-current={view === v.id ? "page" : undefined} onClick={() => onSelect(v.id)}>
            <NavIcon v={v} />
            {v.label}
          </button>
        ))}
        <div className="nav-div" aria-hidden="true"></div>
        <div className="nav-group">经营分析</div>
        {VIEWS.filter((v) => v.group === "premium").map((v) => (
          <button key={v.id} type="button" data-view={v.id} className={view === v.id ? "on" : ""}
            aria-current={view === v.id ? "page" : undefined} onClick={() => onSelect(v.id)}>
            <NavIcon v={v} />
            {v.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
