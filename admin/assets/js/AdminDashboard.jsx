/* Guiyan admin dashboard (React) — port of admin/assets/js/dashboard.js +
   admin/dashboard.html. Loads /api/admin/stats, /api/admin/orders,
   /api/admin/users and /api/admin/demands (admin role only) plus public
   /api/resources. Demands come from the admin endpoint because the public
   list hides pending ones; the stat card counts all demands.
   Premium views (Phase 5): 趋势统计 / 经营分析 / 预警中心 reuse the
   server/routes/admin-insights.mjs backend (stats by period, analysis,
   alerts, CSV export, demand review, audit logs). The 5 original views
   stay read-only; the premium views have write actions (review demands,
   trigger/resolve simulated alerts, export CSV) and every write lands in
   audit_logs. Premium data loads lazily, only when its view opens. */
import { useEffect, useRef, useState } from "react";
import {
  apiGet, apiPost, apiPatch, apiDownloadCsv, clearToken, currentUser, getToken, fmtMoney, STATUS,
} from "./adminApi.js";
import TrendChart from "./TrendChart.jsx";
import SearchBox from "./SearchBox.jsx";
// catZh maps a category id (show/venue/…) to its Chinese name, from a
// verbatim copy of the CATS table (admin/assets/js/cats.js). It used to
// come from web/assets/js/data.js, which dragged the whole 866 KB data
// file (i18n + base64 images) into the admin bundle as a separate chunk.
import { catZh } from "./cats.js";
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
  trends: (<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></>),
  analysis: (<><path d="M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></>),
  alerts: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
};
function NavIcon({ v }) {
  return (
    <svg className="ic" data-icon={v.iconName} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS[v.id]}</svg>
  );
}
/* fmtMoney() returns one string ("¥158,028"); split the ¥ out so only
   the unit renders gold in the hero numeral (DESIGN.md §2). adminApi.js
   is out of scope, so the split stays local. */
function heroMoney(v) {
  const s = fmtMoney(v);
  return (<><em>¥</em>{s.slice(1)}</>);
}

/* Order status breakdown: one row per status — label + bar sized to the
   real share + count. All six canonical statuses always render (a status
   missing from orders_by_status counts as 0); the total comes from the
   same /api/admin/stats response. No invented figures. */
const ORDER_STATUS = ["pending", "confirmed", "paid", "completed", "cancelled", "refunded"];
const DEMAND_STATUS = { approved: "已通过", pending: "待审核", rejected: "已拒绝" };
const VIEWS = [
  { id: "overview", label: "总览", iconName: "ui:layout-dashboard", group: "main" },
  { id: "orders", label: "订单", iconName: "ui:receipt", group: "main" },
  { id: "users", label: "用户", iconName: "ui:users", group: "main" },
  { id: "resources", label: "资源", iconName: "ui:layers", group: "main" },
  { id: "demands", label: "需求", iconName: "ui:clipboard-list", group: "main" },
  { id: "trends", label: "趋势统计", iconName: "ui:chart-line", group: "premium" },
  { id: "analysis", label: "经营分析", iconName: "ui:scroll-text", group: "premium" },
  { id: "alerts", label: "预警中心", iconName: "ui:triangle-alert", group: "premium" },
];
const PREMIUM_VIEWS = ["trends", "analysis", "alerts"];
const FILTERS = [
  ["all", "全部"], ["pending", "待确认"], ["confirmed", "已确认"], ["paid", "已支付"],
  ["completed", "已完成"], ["cancelled", "已取消"], ["refunded", "已退款"],
];
const PERIODS = [["day", "日"], ["week", "周"], ["month", "月"], ["quarter", "季"]];
const ALERT_KINDS = [
  ["sales", "销量突降"], ["verification", "核销异常"], ["inventory", "库存异常"],
  ["data", "数据异常"], ["sentiment", "潜在舆情风险"],
];

function OrderRow({ o }) {
  return (
    <tr>
      <td className="code">{o.code}</td><td>{o.user_name || ""}</td><td>{o.resource_name || ""}</td>
      <td className="num">{fmtMoney(o.amount)}</td><td>{o.booking_date || ""}</td>
      <td><span className={"pill " + o.status}>{STATUS[o.status] || o.status}</span></td>
    </tr>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);
  const [demands, setDemands] = useState([]);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("overview");
  // One shared search query for the current view; reset on every view
  // change so a query never leaks into another view. Changing `period`
  // inside trends/analysis does NOT reset it (same view).
  const [query, setQuery] = useState("");
  function changeView(v) { setView(v); setQuery(""); setDrawerOpen(false); }
  // Mobile drawer (≤860px): open state + Esc closes + focus returns to
  // the hamburger. Desktop sidebar is unaffected (drawer CSS only
  // applies at ≤860px).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hamburgerRef = useRef(null);
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        if (hamburgerRef.current) hamburgerRef.current.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  const [whoName, setWhoName] = useState("管理员");
  const [forbidden, setForbidden] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef(null);
  // Premium state (lazy-loaded, see the effect below).
  const [period, setPeriod] = useState("day");
  const [seriesData, setSeriesData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisStale, setAnalysisStale] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [threshold, setThreshold] = useState(5);
  const [auditLogs, setAuditLogs] = useState([]);
  const [csvBusy, setCsvBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [triggerBusy, setTriggerBusy] = useState("");
  const loadedRef = useRef({ trends: "", analysis: "", alerts: false });
  // Monotonic request id: guards the lazy period fetches below against
  // out-of-order responses when the user switches period quickly — only
  // the newest request may set state / mark its period loaded.
  const requestSeqRef = useRef(0);

  function toast(msg) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }
  function loadFail(e) {
    if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
    if (e && e.status === 403) { setForbidden(true); return; }
    toast("加载失败，请稍后重试");
  }
  function loadAlerts() {
    apiGet("/api/admin/alerts").then(function (d) {
      setAlerts(d.alerts || []); setThreshold(d.threshold ?? 5);
    }).catch(loadFail);
  }
  function loadAudit() {
    apiGet("/api/admin/audit-logs").then(function (d) {
      setAuditLogs(d.logs || []);
    }).catch(loadFail);
  }

  useEffect(() => {
    const u = currentUser();
    if (!getToken() || !u) { location.href = "/admin/index.html"; return; }
    setWhoName(u.name || u.username || "管理员");
    Promise.all([
      apiGet("/api/admin/stats"), apiGet("/api/admin/orders"), apiGet("/api/admin/users"),
      apiGet("/api/resources"), apiGet("/api/admin/demands"),
    ]).then(function (res) {
      setStats(res[0]);
      setOrders(res[1].orders || []);
      setUsers(res[2].users || []);
      setResources(res[3].resources || []);
      setDemands(res[4].demands || []);
      setView("overview");
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      if (e && e.status === 403) { setForbidden(true); return; }
      toast("加载失败，请稍后重试");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Premium data loads lazily: only when its view opens (and refetches
  // when `period` changes or after an alert mutation busts the cache).
  useEffect(() => {
    if (view === "trends" && loadedRef.current.trends !== period) {
      const seq = ++requestSeqRef.current;
      apiGet("/api/admin/stats?period=" + period).then(function (d) {
        if (seq !== requestSeqRef.current) return;
        setSeriesData(d); loadedRef.current.trends = period;
      }).catch(loadFail);
    }
    if (view === "analysis" && (loadedRef.current.analysis !== period || analysisStale)) {
      const seq = ++requestSeqRef.current;
      apiGet("/api/admin/analysis?period=" + period).then(function (d) {
        if (seq !== requestSeqRef.current) return;
        setAnalysis(d); loadedRef.current.analysis = period; setAnalysisStale(false);
      }).catch(loadFail);
    }
    if (view === "alerts" && !loadedRef.current.alerts) {
      loadedRef.current.alerts = true;
      loadAlerts(); loadAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, period, analysisStale]);

  function doLogout() {
    apiPost("/api/auth/logout", {}).catch(function () {});
    clearToken();
    location.href = "/admin/index.html";
  }

  function doExportCsv() {
    if (csvBusy) return;
    setCsvBusy(true);
    apiDownloadCsv("/api/admin/orders.csv", "guiyan-orders.csv").then(function () {
      toast("已导出订单CSV");
      loadAudit();
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权导出");
      else toast("导出失败，请稍后重试");
    }).finally(function () { setCsvBusy(false); });
  }

  function doReviewDemand(id, status) {
    if (reviewBusyId !== null) return;
    setReviewBusyId(id);
    apiPatch("/api/admin/demands/" + id, { status }).then(function () {
      setDemands(function (ds) { return ds.map(function (d) { return d.id === id ? { ...d, status } : d; }); });
      // Review busts the cached admin stats on the server.
      apiGet("/api/admin/stats").then(setStats).catch(function () {});
      loadAudit();
      toast(status === "approved" ? "已通过" : "已拒绝");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权审核");
      else if (e && e.status === 404) toast("需求不存在");
      else toast("审核失败，请稍后重试");
    }).finally(function () { setReviewBusyId(null); });
  }

  function doTriggerAlert(kind) {
    if (triggerBusy) return;
    setTriggerBusy(kind);
    apiPost("/api/admin/alerts", { kind }).then(function () {
      toast("已触发模拟预警");
      loadAlerts(); loadAudit(); setAnalysisStale(true);
    }).catch(function () { toast("触发失败，请稍后重试"); })
      .finally(function () { setTriggerBusy(""); });
  }

  function doResolveAlert(id) {
    apiPost("/api/admin/alerts", { resolve: id }).then(function () {
      toast("已处理");
      loadAlerts(); loadAudit(); setAnalysisStale(true);
    }).catch(function () { toast("处理失败，请稍后重试"); });
  }

  const titles = {
    overview: ["总览", "运营数据一览"],
    orders: ["全部订单", "共 " + orders.length + " 单 · 仅查看"],
    users: ["全部用户", "共 " + users.length + " 人"],
    resources: ["资源总览", "共 " + resources.length + " 项"],
    demands: ["需求总览", "共 " + demands.length + " 条"],
    trends: ["趋势统计", "按周期查看订单趋势"],
    analysis: ["经营分析", "模拟经营分析报告"],
    alerts: ["预警中心", "库存与模拟预警 · 操作留痕"],
  };
  const by = (stats && stats.orders_by_status) || {};
  const total = ORDER_STATUS.reduce(function (n, k) { return n + (by[k] || 0); }, 0);
  // Search (redesign 2026-11-11): one query, client-side, substring match
  // (case-insensitive, trimmed; Chinese matches verbatim). No money/price/
  // stock/budget field is searched — a formatted number matches ambiguously.
  const q = query.trim().toLowerCase();
  function has(s) { return String(s ?? "").toLowerCase().includes(q); }
  function orderMatch(o) {
    return has(o.code) || has(o.user_name) || has(o.resource_name)
      || has(o.booking_date) || has(o.status) || has(STATUS[o.status]);
  }
  function userMatch(u) {
    return has(u.name) || has(u.username) || has(u.email) || has(u.city)
      || has(u.channel) || has(u.role) || has(u.verified ? "已认证" : "未认证");
  }
  function categoryMatch(c) { return has(c) || has(catZh(c)); }
  function resourceMatch(r) {
    return has(r.name) || categoryMatch(r.category) || has(r.city);
  }
  function demandMatch(d) {
    return has(d.title) || categoryMatch(d.category) || has(d.city)
      || has(d.user_name) || has(DEMAND_STATUS[d.status]);
  }
  // Orders: status chip AND search, one filter. Overview filters the
  // whole order list first and only then slices the first 8, so an older
  // order is still findable; the count is the total number of matches.
  const filteredOrders = orders.filter(function (o) {
    return (filter === "all" || o.status === filter) && (!q || orderMatch(o));
  });
  const overviewMatches = q ? orders.filter(orderMatch) : orders;
  const filteredUsers = q ? users.filter(userMatch) : users;
  const filteredResources = q ? resources.filter(resourceMatch) : resources;
  const filteredDemands = q ? demands.filter(demandMatch) : demands;
  const trendSeries = seriesData ? seriesData.series : [];
  const filteredSeries = q ? trendSeries.filter(function (s) { return has(s.label); }) : trendSeries;
  const filteredChannels = analysis && q
    ? analysis.channels.filter(function (c) { return has(c.name); }) : (analysis ? analysis.channels : []);
  const rankedWithRank = analysis ? analysis.ranking.map(function (r, i) { return { ...r, rank: i + 1 }; }) : [];
  const filteredRanking = q ? rankedWithRank.filter(function (r) { return has(r.name); }) : rankedWithRank;
  const filteredVenues = analysis && q
    ? analysis.venues.filter(function (v) { return has(v.name); }) : (analysis ? analysis.venues : []);
  const filteredAlerts = q ? alerts.filter(function (a) {
    return has(a.title) || has(a.detail) || has(a.severity === "warning" ? "预警" : "提示");
  }) : alerts;
  const filteredAudit = q ? auditLogs.filter(function (l) {
    return has(l.user_name) || has(l.action) || has(l.detail)
      || has(String(l.created_at || "").slice(0, 16));
  }) : auditLogs;
  // Search empty state (parent-side): distinct from the "no data at all"
  // state — only shown while a query is active and nothing matches.
  const searchEmpty = (colSpan) => (
    <tr><td colSpan={colSpan}><div className="empty">没有找到匹配的结果<br />
      <button type="button" className="link-btn" onClick={() => setQuery("")}>清除搜索</button>
    </div></td></tr>
  );

  const isPremium = PREMIUM_VIEWS.indexOf(view) !== -1;
  // Badge reflects real write ability, not just the premium group:
  // 订单 exports CSV (writes an audit row) and 需求 approves/rejects
  // (writes audit + notifies), so both are write views too.
  const canWrite = isPremium || view === "demands" || view === "orders";
  const reportLines = analysis && typeof analysis.report === "string" ? analysis.report.split("\n") : [];
  const reportTitle = reportLines.length ? reportLines[0] : "模拟经营分析报告";
  const reportBody = reportLines.length > 1 ? reportLines.slice(1).join("\n") : "";
  const analysisSeriesAmount = analysis ? analysis.series.reduce(function (n, s) { return n + Number(s.amount || 0); }, 0) : 0;
  const analysisSeriesCount = analysis ? analysis.series.reduce(function (n, s) { return n + Number(s.count || 0); }, 0) : 0;

  if (forbidden) {
    return (
      <div id="forbidden">
        <div className="login-page">
          <div className="login-card">
            <div className="mark">桂演</div>
            <h1>无权访问</h1>
            <p className="sub">该账号无权访问管理后台，请使用管理员账号登录。</p>
            <button type="button" className="login-btn" id="backLoginBtn" onClick={() => { clearToken(); location.href = "/admin/index.html"; }}>返回登录</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#top">跳到主要内容</a>
      <div id="app" className="admin-app">
        <aside className={"sidebar" + (drawerOpen ? " open" : "")} id="adminSidebar">
          <div className="mark">桂演<small>Admin Console</small></div>
          <nav>
            {VIEWS.filter((v) => v.group === "main").map((v) => (
              <button key={v.id} type="button" data-view={v.id} className={view === v.id ? "on" : ""}
                aria-current={view === v.id ? "page" : undefined} onClick={() => changeView(v.id)}>
                <NavIcon v={v} />
                {v.label}
              </button>
            ))}
            <div className="nav-div" aria-hidden="true"></div>
            <div className="nav-group">经营分析</div>
            {VIEWS.filter((v) => v.group === "premium").map((v) => (
              <button key={v.id} type="button" data-view={v.id} className={view === v.id ? "on" : ""}
                aria-current={view === v.id ? "page" : undefined} onClick={() => changeView(v.id)}>
                <NavIcon v={v} />
                {v.label}
              </button>
            ))}
          </nav>
          <div className="who">
            <div><div className="nm" id="whoName">{whoName}</div><div className="rl">管理员</div></div>
            <button type="button" id="logoutBtn" onClick={doLogout}>退出</button>
          </div>
        </aside>
        <div className={"drawer-backdrop" + (drawerOpen ? " open" : "")} aria-hidden="true" onClick={() => setDrawerOpen(false)}></div>
        <main className="main" id="top" tabIndex={-1}>
          <div className="main-head">
            <button type="button" className="menu-btn" ref={hamburgerRef}
              aria-expanded={drawerOpen ? "true" : "false"} aria-controls="adminSidebar" aria-label="打开导航菜单"
              onClick={() => setDrawerOpen(!drawerOpen)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <h1><span id="pageTitle">{titles[view][0]}</span><span className="sub" id="pageSub">{titles[view][1]}</span></h1>
            <span className="badge">{canWrite ? "管理操作 · 审计留痕" : "仅查看 · 只读"}</span>
          </div>

          <section className={"view" + (view === "overview" ? " on" : "")} id="view-overview">
            <div className="stats">
              <div className="stat hero"><span>总收入</span><b id="statRevenue">{heroMoney(stats ? stats.revenue_cents : 0)}</b></div>
              <div className="stat"><span>用户</span><b id="statUsers">{stats ? stats.users : 0}</b></div>
              <div className="stat"><span>订单</span><b id="statOrders">{stats ? stats.orders : 0}</b></div>
              <div className="stat"><span>资源</span><b id="statResources">{stats ? stats.resources : 0}</b></div>
              <div className="stat"><span>需求</span><b id="statDemands">{stats ? stats.demands : 0}</b></div>
            </div>
            <div className="note">订单、用户、资源仅查看；需求可在需求页审核，操作留痕。支付与 AI 均为模拟。</div>
            <div className="sec">
              <h2>订单状态</h2>
              <div id="orderBreakdown">
                {ORDER_STATUS.map((k) => {
                  const n = by[k] || 0;
                  const pct = total ? Math.round((n / total) * 100) : 0;
                  return (
                    <div key={k} className="bd-row">
                      <span className="bd-label">{STATUS[k]}</span>
                      <span className="bd-track"><span className={"bd-fill " + k} style={{ width: pct + "%" }}></span></span>
                      <span className="bd-num">{n}</span>
                    </div>
                  );
                })}
                <div className="bd-total">共 {total} 单</div>
              </div>
            </div>
            <div className="sec">
              <h2>最近订单</h2>
              <div className="search-row">
                <SearchBox id="search-overview" label="搜索订单" placeholder="输入订单号、用户名或资源名…"
                  value={query} onChange={setQuery}
                  resultCount={q ? overviewMatches.length : null}
                  countText={q ? (overviewMatches.length > 8 ? `找到 ${overviewMatches.length} 条（显示前 8 条）` : `找到 ${overviewMatches.length} 条`) : undefined} />
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th scope="col">订单号</th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num">金额</th><th scope="col">预订日期</th><th scope="col">状态</th></tr></thead>
                  <tbody id="recentBody">
                    {orders.length
                      ? (overviewMatches.length ? overviewMatches.slice(0, 8).map((o) => <OrderRow key={o.code} o={o} />)
                        : searchEmpty(6))
                      : <tr><td colSpan="6"><div className="empty">暂无订单</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className={"view" + (view === "orders" ? " on" : "")} id="view-orders">
            <div className="search-row">
              <SearchBox id="search-orders" label="搜索订单" placeholder="输入订单号、用户名或资源名…"
                value={query} onChange={setQuery} resultCount={q ? filteredOrders.length : null} />
            </div>
            <div className="trend-bar">
              <div className="chips">
                {FILTERS.map(([f, label]) => (
                  <button key={f} type="button" data-f={f} className={filter === f ? "on" : ""}
                    aria-pressed={filter === f ? "true" : "false"} onClick={() => setFilter(f)}>{label}</button>
                ))}
              </div>
              <button type="button" className="btn-export" disabled={csvBusy} onClick={doExportCsv}>{csvBusy ? "导出中…" : "导出订单CSV"}</button>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">订单号</th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num">金额</th><th scope="col">预订日期</th><th scope="col">状态</th></tr></thead>
                <tbody id="ordersBody">
                  {filteredOrders.length ? filteredOrders.map((o) => <OrderRow key={o.code} o={o} />)
                    : (q ? searchEmpty(6) : <tr><td colSpan="6"><div className="empty">暂无订单</div></td></tr>)}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "users" ? " on" : "")} id="view-users">
            <div className="search-row">
              <SearchBox id="search-users" label="搜索用户" placeholder="输入姓名、账号、邮箱或城市…"
                value={query} onChange={setQuery} resultCount={q ? filteredUsers.length : null} />
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">姓名</th><th scope="col">账号</th><th scope="col">角色</th><th scope="col">城市</th><th scope="col">渠道</th><th scope="col">认证</th></tr></thead>
                <tbody id="usersBody">
                  {users.length
                    ? (filteredUsers.length ? filteredUsers.map((usr) => (
                      <tr key={usr.username}>
                        <td>{usr.name || ""}</td><td>{usr.username}</td><td>{usr.role}</td>
                        <td>{usr.city || ""}</td><td>{usr.channel || ""}</td><td>{usr.verified ? "已认证" : "未认证"}</td>
                      </tr>
                    )) : searchEmpty(6))
                    : <tr><td colSpan="6"><div className="empty">暂无用户</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "resources" ? " on" : "")} id="view-resources">
            <div className="search-row">
              <SearchBox id="search-resources" label="搜索资源" placeholder="输入资源名、分类或城市…"
                value={query} onChange={setQuery} resultCount={q ? filteredResources.length : null} />
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">名称</th><th scope="col">分类</th><th scope="col">城市</th><th scope="col" className="num">价格</th><th scope="col" className="num">库存</th></tr></thead>
                <tbody id="resBody">
                  {resources.length
                    ? (filteredResources.length ? filteredResources.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td><td>{r.category}</td><td>{r.city}</td>
                        <td className="num">{fmtMoney(r.price)}</td><td className="num">{r.stock}</td>
                      </tr>
                    )) : searchEmpty(5))
                    : <tr><td colSpan="5"><div className="empty">暂无资源</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "demands" ? " on" : "")} id="view-demands">
            <div className="search-row">
              <SearchBox id="search-demands" label="搜索需求" placeholder="输入标题、分类、城市或发布人…"
                value={query} onChange={setQuery} resultCount={q ? filteredDemands.length : null} />
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">标题</th><th scope="col">分类</th><th scope="col" className="num">预算</th><th scope="col">城市</th><th scope="col">发布人</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="demBody">
                  {demands.length
                    ? (filteredDemands.length ? filteredDemands.map((d) => (
                      <tr key={d.id}>
                        <td>{d.title}</td><td>{d.category}</td>
                        <td className="num">{fmtMoney(d.budget)}</td><td>{d.city}</td><td>{d.user_name || ""}</td>
                        <td>{d.status === "approved" ? "已通过" : d.status === "pending" ? "待审核" : d.status === "rejected" ? "已拒绝" : (d.status || "")}</td>
                        <td>
                          {d.status === "pending" ? (
                            <span className="row-actions">
                              <button type="button" className="btn-approve" disabled={reviewBusyId === d.id} onClick={() => doReviewDemand(d.id, "approved")}>{reviewBusyId === d.id ? "处理中…" : "通过"}</button>
                              <button type="button" className="btn-reject" disabled={reviewBusyId === d.id} onClick={() => doReviewDemand(d.id, "rejected")}>{reviewBusyId === d.id ? "处理中…" : "拒绝"}</button>
                            </span>
                          ) : ""}
                        </td>
                      </tr>
                    )) : searchEmpty(7))
                    : <tr><td colSpan="7"><div className="empty">暂无需求</div></td></tr>}
                </tbody>
              </table>
            </div>
            <p className="def-note">审核结果会通知发布人，并在操作审计中留痕。</p>
          </section>

          <section className={"view" + (view === "trends" ? " on" : "")} id="view-trends">
            <div className="trend-bar">
              <div className="chips">
                {PERIODS.map(([p, label]) => (
                  <button key={p} type="button" data-period={p} className={period === p ? "on" : ""}
                    aria-pressed={period === p ? "true" : "false"} onClick={() => setPeriod(p)}>{label}</button>
                ))}
              </div>
              <button type="button" className="btn-export" disabled={csvBusy} onClick={doExportCsv}>{csvBusy ? "导出中…" : "导出订单CSV"}</button>
            </div>
            <p className="cache-note">数据最多每 60 秒更新一次（服务端缓存）。</p>
            {seriesData ? <TrendChart series={seriesData.series} period={period} /> : <div className="empty">加载中…</div>}
            {seriesData ? (
              <>
                <div className="src-chips">
                  {Object.entries(seriesData.sources || {}).map(([name, state]) => (
                    <span key={name} className="src-chip">{name} {state}</span>
                  ))}
                </div>
                <p className="def-note">按订单创建时间（北京时间）归集，补齐零交易周期；无支付时间字段</p>
                <div className="sec">
                  <h2>最近周期</h2>
                  <div className="search-row">
                    <SearchBox id="search-trends" label="搜索周期" placeholder="输入周期，如 11-11 或 2026 Q4…"
                      value={query} onChange={setQuery} resultCount={q ? filteredSeries.length : null}
                      countText={q ? (filteredSeries.length > 10 ? `找到 ${filteredSeries.length} 条（显示最近 10 条）` : `找到 ${filteredSeries.length} 条`) : undefined} />
                  </div>
                  <div className="tbl-wrap">
                    <table>
                      <thead><tr><th scope="col">周期</th><th scope="col" className="num">金额</th><th scope="col" className="num">订单量</th></tr></thead>
                      <tbody>
                        {filteredSeries.length ? filteredSeries.slice(-10).reverse().map((s) => (
                          <tr key={s.date}><td>{s.label}</td><td className="num">{fmtMoney(s.amount)}</td><td className="num">{s.count}</td></tr>
                        )) : (q ? searchEmpty(3) : <tr><td colSpan="3"><div className="empty">暂无数据</div></td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </section>

          <section className={"view" + (view === "analysis" ? " on" : "")} id="view-analysis">
            <p className="cache-note">数据最多每 60 秒更新一次（服务端缓存）。</p>
            {analysis ? (
              <>
                <h2 className="report-title">{reportTitle}</h2>
                <div className="stats">
                  <div className="stat hero"><span>总收入</span><b>{heroMoney(analysis.kpis.revenue)}</b><small className="def">{analysis.definitions.revenue}</small></div>
                  <div className="stat"><span>历史订单</span><b>{analysis.kpis.orders}</b><small className="def">{analysis.definitions.orders}</small></div>
                  <div className="stat"><span>有效付费订单</span><b>{analysis.kpis.paidOrders}</b></div>
                  <div className="stat"><span>在售资源</span><b>{analysis.kpis.resources}</b></div>
                  <div className="stat"><span>近30天活跃用户</span><b>{analysis.kpis.users}</b><small className="def">{analysis.definitions.users}</small></div>
                </div>
                <p className="series-sum">本周期有效交易额 {fmtMoney(analysisSeriesAmount)}，共 {analysisSeriesCount} 笔
                  <button type="button" className="link-btn" onClick={() => changeView("trends")}>查看趋势图 →</button>
                </p>
                <p className="user-sum">用户总数 {analysis.userSummary.total} · 近30天新增 {analysis.userSummary.newUsers} · 高价值 {analysis.userSummary.highValue} · 潜力会员 {analysis.userSummary.potential} · 沉默用户 {analysis.userSummary.silent}</p>
                <p className="def-note">高价值：累计消费 ≥ ¥10,000；潜力会员：消费 ¥1,000–10,000 且付费 ≥ 2 笔、最近付费 ≤ 90 天；沉默用户：付费 ≥ 1 笔、最近付费 &gt; 90 天。</p>
                <div className="search-row">
                  <SearchBox id="search-analysis" label="搜索经营数据" placeholder="输入渠道、资源或场馆名…"
                    value={query} onChange={setQuery}
                    resultCount={q ? filteredChannels.length + filteredRanking.length + filteredVenues.length : null}
                    countText={q ? `找到 ${filteredChannels.length} 条渠道 · ${filteredRanking.length} 条资源${filteredRanking.length > 10 ? "（显示前 10 条）" : ""} · ${filteredVenues.length} 个场馆` : undefined} />
                </div>
                <div className="sec">
                  <h2>渠道复盘</h2>
                  <div className="tbl-wrap">
                    <table>
                      <thead><tr><th scope="col">渠道</th><th scope="col" className="num">成交额</th><th scope="col" className="num">订单量</th><th scope="col" className="num">占比</th></tr></thead>
                      <tbody>
                        {filteredChannels.length ? filteredChannels.map((c) => (
                          <tr key={c.name}>
                            <td>{c.name}</td><td className="num">{fmtMoney(c.amount)}</td><td className="num">{c.orders}</td>
                            <td className="num">{analysis.kpis.revenue ? ((c.amount / analysis.kpis.revenue) * 100).toFixed(1) + "%" : "—"}</td>
                          </tr>
                        )) : (q ? searchEmpty(4) : <tr><td colSpan="4"><div className="empty">暂无渠道</div></td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  <p className="def-note">{analysis.insights[4] || ""}</p>
                </div>
                <div className="sec">
                  <h2>资源销量 Top 10</h2>
                  <div className="tbl-wrap">
                    <table>
                      <thead><tr><th scope="col">排名</th><th scope="col">资源</th><th scope="col" className="num">销量</th><th scope="col" className="num">数量</th><th scope="col" className="num">交易额</th></tr></thead>
                      <tbody>
                        {filteredRanking.length ? filteredRanking.slice(0, 10).map((r) => (
                          <tr key={r.id} className={r.rank === 1 ? "top1" : ""}>
                            <td>{r.rank}</td><td>{r.name}</td><td className="num">{r.sales}</td><td className="num">{r.quantity}</td><td className="num">{fmtMoney(r.revenue)}</td>
                          </tr>
                        )) : (q ? searchEmpty(5) : <tr><td colSpan="5"><div className="empty">暂无资源</div></td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  <p className="def-note">共 {q ? filteredRanking.length : analysis.ranking.length} 项资源</p>
                </div>
                {analysis.cold.length ? (
                  <div className="note">零成交资源：{analysis.cold.map((r) => r.name).join("、")}；建议补充介绍与小规模曝光，先验证需求再调价。</div>
                ) : null}
                <div className="sec">
                  <h2>预警摘要</h2>
                  <p>共 {analysis.alerts.length} 条预警，{analysis.alerts.filter((a) => a.id).length} 条模拟事件待处理
                    <button type="button" className="link-btn" onClick={() => changeView("alerts")}>前往预警中心 →</button>
                  </p>
                </div>
                <div className="sec">
                  <h2>运营建议</h2>
                  <ul className="insights">
                    {analysis.insights.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <div className="sec">
                  <h2>场馆经营</h2>
                  {filteredVenues.length ? (
                    <div className="venue-grid">
                      {filteredVenues.map((v) => (
                        <div key={v.id} className="stat venue-card">
                          <span>{v.name}</span>
                          <b>{v.occupancy}%</b>
                          <small className="def">未来30天档期占用 {v.occupancy}% · 闲置 {v.idleRate}%</small>
                          <small className="def">热门预约星期 {v.peak} · 关联剧目 {v.performances}场</small>
                          <small className="def">上座率 {v.seatOccupancy === null ? "暂无关联售票样本" : v.seatOccupancy + "%"}</small>
                          <small className="def">场均票房 {v.averageRevenue === null ? "暂无" : fmtMoney(v.averageRevenue)}</small>
                        </div>
                      ))}
                    </div>
                  ) : (q ? (
                    <div className="empty">没有找到匹配的结果<br />
                      <button type="button" className="link-btn" onClick={() => setQuery("")}>清除搜索</button>
                    </div>
                  ) : (
                    <div className="empty">暂无场馆</div>
                  ))}
                </div>
                <div className="sec">
                  <h2>完整报告</h2>
                  <div className="report"><pre>{reportBody}</pre></div>
                </div>
                <p className="def-note">{analysis.definitions.revenue}；{analysis.definitions.orders}；{analysis.definitions.series}；{analysis.definitions.users}。</p>
              </>
            ) : <div className="empty">加载中…</div>}
          </section>

          <section className={"view" + (view === "alerts" ? " on" : "")} id="view-alerts">
            <div className="note">以下预警中，库存/预约/售后为真实数据规则触发；标注（模拟事件）的是模拟演练事件，不代表真实故障。</div>
            <p>库存预警阈值：{threshold}</p>
            <div className="sec">
              <h2>触发模拟预警</h2>
              <div className="chips">
                {ALERT_KINDS.map(([kind, label]) => (
                  <button key={kind} type="button" disabled={triggerBusy === kind} onClick={() => doTriggerAlert(kind)}>
                    {triggerBusy === kind ? "触发中…" : label}
                  </button>
                ))}
              </div>
            </div>
            <div className="search-row">
              <SearchBox id="search-alerts" label="搜索预警与审计" placeholder="输入预警标题、操作人或操作…"
                value={query} onChange={setQuery}
                resultCount={q ? filteredAlerts.length + filteredAudit.length : null}
                countText={q ? `找到 ${filteredAlerts.length} 条预警 · ${filteredAudit.length} 条审计记录` : undefined} />
            </div>
            <div className="sec">
              <h2>预警列表</h2>
              {alerts.length
                ? (filteredAlerts.length ? filteredAlerts.map((a) => (
                  <div key={a.id || a.title} className={"alert " + a.severity}>
                    <span className={"pill " + (a.severity === "warning" ? "pending" : "confirmed")}>{a.severity === "warning" ? "预警" : "提示"}</span>
                    <b>{a.title}</b>
                    <p>{a.detail}</p>
                    {a.id ? <button type="button" className="btn-resolve" onClick={() => doResolveAlert(a.id)}>处理模拟预警</button> : null}
                  </div>
                )) : (
                  <div className="empty">没有找到匹配的结果<br />
                    <button type="button" className="link-btn" onClick={() => setQuery("")}>清除搜索</button>
                  </div>
                ))
                : <div className="empty">暂无预警</div>}
            </div>
            <div className="sec">
              <h2>操作审计</h2>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th scope="col">时间</th><th scope="col">操作人</th><th scope="col">操作</th><th scope="col">详情</th></tr></thead>
                  <tbody>
                    {auditLogs.length
                      ? (filteredAudit.length ? filteredAudit.map((l) => (
                        <tr key={l.id}>
                          <td className="audit-time">{String(l.created_at || "").slice(0, 16)}</td>
                          <td>{l.user_name || "—"}</td><td>{l.action}</td><td>{l.detail || ""}</td>
                        </tr>
                      )) : searchEmpty(4))
                      : <tr><td colSpan="4"><div className="empty">暂无审计记录</div></td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="def-note">仅显示最近 60 条，最新在前。每次导出、审核、触发与处理预警都会在此留痕。</p>
            </div>
          </section>
        </main>
      </div>

      <div className={"toast" + (toastMsg ? " show" : "")} id="toast" role="status">{toastMsg}</div>
    </>
  );
}
