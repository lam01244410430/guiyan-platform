/* Guiyan admin dashboard (React) — port of admin/assets/js/dashboard.js +
   admin/dashboard.html. Loads /api/admin/stats, /api/admin/orders,
   /api/admin/users, /api/admin/demands and /api/admin/resources (admin
   role only). Demands come from the admin endpoint because the public
   list hides pending ones; the stat card counts all demands. Resources
   come from the admin endpoint because the public list hides drafts.
   Premium views (Phase 5): 趋势统计 / 经营分析 / 预警中心 reuse the
   server/routes/admin-insights.mjs backend (stats by period, analysis,
   alerts, CSV export, demand review, audit logs). The 5 original views
   stay read-only except 资源 (Wave 4 #16: create/edit/publish/sync,
   server/routes/admin-resources.mjs); the premium views have write actions
   (review demands, trigger/resolve simulated alerts, export CSV) and
   every write lands in audit_logs. Premium data loads lazily, only when its view opens. */
import { Fragment, useEffect, useRef, useState } from "react";
import {
  apiGet, apiPost, apiPatch, apiDownloadCsv, downloadText, clearToken, currentUser, getToken, fmtMoney, STATUS,
} from "./adminApi.js";
import TrendChart from "./TrendChart.jsx";
import SearchBox from "./SearchBox.jsx";
import SortButton from "./SortButton.jsx";
import { cycleDirection, sortRows } from "./sortUtils.js";
// catZh maps a category id (show/venue/…) to its Chinese name, from a
// verbatim copy of the CATS table (admin/assets/js/cats.js). It used to
// come from web/assets/js/data.js, which dragged the whole 866 KB data
// file (i18n + base64 images) into the admin bundle as a separate chunk.
import { catZh, CATS } from "./cats.js";
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
  shops: (<><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M9 21v-6h6v6" /></>),
  trends: (<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></>),
  analysis: (<><path d="M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></>),
  alerts: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  tagrules: (<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>),
  aicopy: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  account: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
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
   real share + count. All eight canonical statuses always render (a status
   missing from orders_by_status counts as 0); the total comes from the
   same /api/admin/stats response. No invented figures. */
const ORDER_STATUS = ["pending", "confirmed", "paid", "completed", "cancelled", "refunded", "refund_requested", "disputed"];
const DEMAND_STATUS = { approved: "已通过", pending: "待审核", rejected: "已拒绝" };
const VIEWS = [
  { id: "overview", label: "总览", iconName: "ui:layout-dashboard", group: "main" },
  { id: "orders", label: "订单", iconName: "ui:receipt", group: "main" },
  { id: "users", label: "用户", iconName: "ui:users", group: "main" },
  { id: "account", label: "账号", iconName: "ui:user", group: "main" },
  { id: "tagrules", label: "标签规则", iconName: "ui:tags", group: "main" },
  { id: "aicopy", label: "文案生成", iconName: "ui:pen", group: "main" },
  { id: "resources", label: "资源", iconName: "ui:layers", group: "main" },
  { id: "shops", label: "店铺", iconName: "ui:store", group: "main" },
  { id: "demands", label: "需求", iconName: "ui:clipboard-list", group: "main" },
  { id: "trends", label: "趋势统计", iconName: "ui:chart-line", group: "premium" },
  { id: "analysis", label: "经营分析", iconName: "ui:scroll-text", group: "premium" },
  { id: "alerts", label: "预警中心", iconName: "ui:triangle-alert", group: "premium" },
];
const FILTERS = [
  ["all", "全部"], ["pending", "待确认"], ["confirmed", "已确认"], ["paid", "已支付"],
  ["completed", "已完成"], ["cancelled", "已取消"], ["refunded", "已退款"],
  ["refund_requested", "退款申请中"], ["disputed", "纠纷处理中"],
];
const PERIODS = [["day", "日"], ["week", "周"], ["month", "月"], ["quarter", "季"]];
// Wave 3 #9: rule field labels, port of zhou TagRules.jsx:4-14. Amounts
// are stored in 分 (cents) — zhou's UI said 元 while its rules stored 分,
// a 100x trap; Lam's form labels the unit as 分 (Q12 default).
const TAG_FIELDS = [
  ["spent", "累计支付（分）"], ["paid_count", "有效付费订单数"],
  ["days_since_payment", "距上次消费（天）"], ["view_count", "浏览次数"],
  ["favorite_count", "收藏数量"], ["preference", "兴趣分类"],
  ["view_category", "浏览分类"], ["city", "城市"], ["channel", "来源渠道"],
];
const TAG_NUMERIC = ["spent", "paid_count", "days_since_payment", "view_count", "favorite_count"];
const TAG_OPS = [["gte", "≥"], ["lte", "≤"], ["gt", ">"], ["lt", "<"], ["eq", "="]];
const ALERT_KINDS = [
  ["sales", "销量突降"], ["verification", "核销异常"], ["inventory", "库存异常"],
  ["data", "数据异常"], ["sentiment", "潜在舆情风险"],
];

/* Wave 4 #13: after-sales actions per order row. refund_requested shows
   同意退款 / 拒绝退款; disputed shows 驳回申诉 / 调解完成并结算. Buttons
   follow the demands-review pattern (reviewBusyId, disabled while
   processing). The reason + platform decision render under the row, port
   of zhou Transactions.jsx:248-252. */
function OrderRow({ o, onContract, onReview, reviewBusyId }) {
  const busy = reviewBusyId === o.id;
  return (
    <>
      <tr>
        <td className="code">{o.code}</td><td>{o.user_name || ""}</td><td>{o.resource_name || ""}</td>
        <td className="num">{fmtMoney(o.amount)}</td><td>{o.booking_date || ""}</td>
        <td><span className={"pill " + o.status}>{STATUS[o.status] || o.status}</span></td>
        <td><button type="button" className="btn-view" onClick={() => onContract(o)}>协议 / 权益</button></td>
        <td>
          {o.status === "refund_requested" ? (
            <span className="row-actions">
              <button type="button" className="btn-approve" disabled={busy} onClick={() => onReview(o.id, "approveRefund")}>{busy ? "处理中…" : "同意退款"}</button>
              <button type="button" className="btn-reject" disabled={busy} onClick={() => onReview(o.id, "rejectRefund")}>{busy ? "处理中…" : "拒绝退款"}</button>
            </span>
          ) : o.status === "disputed" ? (
            <span className="row-actions">
              <button type="button" className="btn-reject" disabled={busy} onClick={() => onReview(o.id, "rejectDispute")}>{busy ? "处理中…" : "驳回申诉"}</button>
              <button type="button" className="btn-approve" disabled={busy} onClick={() => onReview(o.id, "resolve")}>{busy ? "处理中…" : "调解完成并结算"}</button>
            </span>
          ) : ""}
        </td>
      </tr>
      {o.refund_reason || o.refund_decision ? (
        <tr>
          <td colSpan="8">
            {o.refund_reason ? (<span>售后原因：{o.refund_reason}</span>) : null}
            {o.refund_reason && o.refund_decision ? "　" : null}
            {o.refund_decision ? (<span>平台处理说明：{o.refund_decision}</span>) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  // Wave 4 #15: open simulated agreement ({title, content, code} | null).
  const [contract, setContract] = useState(null);
  const [users, setUsers] = useState([]);  const [resources, setResources] = useState([]);
  const [demands, setDemands] = useState([]);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("overview");
  // One shared search query for the current view; reset on every view
  // change so a query never leaks into another view. Changing `period`
  // inside trends/analysis does NOT reset it (same view).
  const [query, setQuery] = useState("");
  // One sort entry per table: { [tableId]: { key, dir } }. A table with no
  // entry is unsorted (original order). Cleared on view change, like `query`;
  // changing `period` or the orders status chip does NOT clear it (same view).
  const [sorts, setSorts] = useState({});
  function toggleSort(tableId, key) {
    setSorts(function (prev) {
      const cur = prev[tableId];
      const next = cur && cur.key === key ? cycleDirection(cur.dir) : "asc";
      const out = { ...prev };
      if (next) out[tableId] = { key, dir: next };
      else delete out[tableId];
      return out;
    });
  }
  function changeView(v) { setView(v); setQuery(""); setSorts({}); setTagFilter(""); setResShopFilter(""); setDrawerOpen(false); }
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
  // Wave 3 #9 tag rules (lazy-loaded like the premium views) + the users
  // view tag filter (client-side, composes with search/sort; the API's
  // ?tag= filter exists so the endpoint is usable on its own).
  const [tagRules, setTagRules] = useState(null);
  // Wave 3 #8 operator card (analysis view): question + rule answer.
  const [opQuery, setOpQuery] = useState("");
  const [opReply, setOpReply] = useState("");
  const [opBusy, setOpBusy] = useState(false);
  const [tagRulesBusy, setTagRulesBusy] = useState(false);
  // Wave 3 #10 copy template: prompt + generated result (3 channels).
  const [copyPrompt, setCopyPrompt] = useState("");
  const [copyResult, setCopyResult] = useState(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [reviewBusyId, setReviewBusyId] = useState(null);
  // Wave 4 #16 resource management: the open create/edit form draft
  // (null = closed; {id: null} = create, {id} = edit) + the id of the
  // resource whose row action is in flight (same disabled-while-
  // processing pattern as reviewBusyId).
  const [resForm, setResForm] = useState(null);
  const [resBusyId, setResBusyId] = useState(null);
  // R1-1 multi-shop: the shop list + the open create/edit form draft
  // (null = closed; {id: null} = create, {id} = edit) + the id of the
  // shop whose row action is in flight (same pattern as resBusyId).
  // resShopFilter is the resources view's shop filter ("" = all shops;
  // a shop-scoped admin sees only their own shop from the server and
  // gets no filter control).
  const [shops, setShops] = useState([]);
  const [shopForm, setShopForm] = useState(null);
  const [shopBusyId, setShopBusyId] = useState(null);
  const [resShopFilter, setResShopFilter] = useState("");
  // R1-2 admin accounts: own profile form + OTP password change, and
  // the id of the user whose enable/disable is in flight.
  const [acctName, setAcctName] = useState("");
  const [acctEmail, setAcctEmail] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctOtp, setAcctOtp] = useState("");
  const [acctOtpInput, setAcctOtpInput] = useState("");
  const [acctNewPw, setAcctNewPw] = useState("");
  const [acctPwBusy, setAcctPwBusy] = useState(false);
  const [userStatusBusyId, setUserStatusBusyId] = useState(null);
  const [triggerBusy, setTriggerBusy] = useState("");
  const loadedRef = useRef({ trends: "", analysis: "", alerts: false, tagrules: false });
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
      apiGet("/api/admin/resources"), apiGet("/api/admin/demands"),
      apiGet("/api/admin/shops"),
    ]).then(function (res) {
      setStats(res[0]);
      setOrders(res[1].orders || []);
      setUsers(res[2].users || []);
      // R1-2: initialise the account form from the signed-in admin's row.
      const meRow0 = (res[2].users || []).find((x) => x.id === u.id);
      if (meRow0) { setAcctName(meRow0.name || ""); setAcctEmail(meRow0.email || ""); }
      setResources(res[3].resources || []);
      setDemands(res[4].demands || []);
      setShops(res[5].shops || []);
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
    if (view === "tagrules" && !loadedRef.current.tagrules) {
      loadedRef.current.tagrules = true;
      apiGet("/api/admin/tag-rules").then(function (d) {
        setTagRules(d.tagRules || []);
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

  /* Wave 4 #15 — simulated agreement per order (具体功能 #12, port of
     zhou Transactions.jsx): fetch the server-generated text and show it
     in a modal; the .txt download is named <order-code>-模拟协议.txt. */
  function openContract(o) {
    apiGet("/api/orders/" + encodeURIComponent(o.id) + "/contract").then(function (d) {
      setContract({ title: d.title, content: d.content, code: o.code });
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      toast("加载协议失败，请稍后重试");
    });
  }
  function downloadContract() {
    if (contract) downloadText(contract.content, contract.code + "-模拟协议.txt");
  }

  // Wave 5 #23 — download the report text exactly as shown on screen
  // (title + body = analysis.report). No new endpoint, no audit row.
  function downloadReport() {
    if (!analysis || typeof analysis.report !== "string") return;
    downloadText(analysis.report, "guiyan-analysis-" + period + ".txt");
    toast("报告已下载");
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

  /* Wave 4 #13 — admin after-sales decisions on an order (same
     reviewBusyId pattern as demands). Rejections ask for a reason up
     front: the server requires it (Q6) and stores it in refund_decision.
     The list is reloaded so refund_reason/refund_decision render fresh. */
  function doReviewOrder(id, action) {
    if (reviewBusyId !== null) return;
    let reason = "";
    if (action === "rejectRefund" || action === "rejectDispute") {
      reason = window.prompt("请填写拒绝原因", "") || "";
      if (!reason.trim()) { toast("请填写拒绝原因"); return; }
    }
    setReviewBusyId(id);
    apiPost("/api/orders/" + id + "/" + action, reason ? { reason } : {}).then(function (d) {
      setOrders(function (os) { return os.map(function (o) { return o.id === id ? { ...o, status: d.status } : o; }); });
      apiGet("/api/admin/orders").then(function (r) { setOrders(r.orders || []); }).catch(function () {});
      apiGet("/api/admin/stats").then(setStats).catch(function () {});
      loadAudit();
      toast("已处理");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权处理");
      else if (e && e.status === 400) toast((e.data && e.data.error) || "当前状态不允许该操作");
      else if (e && e.status === 404) toast("订单不存在");
      else toast("处理失败，请稍后重试");
    }).finally(function () { setReviewBusyId(null); });
  }

  /* Wave 4 #16 — admin resource management (create/edit/publish/
     unpublish/simulated channel sync). Money: the form inputs yuan and
     converts to integer cents before calling (the server only accepts
     cents); image stays a static path string, no upload. The list loads
     from GET /api/admin/resources (all rows including drafts), so a
     resource just set to draft stays visible after a reload; the list
     is still updated from the response to avoid a reload round-trip. */
  function openResForm(r) {
    setResForm(r ? {
      id: r.id, name: r.name || "", category: r.category || "show",
      city: r.city || "", priceYuan: String((r.price || 0) / 100),
      unit: r.unit || "张", description: r.description || "",
      image: r.image || "", capacity: String(r.capacity || 0),
      stock: String(r.stock || 0), status: r.status || "published",
    } : {
      id: null, name: "", category: "show", city: "", priceYuan: "",
      unit: "张", description: "", image: "", capacity: "0",
      stock: "100", status: "published",
    });
  }
  function editResForm(key, value) {
    setResForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveResForm() {
    if (!resForm || resBusyId !== null) return;
    const priceYuan = Number(resForm.priceYuan);
    if (!resForm.name.trim() || !resForm.city.trim() || !resForm.unit.trim()) { toast("请填写名称、城市与单位"); return; }
    if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast("价格（元）须为不小于 0 的数字"); return; }
    const capacity = Number(resForm.capacity);
    const stock = Number(resForm.stock);
    if (!Number.isInteger(capacity) || capacity < 0 || !Number.isInteger(stock) || stock < 0) { toast("容量与库存须为不小于 0 的整数"); return; }
    const body = {
      name: resForm.name.trim(), category: resForm.category,
      city: resForm.city.trim(), price: Math.round(priceYuan * 100),
      unit: resForm.unit.trim(), description: resForm.description.trim(),
      image: resForm.image.trim(), capacity, stock, status: resForm.status,
    };
    setResBusyId(resForm.id === null ? "new" : resForm.id);
    const call = resForm.id === null
      ? apiPost("/api/admin/resources", body)
      : apiPatch("/api/admin/resources/" + resForm.id, body);
    call.then(function (d) {
      const saved = d.resource;
      setResources(function (rs) {
        return resForm.id === null ? rs.concat([saved])
          : rs.map(function (r) { return r.id === saved.id ? saved : r; });
      });
      setResForm(null);
      apiGet("/api/admin/stats").then(setStats).catch(function () {});
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权管理资源");
      else if (e && e.status === 404) toast("资源不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setResBusyId(null); });
  }
  function doToggleResStatus(r) {
    if (resBusyId !== null) return;
    const next = r.status === "published" ? "draft" : "published";
    setResBusyId(r.id);
    apiPatch("/api/admin/resources/" + r.id, { status: next }).then(function (d) {
      const saved = d.resource;
      setResources(function (rs) { return rs.map(function (x) { return x.id === saved.id ? saved : x; }); });
      apiGet("/api/admin/stats").then(setStats).catch(function () {});
      loadAudit();
      toast(next === "published" ? "已上架" : "已下架");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权管理资源");
      else if (e && e.status === 404) toast("资源不存在");
      else toast((e && e.data && e.data.error) || "操作失败，请稍后重试");
    }).finally(function () { setResBusyId(null); });
  }
  function doSyncRes(r) {
    if (resBusyId !== null) return;
    setResBusyId(r.id);
    apiPost("/api/admin/resources/" + r.id + "/sync", {}).then(function (d) {
      const saved = d.resource;
      setResources(function (rs) { return rs.map(function (x) { return x.id === saved.id ? saved : x; }); });
      loadAudit();
      // The server message states no external request was sent; the
      // sync itself is simulated (syncResult carries （模拟）).
      toast(d.message || "已模拟同步");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权管理资源");
      else if (e && e.status === 404) toast("资源不存在");
      else toast((e && e.data && e.data.error) || "同步失败，请稍后重试");
    }).finally(function () { setResBusyId(null); });
  }

  // R1-1 shop editor helpers (same disabled-while-processing pattern as
  // the resource form). Only a platform admin ever sees the create/edit
  // controls (the server returns 403 otherwise); a shop-scoped admin
  // sees their own shop read-only.
  function loadShops() {
    apiGet("/api/admin/shops").then(function (d) {
      setShops(d.shops || []);
    }).catch(loadFail);
  }
  function openShopForm(s) {
    if (s) {
      setShopForm({ id: s.id, name: s.name, parent_id: s.parent_id, owner_id: s.owner_id === null ? "" : String(s.owner_id), status: s.status });
    } else {
      setShopForm({ id: null, name: "", parent_id: "1", owner_id: "", status: "active" });
    }
  }
  function editShopForm(key, value) {
    setShopForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveShopForm() {
    if (!shopForm || shopBusyId !== null) return;
    if (!shopForm.name.trim()) { toast("请填写店铺名称"); return; }
    const body = { name: shopForm.name.trim() };
    if (shopForm.id === null) {
      body.parent_id = Number(shopForm.parent_id) || 1;
      if (shopForm.owner_id !== "") body.owner_id = Number(shopForm.owner_id);
    } else {
      if (shopForm.owner_id === "") body.owner_id = null;
      else body.owner_id = Number(shopForm.owner_id);
      body.status = shopForm.status;
    }
    setShopBusyId(shopForm.id === null ? "new" : shopForm.id);
    const call = shopForm.id === null
      ? apiPost("/api/admin/shops", body)
      : apiPatch("/api/admin/shops/" + shopForm.id, body);
    call.then(function (d) {
      const saved = d.shop;
      setShops(function (ss) {
        return shopForm.id === null ? ss.concat([saved])
          : ss.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setShopForm(null);
      // The owner list carries shop_id, so reload users as well.
      apiGet("/api/admin/users").then(function (u) { setUsers(u.users || []); }).catch(function () {});
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只有平台管理员可管理店铺");
      else if (e && e.status === 404) toast("店铺不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setShopBusyId(null); });
  }
  function doToggleShopStatus(s) {
    if (shopBusyId !== null) return;
    const next = s.status === "active" ? "disabled" : "active";
    setShopBusyId(s.id);
    apiPatch("/api/admin/shops/" + s.id, { status: next }).then(function (d) {
      const saved = d.shop;
      setShops(function (ss) { return ss.map(function (x) { return x.id === saved.id ? saved : x; }); });
      loadAudit();
      toast(next === "active" ? "已启用" : "已停用");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只有平台管理员可管理店铺");
      else if (e && e.status === 404) toast("店铺不存在");
      else toast((e && e.data && e.data.error) || "操作失败，请稍后重试");
    }).finally(function () { setShopBusyId(null); });
  }

  // R1-2 admin accounts: own profile (name/email) + OTP password
  // change + enable/disable other accounts. The OTP target is always
  // the SAVED email (from the users list), never the unsaved draft —
  // the server consumes the code against the stored email.
  function saveAcctProfile() {
    if (acctBusy) return;
    if (!acctName.trim()) { toast("请填写姓名"); return; }
    setAcctBusy(true);
    apiPatch("/api/admin/profile", { name: acctName.trim(), email: acctEmail.trim() }).then(function (d) {
      setUsers(function (us) { return us.map(function (x) { return x.id === d.user.id ? d.user : x; }); });
      setWhoName(d.user.name || d.user.username || "管理员");
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setAcctBusy(false); });
  }
  function sendAcctOtp() {
    if (acctBusy) return;
    const meNow = currentUser();
    const saved = users.find(function (x) { return meNow && x.id === meNow.id; });
    const target = (saved && saved.email) || "";
    if (!target) { toast("请先在上方保存邮箱"); return; }
    setAcctBusy(true);
    apiPost("/api/account/send-otp", { channel: "email", target: target }).then(function (d) {
      setAcctOtp(d.code || "");
      toast("验证码已生成（模拟，未真实发送）");
    }).catch(function (e) {
      toast((e && e.data && e.data.error) || "发送失败，请稍后重试");
    }).finally(function () { setAcctBusy(false); });
  }
  function doAcctChangePassword() {
    if (acctPwBusy) return;
    if (!/^\d{6}$/.test(acctOtpInput)) { toast("请输入6位验证码"); return; }
    if (!acctNewPw.trim()) { toast("请输入新密码"); return; }
    setAcctPwBusy(true);
    apiPost("/api/admin/change-password", { newPassword: acctNewPw.trim(), code: acctOtpInput }).then(function () {
      setAcctOtp(""); setAcctOtpInput(""); setAcctNewPw("");
      loadAudit();
      toast("密码已修改");
    }).catch(function (e) {
      toast((e && e.data && e.data.error) || "修改失败，请检查验证码");
    }).finally(function () { setAcctPwBusy(false); });
  }
  function doToggleUserStatus(usr) {
    if (userStatusBusyId !== null) return;
    const next = usr.status === "disabled" ? "active" : "disabled";
    setUserStatusBusyId(usr.id);
    apiPatch("/api/admin/users/" + usr.id + "/status", { status: next }).then(function (d) {
      setUsers(function (us) { return us.map(function (x) { return x.id === d.user.id ? d.user : x; }); });
      loadAudit();
      toast(next === "active" ? "已启用" : "已停用");
    }).catch(function (e) {
      toast((e && e.data && e.data.error) || "操作失败，请稍后重试");
    }).finally(function () { setUserStatusBusyId(null); });
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

  // Wave 3 #9 tag-rule editor helpers. Changing a condition's field
  // resets op/value to the defaults, exactly like zhou TagRules.jsx
  // (numeric -> gte/0, text -> eq/heritage or 南宁).
  function editTagRule(i, key, value) {
    setTagRules(function (rs) { return rs.map(function (r, n) { return n === i ? { ...r, [key]: value } : r; }); });
  }
  function editTagCond(i, j, key, value) {
    setTagRules(function (rs) {
      return rs.map(function (r, n) {
        if (n !== i) return r;
        return {
          ...r,
          conditions: r.conditions.map(function (c, k) {
            if (k !== j) return c;
            const next = { ...c, [key]: value };
            if (key === "field") {
              next.op = TAG_NUMERIC.indexOf(value) !== -1 ? "gte" : "eq";
              next.value = TAG_NUMERIC.indexOf(value) !== -1 ? 0
                : (value.indexOf("category") !== -1 || value === "preference" ? "heritage" : "南宁");
            }
            return next;
          }),
        };
      });
    });
  }
  function addTagRule() {
    if (!tagRules || tagRules.length >= 20) { toast("最多配置20条标签规则"); return; }
    setTagRules(tagRules.concat([{
      id: "tag-" + Math.random().toString(36).slice(2, 8),
      name: "新标签", enabled: true, match: "all",
      conditions: [{ field: "spent", op: "gte", value: 0 }],
    }]));
  }
  function saveTagRules() {
    if (tagRulesBusy || !tagRules) return;
    setTagRulesBusy(true);
    apiPatch("/api/admin/tag-rules", { tagRules }).then(function (d) {
      setTagRules(d.tagRules || tagRules);
      toast("标签规则已保存，用户标签已重算");
      // Tags changed: reload the users table and mark the analysis stale
      // (its userSummary counts tags; the server already busted its cache).
      apiGet("/api/admin/users").then(function (u) { setUsers(u.users || []); }).catch(function () {});
      setAnalysisStale(true);
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权修改标签规则");
      else toast((e && e.data && e.data.error) || "保存失败，请检查规则");
    }).finally(function () { setTagRulesBusy(false); });
  }

  function doOperatorAsk() {
    const q = opQuery.trim();
    if (opBusy || !q) return;
    setOpBusy(true);
    apiPost("/api/assistant/chat", { message: q, kind: "operator" }).then(function (d) {
      setOpReply(d.reply || "");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权使用运营助手");
      else toast((e && e.data && e.data.error) || "运营助手暂时不可用");
    }).finally(function () { setOpBusy(false); });
  }

  function doCopyGenerate() {
    const prompt = copyPrompt.trim();
    if (copyBusy || !prompt) return;
    setCopyBusy(true);
    apiPost("/api/ai/copy", { prompt }).then(function (d) {
      setCopyResult(d);
    }).catch(function (e) {
      if (e && e.status === 401) toast("请先登录");
      else toast((e && e.data && e.data.error) || "文案生成失败");
    }).finally(function () { setCopyBusy(false); });
  }
  function doCopyText(content) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content).then(function () { toast("已复制"); }).catch(function () { toast("复制失败"); });
    } else { toast("当前浏览器不支持复制"); }
  }

  const titles = {
    overview: ["总览", "运营数据一览"],
    orders: ["全部订单", "共 " + orders.length + " 单 · 可处理售后"],
    users: ["全部用户", "共 " + users.length + " 人"],
    tagrules: ["标签规则", "自动标签规则 · 保存后立即重算"],
    aicopy: ["文案生成", "本地模板 · 未接入大模型"],
    resources: ["资源总览", "共 " + resources.length + " 项"],
    shops: ["店铺管理", "共 " + shops.length + " 家店铺 · 仅平台管理员可创建/修改"],
    demands: ["需求总览", "共 " + demands.length + " 条"],
    trends: ["趋势统计", "按周期查看订单趋势"],
    analysis: ["经营分析", "模拟经营分析报告"],
    alerts: ["预警中心", "库存与模拟预警 · 操作留痕"],
  };
  const by = (stats && stats.orders_by_status) || {};
  // R1-1: the signed-in admin's scope (the sessionStorage user carries
  // shop_id since R1-1; NULL = platform admin, all shops).
  const me = currentUser();
  const isPlatformAdmin = !me || me.shop_id === null || me.shop_id === undefined;
  // R1-2: the signed-in admin's row (for the account view + self checks).
  const meRow = me ? users.find((x) => x.id === me.id) : null;
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
    return has(String(u.id)) || has(u.name) || has(u.username) || has(u.email) || has(u.city)
      || has(u.channel) || has(u.role) || has(u.verified ? "已认证" : "未认证");
  }
  function categoryMatch(c) { return has(c) || has(catZh(c)); }
  function resourceMatch(r) {
    return has(r.name) || categoryMatch(r.category) || has(r.city);
  }
  function shopMatch(s) {
    return has(s.name) || has(s.owner_name) || has(String(s.id));
  }
  function shopName(id) {
    if (id === null || id === undefined) return "—";
    const s = shops.find(function (x) { return x.id === id; });
    return s ? s.name : "店铺#" + id;
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
  const allTags = [...new Set(users.flatMap(function (u) { return u.tags || []; }))].sort(function (a, b) { return a.localeCompare(b, "zh"); });
  const filteredUsers = users.filter(function (u) {
    return (!tagFilter || (u.tags || []).indexOf(tagFilter) !== -1) && (!q || userMatch(u));
  });
  const filteredResources = resources.filter(function (r) {
    return (resShopFilter === "" || String(r.shop_id) === resShopFilter) && (!q || resourceMatch(r));
  });
  const filteredShops = q ? shops.filter(shopMatch) : shops;
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
  // Sort (sortable columns 2026-11-11): derived in render, never stored
  // order. Pipeline per table: source -> search filter (+ status chip
  // for orders) -> sort (copy) -> slice. Unsorted = original (API) order.
  const SORT_ACCESSORS = {
    overview: {
      code: (o) => o.code ?? "", amount: (o) => o.amount,
      booking_date: (o) => o.booking_date ?? "",
    },
    orders: {
      code: (o) => o.code ?? "", amount: (o) => o.amount,
      booking_date: (o) => o.booking_date ?? "",
    },
    users: { id: (u) => u.id, name: (u) => u.name ?? "", username: (u) => u.username ?? "" },
    resources: { name: (r) => r.name ?? "", price: (r) => r.price, stock: (r) => r.stock },
    shops: { name: (s) => s.name ?? "", resource_count: (s) => s.resource_count },
    demands: { title: (d) => d.title ?? "", budget: (d) => d.budget },
    trends: { label: (s) => s.label, amount: (s) => s.amount, count: (s) => s.count },
    channels: {
      amount: (c) => c.amount, orders: (c) => c.orders,
      share: (c) => (analysis && analysis.kpis.revenue ? (c.amount / analysis.kpis.revenue) * 100 : 0),
    },
    ranking: { sales: (r) => r.sales, quantity: (r) => r.quantity, revenue: (r) => r.revenue },
    audit: { created_at: (l) => String(l.created_at || "") },
  };
  function sorted(tableId, rows) {
    const s = sorts[tableId];
    if (!s) return rows;
    return sortRows(rows, SORT_ACCESSORS[tableId][s.key], s.dir);
  }
  function ariaSort(tableId, key) {
    const s = sorts[tableId];
    if (!s || s.key !== key) return "none";
    return s.dir === "asc" ? "ascending" : "descending";
  }
  const sortedOverview = sorted("overview", overviewMatches);
  const sortedOrders = sorted("orders", filteredOrders);
  const sortedUsers = sorted("users", filteredUsers);
  const sortedResources = sorted("resources", filteredResources);
  const sortedShops = sorted("shops", filteredShops);
  const sortedDemands = sorted("demands", filteredDemands);
  const sortedSeries = sorted("trends", filteredSeries);
  const sortedChannels = sorted("channels", filteredChannels);
  const sortedRanking = sorted("ranking", filteredRanking);
  const sortedAudit = sorted("audit", filteredAudit);
  // Search empty state (parent-side): distinct from the "no data at all"
  // state — only shown while a query is active and nothing matches.
  const searchEmpty = (colSpan) => (
    <tr><td colSpan={colSpan}><div className="empty">没有找到匹配的结果<br />
      <button type="button" className="link-btn" onClick={() => setQuery("")}>清除搜索</button>
    </div></td></tr>
  );

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
          <a className="home-link" href="/">
            <svg className="ic" data-icon="ui:home" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>
            返回首页
          </a>
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
            <h1><span id="pageTitle">{titles[view][0]}</span><span className="sub" id="pageSub">{view === "users" ? "共 " + filteredUsers.length + " 人" : view === "orders" ? "共 " + filteredOrders.length + " 单 · 可处理售后" : view === "resources" ? "共 " + filteredResources.length + " 项" : view === "demands" ? "共 " + filteredDemands.length + " 条" : titles[view][1]}</span></h1>
            <span className="badge">管理操作 · 审计留痕</span>
          </div>

          <section className={"view" + (view === "overview" ? " on" : "")} id="view-overview">
            <div className="stats">
              <div className="stat hero"><span>总收入</span><b id="statRevenue">{heroMoney(stats ? stats.revenue_cents : 0)}</b></div>
              <div className="stat"><span>用户</span><b id="statUsers">{stats ? stats.users : 0}</b></div>
              <div className="stat"><span>订单</span><b id="statOrders">{stats ? stats.orders : 0}</b></div>
              <div className="stat"><span>资源</span><b id="statResources">{stats ? stats.resources : 0}</b></div>
              <div className="stat"><span>需求</span><b id="statDemands">{stats ? stats.demands : 0}</b></div>
            </div>
            <div className="note">订单可在订单页处理售后；用户仅查看；资源可在资源页管理；需求可在需求页审核，操作留痕。支付与 AI 均为模拟。</div>
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
                  <thead><tr><th scope="col" aria-sort={ariaSort("overview", "code")}>订单号<SortButton label="订单号" sortKey="code" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num" aria-sort={ariaSort("overview", "amount")}>金额<SortButton label="金额" sortKey="amount" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("overview", "booking_date")}>预订日期<SortButton label="预订日期" sortKey="booking_date" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">协议</th><th scope="col">售后</th></tr></thead>
                  <tbody id="recentBody">
                    {orders.length
                      ? (overviewMatches.length ? sortedOverview.slice(0, 8).map((o) => <OrderRow key={o.code} o={o} onContract={openContract} onReview={doReviewOrder} reviewBusyId={reviewBusyId} />)
                        : searchEmpty(8))
                      : <tr><td colSpan="8"><div className="empty">暂无订单</div></td></tr>}
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
                <thead><tr><th scope="col" aria-sort={ariaSort("orders", "code")}>订单号<SortButton label="订单号" sortKey="code" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num" aria-sort={ariaSort("orders", "amount")}>金额<SortButton label="金额" sortKey="amount" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("orders", "booking_date")}>预订日期<SortButton label="预订日期" sortKey="booking_date" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">协议</th><th scope="col">售后</th></tr></thead>
                <tbody id="ordersBody">
                  {filteredOrders.length ? sortedOrders.map((o) => <OrderRow key={o.code} o={o} onContract={openContract} onReview={doReviewOrder} reviewBusyId={reviewBusyId} />)
                    : (q ? searchEmpty(8) : <tr><td colSpan="8"><div className="empty">暂无订单</div></td></tr>)}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "users" ? " on" : "")} id="view-users">
            <div className="search-row">
              <SearchBox id="search-users" label="搜索用户" placeholder="输入ID、姓名、账号、邮箱或城市…"
                value={query} onChange={setQuery} resultCount={q ? filteredUsers.length : null} />
              <select className="tag-filter" aria-label="按标签筛选" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">全部标签</option>
                {allTags.map((tg) => (<option key={tg} value={tg}>{tg}</option>))}
              </select>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col" aria-sort={ariaSort("users", "id")}>ID<SortButton label="ID" sortKey="id" tableId="users" sort={sorts.users} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("users", "name")}>姓名<SortButton label="姓名" sortKey="name" tableId="users" sort={sorts.users} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("users", "username")}>账号<SortButton label="账号" sortKey="username" tableId="users" sort={sorts.users} onToggle={toggleSort} /></th><th scope="col">角色</th><th scope="col">城市</th><th scope="col">渠道</th><th scope="col">认证</th><th scope="col">标签</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="usersBody">
                  {users.length
                    ? (filteredUsers.length ? sortedUsers.map((usr) => (
                      <tr key={usr.username}>
                        <td className="id">{usr.id}</td><td>{usr.name || ""}</td><td>{usr.username}</td><td>{usr.role}</td>
                        <td>{usr.city || ""}</td><td>{usr.channel || ""}</td><td>{usr.verified ? "已认证" : "未认证"}</td>
                        <td>{(usr.tags || []).map((tg) => (<span key={tg} className="pill tag">{tg}</span>))}</td>
                        <td>{usr.status === "disabled" ? "停用" : "启用"}</td>
                        <td>
                          {isPlatformAdmin && me && usr.id !== me.id ? (
                            <span className="row-actions">
                              <button type="button" className="btn-view" disabled={userStatusBusyId !== null} onClick={() => doToggleUserStatus(usr)}>{userStatusBusyId === usr.id ? "处理中…" : (usr.status === "disabled" ? "启用" : "停用")}</button>
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    )) : searchEmpty(10))
                    : <tr><td colSpan="10"><div className="empty">暂无用户</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "account" ? " on" : "")} id="view-account">
            <div className="note">本人资料与改密码。改密码用 OTP 发到当前已保存的邮箱（模拟验证码，未真实发送）；未保存邮箱的账号请先在上方保存邮箱。</div>
            <fieldset className="tag-rule">
              <legend>本人资料</legend>
              <label>账号 <input type="text" value={me ? me.username : ""} disabled /></label>
              <label>姓名 <input type="text" value={acctName} maxLength={50} onChange={(e) => setAcctName(e.target.value)} /></label>
              <label>邮箱 <input type="text" value={acctEmail} maxLength={100} onChange={(e) => setAcctEmail(e.target.value)} /></label>
              <div>
                <button type="button" className="btn-export" disabled={acctBusy} onClick={saveAcctProfile}>{acctBusy ? "保存中…" : "保存资料"}</button>
              </div>
            </fieldset>
            <fieldset className="tag-rule">
              <legend>修改密码（OTP 验证）</legend>
              <label>验证码发到 <input type="text" value={(meRow && meRow.email) || ""} disabled /></label>
              <div>
                <button type="button" className="btn-export" disabled={acctBusy || !(meRow && meRow.email)} onClick={sendAcctOtp}>获取验证码</button>
              </div>
              {acctOtp ? (<p className="def-note">模拟验证码（未真实发送）：<b>{acctOtp}</b></p>) : null}
              <label>验证码 <input type="text" value={acctOtpInput} maxLength={6} inputMode="numeric" onChange={(e) => setAcctOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <label>新密码 <input type="password" value={acctNewPw} maxLength={100} onChange={(e) => setAcctNewPw(e.target.value)} /></label>
              <div>
                <button type="button" className="btn-export" disabled={acctPwBusy} onClick={doAcctChangePassword}>{acctPwBusy ? "修改中…" : "修改密码"}</button>
              </div>
            </fieldset>
          </section>

          <section className={"view" + (view === "tagrules" ? " on" : "")} id="view-tagrules">
            <div className="note">条件可组合，保存后立即重算。金额单位为<b>分</b>（¥10,000 = 1000000分）；未付费用户不会被默认划为潜力会员。浏览分类规则需要真实浏览数据（打开资源详情即记录）。</div>
            {tagRules === null ? <div className="empty">加载中…</div> : (
              <>
                {tagRules.map((r, i) => (
                  <fieldset className="tag-rule" key={r.id}>
                    <legend>{r.name || "未命名标签"}</legend>
                    <label>标签名称 <input type="text" value={r.name} maxLength={20} onChange={(e) => editTagRule(i, "name", e.target.value)} /></label>
                    <label>规则编号 <input type="text" value={r.id} maxLength={60} onChange={(e) => editTagRule(i, "id", e.target.value)} /></label>
                    <label><input type="checkbox" checked={r.enabled} onChange={(e) => editTagRule(i, "enabled", e.target.checked)} /> 启用</label>
                    <label>满足条件 <select value={r.match} onChange={(e) => editTagRule(i, "match", e.target.value)}>
                      <option value="all">全部满足</option><option value="any">任一满足</option>
                    </select></label>
                    {r.conditions.map((c, j) => (
                      <div className="tag-cond" key={j}>
                        <select aria-label="条件字段" value={c.field} onChange={(e) => editTagCond(i, j, "field", e.target.value)}>
                          {TAG_FIELDS.map(([f, label]) => (<option key={f} value={f}>{label}</option>))}
                        </select>
                        <select aria-label="比较方式" value={c.op} onChange={(e) => editTagCond(i, j, "op", e.target.value)}>
                          {TAG_OPS.filter(([op]) => TAG_NUMERIC.indexOf(c.field) !== -1 || op === "eq").map(([op, label]) => (<option key={op} value={op}>{label}</option>))}
                        </select>
                        {TAG_NUMERIC.indexOf(c.field) !== -1
                          ? <input type="number" aria-label="阈值" value={c.value} min={0} onChange={(e) => editTagCond(i, j, "value", e.target.value === "" ? 0 : Number(e.target.value))} />
                          : <input type="text" aria-label="匹配值" value={c.value} maxLength={40} onChange={(e) => editTagCond(i, j, "value", e.target.value)} />}
                        <button type="button" className="link-btn" disabled={r.conditions.length <= 1} onClick={() => editTagRule(i, "conditions", r.conditions.filter((_, k) => k !== j))}>删除条件</button>
                      </div>
                    ))}
                    <div>
                      <button type="button" className="btn-resolve" disabled={r.conditions.length >= 6} onClick={() => editTagRule(i, "conditions", r.conditions.concat([{ field: "spent", op: "gte", value: 0 }]))}>添加条件</button>{" "}
                      <button type="button" className="btn-reject" onClick={() => setTagRules(tagRules.filter((_, n) => n !== i))}>删除规则</button>
                    </div>
                  </fieldset>
                ))}
                <div className="chips">
                  <button type="button" disabled={tagRules.length >= 20} onClick={addTagRule}>添加规则</button>
                  <button type="button" className="btn-export" disabled={tagRulesBusy} onClick={saveTagRules}>{tagRulesBusy ? "保存中…" : "保存标签规则"}</button>
                </div>
              </>
            )}
          </section>

          <section className={"view" + (view === "resources" ? " on" : "")} id="view-resources">
            <div className="search-row">
              <SearchBox id="search-resources" label="搜索资源" placeholder="输入资源名、分类或城市…"
                value={query} onChange={setQuery} resultCount={q ? filteredResources.length : null} />
              {isPlatformAdmin ? (
                <select className="tag-filter" aria-label="按店铺筛选" value={resShopFilter} onChange={(e) => setResShopFilter(e.target.value)}>
                  <option value="">全部店铺</option>
                  {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                </select>
              ) : null}
              <button type="button" className="btn-export" onClick={() => openResForm(null)}>添加资源</button>
            </div>
            <div className="note">管理端写资源会改库存/容量/详情，直接影响档期余量、推荐与统计；操作留痕。价格输入元，保存时换算为分。图片只填静态路径（/images/…），不上传。</div>
            {resForm ? (
              <fieldset className="tag-rule">
                <legend>{resForm.id === null ? "添加资源" : "编辑资源：" + resForm.name}</legend>
                <label>资源名称 <input type="text" value={resForm.name} maxLength={80} onChange={(e) => editResForm("name", e.target.value)} /></label>
                <label>分类 <select value={resForm.category} onChange={(e) => editResForm("category", e.target.value)}>
                  {CATS.map(([id, name]) => (<option key={id} value={id}>{name}</option>))}
                </select></label>
                <label>城市 <input type="text" value={resForm.city} maxLength={30} onChange={(e) => editResForm("city", e.target.value)} /></label>
                <label>价格（元） <input type="number" min={0} step="0.01" value={resForm.priceYuan} onChange={(e) => editResForm("priceYuan", e.target.value)} /></label>
                <label>单位 <input type="text" value={resForm.unit} maxLength={10} onChange={(e) => editResForm("unit", e.target.value)} /></label>
                <label>容量 <input type="number" min={0} value={resForm.capacity} onChange={(e) => editResForm("capacity", e.target.value)} /></label>
                <label>库存 <input type="number" min={0} value={resForm.stock} onChange={(e) => editResForm("stock", e.target.value)} /></label>
                <label>状态 <select value={resForm.status} onChange={(e) => editResForm("status", e.target.value)}>
                  <option value="published">上架</option><option value="draft">下架</option>
                </select></label>
                <label>图片路径 <input type="text" value={resForm.image} maxLength={200} placeholder="/images/…" onChange={(e) => editResForm("image", e.target.value)} /></label>
                <label>介绍 <input type="text" value={resForm.description} maxLength={3000} onChange={(e) => editResForm("description", e.target.value)} /></label>
                <div>
                  <button type="button" className="btn-export" disabled={resBusyId !== null} onClick={saveResForm}>{resBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setResForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col" aria-sort={ariaSort("resources", "name")}>名称<SortButton label="名称" sortKey="name" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col">分类</th><th scope="col">城市</th><th scope="col">店铺</th><th scope="col" className="num" aria-sort={ariaSort("resources", "price")}>价格<SortButton label="价格" sortKey="price" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("resources", "stock")}>库存<SortButton label="库存" sortKey="stock" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="resBody">
                  {resources.length
                    ? (filteredResources.length ? sortedResources.map((r) => (
                      <Fragment key={r.id}>
                        <tr>
                          <td>{r.name}</td><td>{catZh(r.category)}</td><td>{r.city}</td><td>{shopName(r.shop_id)}</td>
                          <td className="num">{fmtMoney(r.price)}</td><td className="num">{r.stock}</td>
                          <td>{r.status === "published" ? "上架" : "下架"}</td>
                          <td>
                            <span className="row-actions">
                              <button type="button" className="btn-view" disabled={resBusyId !== null} onClick={() => openResForm(r)}>编辑</button>
                              <button type="button" className="btn-view" disabled={resBusyId !== null} onClick={() => doToggleResStatus(r)}>{resBusyId === r.id ? "处理中…" : (r.status === "published" ? "下架" : "上架")}</button>
                              {r.category === "show" ? (
                                <button type="button" className="btn-view" disabled={resBusyId !== null} onClick={() => doSyncRes(r)}>{resBusyId === r.id ? "处理中…" : "同步渠道"}</button>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                        {r.meta && (r.meta.lastSync || r.meta.syncResult) ? (
                          <tr>
                            <td colSpan="8">
                              {r.meta.lastSync ? (<span>最近模拟同步：{String(r.meta.lastSync).slice(0, 19).replace("T", " ")}</span>) : null}
                              {r.meta.lastSync && r.meta.syncResult ? "　" : null}
                              {r.meta.syncResult ? (<span>渠道同步结果：{r.meta.syncResult}</span>) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )) : searchEmpty(8))
                    : <tr><td colSpan="8"><div className="empty">暂无资源</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "shops" ? " on" : "")} id="view-shops">
            <div className="search-row">
              <SearchBox id="search-shops" label="搜索店铺" placeholder="输入店铺名或店主…"
                value={query} onChange={setQuery} resultCount={q ? filteredShops.length : null} />
              {isPlatformAdmin ? (<button type="button" className="btn-export" onClick={() => openShopForm(null)}>添加店铺</button>) : null}
            </div>
            <div className="note">总店“桂演平台总店”不可停用；子店店主须为管理员账号，且一位管理员只属于一家店铺。子店管理员仅可见、可改本店资源。</div>
            {shopForm ? (
              <fieldset className="tag-rule">
                <legend>{shopForm.id === null ? "添加店铺" : "编辑店铺：" + shopForm.name}</legend>
                <label>店铺名称 <input type="text" value={shopForm.name} maxLength={50} onChange={(e) => editShopForm("name", e.target.value)} /></label>
                {shopForm.id === null ? (
                  <label>上级店铺 <select value={shopForm.parent_id} onChange={(e) => editShopForm("parent_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : (
                  <label>上级店铺 <input type="text" value={shopName(shopForm.parent_id)} disabled /></label>
                )}
                <label>店主 <select value={shopForm.owner_id} onChange={(e) => editShopForm("owner_id", e.target.value)}>
                  <option value="">未指派</option>
                  {users.filter((u) => u.role === "admin").map((u) => (<option key={u.id} value={String(u.id)}>{u.name}（{u.username}）</option>))}
                </select></label>
                {shopForm.id !== null ? (
                  <label>状态 <select value={shopForm.status} onChange={(e) => editShopForm("status", e.target.value)}>
                    <option value="active">启用</option><option value="disabled">停用</option>
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={shopBusyId !== null} onClick={saveShopForm}>{shopBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setShopForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col" aria-sort={ariaSort("shops", "name")}>名称<SortButton label="名称" sortKey="name" tableId="shops" sort={sorts.shops} onToggle={toggleSort} /></th><th scope="col">上级</th><th scope="col">店主</th><th scope="col" className="num" aria-sort={ariaSort("shops", "resource_count")}>资源数<SortButton label="资源数" sortKey="resource_count" tableId="shops" sort={sorts.shops} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="shopsBody">
                  {shops.length
                    ? (filteredShops.length ? sortedShops.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td><td>{s.parent_id === null ? "—" : shopName(s.parent_id)}</td><td>{s.owner_name || "未指派"}</td>
                        <td className="num">{s.resource_count}</td><td>{s.status === "active" ? "启用" : "停用"}</td>
                        <td>
                          {isPlatformAdmin ? (
                            <span className="row-actions">
                              <button type="button" className="btn-view" disabled={shopBusyId !== null} onClick={() => openShopForm(s)}>编辑</button>
                              {s.id !== 1 ? (
                                <button type="button" className="btn-view" disabled={shopBusyId !== null} onClick={() => doToggleShopStatus(s)}>{shopBusyId === s.id ? "处理中…" : (s.status === "active" ? "停用" : "启用")}</button>
                              ) : null}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    )) : searchEmpty(6))
                    : <tr><td colSpan="6"><div className="empty">暂无店铺</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "aicopy" ? " on" : "")} id="view-aicopy">
            <div className="note">本地模板 · 未接入大模型。输入主题生成三渠道文案草稿；缺日期、价格、地点时只留占位符，不编造。请用中文输入主题，模板只识别中文日期/价格/地点。</div>
            <textarea className="copy-prompt" aria-label="文案主题" placeholder="例如：为《刘三姐》写一段小红书推送，地点：南宁剧场，票价280元"
              value={copyPrompt} onChange={(e) => setCopyPrompt(e.target.value)} />
            <div className="chips">
              <button type="button" className="btn-export" disabled={copyBusy || !copyPrompt.trim()} onClick={doCopyGenerate}>{copyBusy ? "生成中…" : "生成文案"}</button>
            </div>
            {copyResult ? (
              <>
                <div className="copy-card">
                  <h3>{copyResult.title}</h3>
                  <pre>{copyResult.body}</pre>
                  <button type="button" className="btn-resolve" onClick={() => doCopyText(copyResult.body)}>复制正文</button>
                </div>
                {copyResult.channels.map((c) => (
                  <div className="copy-card" key={c.name}>
                    <h3>{c.name}</h3>
                    <pre>{c.content}</pre>
                    <button type="button" className="btn-resolve" onClick={() => doCopyText(c.content)}>复制{c.name}</button>
                  </div>
                ))}
                <p className="def-note">注意事项：{(copyResult.notes || []).join("；")}</p>
              </>
            ) : null}
          </section>

          <section className={"view" + (view === "demands" ? " on" : "")} id="view-demands">
            <div className="search-row">
              <SearchBox id="search-demands" label="搜索需求" placeholder="输入标题、分类、城市或发布人…"
                value={query} onChange={setQuery} resultCount={q ? filteredDemands.length : null} />
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col" aria-sort={ariaSort("demands", "title")}>标题<SortButton label="标题" sortKey="title" tableId="demands" sort={sorts.demands} onToggle={toggleSort} /></th><th scope="col">分类</th><th scope="col" className="num" aria-sort={ariaSort("demands", "budget")}>预算<SortButton label="预算" sortKey="budget" tableId="demands" sort={sorts.demands} onToggle={toggleSort} /></th><th scope="col">城市</th><th scope="col">发布人</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="demBody">
                  {demands.length
                    ? (filteredDemands.length ? sortedDemands.map((d) => (
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
                      countText={q ? (filteredSeries.length > 10 ? `找到 ${filteredSeries.length} 条（显示${sorts.trends ? "前" : "最近"} 10 条）` : `找到 ${filteredSeries.length} 条`) : undefined} />
                  </div>
                  <div className="tbl-wrap">
                    <table>
                      <thead><tr><th scope="col" aria-sort={ariaSort("trends", "label")}>周期<SortButton label="周期" sortKey="label" tableId="trends" sort={sorts.trends} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("trends", "amount")}>金额<SortButton label="金额" sortKey="amount" tableId="trends" sort={sorts.trends} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("trends", "count")}>订单量<SortButton label="订单量" sortKey="count" tableId="trends" sort={sorts.trends} onToggle={toggleSort} /></th></tr></thead>
                      <tbody>
                        {filteredSeries.length ? (sorts.trends ? sortedSeries.slice(0, 10) : filteredSeries.slice(-10).reverse()).map((s) => (
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
                <p className="def-note">默认规则：高价值：累计消费 ≥ ¥10,000；潜力会员：消费 ¥1,000–10,000 且付费 ≥ 2 笔、最近付费 ≤ 90 天；沉默用户：付费 ≥ 1 笔、最近付费 &gt; 90 天。规则可在「标签规则」页修改。</p>
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
                      <thead><tr><th scope="col">渠道</th><th scope="col" className="num" aria-sort={ariaSort("channels", "amount")}>成交额<SortButton label="成交额" sortKey="amount" tableId="channels" sort={sorts.channels} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("channels", "orders")}>订单量<SortButton label="订单量" sortKey="orders" tableId="channels" sort={sorts.channels} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("channels", "share")}>占比<SortButton label="占比" sortKey="share" tableId="channels" sort={sorts.channels} onToggle={toggleSort} /></th></tr></thead>
                      <tbody>
                        {filteredChannels.length ? sortedChannels.map((c) => (
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
                      <thead><tr><th scope="col">排名</th><th scope="col">资源</th><th scope="col" className="num" aria-sort={ariaSort("ranking", "sales")}>销量<SortButton label="销量" sortKey="sales" tableId="ranking" sort={sorts.ranking} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("ranking", "quantity")}>数量<SortButton label="数量" sortKey="quantity" tableId="ranking" sort={sorts.ranking} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("ranking", "revenue")}>交易额<SortButton label="交易额" sortKey="revenue" tableId="ranking" sort={sorts.ranking} onToggle={toggleSort} /></th></tr></thead>
                      <tbody>
                        {filteredRanking.length ? sortedRanking.slice(0, 10).map((r) => (
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
                  <h2>运营助手</h2>
                  <p className="def-note">本地规则分析，未接入大模型；按经营分析的真实数据回答，仅管理员可用。</p>
                  <div className="op-row">
                    <input type="text" aria-label="运营问题" placeholder="例如：今日销量、场馆表现、生成经营报告…"
                      value={opQuery} onChange={(e) => setOpQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") doOperatorAsk(); }} />
                    <button type="button" className="btn-export" disabled={opBusy || !opQuery.trim()} onClick={doOperatorAsk}>{opBusy ? "查询中…" : "发送"}</button>
                  </div>
                  {opReply ? <div className="report"><pre>{opReply}</pre></div> : null}
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
                          {v.recommendations && v.recommendations.length ? (
                            <Fragment>
                              <small className="def">推荐剧目：</small>
                              {v.recommendations.map((r) => (
                                <small key={r.id} className="def">· {r.name} — {r.reason}</small>
                              ))}
                            </Fragment>
                          ) : (
                            <small className="def">推荐剧目：暂无匹配剧目</small>
                          )}
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
                  <h2>完整报告 <button type="button" className="btn-export" onClick={downloadReport}>下载报告</button></h2>
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
                  <thead><tr><th scope="col" aria-sort={ariaSort("audit", "created_at")}>时间<SortButton label="时间" sortKey="created_at" tableId="audit" sort={sorts.audit} onToggle={toggleSort} /></th><th scope="col">操作人</th><th scope="col">操作</th><th scope="col">详情</th></tr></thead>
                  <tbody>
                    {auditLogs.length
                      ? (filteredAudit.length ? sortedAudit.map((l) => (
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

      {/* Wave 4 #15: simulated agreement modal (具体功能 #12). */}
      {contract && (
        <div className="contract-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setContract(null); }}>
          <div className="contract-sheet">
            <h3>{contract.title}</h3>
            <pre className="contract-text">{contract.content}</pre>
            <div className="contract-actions">
              <button type="button" className="btn-approve" onClick={downloadContract}>下载模拟协议</button>
              <button type="button" className="btn-reject" onClick={() => setContract(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <div className={"toast" + (toastMsg ? " show" : "")} id="toast" role="status">{toastMsg}</div>
    </>
  );
}
