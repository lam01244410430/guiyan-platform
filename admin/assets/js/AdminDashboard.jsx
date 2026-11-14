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
  apiGet, apiPost, apiPatch, apiDelete, apiDownloadCsv, apiDownloadFile, downloadText, clearToken, currentUser, getToken, fmtMoney, STATUS,
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
const PERF_STATUS = { scheduled: "待上架", on_sale: "在售", cancelled: "已取消" };
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
// B-053: auto-tag rules (R7-5) have a signal, not conditions — the signal
// kinds are AUTO_SIGNAL_KINDS in server/lib/profiles.mjs. The admin view
// renders the signal as text; condition editors stay manual-only.
const AUTO_SIGNAL_LABELS = {
  view_genre: "浏览剧种",
  view_category: "浏览分类",
  click_category: "点击分类",
  order_category: "购票分类",
  favorite_category: "收藏分类",
};
function autoSignalText(r) {
  const s = (r && r.signal) || {};
  const label = AUTO_SIGNAL_LABELS[s.kind] || "自动信号";
  const what = s.kind === "view_genre" ? s.genre : s.category;
  return "自动 · " + label + (what ? " " + what : "") + " ≥ " + (s.threshold || 0) + " 次";
}
const ALERT_KINDS = [
  ["sales", "销量突降"], ["verification", "核销异常"], ["inventory", "库存异常"],
  ["data", "数据异常"], ["sentiment", "潜在舆情风险"],
];

/* R4-4: a pending partial refund (refund_requested with ticket ids in
   pending_refund_tickets) shows the frozen ticket count + the refund
   amounts the approval would pay (perTicket = floor(amount /
   quantity), card share first = floor(stored_value_cents /
   quantity) x k). Returns null when nothing is pending. */
function pendingPartialInfo(o) {
  let ids = [];
  try { ids = JSON.parse(o.pending_refund_tickets || "[]"); } catch { ids = []; }
  if (!Array.isArray(ids) || !ids.length) return null;
  const k = ids.length;
  const qty = o.quantity || 1;
  const perTicket = Math.floor((o.amount || 0) / qty);
  const cardPerTicket = Math.floor((o.stored_value_cents || 0) / qty);
  return { k, refundCents: perTicket * k, cardCents: cardPerTicket * k };
}

/* Wave 4 #13: after-sales actions per order row. refund_requested shows
   同意退款 / 拒绝退款; disputed shows 驳回申诉 / 调解完成并结算. Buttons
   follow the demands-review pattern (reviewBusyId, disabled while
   processing). The reason + platform decision render under the row, port
   of zhou Transactions.jsx:248-252. */
function OrderRow({ o, onContract, onReview, onEscrow, reviewBusyId }) {
  const busy = reviewBusyId === o.id;
  const pending = pendingPartialInfo(o);
  return (
    <>
      <tr>
        <td className="code">{o.code}</td><td>{o.user_name || ""}</td><td>{o.resource_name || ""}</td>
        <td className="num">{fmtMoney(o.amount)}</td><td>{o.booking_date || ""}</td>
        <td><span className={"pill " + o.status}>{STATUS[o.status] || o.status}</span></td>
        <td>{o.escrow || ""}</td>
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
          ) : o.status === "paid" && o.escrow === "模拟托管中" ? (
            <span className="row-actions">
              <button type="button" className="btn-approve" disabled={busy} onClick={() => onEscrow(o.id, "hold")}>{busy ? "处理中…" : "托管"}</button>
            </span>
          ) : o.status === "paid" && o.escrow === "已托管" ? (
            <span className="row-actions">
              <button type="button" className="btn-approve" disabled={busy} onClick={() => onEscrow(o.id, "release")}>{busy ? "处理中…" : "释放托管"}</button>
            </span>
          ) : ""}
        </td>
      </tr>
      {o.refund_reason || o.refund_decision || pending ? (
        <tr>
          <td colSpan="9">
            {pending ? (<span>部分退款待审：{pending.k} 张票，退款 ¥{(pending.refundCents / 100).toString()}（其中文惠卡先返 ¥{(pending.cardCents / 100).toString()}）</span>) : null}
            {pending && (o.refund_reason || o.refund_decision) ? "　" : null}
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
  // R6-5 评论审核: the admin comment list + status filter
  // ("pending" default) + the per-comment reply draft, keyed by id.
  const [comments, setComments] = useState([]);
  const [cmtFilter, setCmtFilter] = useState("pending");
  const [replyDraft, setReplyDraft] = useState({});
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
  function changeView(v) { setView(v); setQuery(""); setSorts({}); setTagFilter(""); setResShopFilter(""); setShowStatusFilter(""); setPerfShowId(null); setPerfForm(null); setDrawerOpen(false); setVenueForm(null); setMemberTierForm(null); setFlashSaleForm(null); setCouponRuleForm(null); setTplVenueId(null); setTplForm(null); }
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
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [threshold, setThreshold] = useState(5);
  // R5-1 数据运营: the stored aggregates for the chosen period +
  // date + type filter ("" = all types), and the re-aggregate
  // in-flight flag. Date "" = today (server default); the aggregates
  // table is read-only — recompute runs only via the button below.
  const [eventAggregates, setEventAggregates] = useState([]);
  const [eventPeriod, setEventPeriod] = useState("day");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventBusy, setEventBusy] = useState(false);
  // R5-2 会员数据: the per-shop member rows + rule suggestions for
  // the chosen shop, the stored insight rules, and the rules form
  // (strings in the inputs, validated as integers on save).
  const [memberInsights, setMemberInsights] = useState(null);
  const [insightShop, setInsightShop] = useState("1");
  const [insightRules, setInsightRules] = useState(null);
  const [insightRuleForm, setInsightRuleForm] = useState({ churnDays: "90", upgradeGapPct: "20", callbackDays: "90" });
  const [insightBusy, setInsightBusy] = useState(false);
  // R7-1 IP 配置: 文小惠 config frame — name/avatar/greeting, all
  // empty (= unset) until an admin sets them; the form holds strings,
  // the server validates (name ≤20, greeting ≤200, avatar https://
  // or site-relative) and GET /api/ip stays {} while unset.
  const [ipConfig, setIpConfig] = useState(null);
  const [ipForm, setIpForm] = useState({ ip_name: "", ip_avatar_url: "", ip_greeting: "" });
  const [ipBusy, setIpBusy] = useState(false);
  // R5-3 数据大屏: the BI payload (KPIs + top shows/venues +
  // 30-day series), the export in-flight flag, and the fullscreen
  // toggle (CSS class on the section; Esc closes it — see the
  // keydown effect below).
  const [biData, setBiData] = useState(null);
  const [biBusy, setBiBusy] = useState(false);
  const [biFullscreen, setBiFullscreen] = useState(false);
  // R5-5 财务账本: the ledger page + kind/reconciled filters, the
  // id of the row being reconciled, and the alert rules + the
  // create-rule form (config fields follow the chosen kind).
  const [financeLedger, setFinanceLedger] = useState([]);
  const [ledgerKind, setLedgerKind] = useState("");
  const [ledgerReconciled, setLedgerReconciled] = useState("");
  const [ledgerBusyId, setLedgerBusyId] = useState(null);
  const [alertRules, setAlertRules] = useState([]);
  const [ruleForm, setRuleForm] = useState({ kind: "sales_drop", shop_id: "", drop_pct: "50", window_days: "7", fail_count: "10", window_minutes: "60", stock_lt: "10" });
  const [ruleBusy, setRuleBusy] = useState(false);
  // R5-5 resource stats: per-resource stats loaded on demand (one
  // row at a time — the resources table does not fire N requests on
  // load), keyed by resource id.
  const [resStats, setResStats] = useState({});
  const [resStatsBusyId, setResStatsBusyId] = useState(null);
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
  // R1-3 shop theming: the open theme editor draft (null = closed;
  // {shopId, shopName, banner, primaryColor, sections[]}) + the shop
  // id whose theme save is in flight (same pattern as shopBusyId).
  const [themeForm, setThemeForm] = useState(null);
  const [themeBusyId, setThemeBusyId] = useState(null);
  // R1-2 admin accounts: own profile form + OTP password change, and
  // the id of the user whose enable/disable is in flight.
  const [acctName, setAcctName] = useState("");
  const [acctEmail, setAcctEmail] = useState("");
  // R2-1 shows + performances: the show list + the open create form
  // draft + the status filter + the id of the show under review +
  // the open per-show performance manager (perfShowId) + its create
  // form draft (null = closed) + the id of the performance in flight.
  const [shows, setShows] = useState([]);
  const [showForm, setShowForm] = useState(null);
  const [showBusyId, setShowBusyId] = useState(null);
  const [showStatusFilter, setShowStatusFilter] = useState("");
  const [showReviewBusyId, setShowReviewBusyId] = useState(null);
  const [perfShowId, setPerfShowId] = useState(null);
  const [perfForm, setPerfForm] = useState(null);
  const [perfBusyId, setPerfBusyId] = useState(null);
  // R2-2 ticket types (price tiers): the performance whose tiers are
  // open (tierPerfId) + tiers loaded on demand per performance
  // (tiersByPerf) + the open tier create/edit draft (null = closed) +
  // the id of the tier in flight.
  const [tierPerfId, setTierPerfId] = useState(null);
  const [tiersByPerf, setTiersByPerf] = useState({});
  const [tierForm, setTierForm] = useState(null);
  const [tierBusyId, setTierBusyId] = useState(null);
  // R2-3 pickup points + ticket templates: the show whose pickup
  // points are open (pickupShowId) + points loaded on demand per show
  // (pickupByShow) + the open create draft (null = closed) + the id of
  // the point in flight; the shop-scoped template list (templates) +
  // the open template create/edit draft + the id in flight.
  const [pickupByShow, setPickupByShow] = useState({});
  const [pickupShowId, setPickupShowId] = useState(null);
  const [pickupForm, setPickupForm] = useState(null);
  const [pickupBusyId, setPickupBusyId] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState(null);
  const [templateBusyId, setTemplateBusyId] = useState(null);
  // R2-4 venues + seat templates: the venue list + the open create/
  // edit draft + the id of the venue in flight; the venue whose seat
  // templates are open (tplVenueId) + templates loaded on demand per
  // venue (templatesByVenue) + the open template create/edit draft
  // (null = closed) + the id of the template in flight.
  const [venues, setVenues] = useState([]);
  const [venueForm, setVenueForm] = useState(null);
  const [venueBusyId, setVenueBusyId] = useState(null);
  // R6-2: venue availability lookup — the date + the picked venue
  // ("" = all venues) + the last result (null = no lookup run yet).
  const [availDate, setAvailDate] = useState(function () {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  });
  const [availVenueId, setAvailVenueId] = useState("");
  const [availResult, setAvailResult] = useState(null);
  const [availBusy, setAvailBusy] = useState(false);
  const [tplVenueId, setTplVenueId] = useState(null);
  const [templatesByVenue, setTemplatesByVenue] = useState({});
  const [tplForm, setTplForm] = useState(null);
  const [tplBusyId, setTplBusyId] = useState(null);
  // R3-1 member tiers: the tier list (already shop-scoped by the
  // server) + the open create/edit draft + the id of the tier in flight.
  const [memberTiers, setMemberTiers] = useState([]);
  const [memberTierForm, setMemberTierForm] = useState(null);
  const [memberTierBusyId, setMemberTierBusyId] = useState(null);
  // R3-2 coupons: the coupon list (already shop-scoped by the server,
  // each row carries live redemption_count + total_discount_cents) +
  // the open create/edit draft + the id of the coupon in flight.
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState(null);
  const [couponBusyId, setCouponBusyId] = useState(null);
  // R3-3 flash sales: the sale list (already shop-scoped by the
  // server, each row carries live sold_count + quota_remaining) +
  // the open create/edit draft + the id of the sale in flight.
  const [flashSales, setFlashSales] = useState([]);
  const [flashSaleForm, setFlashSaleForm] = useState(null);
  const [flashSaleBusyId, setFlashSaleBusyId] = useState(null);
  // R3-4 auto coupon rules: the rule list (already shop-scoped by the
  // server, each row carries live gift_count) + the open create/edit
  // draft + the id of the rule in flight.
  const [couponRules, setCouponRules] = useState([]);
  const [couponRuleForm, setCouponRuleForm] = useState(null);
  const [couponRuleBusyId, setCouponRuleBusyId] = useState(null);
  // R3-5 SMS tasks: the task list (already shop-scoped by the server,
  // each row carries its stored audience_count) + the open create/edit
  // draft + the id of the task in flight. No provider is registered
  // this wave — a task only ever reaches "未发送 — 等待服务商".
  const [smsTasks, setSmsTasks] = useState([]);
  const [smsTaskForm, setSmsTaskForm] = useState(null);
  const [smsTaskBusyId, setSmsTaskBusyId] = useState(null);
  // R6-1 版权登记: the licence list (public endpoint; writes are
  // shop-scoped by the resource's shop) + the open create draft +
  // the in-flight flag. Admin labels stay hardcoded Chinese
  // (admin rule: no i18n).
  const [licenses, setLicenses] = useState([]);
  const [licForm, setLicForm] = useState(null);
  const [licBusy, setLicBusy] = useState(false);
  // R3-6 stored value 文惠卡: the plan list (already shop-scoped by
  // the server) + the open create/edit draft + the id of the plan in
  // flight + the subsidy-grant form + the per-user account lookup.
  const [storedValuePlans, setStoredValuePlans] = useState([]);
  const [storedValuePlanForm, setStoredValuePlanForm] = useState(null);
  const [storedValuePlanBusyId, setStoredValuePlanBusyId] = useState(null);
  const [grantForm, setGrantForm] = useState({ user_id: "", amount_cents: "", note: "", shop_id: "1" });
  const [grantBusy, setGrantBusy] = useState(false);
  const [lookupUserId, setLookupUserId] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  // R4-1 核销: the code being verified + the last result card +
  // this session's verify history (the server logs EVERY attempt
  // in verify_logs, but there is no admin verify-logs list endpoint
  // this wave, so the recent list below is the session's own
  // attempts, newest first).
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyHistory, setVerifyHistory] = useState([]);
  // R4-3 批量核销 + 离线队列: pasted multi-code input, per-code
  // batch results, and the localStorage offline queue (key
  // guiyan-verify-queue — the SAME key the mini-program uses).
  // Admin-only labels stay hardcoded Chinese (admin rule: no i18n).
  const [batchCodes, setBatchCodes] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [verifyQueue, setVerifyQueue] = useState(() => {
    try {
      const q = JSON.parse(localStorage.getItem("guiyan-verify-queue") || "[]");
      return Array.isArray(q) ? q : [];
    } catch (e) { return []; }
  });
  // R4-2 打印纸质票: the order id being printed + the in-flight
  // flag (same disabled-while-processing pattern as the other
  // admin writes).
  const [printOrderId, setPrintOrderId] = useState("");
  const [printBusy, setPrintBusy] = useState(false);
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
  // R5-1: read the STORED aggregates for the current period/date/
  // type filter (the list endpoint never recomputes live).
  function loadEventAggregates() {
    const qs = "/api/admin/event-aggregates?period=" + eventPeriod
      + (eventDate ? "&date=" + encodeURIComponent(eventDate) : "")
      + (eventType ? "&type=" + encodeURIComponent(eventType) : "");
    apiGet(qs).then(function (d) {
      setEventAggregates(d.event_aggregates || []);
    }).catch(loadFail);
  }
  // R5-1: recompute the aggregates for the current period/date
  // (manual trigger only — there is no cron/worker this wave), then
  // reload the table. Idempotent: running it twice changes nothing.
  function doAggregateEvents() {
    if (eventBusy) return;
    setEventBusy(true);
    apiPost("/api/admin/aggregate-events", {
      period: eventPeriod,
      ...(eventDate ? { date: eventDate } : {}),
    }).then(function () {
      setEventBusy(false);
      toast("已重新聚合");
      loadEventAggregates();
    }).catch(function (e) {
      setEventBusy(false);
      if (e && e.status === 403) toast("无权重新聚合");
      else toast((e && e.message) || "重新聚合失败");
    });
  }

  // R5-2: load the member rows + suggestions for the chosen shop
  // and the stored insight rules (the server forces a shop-scoped
  // admin to their own shop whatever ?shop= says).
  function loadMemberInsights() {
    apiGet("/api/admin/member-insights?shop=" + encodeURIComponent(insightShop)).then(function (d) {
      setMemberInsights(d);
    }).catch(loadFail);
    apiGet("/api/admin/member-insight-rules").then(function (d) {
      setInsightRules(d.rules || null);
      if (d.rules) setInsightRuleForm({
        churnDays: String(d.rules.churnDays),
        upgradeGapPct: String(d.rules.upgradeGapPct),
        callbackDays: String(d.rules.callbackDays),
      });
    }).catch(loadFail);
  }
  // R5-2: save the rules form (validated client-side first; the
  // server re-validates: unknown keys -> 400, ranges 1–365 / 0–100
  // / 1–365), then reload the member rows — the churn list follows
  // the new rules immediately.
  function saveInsightRules() {
    if (insightBusy) return;
    const churnDays = Number(insightRuleForm.churnDays);
    const upgradeGapPct = Number(insightRuleForm.upgradeGapPct);
    const callbackDays = Number(insightRuleForm.callbackDays);
    if (!Number.isInteger(churnDays) || churnDays < 1 || churnDays > 365) { toast("流失天数须为 1–365 的整数"); return; }
    if (!Number.isInteger(upgradeGapPct) || upgradeGapPct < 0 || upgradeGapPct > 100) { toast("可升级差距百分比须为 0–100 的整数"); return; }
    if (!Number.isInteger(callbackDays) || callbackDays < 1 || callbackDays > 365) { toast("回访天数须为 1–365 的整数"); return; }
    setInsightBusy(true);
    apiPatch("/api/admin/member-insight-rules", { churnDays, upgradeGapPct, callbackDays }).then(function (d) {
      setInsightBusy(false);
      setInsightRules(d.rules || null);
      toast("规则已保存");
      loadMemberInsights();
    }).catch(function (e) {
      setInsightBusy(false);
      if (e && e.status === 403) toast("无权修改规则");
      else toast((e && e.message) || "保存失败");
    });
  }

  // R7-1: load the IP config when the view opens (public GET — the
  // admin bundle reuses it so the form shows the stored values).
  function loadIpConfig() {
    apiGet("/api/ip").then(function (d) {
      setIpConfig(d || {});
      setIpForm({
        ip_name: (d && d.ip_name) || "",
        ip_avatar_url: (d && d.ip_avatar_url) || "",
        ip_greeting: (d && d.ip_greeting) || "",
      });
    }).catch(loadFail);
  }
  // R7-1: save the IP form (client-side length checks mirror the
  // server: name ≤20, greeting ≤200, avatar https:// or site-
  // relative; empty clears a field).
  function saveIpConfig() {
    if (ipBusy) return;
    if ([...ipForm.ip_name].length > 20) { toast("IP 名称不能超过20字"); return; }
    if ([...ipForm.ip_greeting].length > 200) { toast("问候语不能超过200字"); return; }
    const avatar = ipForm.ip_avatar_url.trim();
    if (avatar !== "" && !/^https:\/\/\S+$/.test(avatar) && !/^\/[^/\s]\S*$/.test(avatar)) { toast("头像链接须为 https:// 开头或站内路径"); return; }
    setIpBusy(true);
    apiPatch("/api/admin/ip", { ip_name: ipForm.ip_name.trim(), ip_avatar_url: avatar, ip_greeting: ipForm.ip_greeting.trim() }).then(function (d) {
      setIpBusy(false);
      setIpConfig(d || {});
      toast("IP 配置已保存");
    }).catch(function (e) {
      setIpBusy(false);
      if (e && e.status === 403) toast("无权修改 IP 配置");
      else toast((e && e.message) || "保存失败");
    });
  }
  // R7-1 IP 配置: load the stored config when the view opens.
  useEffect(() => {
    if (view === "ipconfig") loadIpConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // R5-3: load the BI payload when the view opens.
  function loadBi() {
    apiGet("/api/admin/bi").then(function (d) {
      setBiData(d);
    }).catch(loadFail);
  }
  // R5-3: export the BI report as XLSX (hand-built real .xlsx from
  // the server) or CSV (BOM). The filename carries the Beijing date,
  // matching the server's Content-Disposition.
  function doExportBi(format) {
    if (biBusy) return;
    const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    setBiBusy(true);
    apiDownloadFile("/api/admin/bi/export?format=" + format, "bi-" + date + "." + format).then(function () {
      toast(format === "xlsx" ? "已导出 BI 报表（Excel）" : "已导出 BI 报表（CSV）");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权导出");
      else toast("导出失败，请稍后重试");
    }).finally(function () { setBiBusy(false); });
  }
  // R5-3: PDF goes via browser print (window.print + the print
  // stylesheet) — the server does NOT generate PDF files this wave
  // (no CJK font dependency), so the button says so honestly:
  // "浏览器打印另存为 PDF", never "导出 PDF 文件".
  function doPrintBi() {
    try { window.print(); } catch (e) { toast("当前浏览器不支持打印"); }
  }

  // R5-5: load the alert rules (the alerts view shows them under
  // the alert list; auto alerts themselves are computed on read and
  // are part of GET /api/admin/alerts).
  function loadAlertRules() {
    apiGet("/api/admin/alert-rules").then(function (d) {
      setAlertRules(d.rules || []);
    }).catch(loadFail);
  }
  // R5-5: create a rule from the form (config fields follow the
  // chosen kind; empty shop = platform-level for the platform
  // admin, forced to the admin's own shop for a shop admin).
  function doCreateRule() {
    if (ruleBusy) return;
    const kind = ruleForm.kind;
    const config = {};
    function readNum(key, lo, hi, label) {
      const v = Number(ruleForm[key]);
      if (!Number.isInteger(v) || v < lo || v > hi) { toast(label + "须为 " + lo + "–" + hi + " 的整数"); return false; }
      config[key] = v;
      return true;
    }
    if (kind === "sales_drop") {
      if (!readNum("drop_pct", 1, 100, "跌幅百分比")) return;
      if (!readNum("window_days", 1, 90, "窗口天数")) return;
    } else if (kind === "scan_abuse") {
      if (!readNum("fail_count", 1, 1000, "失败次数")) return;
      if (!readNum("window_minutes", 1, 1440, "窗口分钟")) return;
    } else if (!readNum("stock_lt", 0, 100000, "库存阈值")) return;
    const shopId = ruleForm.shop_id.trim() === "" ? null : Number(ruleForm.shop_id);
    if (shopId !== null && (!Number.isInteger(shopId) || shopId < 1)) { toast("店铺编号错误"); return; }
    setRuleBusy(true);
    apiPost("/api/admin/alert-rules", { kind, shop_id: shopId, config }).then(function () {
      setRuleBusy(false);
      toast("已新增预警规则");
      loadAlertRules(); loadAlerts(); loadAudit();
    }).catch(function (e) {
      setRuleBusy(false);
      toast((e && e.data && e.data.error) || "新增失败");
    });
  }
  // R5-5: enable/disable a rule. Disabling is how an auto alert is
  // dismissed (auto alerts are computed on read, never stored).
  function doToggleRule(rule) {
    if (ruleBusy) return;
    setRuleBusy(true);
    apiPatch("/api/admin/alert-rules/" + rule.id, { status: rule.status === "active" ? "disabled" : "active" }).then(function () {
      setRuleBusy(false);
      toast(rule.status === "active" ? "已停用规则，自动预警随之消失" : "已启用规则");
      loadAlertRules(); loadAlerts(); loadAudit();
    }).catch(function (e) {
      setRuleBusy(false);
      toast((e && e.data && e.data.error) || "操作失败");
    });
  }
  // R5-5: load the finance ledger page for the current filters.
  function loadFinanceLedger() {
    const qs = "/api/admin/finance-ledger?limit=200"
      + (ledgerKind ? "&kind=" + encodeURIComponent(ledgerKind) : "")
      + (ledgerReconciled !== "" ? "&reconciled=" + encodeURIComponent(ledgerReconciled) : "");
    apiGet(qs).then(function (d) {
      setFinanceLedger(d.ledger || []);
    }).catch(loadFail);
  }
  // R5-5: mark one ledger row reconciled, then reload the table.
  function doReconcileLedger(id) {
    if (ledgerBusyId !== null) return;
    setLedgerBusyId(id);
    apiPost("/api/admin/finance-ledger/" + id + "/reconcile", {}).then(function () {
      setLedgerBusyId(null);
      toast("已对账");
      loadFinanceLedger(); loadAudit();
    }).catch(function (e) {
      setLedgerBusyId(null);
      toast((e && e.data && e.data.error) || "对账失败");
    });
  }
  // R5-5: export the filtered ledger as BOM CSV (same download
  // helper as the orders CSV).
  function doExportLedger() {
    const qs = "/api/admin/finance-ledger?format=csv"
      + (ledgerKind ? "&kind=" + encodeURIComponent(ledgerKind) : "")
      + (ledgerReconciled !== "" ? "&reconciled=" + encodeURIComponent(ledgerReconciled) : "");
    apiDownloadCsv(qs, "guiyan-finance-ledger.csv").then(function () {
      toast("已导出财务账本 CSV");
      loadAudit();
    }).catch(function (e) {
      toast((e && e.data && e.data.error) || "导出失败");
    });
  }
  // R5-5: load one resource's stats on demand (views/event_views/
  // clicks/orders/revenue/tickets/verify) and show them under the row.
  function loadResStats(id) {
    if (resStatsBusyId !== null) return;
    setResStatsBusyId(id);
    apiGet("/api/admin/resources/" + id + "/stats").then(function (d) {
      setResStats(function (m) { return { ...m, [id]: d }; });
      setResStatsBusyId(null);
    }).catch(function (e) {
      setResStatsBusyId(null);
      toast((e && e.data && e.data.error) || "加载统计失败");
    });
  }

  useEffect(() => {
    const u = currentUser();
    if (!getToken() || !u) { location.href = "/admin/index.html"; return; }
    setWhoName(u.name || u.username || "管理员");
    Promise.all([
      apiGet("/api/admin/stats"), apiGet("/api/admin/orders"), apiGet("/api/admin/users"),
      apiGet("/api/admin/resources"), apiGet("/api/admin/demands"),
      apiGet("/api/admin/shops"), apiGet("/api/admin/shows"),
      apiGet("/api/venues"), apiGet("/api/admin/member-tiers"),
      apiGet("/api/admin/coupons"), apiGet("/api/admin/flash-sales"),
      apiGet("/api/admin/coupon-rules"), apiGet("/api/admin/sms-tasks"),
      apiGet("/api/admin/stored-value-plans"),
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
      setShows(res[6].shows || []);
      setVenues(res[7].venues || []);
      setMemberTiers(res[8].member_tiers || []);
      setCoupons(res[9].coupons || []);
      setFlashSales(res[10].flash_sales || []);
      setCouponRules(res[11].coupon_rules || []);
      setSmsTasks(res[12].sms_tasks || []);
      setStoredValuePlans(res[13].stored_value_plans || []);
      setView("overview");
    }).catch(function (e) {
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      if (e && e.status === 403) { setForbidden(true); return; }
      toast("加载失败，请稍后重试");
    });
    loadTemplates();
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
      loadAlerts(); loadAudit(); loadAlertRules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, period, analysisStale]);

  // R5-1 数据运营: load the stored aggregates when the view opens
  // and whenever its period/date/type filter changes.
  useEffect(() => {
    if (view === "events") loadEventAggregates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, eventPeriod, eventDate, eventType]);

  // R5-2 会员数据: load the member rows + rules when the view opens
  // and whenever the shop filter changes.
  useEffect(() => {
    if (view === "memberinsights") loadMemberInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, insightShop]);

  // R5-3 数据大屏: load the BI payload when the view opens.
  // Fullscreen is per-view: leaving the view exits fullscreen, so
  // the next view never inherits the fixed overlay; Esc also exits.
  useEffect(() => {
    if (view === "bi") loadBi();
    else if (biFullscreen) setBiFullscreen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // R5-5 财务账本: load the ledger when the view opens and
  // whenever its kind/reconciled filter changes.
  useEffect(() => {
    if (view === "financeledger") loadFinanceLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ledgerKind, ledgerReconciled]);
  // R6-1 版权登记: load the licence list when the view opens.
  useEffect(() => {
    if (view === "licenses") loadLicenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // R6-5 评论审核: load the admin comment list when the view opens
  // and whenever its status filter changes.
  useEffect(() => {
    if (view === "comments") loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cmtFilter]);
  useEffect(() => {
    if (!biFullscreen) return;
    function onKey(e) { if (e.key === "Escape") setBiFullscreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [biFullscreen]);

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

  // R5-4: recompute the analysis for the current period and store
  // it as the period's snapshot (manual trigger only — there is no
  // cron/worker this wave), then reload the live view. Idempotent:
  // running it twice stores the same numbers again.
  function doRefreshAnalysis() {
    if (analysisBusy) return;
    setAnalysisBusy(true);
    apiPost("/api/admin/analysis/refresh", { period }).then(function () {
      setAnalysisBusy(false);
      toast("已刷新快照");
      setAnalysisStale(true);
    }).catch(function (e) {
      setAnalysisBusy(false);
      if (e && e.status === 403) toast("无权刷新快照");
      else toast((e && e.message) || "刷新快照失败");
    });
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

  /* R6-5 评论审核: load the admin comment list for the chosen
     status filter ("" = all statuses). */
  function loadComments() {
    const qs = "/api/admin/comments" + (cmtFilter ? "?status=" + encodeURIComponent(cmtFilter) : "");
    apiGet(qs).then(function (d) {
      setComments(d.comments || []);
    }).catch(loadFail);
  }
  /* R6-5: approve/reject one pending comment (same reviewBusyId
     pattern as demands). The list reloads so the row's status and
     any reply render fresh. */
  function doReviewComment(id, status) {
    if (reviewBusyId !== null) return;
    setReviewBusyId(id);
    apiPatch("/api/admin/comments/" + id, { status }).then(function () {
      loadComments();
      loadAudit();
      toast(status === "approved" ? "已通过" : "已拒绝");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权审核");
      else if (e && e.status === 404) toast("评价不存在");
      else toast((e && e.data && e.data.error) || "审核失败，请稍后重试");
    }).finally(function () { setReviewBusyId(null); });
  }
  /* R6-5: reply to one comment. The author is notified
     (comment_reply) by the server; the reply renders on the comment. */
  function doReplyComment(id) {
    if (reviewBusyId !== null) return;
    const reply = (replyDraft[id] || "").trim();
    if (!reply) { toast("请填写回复内容"); return; }
    setReviewBusyId(id);
    apiPatch("/api/admin/comments/" + id + "/reply", { reply }).then(function () {
      setReplyDraft(function (m) { const next = { ...m }; delete next[id]; return next; });
      loadComments();
      loadAudit();
      toast("已回复，作者已收到通知");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权回复");
      else if (e && e.status === 404) toast("评价不存在");
      else toast((e && e.data && e.data.error) || "回复失败，请稍后重试");
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

  /* R6-6 — escrow hold/release (admin): hold 模拟托管中 -> 已托管,
     release 已托管 -> 已释放. Same busy-id + reload pattern as
     doReviewOrder; the server enforces paid-only + dispute freeze. */
  function doEscrowOrder(id, action) {
    if (reviewBusyId !== null) return;
    setReviewBusyId(id);
    apiPost("/api/orders/" + id + "/escrow", { action }).then(function (d) {
      setOrders(function (os) { return os.map(function (o) { return o.id === id ? { ...o, escrow: d.escrow } : o; }); });
      apiGet("/api/admin/orders").then(function (r) { setOrders(r.orders || []); }).catch(function () {});
      loadAudit();
      toast(action === "hold" ? "已托管" : "托管已释放");
    }).catch(function (e) {
      if (e && e.status === 403) toast("无权处理");
      else if (e && e.status === 400) toast((e.data && e.data.error) || "当前托管状态不允许该操作");
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
      venue_id: r.venue_id == null ? "" : String(r.venue_id),
    } : {
      id: null, name: "", category: "show", city: "", priceYuan: "",
      unit: "张", description: "", image: "", capacity: "0",
      stock: "100", status: "published", venue_id: "",
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
      venue_id: resForm.venue_id === "" ? null : Number(resForm.venue_id),
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

  // R2-4 venues + seat templates (same disabled-while-processing
  // pattern as the show form). A shop-scoped admin creates/edits only
  // their own shop's venues (the server returns 403 otherwise); a
  // platform admin names the shop in the create form. A venue with no
  // template shows "未配置座位模板" — its performances cannot generate
  // seats until a template exists (R2-5). Zones are edited as rows of
  // name/rows/cols; every zone needs positive row/col counts.
  function loadVenues() {
    apiGet("/api/venues").then(function (d) {
      setVenues(d.venues || []);
    }).catch(loadFail);
  }
  // R6-2: venue availability lookup — GET /api/venues/available?date=.
  // Read-only; a failed fetch toasts and leaves the last result alone.
  // venueId is passed explicitly (not read from state) so the per-row
  // 查空闲 button works in the same tick as setAvailVenueId.
  function lookupAvailability(venueId, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { toast("请选择有效日期"); return; }
    setAvailBusy(true);
    apiGet("/api/venues/available?date=" + date).then(function (r) {
      setAvailResult({ date: r.date, venueId: venueId || null, free: r.free || [], occupied: r.occupied || [] });
    }).catch(function () { toast("查询失败，请重试"); }).finally(function () { setAvailBusy(false); });
  }
  // R6-2: one-line summary of the last lookup — a picked venue's own
  // status, or the free / occupied counts for the whole day.
  function availSummaryText(r) {
    if (!r) return null;
    if (r.venueId) {
      const occ = r.occupied.find(function (v) { return v.id === r.venueId; });
      const picked = occ || r.free.find(function (v) { return v.id === r.venueId; });
      if (!picked) return r.date + " · 该场馆不在本店列表中";
      return r.date + " · " + picked.name + (occ
        ? "已占用（" + occ.performances.map(function (p) { return p.show_title; }).join("、") + "）"
        : "空闲");
    }
    const occText = r.occupied.map(function (v) {
      return v.name + "：" + v.performances.map(function (p) { return p.show_title; }).join("、");
    }).join("；");
    return r.date + " · 空闲 " + r.free.length + " 个场馆"
      + (r.occupied.length ? " · 已占用 " + r.occupied.length + " 个（" + occText + "）" : " · 全部空闲");
  }
  function openVenueForm(v) {
    setVenueForm(v ? {
      id: v.id, name: v.name || "", address: v.address || "",
      capacity: String(v.capacity || 0), floor_plan: v.floor_plan || "",
      shop_id: String(v.shop_id),
    } : {
      id: null, name: "", address: "", capacity: "0", floor_plan: "",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editVenueForm(key, value) {
    setVenueForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveVenueForm() {
    if (!venueForm || venueBusyId !== null) return;
    if (!venueForm.name.trim()) { toast("请填写场馆名称"); return; }
    const capacity = Number(venueForm.capacity);
    if (!Number.isInteger(capacity) || capacity < 0) { toast("容量须为不小于 0 的整数"); return; }
    const body = {
      name: venueForm.name.trim(), address: venueForm.address.trim(),
      capacity, floor_plan: venueForm.floor_plan.trim(),
    };
    if (venueForm.id === null && isPlatformAdmin) body.shop_id = Number(venueForm.shop_id) || 1;
    setVenueBusyId(venueForm.id === null ? "new" : venueForm.id);
    const call = venueForm.id === null
      ? apiPost("/api/admin/venues", body)
      : apiPatch("/api/admin/venues/" + venueForm.id, body);
    call.then(function (d) {
      const saved = d.venue;
      setVenues(function (vs) {
        return venueForm.id === null ? vs.concat([saved])
          : vs.map(function (x) { return x.id === saved.id ? { ...saved, has_seats: x.has_seats } : x; });
      });
      setVenueForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的场馆");
      else if (e && e.status === 404) toast("场馆不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setVenueBusyId(null); });
  }
  // R3-1 member tiers (same disabled-while-processing pattern as the
  // venue form). A shop-scoped admin creates/edits only their own
  // shop's tiers (the server returns 403 otherwise); a platform admin
  // names the shop in the create form. Changing a threshold does not
  // re-evaluate existing users — the new threshold applies at the next
  // pay / complete / refund-approval trigger.
  function loadMemberTiers() {
    apiGet("/api/admin/member-tiers").then(function (d) {
      setMemberTiers(d.member_tiers || []);
    }).catch(loadFail);
  }
  function openMemberTierForm(t) {
    setMemberTierForm(t ? {
      id: t.id, name: t.name || "", min_spend_cents: String(t.min_spend_cents || 0),
      discount_pct: String(t.discount_pct || 0), benefits: t.benefits || "",
      shop_id: String(t.shop_id),
    } : {
      id: null, name: "", min_spend_cents: "0", discount_pct: "0", benefits: "",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editMemberTierForm(key, value) {
    setMemberTierForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveMemberTierForm() {
    if (!memberTierForm || memberTierBusyId !== null) return;
    if (!memberTierForm.name.trim()) { toast("请填写等级名称"); return; }
    const minSpend = Number(memberTierForm.min_spend_cents);
    if (!Number.isInteger(minSpend) || minSpend < 0) { toast("消费门槛须为不小于 0 的整数（分）"); return; }
    const discountPct = Number(memberTierForm.discount_pct);
    if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) { toast("折扣须为 0–100 的整数"); return; }
    const body = {
      name: memberTierForm.name.trim(), min_spend_cents: minSpend,
      discount_pct: discountPct, benefits: memberTierForm.benefits.trim(),
    };
    if (memberTierForm.id === null && isPlatformAdmin) body.shop_id = Number(memberTierForm.shop_id) || 1;
    setMemberTierBusyId(memberTierForm.id === null ? "new" : memberTierForm.id);
    const call = memberTierForm.id === null
      ? apiPost("/api/admin/member-tiers", body)
      : apiPatch("/api/admin/member-tiers/" + memberTierForm.id, body);
    call.then(function (d) {
      const saved = d.member_tier;
      setMemberTiers(function (ts) {
        return memberTierForm.id === null ? ts.concat([saved])
          : ts.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setMemberTierForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的会员等级");
      else if (e && e.status === 404) toast("会员等级不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setTierBusyId(null); });
  }
  // R3-6 stored value 文惠卡 (same disabled-while-processing pattern
  // as the member-tier form). A shop-scoped admin creates/edits only
  // their own shop's plans and grants only into their own shop (the
  // server returns 403 otherwise); a platform admin names the shop in
  // the create form. The subsidy grant is a bonus credit on the user's
  // (user, shop) account — there is no second card system. The
  // per-user lookup reads that shop's account + ledger; the CSV button
  // downloads the same ledger (BOM, same columns as the server export).
  function loadStoredValuePlans() {
    apiGet("/api/admin/stored-value-plans").then(function (d) {
      setStoredValuePlans(d.stored_value_plans || []);
    }).catch(loadFail);
  }
  function openStoredValuePlanForm(pl) {
    setStoredValuePlanForm(pl ? {
      id: pl.id, amount_cents: String(pl.amount_cents || 0),
      bonus_cents: String(pl.bonus_cents || 0), status: pl.status || "active",
      shop_id: String(pl.shop_id),
    } : {
      id: null, amount_cents: "10000", bonus_cents: "1000", status: "active",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editStoredValuePlanForm(key, value) {
    setStoredValuePlanForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveStoredValuePlanForm() {
    if (!storedValuePlanForm || storedValuePlanBusyId !== null) return;
    const amount = Number(storedValuePlanForm.amount_cents);
    if (!Number.isInteger(amount) || amount < 1) { toast("充值金额须为不小于 1 的整数（分）"); return; }
    const bonus = Number(storedValuePlanForm.bonus_cents);
    if (!Number.isInteger(bonus) || bonus < 0) { toast("赠送金额须为不小于 0 的整数（分）"); return; }
    const body = {
      amount_cents: amount, bonus_cents: bonus,
      status: storedValuePlanForm.status,
    };
    if (storedValuePlanForm.id === null && isPlatformAdmin) body.shop_id = Number(storedValuePlanForm.shop_id) || 1;
    setStoredValuePlanBusyId(storedValuePlanForm.id === null ? "new" : storedValuePlanForm.id);
    const call = storedValuePlanForm.id === null
      ? apiPost("/api/admin/stored-value-plans", body)
      : apiPatch("/api/admin/stored-value-plans/" + storedValuePlanForm.id, body);
    call.then(function (d) {
      const saved = d.stored_value_plan;
      setStoredValuePlans(function (ps) {
        return storedValuePlanForm.id === null ? ps.concat([saved])
          : ps.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setStoredValuePlanForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的文惠卡");
      else if (e && e.status === 404) toast("储值套餐不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setStoredValuePlanBusyId(null); });
  }
  function doGrantStoredValue() {
    if (grantBusy) return;
    const userId = Number(grantForm.user_id);
    if (!Number.isInteger(userId) || userId < 1) { toast("请填写用户编号"); return; }
    const amount = Number(grantForm.amount_cents);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500000) { toast("补贴金额须为 1–500000 的整数（分，上限 ¥5000）"); return; }
    const body = { user_id: userId, amount_cents: amount };
    if (grantForm.note.trim()) body.note = grantForm.note.trim();
    if (isPlatformAdmin && grantForm.shop_id) body.shop_id = Number(grantForm.shop_id) || 1;
    setGrantBusy(true);
    apiPost("/api/admin/stored-value/grant", body).then(function (d) {
      setGrantForm({ user_id: "", amount_cents: "", note: "", shop_id: "1" });
      loadAudit();
      toast("已发放，当前余额 " + fmtMoney(d.account.balance_cents));
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的文惠卡");
      else if (e && e.status === 404) toast("用户或店铺不存在");
      else toast((e && e.data && e.data.error) || "发放失败，请检查表单");
    }).finally(function () { setGrantBusy(false); });
  }
  function doLookupStoredValue() {
    const userId = Number(lookupUserId);
    if (!Number.isInteger(userId) || userId < 1) { toast("请填写用户编号"); return; }
    apiGet("/api/admin/stored-value/" + userId).then(function (d) {
      setLookupResult(d);
    }).catch(function (e) {
      if (e && e.status === 404) toast("用户不存在");
      else if (e && e.status === 403) toast("只能管理本店铺的文惠卡");
      else toast((e && e.data && e.data.error) || "查询失败");
    });
  }
  // R4-1 核销: POST /api/verify/:code (admin only — staff = admin
  // role). The server normalizes the code (trim + uppercase) and
  // logs every attempt in verify_logs; a failed verify still
  // carries ticket + order info in e.data, so the result card shows
  // the order at the gate. Verify checks ticket status only — no
  // date/performance check this wave.
  function doVerify() {
    if (verifyBusy) return;
    const code = verifyCode.trim().toUpperCase();
    if (!code) { toast("请填写票码"); return; }
    setVerifyBusy(true);
    apiPost("/api/verify/" + encodeURIComponent(code), {}).then(function (d) {
      const entry = { code, ok: true, result: "used", ticket: d.ticket, order: d.order, at: new Date().toISOString() };
      setVerifyResult(entry);
      setVerifyHistory(function (h) { return [entry].concat(h).slice(0, 20); });
      setVerifyCode("");
      toast("核销成功");
    }).catch(function (e) {
      const data = (e && e.data) || {};
      const entry = { code, ok: false, result: data.error || "核销失败", ticket: data.ticket || null, order: data.order || null, at: new Date().toISOString() };
      setVerifyResult(entry);
      setVerifyHistory(function (h) { return [entry].concat(h).slice(0, 20); });
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      if (e && e.status === 403) { setForbidden(true); return; }
      toast(data.error || "核销失败");
    }).finally(function () { setVerifyBusy(false); });
  }
  // R4-3 批量核销 + 离线队列: POST /api/verify/batch (admin
  // only, max 50 codes, one result per code, a bad code never
  // throws the batch). Pasted codes (one per line) verify in one
  // call; the localStorage queue holds codes whose batch call
  // failed (offline) — they sync with the 同步 button and leave
  // the queue ONLY after the batch call succeeds. Voice +
  // vibration are H5-only: Web Speech API (speechSynthesis)
  // speaks the batch summary and navigator.vibrate buzzes on a
  // failed batch — the mini-program has NO native TTS (see
  // miniprogram/pages/verify/verify.js), so voice is never
  // claimed there, and no third-party voice plugin is used.
  const batchResultText = { used: "已核销", already_used: "票已核销", not_found: "票不存在", void: "票已作废", refund_pending: "票正在退款审核中" };
  function saveVerifyQueue(q) {
    try { localStorage.setItem("guiyan-verify-queue", JSON.stringify(q)); } catch (e) {}
    setVerifyQueue(q);
  }
  function speakBatch(ok, total) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(
        ok === total ? "批量核销完成，" + ok + "张全部成功" : "批量核销完成，成功" + ok + "张，失败" + (total - ok) + "张"));
    } catch (e) {}
  }
  function buzzBatch(failed) {
    try { if (navigator.vibrate) navigator.vibrate(failed ? [100, 50, 100] : 200); } catch (e) {}
  }
  function doBatchVerify(codes) {
    if (batchBusy) return;
    const list = (codes || batchCodes.split(/[\n,，、\s]+/)).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!list.length) { toast("请填写票码"); return; }
    if (list.length > 50) { toast("一次最多核销 50 张票"); return; }
    setBatchBusy(true);
    apiPost("/api/verify/batch", { codes: list }).then(function (d) {
      const results = (d && d.results) || [];
      const ok = results.filter((r) => r.result === "used").length;
      setBatchResults(results);
      setVerifyHistory(function (h) {
        return results.map((r) => ({ code: r.code, ok: r.result === "used", result: batchResultText[r.result] || r.result, ticket: r.ticket || null, order: r.order || null, at: new Date().toISOString() })).concat(h).slice(0, 20);
      });
      // Synced codes leave the queue only now that the call succeeded.
      const done = {};
      results.forEach((r) => { done[r.code] = true; });
      saveVerifyQueue(verifyQueue.filter((c) => !done[c]));
      setBatchCodes("");
      speakBatch(ok, results.length);
      buzzBatch(results.length - ok);
      toast("批量核销完成：成功 " + ok + " 张，失败 " + (results.length - ok) + " 张");
    }).catch(function (e) {
      // A failed batch call keeps the codes queued — nothing is lost.
      const q = verifyQueue.slice();
      list.forEach((c) => { if (q.indexOf(c) < 0) q.push(c); });
      saveVerifyQueue(q);
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      if (e && e.status === 403) { setForbidden(true); return; }
      toast("批量核销失败，已存入离线队列");
    }).finally(function () { setBatchBusy(false); });
  }
  function syncVerifyQueue() {
    if (!verifyQueue.length) { toast("离线队列为空"); return; }
    doBatchVerify(verifyQueue.slice());
  }
  // R4-2 打印纸质票: POST /api/admin/tickets/print records the
  // print event (one print_logs row per ticket + printed_at) and
  // then the browser prints the ticket layout (window.print).
  // HONESTY BOUNDARY: the endpoint only records the event — the
  // paper comes from the browser, no physical printer is connected
  // and none is claimed. Only `issued` tickets print; used/void or
  // refund-frozen tickets answer 400 and nothing opens.
  function openTicketPrint(orderId, tickets) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const w = window.open("", "_blank");
    if (!w) { toast("浏览器拦截了打印窗口，请允许弹出窗口后重试"); return; }
    const rows = (tickets || []).map((tk) => "<tr><td>" + esc(tk.code) + "</td><td>" + (tk.status === "used" ? "已核销" : tk.status === "void" ? "已作废" : "已出票") + "</td><td>" + (tk.printed_at ? esc(String(tk.printed_at).slice(0, 19).replace("T", " ")) : "—") + "</td></tr>").join("");
    w.document.write("<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\"><title>桂演纸质票</title><style>body{font-family:\"Noto Sans SC\",sans-serif;color:#1c1710;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left;font-size:14px}@media print{body{padding:0}}</style></head><body><h1>桂演纸质票</h1><p>订单号：" + esc(orderId) + "</p><table><thead><tr><th>票码</th><th>状态</th><th>打印时间</th></tr></thead><tbody>" + rows + "</tbody></table><p style=\"font-size:12px;color:#5d5344\">纸质票由浏览器打印出票；本系统不连接实体打印机。</p></body></html>");
    w.document.close();
    w.focus();
    w.print();
  }
  function doPrintOrder(orderId) {
    if (printBusy) return;
    const id = String(orderId == null ? printOrderId : orderId).trim();
    if (!id) { toast("请填写订单号"); return; }
    setPrintBusy(true);
    apiPost("/api/admin/tickets/print", { order_id: Number(id) }).then(function (d) {
      openTicketPrint(id, d.tickets || []);
      toast("已记录打印，可用浏览器打印票面");
    }).catch(function (e) {
      const data = (e && e.data) || {};
      if (e && e.status === 401) { clearToken(); location.href = "/admin/index.html"; return; }
      if (e && e.status === 403) { setForbidden(true); return; }
      toast(data.error || "打印失败");
    }).finally(function () { setPrintBusy(false); });
  }
  // R3-2 coupons (same disabled-while-processing pattern as the
  // member-tier form). A shop-scoped admin creates/edits only their
  // own shop's coupons (the server returns 403 otherwise); a platform
  // admin names the shop in the create form. The code and the shop
  // are immutable after creation — the edit form hides them. The
  // datetime-local inputs hold local time; the server stores ISO.
  function loadCoupons() {
    apiGet("/api/admin/coupons").then(function (d) {
      setCoupons(d.coupons || []);
    }).catch(loadFail);
  }
  function couponLocal(dt) {
    if (!dt) return "";
    const d = new Date(dt);
    if (isNaN(d.valueOf())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function openCouponForm(c) {
    setCouponForm(c ? {
      id: c.id, code: c.code, kind: c.kind,
      value_cents: c.value_cents == null ? "" : String(c.value_cents),
      discount_pct: c.discount_pct == null ? "" : String(c.discount_pct),
      min_spend_cents: String(c.min_spend_cents || 0),
      valid_from: couponLocal(c.valid_from), valid_until: couponLocal(c.valid_until),
      quota: c.quota == null ? "" : String(c.quota),
      per_user_limit: String(c.per_user_limit || 1), status: c.status || "active",
      shop_id: String(c.shop_id),
    } : {
      id: null, code: "", kind: "fixed", value_cents: "", discount_pct: "",
      min_spend_cents: "0", valid_from: "", valid_until: "",
      quota: "", per_user_limit: "1", status: "active",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editCouponForm(key, value) {
    setCouponForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveCouponForm() {
    if (!couponForm || couponBusyId !== null) return;
    if (couponForm.id === null && !/^[A-Za-z0-9]{4,20}$/.test(couponForm.code.trim())) { toast("券码须为 4–20 位字母或数字"); return; }
    const body = {};
    if (couponForm.id === null) body.code = couponForm.code.trim().toUpperCase();
    body.kind = couponForm.kind;
    if (couponForm.kind === "fixed") {
      const v = Number(couponForm.value_cents);
      if (!Number.isInteger(v) || v < 1) { toast("固定金额须为不小于 1 的整数（分）"); return; }
      body.value_cents = v;
    } else {
      const pc = Number(couponForm.discount_pct);
      if (!Number.isInteger(pc) || pc < 1 || pc > 100) { toast("折扣须为 1–100 的整数"); return; }
      body.discount_pct = pc;
    }
    const minSpend = Number(couponForm.min_spend_cents);
    if (!Number.isInteger(minSpend) || minSpend < 0) { toast("最低消费须为不小于 0 的整数（分）"); return; }
    body.min_spend_cents = minSpend;
    body.valid_from = couponForm.valid_from ? new Date(couponForm.valid_from).toISOString() : null;
    body.valid_until = couponForm.valid_until ? new Date(couponForm.valid_until).toISOString() : null;
    if (body.valid_from && body.valid_until && body.valid_from > body.valid_until) { toast("生效时间不能晚于失效时间"); return; }
    body.quota = couponForm.quota === "" ? null : Number(couponForm.quota);
    if (body.quota !== null && (!Number.isInteger(body.quota) || body.quota < 1)) { toast("总名额须为空或不小于 1 的整数"); return; }
    const perUser = Number(couponForm.per_user_limit);
    if (!Number.isInteger(perUser) || perUser < 1) { toast("每人限用次数须为不小于 1 的整数"); return; }
    body.per_user_limit = perUser;
    body.status = couponForm.status;
    if (couponForm.id === null && isPlatformAdmin) body.shop_id = Number(couponForm.shop_id) || 1;
    setCouponBusyId(couponForm.id === null ? "new" : couponForm.id);
    const call = couponForm.id === null
      ? apiPost("/api/admin/coupons", body)
      : apiPatch("/api/admin/coupons/" + couponForm.id, body);
    call.then(function (d) {
      const saved = d.coupon;
      setCoupons(function (cs) {
        return couponForm.id === null ? cs.concat([saved])
          : cs.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setCouponForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的优惠券");
      else if (e && e.status === 404) toast("优惠券不存在");
      else if (e && e.status === 409) toast("该店铺已存在相同券码");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setCouponBusyId(null); });
  }
  // R3-3 flash sales (same disabled-while-processing pattern as the
  // coupon form). A shop-scoped admin creates/edits only their own
  // shop's sales (the server returns 403 otherwise); a platform
  // admin names the shop in the create form. The performance and the
  // shop are immutable after creation — the edit form hides them.
  // The datetime-local inputs hold local time; the server stores ISO.
  // One sale targets one performance; the dropdown is built from the
  // already-loaded shows (each carries its performances).
  function loadFlashSales() {
    apiGet("/api/admin/flash-sales").then(function (d) {
      setFlashSales(d.flash_sales || []);
    }).catch(loadFail);
  }
  function flashPerfOptions() {
    const out = [];
    (shows || []).forEach(function (s) {
      (s.performances || []).forEach(function (pf) {
        out.push({ id: pf.id, label: s.title + " · " + String(pf.start_at).slice(0, 16) + " · #" + pf.id + "（" + pf.status + "）" });
      });
    });
    return out;
  }
  function flashPerfLabel(perfId) {
    const found = flashPerfOptions().find(function (o) { return o.id === perfId; });
    return found ? found.label : "#" + perfId;
  }
  function openFlashSaleForm(s) {
    setFlashSaleForm(s ? {
      id: s.id, performance_id: String(s.performance_id), name: s.name || "", kind: s.kind,
      value_cents: s.value_cents == null ? "" : String(s.value_cents),
      discount_pct: s.discount_pct == null ? "" : String(s.discount_pct),
      start_at: couponLocal(s.start_at), end_at: couponLocal(s.end_at),
      quota: s.quota == null ? "" : String(s.quota),
      status: s.status || "active",
      shop_id: String(s.shop_id),
    } : {
      id: null, performance_id: "", name: "", kind: "pct", value_cents: "", discount_pct: "",
      start_at: "", end_at: "", quota: "", status: "active",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editFlashSaleForm(key, value) {
    setFlashSaleForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveFlashSaleForm() {
    if (!flashSaleForm || flashSaleBusyId !== null) return;
    if (!flashSaleForm.name.trim()) { toast("请填写抢购名称"); return; }
    if (flashSaleForm.id === null && !flashSaleForm.performance_id) { toast("请选择场次"); return; }
    const body = {};
    if (flashSaleForm.id === null) body.performance_id = Number(flashSaleForm.performance_id);
    body.name = flashSaleForm.name.trim();
    body.kind = flashSaleForm.kind;
    if (flashSaleForm.kind === "fixed") {
      const v = Number(flashSaleForm.value_cents);
      if (!Number.isInteger(v) || v < 1) { toast("每张减免须为不小于 1 的整数（分）"); return; }
      body.value_cents = v;
    } else {
      const pc = Number(flashSaleForm.discount_pct);
      if (!Number.isInteger(pc) || pc < 1 || pc > 100) { toast("折扣须为 1–100 的整数"); return; }
      body.discount_pct = pc;
    }
    if (!flashSaleForm.start_at || !flashSaleForm.end_at) { toast("请填写开始与结束时间"); return; }
    body.start_at = new Date(flashSaleForm.start_at).toISOString();
    body.end_at = new Date(flashSaleForm.end_at).toISOString();
    if (body.start_at >= body.end_at) { toast("开始时间须早于结束时间"); return; }
    body.quota = flashSaleForm.quota === "" ? null : Number(flashSaleForm.quota);
    if (body.quota !== null && (!Number.isInteger(body.quota) || body.quota < 1)) { toast("总名额须为空或不小于 1 的整数"); return; }
    body.status = flashSaleForm.status;
    if (flashSaleForm.id === null && isPlatformAdmin) body.shop_id = Number(flashSaleForm.shop_id) || 1;
    setFlashSaleBusyId(flashSaleForm.id === null ? "new" : flashSaleForm.id);
    const call = flashSaleForm.id === null
      ? apiPost("/api/admin/flash-sales", body)
      : apiPatch("/api/admin/flash-sales/" + flashSaleForm.id, body);
    call.then(function (d) {
      const saved = d.flash_sale;
      setFlashSales(function (ss) {
        return flashSaleForm.id === null ? ss.concat([saved])
          : ss.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setFlashSaleForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的限时抢购");
      else if (e && e.status === 404) toast("限时抢购不存在");
      else if (e && e.status === 409) toast("该场次已有重叠的限时抢购");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setFlashSaleBusyId(null); });
  }
  // R3-4 auto coupon rules: a rule fires on a behaviour (first
  // purchase / tier upgrade) and the coupon lands in the user's
  // inbox — no background worker, the order-pay transaction evaluates
  // the rules synchronously. The trigger, coupon and shop are
  // immutable after creation — the edit form hides them. The
  // min-spend condition only applies to first_purchase rules.
  function loadCouponRules() {
    apiGet("/api/admin/coupon-rules").then(function (d) {
      setCouponRules(d.coupon_rules || []);
    }).catch(loadFail);
  }
  function couponRuleCouponLabel(couponId) {
    const c = (coupons || []).find(function (x) { return x.id === couponId; });
    return c ? c.code : "#" + couponId;
  }
  function openCouponRuleForm(r) {
    setCouponRuleForm(r ? {
      id: r.id, name: r.name || "", trigger: r.trigger, coupon_id: String(r.coupon_id),
      min_spend_cents: r.conditions && r.conditions.min_spend_cents != null ? String(r.conditions.min_spend_cents) : "",
      status: r.status || "active",
      shop_id: String(r.shop_id),
    } : {
      id: null, name: "", trigger: "first_purchase", coupon_id: "",
      min_spend_cents: "", status: "active",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editCouponRuleForm(key, value) {
    setCouponRuleForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveCouponRuleForm() {
    if (!couponRuleForm || couponRuleBusyId !== null) return;
    if (!couponRuleForm.name.trim()) { toast("请填写规则名称"); return; }
    if (couponRuleForm.id === null && !couponRuleForm.coupon_id) { toast("请选择优惠券"); return; }
    const body = {};
    if (couponRuleForm.id === null) body.coupon_id = Number(couponRuleForm.coupon_id);
    if (couponRuleForm.id === null) body.trigger = couponRuleForm.trigger;
    body.name = couponRuleForm.name.trim();
    if (couponRuleForm.trigger === "first_purchase" && couponRuleForm.min_spend_cents !== "") {
      const v = Number(couponRuleForm.min_spend_cents);
      if (!Number.isInteger(v) || v < 0) { toast("最低消费须为不小于 0 的整数（分）"); return; }
      body.conditions = { min_spend_cents: v };
    } else {
      body.conditions = {};
    }
    body.status = couponRuleForm.status;
    if (couponRuleForm.id === null && isPlatformAdmin) body.shop_id = Number(couponRuleForm.shop_id) || 1;
    setCouponRuleBusyId(couponRuleForm.id === null ? "new" : couponRuleForm.id);
    const call = couponRuleForm.id === null
      ? apiPost("/api/admin/coupon-rules", body)
      : apiPatch("/api/admin/coupon-rules/" + couponRuleForm.id, body);
    call.then(function (d) {
      const saved = d.coupon_rule;
      setCouponRules(function (rs) {
        return couponRuleForm.id === null ? rs.concat([saved])
          : rs.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setCouponRuleForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的自动发券规则");
      else if (e && e.status === 404) toast("自动发券规则不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setCouponRuleBusyId(null); });
  }
  // R3-5 SMS tasks: no provider is registered this wave, so a task
  // only travels draft -> queued -> waiting_provider ("未发送 — 等待
  // 服务商", terminal). Content (name/template/audience) is editable
  // only while the task is a draft — the server enforces that, and the
  // form disables the fields once the task has left draft.
  function smsStatusLabel(status) {
    return status === "draft" ? "草稿"
      : status === "queued" ? "已排队"
      : status === "waiting_provider" ? "未发送 — 等待服务商" : status;
  }
  function smsAudienceLabel(t) {
    if (!t || !t.audience) return "全部用户";
    if (t.audience.type === "tier") {
      const tier = (memberTiers || []).find(function (x) { return x.id === t.audience.tier_id; });
      return "会员等级：" + (tier ? tier.name : "#" + t.audience.tier_id);
    }
    return "全部用户";
  }
  function loadSmsTasks() {
    apiGet("/api/admin/sms-tasks").then(function (d) {
      setSmsTasks(d.sms_tasks || []);
    }).catch(loadFail);
  }
  function openSmsTaskForm(r) {
    setSmsTaskForm(r ? {
      id: r.id, name: r.name || "", template: r.template || "",
      audience_type: (r.audience && r.audience.type) || "all",
      tier_id: r.audience && r.audience.tier_id != null ? String(r.audience.tier_id) : "",
      status: r.status || "draft",
      shop_id: String(r.shop_id),
    } : {
      id: null, name: "", template: "", audience_type: "all", tier_id: "",
      status: "draft",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
    });
  }
  function editSmsTaskForm(key, value) {
    setSmsTaskForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveSmsTaskForm() {
    if (!smsTaskForm || smsTaskBusyId !== null) return;
    if (!smsTaskForm.name.trim()) { toast("请填写任务名称"); return; }
    if (!smsTaskForm.template.trim()) { toast("请填写短信模板"); return; }
    if (smsTaskForm.audience_type === "tier" && !smsTaskForm.tier_id) { toast("请选择会员等级"); return; }
    const body = {};
    body.name = smsTaskForm.name.trim();
    body.template = smsTaskForm.template.trim();
    body.audience = smsTaskForm.audience_type === "tier"
      ? { type: "tier", tier_id: Number(smsTaskForm.tier_id) }
      : { type: "all" };
    if (smsTaskForm.id !== null) body.status = smsTaskForm.status;
    if (smsTaskForm.id === null && isPlatformAdmin) body.shop_id = Number(smsTaskForm.shop_id) || 1;
    setSmsTaskBusyId(smsTaskForm.id === null ? "new" : smsTaskForm.id);
    const call = smsTaskForm.id === null
      ? apiPost("/api/admin/sms-tasks", body)
      : apiPatch("/api/admin/sms-tasks/" + smsTaskForm.id, body);
    call.then(function (d) {
      const saved = d.sms_task;
      setSmsTasks(function (rs) {
        return smsTaskForm.id === null ? rs.concat([saved])
          : rs.map(function (x) { return x.id === saved.id ? saved : x; });
      });
      setSmsTaskForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的短信任务");
      else if (e && e.status === 404) toast("短信任务不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setSmsTaskBusyId(null); });
  }
  function loadLicenses() {
    apiGet("/api/licenses").then(function (d) {
      setLicenses(d.licenses || []);
    }).catch(loadFail);
  }
  function openLicForm() {
    setLicForm({
      resource_id: "", licensor: "", licensee: "", kind: "buy",
      price_yuan: "", status: "pending", start_at: "", end_at: "",
      copyright_holder: "", license_type: "", ip_region: "",
    });
  }
  function editLicForm(key, value) {
    setLicForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveLicForm() {
    if (!licForm || licBusy) return;
    if (!licForm.resource_id) { toast("请选择资源"); return; }
    if (!licForm.licensor.trim()) { toast("请填写授权方"); return; }
    if (!licForm.licensee.trim()) { toast("请填写被授权方"); return; }
    const priceYuan = Number(licForm.price_yuan);
    if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast("请填写授权价格（元）"); return; }
    const body = {
      resource_id: Number(licForm.resource_id),
      licensor: licForm.licensor.trim(),
      licensee: licForm.licensee.trim(),
      kind: licForm.kind,
      price_cents: Math.round(priceYuan * 100),
      status: licForm.status,
    };
    if (licForm.start_at) body.start_at = licForm.start_at;
    if (licForm.end_at) body.end_at = licForm.end_at;
    setLicBusy(true);
    apiPost("/api/admin/licenses", body).then(function (d) {
      // Copyright facts (if any) ride on the resource meta through
      // the existing resource PATCH — merged, never overwriting the
      // resource's other meta keys.
      const metaPatch = {};
      if (licForm.copyright_holder.trim()) metaPatch.copyright_holder = licForm.copyright_holder.trim();
      if (licForm.license_type.trim()) metaPatch.license_type = licForm.license_type.trim();
      if (licForm.ip_region.trim()) metaPatch.ip_region = licForm.ip_region.trim();
      const done = function () {
        setLicenses(function (rs) { return [d.license].concat(rs); });
        setLicForm(null);
        loadAudit();
        toast("已登记版权");
      };
      if (Object.keys(metaPatch).length === 0) { done(); return; }
      const res = resources.find(function (r) { return r.id === body.resource_id; });
      const merged = { ...(res && res.meta ? res.meta : {}), ...metaPatch };
      apiPatch("/api/admin/resources/" + body.resource_id, { meta: merged }).then(function (u) {
        setResources(function (rs) { return rs.map(function (x) { return x.id === u.resource.id ? u.resource : x; }); });
        done();
      }).catch(function (e) {
        // The licence is already registered; a meta failure must not
        // hide that — report it and still show the new licence.
        toast("版权已登记，但版权信息保存失败：" + ((e && e.data && e.data.error) || "请重试"));
        done();
      });
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的版权");
      else if (e && e.status === 404) toast("资源不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setLicBusy(false); });
  }
  function loadTemplates(venueId) {
    apiGet("/api/venues/" + venueId + "/seat-templates").then(function (d) {
      setTemplatesByVenue(function (m) { return { ...m, [venueId]: d.seat_templates || [] }; });
    }).catch(loadFail);
  }
  function toggleTplManager(v) {
    if (tplVenueId === v.id) { setTplVenueId(null); setTplForm(null); }
    else { setTplVenueId(v.id); setTplForm(null); loadTemplates(v.id); }
  }
  function openTplForm(v, tpl) {
    setTplForm(tpl ? {
      venueId: v.id, id: tpl.id, name: tpl.name,
      zones: (tpl.zones || []).map(function (z) {
        return { name: z.name, rows: String(z.rows), cols: String(z.cols) };
      }),
    } : { venueId: v.id, id: null, name: "", zones: [{ name: "A区", rows: "10", cols: "10" }] });
  }
  function editTplForm(key, value) {
    setTplForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function editTplZone(i, key, value) {
    setTplForm(function (f) {
      if (!f) return f;
      const zones = f.zones.slice();
      zones[i] = { ...zones[i], [key]: value };
      return { ...f, zones: zones };
    });
  }
  function addTplZone() {
    setTplForm(function (f) {
      if (!f) return f;
      return { ...f, zones: f.zones.concat([{ name: "", rows: "", cols: "" }]) };
    });
  }
  function removeTplZone(i) {
    setTplForm(function (f) {
      if (!f || f.zones.length <= 1) return f;
      return { ...f, zones: f.zones.filter(function (_, j) { return j !== i; }) };
    });
  }
  function saveTplForm() {
    if (!tplForm || tplBusyId !== null) return;
    if (!tplForm.name.trim()) { toast("请填写座位模板名称"); return; }
    const zones = [];
    for (let i = 0; i < tplForm.zones.length; i++) {
      const z = tplForm.zones[i];
      const rows = Number(z.rows);
      const cols = Number(z.cols);
      if (!z.name.trim() || !Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
        toast("第 " + (i + 1) + " 分区须填写名称，且行列均为正整数");
        return;
      }
      zones.push({ name: z.name.trim(), rows: rows, cols: cols });
    }
    setTplBusyId(tplForm.id === null ? "new" : tplForm.id);
    const call = tplForm.id === null
      ? apiPost("/api/venues/" + tplForm.venueId + "/seat-templates", { name: tplForm.name.trim(), zones: zones })
      : apiPatch("/api/admin/seat-templates/" + tplForm.id, { name: tplForm.name.trim(), zones: zones });
    call.then(function (d) {
      const saved = d.seat_template;
      setTemplatesByVenue(function (m) {
        const list = m[tplForm.venueId] || [];
        return { ...m, [tplForm.venueId]: tplForm.id === null ? list.concat([saved]) : list.map(function (x) { return x.id === saved.id ? saved : x; }) };
      });
      setVenues(function (vs) {
        return vs.map(function (x) { return x.id === tplForm.venueId ? { ...x, has_seats: true } : x; });
      });
      setTplForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的座位模板");
      else if (e && e.status === 404) toast("场馆或模板不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setTplBusyId(null); });
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

  // R1-3 shop theming: config form only (banner, primary color from
  // the Guiyan allowlist, section checkboxes in canonical order — no
  // drag-and-drop in this wave). A platform admin themes any shop; a
  // shop-scoped admin themes only their own shop (the server returns
  // 403 otherwise). The theme is loaded from the public endpoint so
  // the form always starts from the stored (merged) values.
  const THEME_COLORS = ["#0b3d36", "#14564d", "#c8452c", "#c9a24b", "#0d6e5f", "#a83a20", "#b8860b"];
  const THEME_SECTIONS = [["hero", "首屏"], ["categories", "分类"], ["catalog", "资源列表"], ["spot", "精选"], ["demands", "需求"], ["ai", "智能助手"], ["wechat", "小程序"]];
  function openThemeForm(s) {
    if (themeBusyId !== null) return;
    apiGet("/api/shops/" + s.id + "/theme").then(function (d) {
      const t = d.theme || {};
      setThemeForm({
        shopId: s.id, shopName: s.name,
        banner: t.banner || "", primaryColor: t.primaryColor || "#0b3d36",
        sections: Array.isArray(t.sections) && t.sections.length ? t.sections.slice() : THEME_SECTIONS.map(function (x) { return x[0]; }),
      });
    }).catch(function () { toast("加载装修失败，请稍后重试"); });
  }
  function editThemeForm(key, value) {
    setThemeForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function toggleThemeSection(sec) {
    setThemeForm(function (f) {
      if (!f) return f;
      const has = f.sections.indexOf(sec) >= 0;
      const next = has ? f.sections.filter(function (x) { return x !== sec; }) : f.sections.concat([sec]);
      return { ...f, sections: next };
    });
  }
  function saveThemeForm() {
    if (!themeForm || themeBusyId !== null) return;
    if (!themeForm.sections.length) { toast("请至少选择一个栏目"); return; }
    const body = {
      banner: themeForm.banner,
      primaryColor: themeForm.primaryColor,
      // Saved order is the canonical order of the checked set.
      sections: THEME_SECTIONS.map(function (x) { return x[0]; }).filter(function (x) { return themeForm.sections.indexOf(x) >= 0; }),
    };
    setThemeBusyId(themeForm.shopId);
    apiPatch("/api/admin/shops/" + themeForm.shopId + "/theme", body).then(function () {
      setThemeForm(null);
      loadAudit();
      toast("已保存");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能装修本店铺");
      else if (e && e.status === 404) toast("店铺不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setThemeBusyId(null); });
  }

  // R2-1 shows + performances (same disabled-while-processing pattern
  // as the shop form). A shop-scoped admin creates/reviews only their
  // own shop's shows (the server returns 403 otherwise); a platform
  // admin names the shop in the create form. New shows are pending;
  // only an approved show takes performances, and only an on-sale
  // performance is visible to buyers.
  function loadShows() {
    apiGet("/api/admin/shows").then(function (d) {
      setShows(d.shows || []);
    }).catch(loadFail);
  }
  function openShowForm() {
    setShowForm({
      title: "",
      resource_id: "",
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
      description: "",
    });
  }
  function editShowForm(key, value) {
    setShowForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveShowForm() {
    if (!showForm || showBusyId !== null) return;
    if (!showForm.title.trim()) { toast("请填写演出名称"); return; }
    if (!showForm.resource_id) { toast("请选择演出剧目资源"); return; }
    const body = {
      title: showForm.title.trim(),
      resource_id: Number(showForm.resource_id),
      description: showForm.description.trim(),
    };
    if (isPlatformAdmin) body.shop_id = Number(showForm.shop_id) || 1;
    setShowBusyId("new");
    apiPost("/api/shows", body).then(function (d) {
      setShows(function (ss) { return [d.show].concat(ss); });
      setShowForm(null);
      loadAudit();
      toast("已提交审核");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能在本店铺创建演出");
      else if (e && e.status === 404) toast("店铺或资源不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setShowBusyId(null); });
  }
  function doReviewShow(s, status) {
    if (showReviewBusyId !== null) return;
    setShowReviewBusyId(s.id);
    apiPatch("/api/admin/shows/" + s.id, { status: status }).then(function (d) {
      const saved = d.show;
      setShows(function (ss) { return ss.map(function (x) { return x.id === saved.id ? saved : x; }); });
      loadAudit();
      toast(status === "approved" ? "已通过" : "已拒绝");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能审核本店铺的演出");
      else if (e && e.status === 404) toast("演出不存在");
      else toast((e && e.data && e.data.error) || "操作失败，请稍后重试");
    }).finally(function () { setShowReviewBusyId(null); });
  }
  function togglePerfManager(s) {
    if (perfShowId === s.id) {
      setPerfShowId(null);
      setPerfForm(null);
    } else {
      setPerfShowId(s.id);
      setPerfForm({ showId: s.id, start_at: "", price: "" });
    }
  }
  function editPerfForm(key, value) {
    setPerfForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function savePerfForm() {
    if (!perfForm || perfBusyId !== null) return;
    if (!perfForm.start_at) { toast("请填写开演时间"); return; }
    const price = Number(perfForm.price);
    if (!Number.isFinite(price) || price < 0) { toast("请填写有效票价"); return; }
    const showId = perfForm.showId;
    setPerfBusyId("new");
    apiPost("/api/shows/" + showId + "/performances", {
      start_at: perfForm.start_at, price_cents: Math.round(price * 100),
    }).then(function (d) {
      const created = d.performance;
      setShows(function (ss) {
        return ss.map(function (x) {
          if (x.id !== showId) return x;
          return { ...x, performances: (x.performances || []).concat([created]) };
        });
      });
      setPerfForm({ showId: showId, start_at: "", price: "" });
      loadAudit();
      toast("已创建场次");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的场次");
      else if (e && e.status === 404) toast("演出不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setPerfBusyId(null); });
  }
  function doPerfStatus(pf, status) {
    if (perfBusyId !== null) return;
    setPerfBusyId(pf.id);
    apiPatch("/api/admin/performances/" + pf.id, { status: status }).then(function (d) {
      const saved = d.performance;
      setShows(function (ss) {
        return ss.map(function (x) {
          if (x.id !== saved.show_id) return x;
          return { ...x, performances: (x.performances || []).map(function (p) { return p.id === saved.id ? saved : p; }) };
        });
      });
      loadAudit();
      toast(status === "on_sale" ? "已上架" : "已取消");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的场次");
      else if (e && e.status === 404) toast("场次不存在");
      else toast((e && e.data && e.data.error) || "操作失败，请稍后重试");
    }).finally(function () { setPerfBusyId(null); });
  }

  // R2-2 ticket types (price tiers): create/edit inside the performance
  // manager. Tiers load on demand per performance (the admin shows list
  // does not carry them); create/edit only — there is no delete endpoint.
  // The deadline is optional; clearing it on edit sends null.
  function loadTiers(pfId) {
    apiGet("/api/performances/" + pfId + "/ticket-types").then(function (d) {
      setTiersByPerf(function (m) { return { ...m, [pfId]: d.ticket_types || [] }; });
    }).catch(loadFail);
  }
  function toggleTierManager(pf) {
    if (tierPerfId === pf.id) { setTierPerfId(null); setTierForm(null); }
    else { setTierPerfId(pf.id); setTierForm(null); loadTiers(pf.id); }
  }
  function openTierForm(pf, tier) {
    setTierForm(tier ? {
      perfId: pf.id, id: tier.id, name: tier.name,
      price: String((tier.price_cents || 0) / 100),
      quota: String(tier.quota),
      sale_until: tier.sale_until ? String(tier.sale_until).slice(0, 16) : "",
    } : { perfId: pf.id, id: null, name: "", price: "", quota: "", sale_until: "" });
  }
  function editTierForm(key, value) {
    setTierForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveTierForm() {
    if (!tierForm || tierBusyId !== null) return;
    if (!tierForm.name.trim()) { toast("请填写票种名称"); return; }
    const price = Number(tierForm.price);
    if (!Number.isFinite(price) || price < 0) { toast("请填写有效票价"); return; }
    const quota = Number(tierForm.quota);
    if (!Number.isSafeInteger(quota) || quota < 1) { toast("请填写有效票数上限"); return; }
    const body = { name: tierForm.name.trim(), price_cents: Math.round(price * 100), quota: quota };
    if (tierForm.sale_until) body.sale_until = tierForm.sale_until;
    else if (tierForm.id) body.sale_until = null;
    const pfId = tierForm.perfId, tierId = tierForm.id;
    setTierBusyId(tierId || "new");
    const done = function (d) {
      const saved = d.ticket_type;
      setTiersByPerf(function (m) {
        const list = m[pfId] || [];
        return { ...m, [pfId]: tierId ? list.map(function (x) { return x.id === saved.id ? saved : x; }) : list.concat([saved]) };
      });
      setTierForm(null);
      toast(tierId ? "已保存票种" : "已创建票种");
    };
    const fail = function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的票种");
      else if (e && e.status === 404) toast("场次或票种不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    };
    const fin = function () { setTierBusyId(null); };
    if (tierId) apiPatch("/api/admin/ticket-types/" + tierId, body).then(done).catch(fail).finally(fin);
    else apiPost("/api/performances/" + pfId + "/ticket-types", body).then(done).catch(fail).finally(fin);
  }

  // R2-3 pickup points: list + create + delete inside the show
  // manager. Points load on demand per show; a point an order already
  // chose cannot be deleted (the server refuses with 400).
  function loadPickups(showId) {
    apiGet("/api/shows/" + showId + "/pickup-points").then(function (d) {
      setPickupByShow(function (m) { return { ...m, [showId]: d.pickup_points || [] }; });
    }).catch(loadFail);
  }
  function togglePickupManager(s) {
    if (pickupShowId === s.id) { setPickupShowId(null); setPickupForm(null); }
    else { setPickupShowId(s.id); setPickupForm(null); loadPickups(s.id); }
  }
  function openPickupForm(s) {
    setPickupForm({ showId: s.id, name: "", address: "" });
  }
  function editPickupForm(key, value) {
    setPickupForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function savePickupForm() {
    if (!pickupForm || pickupBusyId !== null) return;
    if (!pickupForm.name.trim()) { toast("请填写取票点名称"); return; }
    if (!pickupForm.address.trim()) { toast("请填写取票点地址"); return; }
    const showId = pickupForm.showId;
    setPickupBusyId("new");
    apiPost("/api/shows/" + showId + "/pickup-points", {
      name: pickupForm.name.trim(), address: pickupForm.address.trim(),
    }).then(function (d) {
      const created = d.pickup_point;
      setPickupByShow(function (m) {
        return { ...m, [showId]: (m[showId] || []).concat([created]) };
      });
      setPickupForm(null);
      toast("已创建取票点");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的取票点");
      else if (e && e.status === 404) toast("演出不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    }).finally(function () { setPickupBusyId(null); });
  }
  function deletePickupPoint(pt) {
    if (pickupBusyId !== null) return;
    setPickupBusyId(pt.id);
    apiDelete("/api/admin/pickup-points/" + pt.id).then(function () {
      setPickupByShow(function (m) {
        const list = m[pt.show_id] || [];
        return { ...m, [pt.show_id]: list.filter(function (x) { return x.id !== pt.id; }) };
      });
      toast("已删除取票点");
    }).catch(function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的取票点");
      else if (e && e.status === 404) toast("取票点不存在");
      else toast((e && e.data && e.data.error) || "删除失败，请稍后重试");
    }).finally(function () { setPickupBusyId(null); });
  }

  // R2-3 ticket templates: per-shop list + create/edit next to the
  // shop view. Colours come from the same 7-colour Guiyan allowlist as
  // shop theming (THEME_COLORS); the layout is JSON text for an object
  // (empty = {}). Setting a template as default clears the shop's old
  // default on the server, in the same request.
  function loadTemplates() {
    apiGet("/api/admin/ticket-templates").then(function (d) {
      setTemplates(d.ticket_templates || []);
    }).catch(loadFail);
  }
  function openTemplateForm(t) {
    setTemplateForm(t ? {
      id: t.id, shop_id: String(t.shop_id), name: t.name, color: t.color,
      layout: t.layout && Object.keys(t.layout).length ? JSON.stringify(t.layout) : "",
      is_default: t.is_default ? 1 : 0,
    } : {
      id: null,
      shop_id: isPlatformAdmin ? "1" : (me && me.shop_id ? String(me.shop_id) : "1"),
      name: "", color: "#0b3d36", layout: "", is_default: 0,
    });
  }
  function editTemplateForm(key, value) {
    setTemplateForm(function (f) { return f ? { ...f, [key]: value } : f; });
  }
  function saveTemplateForm() {
    if (!templateForm || templateBusyId !== null) return;
    if (!templateForm.name.trim()) { toast("请填写模板名称"); return; }
    if (THEME_COLORS.indexOf(templateForm.color) < 0) { toast("请选择桂演配色"); return; }
    let layout;
    if (templateForm.layout.trim()) {
      try {
        layout = JSON.parse(templateForm.layout);
      } catch (e) {
        toast("票面版式须为 JSON 对象"); return;
      }
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) { toast("票面版式须为 JSON 对象"); return; }
    }
    const body = {
      name: templateForm.name.trim(), color: templateForm.color,
      is_default: templateForm.is_default ? 1 : 0,
    };
    if (layout !== undefined) body.layout = layout;
    if (isPlatformAdmin) body.shop_id = Number(templateForm.shop_id) || 1;
    const tplId = templateForm.id;
    setTemplateBusyId(tplId || "new");
    const done = function (d) {
      const saved = d.ticket_template;
      setTemplates(function (ts) {
        const next = tplId
          ? ts.map(function (x) { return x.id === saved.id ? saved : x; })
          : ts.concat([saved]);
        // The server cleared the shop's old default in the same
        // request; reflect it locally for the same shop only.
        if (!saved.is_default) return next;
        return next.map(function (x) {
          return x.shop_id === saved.shop_id && x.id !== saved.id ? { ...x, is_default: 0 } : x;
        });
      });
      setTemplateForm(null);
      toast(tplId ? "已保存模板" : "已创建模板");
    };
    const fail = function (e) {
      if (e && e.status === 403) toast("只能管理本店铺的票面模板");
      else if (e && e.status === 404) toast("店铺或模板不存在");
      else toast((e && e.data && e.data.error) || "保存失败，请检查表单");
    };
    const fin = function () { setTemplateBusyId(null); };
    if (tplId) apiPatch("/api/admin/ticket-templates/" + tplId, body).then(done).catch(fail).finally(fin);
    else apiPost("/api/admin/ticket-templates", body).then(done).catch(fail).finally(fin);
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
        // B-053: an auto rule has no conditions by design (the server
        // validator refuses them) — never inject one from the editor.
        if (r.mode === "auto") return r;
        return {
          ...r,
          conditions: (r.conditions || []).map(function (c, k) {
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
    ipconfig: ["IP 配置", "文小惠形象配置 · 未设置时聊天保持原样"],
    resources: ["资源总览", "共 " + resources.length + " 项"],
    licenses: ["版权登记", "共 " + licenses.length + " 条授权 · 按店铺管理"],
    shows: ["演出管理", "共 " + shows.length + " 场演出 · 通过审核后可售票"],
    venues: ["场馆管理", "共 " + venues.length + " 个场馆 · 座位模板决定是否可选座"],
    shops: ["店铺管理", "共 " + shops.length + " 家店铺 · 仅平台管理员可创建/修改"],
    demands: ["需求总览", "共 " + demands.length + " 条"],
    comments: ["评论审核", "待审核评价 · 通过/拒绝/回复"],
    trends: ["趋势统计", "按周期查看订单趋势"],
    analysis: ["经营分析", "模拟经营分析报告"],
    alerts: ["预警中心", "库存与模拟预警 · 操作留痕"],
    events: ["数据运营", "埋点聚合 · 按小时/天查看"],
    memberinsights: ["会员数据", "会员消费 · 流失与可升级 · 经营建议（规则建议，非 AI）"],
    bi: ["数据大屏", "关键指标 · 近 30 天趋势 · 热门演出 / 场馆"],
    financeledger: ["财务账本", "订单收入 · 退款 · 储值 · 手工对账"],
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
  function resourceName(id) {
    if (id === null || id === undefined) return "—";
    const r = resources.find(function (x) { return x.id === id; });
    return r ? r.name : "资源#" + id;
  }
  function demandMatch(d) {
    return has(d.title) || categoryMatch(d.category) || has(d.city)
      || has(d.user_name) || has(DEMAND_STATUS[d.status]);
  }
  function showMatch(s) {
    return has(s.title) || has(resourceName(s.resource_id)) || has(shopName(s.shop_id))
      || has(String(s.id)) || has(DEMAND_STATUS[s.status]);
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
  const filteredShows = shows.filter(function (s) {
    return (showStatusFilter === "" || s.status === showStatusFilter) && (!q || showMatch(s));
  });
  // R2-4: the admin venue list (separate from `filteredVenues`, which
  // is the analysis view's venue rows).
  const filteredVenueList = q ? venues.filter(function (v) {
    return has(v.name) || has(v.address);
  }) : venues;
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
    shows: { title: (s) => s.title ?? "" },
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
  const sortedShows = sorted("shows", filteredShows);
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
                  <thead><tr><th scope="col" aria-sort={ariaSort("overview", "code")}>订单号<SortButton label="订单号" sortKey="code" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num" aria-sort={ariaSort("overview", "amount")}>金额<SortButton label="金额" sortKey="amount" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("overview", "booking_date")}>预订日期<SortButton label="预订日期" sortKey="booking_date" tableId="overview" sort={sorts.overview} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">托管</th><th scope="col">协议</th><th scope="col">售后</th></tr></thead>
                  <tbody id="recentBody">
                    {orders.length
                      ? (overviewMatches.length ? sortedOverview.slice(0, 8).map((o) => <OrderRow key={o.code} o={o} onContract={openContract} onReview={doReviewOrder} onEscrow={doEscrowOrder} reviewBusyId={reviewBusyId} />)
                        : searchEmpty(9))
                      : <tr><td colSpan="9"><div className="empty">暂无订单</div></td></tr>}
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
                <thead><tr><th scope="col" aria-sort={ariaSort("orders", "code")}>订单号<SortButton label="订单号" sortKey="code" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num" aria-sort={ariaSort("orders", "amount")}>金额<SortButton label="金额" sortKey="amount" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col" aria-sort={ariaSort("orders", "booking_date")}>预订日期<SortButton label="预订日期" sortKey="booking_date" tableId="orders" sort={sorts.orders} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">托管</th><th scope="col">协议</th><th scope="col">售后</th></tr></thead>
                <tbody id="ordersBody">
                  {filteredOrders.length ? sortedOrders.map((o) => <OrderRow key={o.code} o={o} onContract={openContract} onReview={doReviewOrder} onEscrow={doEscrowOrder} reviewBusyId={reviewBusyId} />)
                    : (q ? searchEmpty(9) : <tr><td colSpan="9"><div className="empty">暂无订单</div></td></tr>)}
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
                    {r.mode === "auto" ? (
                      <p className="def-note">自动规则：{autoSignalText(r)}（系统自动打标签，无需配置条件）</p>
                    ) : (
                      <>
                        <label>满足条件 <select value={r.match} onChange={(e) => editTagRule(i, "match", e.target.value)}>
                          <option value="all">全部满足</option><option value="any">任一满足</option>
                        </select></label>
                        {(r.conditions || []).map((c, j) => (
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
                        <button type="button" className="link-btn" disabled={(r.conditions || []).length <= 1} onClick={() => editTagRule(i, "conditions", (r.conditions || []).filter((_, k) => k !== j))}>删除条件</button>
                      </div>
                        ))}
                      </>
                    )}
                    <div>
                      {r.mode === "auto" ? null : (
                        <button type="button" className="btn-resolve" disabled={(r.conditions || []).length >= 6} onClick={() => editTagRule(i, "conditions", (r.conditions || []).concat([{ field: "spent", op: "gte", value: 0 }]))}>添加条件</button>
                      )}{" "}
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
                <label>场馆 <select value={resForm.venue_id} onChange={(e) => editResForm("venue_id", e.target.value)}>
                  <option value="">不关联场馆</option>
                  {venues.map((v) => (<option key={v.id} value={String(v.id)}>{v.name}（{shopName(v.shop_id)}）</option>))}
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
                <thead><tr><th scope="col" aria-sort={ariaSort("resources", "name")}>名称<SortButton label="名称" sortKey="name" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col">分类</th><th scope="col">城市</th><th scope="col">店铺</th><th scope="col" className="num" aria-sort={ariaSort("resources", "price")}>价格<SortButton label="价格" sortKey="price" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col" className="num" aria-sort={ariaSort("resources", "stock")}>库存<SortButton label="库存" sortKey="stock" tableId="resources" sort={sorts.resources} onToggle={toggleSort} /></th><th scope="col">状态</th><th scope="col">统计</th><th scope="col">操作</th></tr></thead>
                <tbody id="resBody">
                  {resources.length
                    ? (filteredResources.length ? sortedResources.map((r) => (
                      <Fragment key={r.id}>
                        <tr>
                          <td>{r.name}</td><td>{catZh(r.category)}</td><td>{r.city}</td><td>{shopName(r.shop_id)}</td>
                          <td className="num">{fmtMoney(r.price)}</td><td className="num">{r.stock}</td>
                          <td>{r.status === "published" ? "上架" : "下架"}</td>
                          <td>
                            <button type="button" className="btn-view" disabled={resStatsBusyId !== null} onClick={() => loadResStats(r.id)}>{resStatsBusyId === r.id ? "加载中…" : "统计"}</button>
                          </td>
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
                        {/* R5-5 resource stats (loaded on demand):
                            views is the resources.views counter,
                            event_views is the events `view` audit
                            trail — the two are never conflated. */}
                        {resStats[r.id] ? (
                          <tr>
                            <td colSpan="9">
                              <span>浏览 {resStats[r.id].views}（事件 {resStats[r.id].event_views}）· 点击 {resStats[r.id].clicks} · 订单 {resStats[r.id].orders} · 收入 {fmtMoney(resStats[r.id].revenue_cents)} · 已售票 {resStats[r.id].tickets_sold} · 已核销 {resStats[r.id].verify_count}</span>
                            </td>
                          </tr>
                        ) : null}
                        {r.meta && (r.meta.lastSync || r.meta.syncResult) ? (
                          <tr>
                            <td colSpan="9">
                              {r.meta.lastSync ? (<span>最近模拟同步：{String(r.meta.lastSync).slice(0, 19).replace("T", " ")}</span>) : null}
                              {r.meta.lastSync && r.meta.syncResult ? "　" : null}
                              {r.meta.syncResult ? (<span>渠道同步结果：{r.meta.syncResult}</span>) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )) : searchEmpty(9))
                    : <tr><td colSpan="9"><div className="empty">暂无资源</div></td></tr>}
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
            {themeForm ? (
              <fieldset className="tag-rule">
                <legend>店铺装修：{themeForm.shopName}</legend>
                <label>横幅文字 <input type="text" value={themeForm.banner} maxLength={200} onChange={(e) => editThemeForm("banner", e.target.value)} /></label>
                <label>主色 <select value={themeForm.primaryColor} onChange={(e) => editThemeForm("primaryColor", e.target.value)}>
                  {THEME_COLORS.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select></label>
                <div>
                  {THEME_SECTIONS.map(([id, label]) => (
                    <label key={id} style={{ display: "inline-block", marginRight: 16 }}>
                      <input type="checkbox" checked={themeForm.sections.indexOf(id) >= 0} onChange={() => toggleThemeSection(id)} /> {label}
                    </label>
                  ))}
                </div>
                <div>
                  <button type="button" className="btn-export" disabled={themeBusyId !== null} onClick={saveThemeForm}>{themeBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setThemeForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            {/* R2-3 ticket templates: per-shop list + create/edit next
                to the shop view. Colours use the same 7-colour Guiyan
                allowlist as theming; setting a default clears the
                shop's old default. Tickets render with the shop's
                default template (built-in when none is set). */}
            <div className="note" style={{ marginTop: 16 }}>票面模板按店铺管理；设为默认时清除同店旧默认；未设默认时用内置默认票面（深松绿）。</div>
            {templateForm ? (
              <fieldset className="tag-rule">
                <legend>{templateForm.id === null ? "添加票面模板" : "编辑票面模板：" + templateForm.name}</legend>
                {isPlatformAdmin ? (
                  <label>店铺 <select value={templateForm.shop_id} onChange={(e) => editTemplateForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : (
                  <label>店铺 <input type="text" value={me && me.shop_id ? shopName(me.shop_id) : ""} disabled /></label>
                )}
                <label>模板名称 <input type="text" value={templateForm.name} maxLength={100} onChange={(e) => editTemplateForm("name", e.target.value)} /></label>
                <label>颜色 <select value={templateForm.color} onChange={(e) => editTemplateForm("color", e.target.value)}>
                  {THEME_COLORS.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select></label>
                <label>版式（JSON 对象，可空） <input type="text" value={templateForm.layout} placeholder='{"title":"桂演之夜"}' onChange={(e) => editTemplateForm("layout", e.target.value)} /></label>
                <label><input type="checkbox" checked={templateForm.is_default === 1} onChange={(e) => editTemplateForm("is_default", e.target.checked ? 1 : 0)} /> 设为默认模板</label>
                <div>
                  <button type="button" className="btn-export" disabled={templateBusyId !== null} onClick={saveTemplateForm}>{templateBusyId !== null ? "保存中…" : (templateForm.id ? "保存模板" : "创建模板")}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setTemplateForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">模板名称</th><th scope="col">店铺</th><th scope="col">颜色</th><th scope="col">默认</th><th scope="col">操作</th></tr></thead>
                <tbody>
                  {templates.length ? templates.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td><td>{shopName(t.shop_id)}</td>
                      <td><i style={{ display: "inline-block", width: 12, height: 12, background: t.color, borderRadius: 2, marginRight: 6, verticalAlign: "-1px" }} />{t.color}</td>
                      <td>{t.is_default ? "默认" : "—"}</td>
                      <td>
                        <span className="row-actions">
                          <button type="button" className="btn-view" disabled={templateBusyId !== null} onClick={() => openTemplateForm(t)}>编辑</button>
                        </span>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="5"><div className="empty">暂无票面模板</div></td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}><button type="button" className="btn-export" onClick={() => openTemplateForm(null)}>添加票面模板</button></div>
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
                          {(isPlatformAdmin || (me && me.shop_id === s.id)) ? (
                            <span className="row-actions">
                              {isPlatformAdmin ? (
                                <>
                                  <button type="button" className="btn-view" disabled={shopBusyId !== null} onClick={() => openShopForm(s)}>编辑</button>
                                  {s.id !== 1 ? (
                                    <button type="button" className="btn-view" disabled={shopBusyId !== null} onClick={() => doToggleShopStatus(s)}>{shopBusyId === s.id ? "处理中…" : (s.status === "active" ? "停用" : "启用")}</button>
                                  ) : null}
                                </>
                              ) : null}
                              <button type="button" className="btn-view" disabled={themeBusyId !== null} onClick={() => openThemeForm(s)}>装修</button>
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

          <section className={"view" + (view === "shows" ? " on" : "")} id="view-shows">
            <div className="search-row">
              <SearchBox id="search-shows" label="搜索演出" placeholder="输入演出名称、资源或店铺…"
                value={query} onChange={setQuery} resultCount={q ? filteredShows.length : null} />
              <select className="tag-filter" aria-label="按状态筛选" value={showStatusFilter} onChange={(e) => setShowStatusFilter(e.target.value)}>
                <option value="">全部状态</option>
                <option value="pending">待审核</option>
                <option value="approved">已通过</option>
                <option value="rejected">已拒绝</option>
              </select>
              <button type="button" className="btn-export" onClick={openShowForm}>添加演出</button>
            </div>
            <div className="note">演出须关联本店的演出剧目类资源；新建为待审核，通过后才可创建场次、上架售票。子店管理员仅可见、可改本店演出。</div>
            {showForm ? (
              <fieldset className="tag-rule">
                <legend>添加演出</legend>
                <label>演出名称 <input type="text" value={showForm.title} maxLength={100} onChange={(e) => editShowForm("title", e.target.value)} /></label>
                <label>演出剧目 <select value={showForm.resource_id} onChange={(e) => editShowForm("resource_id", e.target.value)}>
                  <option value="">请选择…</option>
                  {resources.filter((r) => r.category === "show").map((r) => (<option key={r.id} value={String(r.id)}>{r.name}（{shopName(r.shop_id)}）</option>))}
                </select></label>
                {isPlatformAdmin ? (
                  <label>店铺 <select value={showForm.shop_id} onChange={(e) => editShowForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : (
                  <label>店铺 <input type="text" value={me && me.shop_id ? shopName(me.shop_id) : ""} disabled /></label>
                )}
                <label>演出介绍 <input type="text" value={showForm.description} maxLength={3000} onChange={(e) => editShowForm("description", e.target.value)} /></label>
                <div>
                  <button type="button" className="btn-export" disabled={showBusyId !== null} onClick={saveShowForm}>{showBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setShowForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">ID</th><th scope="col" aria-sort={ariaSort("shows", "title")}>名称<SortButton label="名称" sortKey="title" tableId="shows" sort={sorts.shows} onToggle={toggleSort} /></th><th scope="col">资源</th><th scope="col">店铺</th><th scope="col">状态</th><th scope="col">场次</th><th scope="col">操作</th></tr></thead>
                <tbody id="showsBody">
                  {shows.length
                    ? (filteredShows.length ? sortedShows.map((s) => (
                      <Fragment key={s.id}>
                        <tr>
                          <td>{s.id}</td><td>{s.title}</td><td>{resourceName(s.resource_id)}</td>
                          <td>{shopName(s.shop_id)}</td><td>{DEMAND_STATUS[s.status] || s.status}</td>
                          <td className="num">{(s.performances || []).length}</td>
                          <td>
                            <span className="row-actions">
                              {s.status === "pending" ? (
                                <>
                                  <button type="button" className="btn-approve" disabled={showReviewBusyId === s.id} onClick={() => doReviewShow(s, "approved")}>{showReviewBusyId === s.id ? "处理中…" : "通过"}</button>
                                  <button type="button" className="btn-reject" disabled={showReviewBusyId === s.id} onClick={() => doReviewShow(s, "rejected")}>{showReviewBusyId === s.id ? "处理中…" : "拒绝"}</button>
                                </>
                              ) : null}
                              <button type="button" className="btn-view" onClick={() => togglePerfManager(s)}>{perfShowId === s.id ? "收起场次" : "场次管理"}</button>
                              <button type="button" className="btn-view" onClick={() => togglePickupManager(s)}>{pickupShowId === s.id ? "收起取票点" : "取票点"}</button>
                            </span>
                          </td>
                        </tr>
                        {perfShowId === s.id ? (
                          <tr>
                            <td colSpan="7">
                              {(s.performances || []).length ? (
                                <table>
                                  <thead><tr><th scope="col">开演时间</th><th scope="col">票价</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                                  <tbody>
                                    {(s.performances || []).map((pf) => (
                                      <Fragment key={pf.id}>
                                      <tr>
                                        <td>{pf.start_at}</td><td className="num">{fmtMoney(pf.price_cents)}</td>
                                        <td>{PERF_STATUS[pf.status] || pf.status}</td>
                                        <td>
                                          <span className="row-actions">
                                            {pf.status === "scheduled" ? (
                                              <button type="button" className="btn-approve" disabled={perfBusyId === pf.id} onClick={() => doPerfStatus(pf, "on_sale")}>{perfBusyId === pf.id ? "处理中…" : "上架"}</button>
                                            ) : null}
                                            {pf.status !== "cancelled" ? (
                                              <button type="button" className="btn-reject" disabled={perfBusyId === pf.id} onClick={() => doPerfStatus(pf, "cancelled")}>{perfBusyId === pf.id ? "处理中…" : "取消"}</button>
                                            ) : null}
                                            <button type="button" className="btn-view" onClick={() => toggleTierManager(pf)}>{tierPerfId === pf.id ? "收起票种" : "票种"}</button>
                                          </span>
                                        </td>
                                      </tr>
                                      {tierPerfId === pf.id ? (
                                        <tr>
                                          <td colSpan="4">
                                            {(tiersByPerf[pf.id] || []).length ? (
                                              <table>
                                                <thead><tr><th scope="col">票种</th><th scope="col">票价</th><th scope="col">票数上限</th><th scope="col">截止时间</th><th scope="col">操作</th></tr></thead>
                                                <tbody>
                                                  {(tiersByPerf[pf.id] || []).map((tt) => (
                                                    <tr key={tt.id}>
                                                      <td>{tt.name}</td><td className="num">{fmtMoney(tt.price_cents)}</td>
                                                      <td className="num">{tt.quota}</td><td>{tt.sale_until || "—"}</td>
                                                      <td>
                                                        <span className="row-actions">
                                                          <button type="button" className="btn-view" disabled={tierBusyId !== null} onClick={() => openTierForm(pf, tt)}>编辑</button>
                                                        </span>
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            ) : (<div className="empty">暂无票种</div>)}
                                            {tierForm && tierForm.perfId === pf.id ? (
                                              <div style={{ marginTop: 12 }}>
                                                <label>票种名称 <input type="text" value={tierForm.name} maxLength={100} onChange={(e) => editTierForm("name", e.target.value)} /></label>{" "}
                                                <label>票价（元） <input type="number" min="0" step="1" value={tierForm.price} onChange={(e) => editTierForm("price", e.target.value)} /></label>{" "}
                                                <label>票数上限 <input type="number" min="1" step="1" value={tierForm.quota} onChange={(e) => editTierForm("quota", e.target.value)} /></label>{" "}
                                                <label>截止时间 <input type="datetime-local" value={tierForm.sale_until} onChange={(e) => editTierForm("sale_until", e.target.value)} /></label>{" "}
                                                <button type="button" className="btn-export" disabled={tierBusyId !== null} onClick={saveTierForm}>{tierBusyId !== null ? "保存中…" : (tierForm.id ? "保存票种" : "创建票种")}</button>{" "}
                                                <button type="button" className="btn-view" onClick={() => setTierForm(null)}>取消</button>
                                              </div>
                                            ) : (
                                              <div style={{ marginTop: 12 }}><button type="button" className="btn-view" onClick={() => openTierForm(pf, null)}>添加票种</button></div>
                                            )}
                                          </td>
                                        </tr>
                                      ) : null}
                                      </Fragment>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (<div className="empty">暂无场次</div>)}
                              {s.status === "approved" && perfForm && perfForm.showId === s.id ? (
                                <div style={{ marginTop: 12 }}>
                                  <label>开演时间 <input type="datetime-local" value={perfForm.start_at} onChange={(e) => editPerfForm("start_at", e.target.value)} /></label>{" "}
                                  <label>票价（元） <input type="number" min="0" step="1" value={perfForm.price} onChange={(e) => editPerfForm("price", e.target.value)} /></label>{" "}
                                  <button type="button" className="btn-export" disabled={perfBusyId !== null} onClick={savePerfForm}>{perfBusyId !== null ? "保存中…" : "创建场次"}</button>
                                </div>
                              ) : s.status === "approved" ? (
                                <div style={{ marginTop: 12 }}><button type="button" className="btn-view" onClick={() => setPerfForm({ showId: s.id, start_at: "", price: "" })}>添加场次</button></div>
                              ) : (
                                <div className="note" style={{ marginTop: 12 }}>演出未通过审核，不可创建场次。</div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                        {pickupShowId === s.id ? (
                          <tr>
                            <td colSpan="7">
                              {(pickupByShow[s.id] || []).length ? (
                                <table>
                                  <thead><tr><th scope="col">取票点</th><th scope="col">地址</th><th scope="col">操作</th></tr></thead>
                                  <tbody>
                                    {(pickupByShow[s.id] || []).map((pt) => (
                                      <tr key={pt.id}>
                                        <td>{pt.name}</td><td>{pt.address}</td>
                                        <td>
                                          <span className="row-actions">
                                            <button type="button" className="btn-reject" disabled={pickupBusyId === pt.id} onClick={() => deletePickupPoint(pt)}>{pickupBusyId === pt.id ? "处理中…" : "删除"}</button>
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (<div className="empty">暂无取票点</div>)}
                              {pickupForm && pickupForm.showId === s.id ? (
                                <div style={{ marginTop: 12 }}>
                                  <label>取票点名称 <input type="text" value={pickupForm.name} maxLength={100} onChange={(e) => editPickupForm("name", e.target.value)} /></label>{" "}
                                  <label>地址 <input type="text" value={pickupForm.address} maxLength={500} onChange={(e) => editPickupForm("address", e.target.value)} /></label>{" "}
                                  <button type="button" className="btn-export" disabled={pickupBusyId !== null} onClick={savePickupForm}>{pickupBusyId !== null ? "保存中…" : "创建取票点"}</button>{" "}
                                  <button type="button" className="btn-view" onClick={() => setPickupForm(null)}>取消</button>
                                </div>
                              ) : (
                                <div style={{ marginTop: 12 }}><button type="button" className="btn-view" onClick={() => openPickupForm(s)}>添加取票点</button></div>
                              )}
                              <div className="note" style={{ marginTop: 8 }}>已有订单使用取票点不可删除；配置取票点后，顾客下单该演出须选择取票点。</div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )) : searchEmpty(7))
                    : <tr><td colSpan="7"><div className="empty">暂无演出</div></td></tr>}
                </tbody>
              </table>
            </div>
            <p className="def-note">审核结果在操作审计中留痕；仅已通过演出的在售场次对顾客可见。</p>
          </section>

          <section className={"view" + (view === "venues" ? " on" : "")} id="view-venues">
            <div className="search-row">
              <SearchBox id="search-venues" label="搜索场馆" placeholder="输入场馆名称或地址…"
                value={query} onChange={setQuery} resultCount={q ? filteredVenueList.length : null} />
              <button type="button" className="btn-export" onClick={() => openVenueForm(null)}>添加场馆</button>
            </div>
            <div className="note">场馆须归属本店；资源表单可把资源挂到同店场馆，顾客详情页显示场馆名与地址。未配置座位模板的场馆显示“未配置座位模板”，其场次暂不可选座。</div>
            {/* R6-2: venue availability lookup — pick a date (and
                optionally one venue) and see which venues are free
                that day. Read-only; occupied venues list their shows. */}
            <div className="search-row">
              <label>查空闲日期 <input type="date" value={availDate} onChange={(e) => setAvailDate(e.target.value)} /></label>
              <label>场馆 <select value={availVenueId} onChange={(e) => setAvailVenueId(e.target.value)}>
                <option value="">全部场馆</option>
                {venues.map((v) => (<option key={v.id} value={String(v.id)}>{v.name}</option>))}
              </select></label>
              <button type="button" className="btn-export" disabled={availBusy} onClick={() => lookupAvailability(availVenueId ? Number(availVenueId) : null, availDate)}>{availBusy ? "查询中…" : "查空闲"}</button>
            </div>
            {availResult ? (<div className="note">{availSummaryText(availResult)}</div>) : null}
            {venueForm ? (
              <fieldset className="tag-rule">
                <legend>{venueForm.id === null ? "添加场馆" : "编辑场馆：" + venueForm.name}</legend>
                <label>场馆名称 <input type="text" value={venueForm.name} maxLength={80} onChange={(e) => editVenueForm("name", e.target.value)} /></label>
                <label>地址 <input type="text" value={venueForm.address} maxLength={200} onChange={(e) => editVenueForm("address", e.target.value)} /></label>
                <label>容量 <input type="number" min={0} value={venueForm.capacity} onChange={(e) => editVenueForm("capacity", e.target.value)} /></label>
                <label>场地平面图描述 <input type="text" value={venueForm.floor_plan} maxLength={3000} onChange={(e) => editVenueForm("floor_plan", e.target.value)} /></label>
                {venueForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={venueForm.shop_id} onChange={(e) => editVenueForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={venueBusyId !== null} onClick={saveVenueForm}>{venueBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setVenueForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">名称</th><th scope="col">地址</th><th scope="col">店铺</th><th scope="col" className="num">容量</th><th scope="col">座位模板</th><th scope="col">操作</th></tr></thead>
                <tbody id="venuesBody">
                  {venues.length
                    ? (filteredVenueList.length ? filteredVenueList.map((v) => (
                      <Fragment key={v.id}>
                        <tr>
                          <td>{v.name}</td><td>{v.address || "—"}</td><td>{shopName(v.shop_id)}</td>
                          <td className="num">{v.capacity}</td>
                          <td>{v.has_seats ? "已配置" : "未配置座位模板"}</td>
                          <td>
                            <span className="row-actions">
                              <button type="button" className="btn-view" disabled={venueBusyId !== null} onClick={() => openVenueForm(v)}>编辑</button>
                              <button type="button" className="btn-view" onClick={() => toggleTplManager(v)}>{tplVenueId === v.id ? "收起座位模板" : "座位模板"}</button>
                              <button type="button" className="btn-view" disabled={availBusy} onClick={() => { setAvailVenueId(String(v.id)); lookupAvailability(v.id, availDate); }}>查空闲</button>
                            </span>
                          </td>
                        </tr>
                        {tplVenueId === v.id ? (
                          <tr>
                            <td colSpan="6">
                              {(templatesByVenue[v.id] || []).length ? (
                                <table>
                                  <thead><tr><th scope="col">模板</th><th scope="col">分区</th><th scope="col">操作</th></tr></thead>
                                  <tbody>
                                    {(templatesByVenue[v.id] || []).map((tpl) => (
                                      <tr key={tpl.id}>
                                        <td>{tpl.name}</td>
                                        <td>{(tpl.zones || []).map((z) => z.name + " " + z.rows + "×" + z.cols).join("；")}</td>
                                        <td>
                                          <span className="row-actions">
                                            <button type="button" className="btn-view" onClick={() => openTplForm(v, tpl)}>编辑</button>
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (<p className="perf-empty">未配置座位模板</p>)}
                              {tplForm && tplForm.venueId === v.id ? (
                                <fieldset className="tag-rule">
                                  <legend>{tplForm.id === null ? "添加座位模板" : "编辑座位模板：" + tplForm.name}</legend>
                                  <label>模板名称 <input type="text" value={tplForm.name} maxLength={80} onChange={(e) => editTplForm("name", e.target.value)} /></label>
                                  {tplForm.zones.map((z, i) => (
                                    <div key={i}>
                                      <label>分区名 <input type="text" value={z.name} maxLength={50} onChange={(e) => editTplZone(i, "name", e.target.value)} /></label>
                                      <label>行数 <input type="number" min={1} value={z.rows} onChange={(e) => editTplZone(i, "rows", e.target.value)} /></label>
                                      <label>列数 <input type="number" min={1} value={z.cols} onChange={(e) => editTplZone(i, "cols", e.target.value)} /></label>
                                      {tplForm.zones.length > 1 ? (
                                        <button type="button" className="btn-resolve" onClick={() => removeTplZone(i)}>删除分区</button>
                                      ) : null}
                                    </div>
                                  ))}
                                  <div>
                                    <button type="button" className="btn-view" onClick={addTplZone}>添加分区</button>{" "}
                                    <button type="button" className="btn-export" disabled={tplBusyId !== null} onClick={saveTplForm}>{tplBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                                    <button type="button" className="btn-resolve" onClick={() => setTplForm(null)}>取消</button>
                                  </div>
                                </fieldset>
                              ) : (
                                <button type="button" className="btn-export" onClick={() => openTplForm(v, null)}>添加座位模板</button>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )) : searchEmpty(6))
                    : <tr><td colSpan="6"><div className="empty">暂无场馆</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "tiers" ? " on" : "")} id="view-tiers">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openMemberTierForm(null)}>添加会员等级</button>
            </div>
            <div className="note">等级按店配置；顾客按累计消费自动升降级，消费额为已付款订单总额（分）。改门槛不追溯已有用户，下次付款/完成/退款批准时才按新门槛算。下单先按票种价算底价，再按等级折扣减。</div>
            {memberTierForm ? (
              <fieldset className="tag-rule">
                <legend>{memberTierForm.id === null ? "添加会员等级" : "编辑会员等级：" + memberTierForm.name}</legend>
                <label>等级名称 <input type="text" value={memberTierForm.name} maxLength={100} onChange={(e) => editMemberTierForm("name", e.target.value)} /></label>
                <label>消费门槛（分） <input type="number" min={0} value={memberTierForm.min_spend_cents} onChange={(e) => editMemberTierForm("min_spend_cents", e.target.value)} /></label>
                <label>折扣（%） <input type="number" min={0} max={100} value={memberTierForm.discount_pct} onChange={(e) => editMemberTierForm("discount_pct", e.target.value)} /></label>
                <label>等级权益 <input type="text" value={memberTierForm.benefits} maxLength={500} onChange={(e) => editMemberTierForm("benefits", e.target.value)} /></label>
                {memberTierForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={memberTierForm.shop_id} onChange={(e) => editMemberTierForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={memberTierBusyId !== null} onClick={saveMemberTierForm}>{memberTierBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setMemberTierForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">等级</th><th scope="col">店铺</th><th scope="col" className="num">消费门槛（分）</th><th scope="col" className="num">折扣</th><th scope="col">权益</th><th scope="col">操作</th></tr></thead>
                <tbody id="tiersBody">
                  {memberTiers.length
                    ? memberTiers.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td><td>{shopName(t.shop_id)}</td>
                        <td className="num">{t.min_spend_cents}</td>
                        <td className="num">{t.discount_pct}%</td>
                        <td>{t.benefits || "—"}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={memberTierBusyId !== null} onClick={() => openMemberTierForm(t)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="6"><div className="empty">暂无会员等级</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "coupons" ? " on" : "")} id="view-coupons">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openCouponForm(null)}>添加优惠券</button>
            </div>
            <div className="note">券按店配置，顾客下单时输入券码使用。叠加顺序：底价 → 会员折扣 → 券在折后余款上算（固定金额取减额与余款较小者，比例券向下取整）。最低消费按折后余款算。订单取消/退款批准后核销自动释放，名额与每人计数恢复。券码与店铺建后不可改。</div>
            {couponForm ? (
              <fieldset className="tag-rule">
                <legend>{couponForm.id === null ? "添加优惠券" : "编辑优惠券：" + couponForm.code}</legend>
                {couponForm.id === null ? (
                  <label>券码 <input type="text" value={couponForm.code} maxLength={20} placeholder="4–20 位字母或数字" onChange={(e) => editCouponForm("code", e.target.value)} /></label>
                ) : null}
                <label>类型 <select value={couponForm.kind} onChange={(e) => editCouponForm("kind", e.target.value)}>
                  <option value="fixed">固定金额</option>
                  <option value="pct">比例折扣</option>
                </select></label>
                {couponForm.kind === "fixed" ? (
                  <label>减免金额（分） <input type="number" min={1} value={couponForm.value_cents} onChange={(e) => editCouponForm("value_cents", e.target.value)} /></label>
                ) : (
                  <label>折扣（%） <input type="number" min={1} max={100} value={couponForm.discount_pct} onChange={(e) => editCouponForm("discount_pct", e.target.value)} /></label>
                )}
                <label>最低消费（分） <input type="number" min={0} value={couponForm.min_spend_cents} onChange={(e) => editCouponForm("min_spend_cents", e.target.value)} /></label>
                <label>生效时间 <input type="datetime-local" value={couponForm.valid_from} onChange={(e) => editCouponForm("valid_from", e.target.value)} /></label>
                <label>失效时间 <input type="datetime-local" value={couponForm.valid_until} onChange={(e) => editCouponForm("valid_until", e.target.value)} /></label>
                <label>总名额（空 = 不限） <input type="number" min={1} value={couponForm.quota} onChange={(e) => editCouponForm("quota", e.target.value)} /></label>
                <label>每人限用次数 <input type="number" min={1} value={couponForm.per_user_limit} onChange={(e) => editCouponForm("per_user_limit", e.target.value)} /></label>
                <label>状态 <select value={couponForm.status} onChange={(e) => editCouponForm("status", e.target.value)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select></label>
                {couponForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={couponForm.shop_id} onChange={(e) => editCouponForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={couponBusyId !== null} onClick={saveCouponForm}>{couponBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setCouponForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">券码</th><th scope="col">店铺</th><th scope="col">类型</th><th scope="col" className="num">减免</th><th scope="col" className="num">最低消费（分）</th><th scope="col">有效期</th><th scope="col" className="num">已用 / 总名额</th><th scope="col" className="num">每人限次</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="couponsBody">
                  {coupons.length
                    ? coupons.map((c) => (
                      <tr key={c.id}>
                        <td>{c.code}</td><td>{shopName(c.shop_id)}</td>
                        <td>{c.kind === "fixed" ? "固定金额" : "比例折扣"}</td>
                        <td className="num">{c.kind === "fixed" ? c.value_cents + " 分" : c.discount_pct + "%"}</td>
                        <td className="num">{c.min_spend_cents}</td>
                        <td>{(c.valid_from ? String(c.valid_from).slice(0, 10) : "—") + " ~ " + (c.valid_until ? String(c.valid_until).slice(0, 10) : "—")}</td>
                        <td className="num">{c.redemption_count ?? 0} / {c.quota == null ? "不限" : c.quota}</td>
                        <td className="num">{c.per_user_limit}</td>
                        <td>{c.status === "active" ? "启用" : "停用"}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={couponBusyId !== null} onClick={() => openCouponForm(c)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="10"><div className="empty">暂无优惠券</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "flashsales" ? " on" : "")} id="view-flashsales">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openFlashSaleForm(null)}>添加限时抢购</button>
            </div>
            <div className="note">抢购按店配置，一场抢购只对一个场次；场次订单在抢购进行中时自动按抢购价计价（窗口外按原价，不报错）。叠加顺序：抢购价 → 会员折扣 → 券在折后余款上算。名额耗尽时订单仍按原价走单；订单取消/退款批准后名额自动释放。同一场次同一时间只能有一场启用的抢购。场次与店铺建后不可改。</div>
            {flashSaleForm ? (
              <fieldset className="tag-rule">
                <legend>{flashSaleForm.id === null ? "添加限时抢购" : "编辑限时抢购：" + flashSaleForm.name}</legend>
                {flashSaleForm.id === null ? (
                  <label>场次 <select value={flashSaleForm.performance_id} onChange={(e) => editFlashSaleForm("performance_id", e.target.value)}>
                    <option value="">请选择场次</option>
                    {flashPerfOptions().map((o) => (<option key={o.id} value={String(o.id)}>{o.label}</option>))}
                  </select></label>
                ) : (
                  <label>场次 <input type="text" value={flashPerfLabel(flashSaleForm.performance_id)} disabled /></label>
                )}
                <label>抢购名称 <input type="text" value={flashSaleForm.name} maxLength={100} placeholder="例如：刘三姐限时 8 折" onChange={(e) => editFlashSaleForm("name", e.target.value)} /></label>
                <label>类型 <select value={flashSaleForm.kind} onChange={(e) => editFlashSaleForm("kind", e.target.value)}>
                  <option value="fixed">每张减固定金额</option>
                  <option value="pct">比例折扣</option>
                </select></label>
                {flashSaleForm.kind === "fixed" ? (
                  <label>每张减免（分） <input type="number" min={1} value={flashSaleForm.value_cents} onChange={(e) => editFlashSaleForm("value_cents", e.target.value)} /></label>
                ) : (
                  <label>折扣（%） <input type="number" min={1} max={100} value={flashSaleForm.discount_pct} onChange={(e) => editFlashSaleForm("discount_pct", e.target.value)} /></label>
                )}
                <label>开始时间 <input type="datetime-local" value={flashSaleForm.start_at} onChange={(e) => editFlashSaleForm("start_at", e.target.value)} /></label>
                <label>结束时间 <input type="datetime-local" value={flashSaleForm.end_at} onChange={(e) => editFlashSaleForm("end_at", e.target.value)} /></label>
                <label>总名额（空 = 不限） <input type="number" min={1} value={flashSaleForm.quota} onChange={(e) => editFlashSaleForm("quota", e.target.value)} /></label>
                <label>状态 <select value={flashSaleForm.status} onChange={(e) => editFlashSaleForm("status", e.target.value)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select></label>
                {flashSaleForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={flashSaleForm.shop_id} onChange={(e) => editFlashSaleForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={flashSaleBusyId !== null} onClick={saveFlashSaleForm}>{flashSaleBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setFlashSaleForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">抢购名称</th><th scope="col">店铺</th><th scope="col">场次</th><th scope="col">类型</th><th scope="col" className="num">减免</th><th scope="col">时间窗口</th><th scope="col" className="num">已售 / 总名额</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="flashSalesBody">
                  {flashSales.length
                    ? flashSales.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td><td>{shopName(s.shop_id)}</td>
                        <td>{flashPerfLabel(s.performance_id)}</td>
                        <td>{s.kind === "fixed" ? "每张减固定金额" : "比例折扣"}</td>
                        <td className="num">{s.kind === "fixed" ? s.value_cents + " 分" : s.discount_pct + "%"}</td>
                        <td>{String(s.start_at).slice(0, 16).replace("T", " ")} ~ {String(s.end_at).slice(0, 16).replace("T", " ")}</td>
                        <td className="num">{s.sold_count ?? 0} / {s.quota == null ? "不限" : s.quota}</td>
                        <td>{s.status === "active" ? "启用" : "停用"}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={flashSaleBusyId !== null} onClick={() => openFlashSaleForm(s)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="9"><div className="empty">暂无限时抢购</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "autorules" ? " on" : "")} id="view-autorules">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openCouponRuleForm(null)}>添加自动发券规则</button>
            </div>
            <div className="note">规则按店配置：用户首次购买或会员升级时，系统自动把指定优惠券发到用户站内信（无后台定时任务，订单支付时同步判定）。同一规则同一用户同一触发只赠一次；生日触发本波不支持（无生日数据）。赠券与管理员发的券完全一样，下单时输券码使用，核销时计入券名额与每人限额。触发条件、优惠券与店铺建后不可改。</div>
            {couponRuleForm ? (
              <fieldset className="tag-rule">
                <legend>{couponRuleForm.id === null ? "添加自动发券规则" : "编辑自动发券规则：" + couponRuleForm.name}</legend>
                {couponRuleForm.id === null ? (
                  <>
                    <label>触发条件 <select value={couponRuleForm.trigger} onChange={(e) => editCouponRuleForm("trigger", e.target.value)}>
                      <option value="first_purchase">首次购买</option>
                      <option value="tier_upgraded">会员升级</option>
                    </select></label>
                    <label>优惠券 <select value={couponRuleForm.coupon_id} onChange={(e) => editCouponRuleForm("coupon_id", e.target.value)}>
                      <option value="">请选择优惠券</option>
                      {coupons.map((c) => (<option key={c.id} value={String(c.id)}>{c.code}（{shopName(c.shop_id)}）</option>))}
                    </select></label>
                  </>
                ) : (
                  <>
                    <label>触发条件 <input type="text" value={couponRuleForm.trigger === "first_purchase" ? "首次购买" : "会员升级"} disabled /></label>
                    <label>优惠券 <input type="text" value={couponRuleCouponLabel(Number(couponRuleForm.coupon_id))} disabled /></label>
                  </>
                )}
                <label>规则名称 <input type="text" value={couponRuleForm.name} maxLength={100} placeholder="例如：首单赠券" onChange={(e) => editCouponRuleForm("name", e.target.value)} /></label>
                {couponRuleForm.trigger === "first_purchase" ? (
                  <label>最低消费（分，空 = 不限） <input type="number" min={0} value={couponRuleForm.min_spend_cents} onChange={(e) => editCouponRuleForm("min_spend_cents", e.target.value)} /></label>
                ) : null}
                <label>状态 <select value={couponRuleForm.status} onChange={(e) => editCouponRuleForm("status", e.target.value)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select></label>
                {couponRuleForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={couponRuleForm.shop_id} onChange={(e) => editCouponRuleForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={couponRuleBusyId !== null} onClick={saveCouponRuleForm}>{couponRuleBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setCouponRuleForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">规则名称</th><th scope="col">店铺</th><th scope="col">触发条件</th><th scope="col">优惠券</th><th scope="col" className="num">最低消费（分）</th><th scope="col" className="num">已赠送</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="couponRulesBody">
                  {couponRules.length
                    ? couponRules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td><td>{shopName(r.shop_id)}</td>
                        <td>{r.trigger === "first_purchase" ? "首次购买" : "会员升级"}</td>
                        <td>{r.coupon_code || couponRuleCouponLabel(r.coupon_id)}</td>
                        <td className="num">{r.conditions && r.conditions.min_spend_cents != null ? r.conditions.min_spend_cents : "不限"}</td>
                        <td className="num">{r.gift_count ?? 0}</td>
                        <td>{r.status === "active" ? "启用" : "停用"}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={couponRuleBusyId !== null} onClick={() => openCouponRuleForm(r)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="8"><div className="empty">暂无自动发券规则</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "smstasks" ? " on" : "")} id="view-smstasks">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openSmsTaskForm(null)}>添加短信任务</button>
            </div>
            <div className="note">短信群发尚未接入服务商：任务只做到“未发送 — 等待服务商”为止，本波不发送任何短信、不花钱。模板只认 {"{{name}}"} 与 {"{{code}}"} 两个占位符；受众按规则算好人数后存下来，不在发送时重查（本波不发送）。内容只在草稿时可改；进入“未发送 — 等待服务商”后任务不可再改。</div>
            {smsTaskForm ? (
              <fieldset className="tag-rule">
                <legend>{smsTaskForm.id === null ? "添加短信任务" : "编辑短信任务：" + smsTaskForm.name}</legend>
                <label>任务名称 <input type="text" value={smsTaskForm.name} maxLength={100} placeholder="例如：新春演出通知" disabled={smsTaskForm.id !== null && smsTaskForm.status !== "draft"} onChange={(e) => editSmsTaskForm("name", e.target.value)} /></label>
                <label>短信模板 <input type="text" value={smsTaskForm.template} maxLength={500} placeholder="例如：{{name}}您好，新演出已开票，券码{{code}}" disabled={smsTaskForm.id !== null && smsTaskForm.status !== "draft"} onChange={(e) => editSmsTaskForm("template", e.target.value)} /></label>
                <label>受众 <select value={smsTaskForm.audience_type} disabled={smsTaskForm.id !== null && smsTaskForm.status !== "draft"} onChange={(e) => editSmsTaskForm("audience_type", e.target.value)}>
                  <option value="all">全部用户</option>
                  <option value="tier">按会员等级</option>
                </select></label>
                {smsTaskForm.audience_type === "tier" ? (
                  <label>会员等级 <select value={smsTaskForm.tier_id} disabled={smsTaskForm.id !== null && smsTaskForm.status !== "draft"} onChange={(e) => editSmsTaskForm("tier_id", e.target.value)}>
                    <option value="">请选择会员等级</option>
                    {memberTiers.map((t) => (<option key={t.id} value={String(t.id)}>{t.name}（{shopName(t.shop_id)}）</option>))}
                  </select></label>
                ) : null}
                {smsTaskForm.id !== null ? (
                  <label>状态 <select value={smsTaskForm.status} onChange={(e) => editSmsTaskForm("status", e.target.value)}>
                    <option value="draft">草稿</option>
                    <option value="queued">已排队</option>
                    <option value="waiting_provider">未发送 — 等待服务商</option>
                  </select></label>
                ) : null}
                {smsTaskForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={smsTaskForm.shop_id} onChange={(e) => editSmsTaskForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={smsTaskBusyId !== null} onClick={saveSmsTaskForm}>{smsTaskBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setSmsTaskForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">任务名称</th><th scope="col">店铺</th><th scope="col">短信模板</th><th scope="col">受众</th><th scope="col" className="num">人数</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="smsTasksBody">
                  {smsTasks.length
                    ? smsTasks.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td><td>{shopName(t.shop_id)}</td>
                        <td>{t.template}</td>
                        <td>{smsAudienceLabel(t)}</td>
                        <td className="num">{t.audience_count ?? 0}</td>
                        <td>{smsStatusLabel(t.status)}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={smsTaskBusyId !== null || t.status === "waiting_provider"} onClick={() => openSmsTaskForm(t)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="7"><div className="empty">暂无短信任务</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "licenses" ? " on" : "")} id="view-licenses">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openLicForm()}>登记版权</button>
            </div>
            <div className="note">版权授权登记：选一个资源，填授权方、被授权方、方向与价格；版权方、授权类型与 IP 地区是资源的事实字段，随登记一起写入资源详情，不编造持有人。跨店铺的资源不能登记。</div>
            {licForm ? (
              <fieldset className="tag-rule">
                <legend>登记版权</legend>
                <label>资源 <select value={licForm.resource_id} onChange={(e) => editLicForm("resource_id", e.target.value)}>
                  <option value="">请选择资源</option>
                  {resources.map((r) => (<option key={r.id} value={String(r.id)}>{r.name}（{catZh(r.category)}）</option>))}
                </select></label>
                <label>授权方 <input type="text" value={licForm.licensor} maxLength={100} placeholder="例如：广西演艺集团" onChange={(e) => editLicForm("licensor", e.target.value)} /></label>
                <label>被授权方 <input type="text" value={licForm.licensee} maxLength={100} placeholder="例如：南宁大剧院" onChange={(e) => editLicForm("licensee", e.target.value)} /></label>
                <label>授权方向 <select value={licForm.kind} onChange={(e) => editLicForm("kind", e.target.value)}>
                  <option value="buy">买入</option>
                  <option value="sell">卖出</option>
                </select></label>
                <label>授权价格（元） <input type="number" min="0" step="1" value={licForm.price_yuan} placeholder="例如：8000" onChange={(e) => editLicForm("price_yuan", e.target.value)} /></label>
                <label>授权状态 <select value={licForm.status} onChange={(e) => editLicForm("status", e.target.value)}>
                  <option value="pending">待生效</option>
                  <option value="active">生效中</option>
                  <option value="expired">已过期</option>
                </select></label>
                <label>开始日期 <input type="date" value={licForm.start_at} onChange={(e) => editLicForm("start_at", e.target.value)} /></label>
                <label>结束日期 <input type="date" value={licForm.end_at} onChange={(e) => editLicForm("end_at", e.target.value)} /></label>
                <label>版权方（资源详情） <input type="text" value={licForm.copyright_holder} maxLength={100} placeholder="选填：与授权方一致时可填" onChange={(e) => editLicForm("copyright_holder", e.target.value)} /></label>
                <label>授权类型（资源详情） <input type="text" value={licForm.license_type} maxLength={100} placeholder="选填：例如商业授权" onChange={(e) => editLicForm("license_type", e.target.value)} /></label>
                <label>IP 地区（资源详情） <input type="text" value={licForm.ip_region} maxLength={100} placeholder="选填：例如广西" onChange={(e) => editLicForm("ip_region", e.target.value)} /></label>
                <div>
                  <button type="button" className="btn-export" disabled={licBusy} onClick={saveLicForm}>{licBusy ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setLicForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">ID</th><th scope="col">资源</th><th scope="col">授权方 → 被授权方</th><th scope="col">方向</th><th scope="col" className="num">价格</th><th scope="col">状态</th><th scope="col">起止日期</th></tr></thead>
                <tbody id="licensesBody">
                  {licenses.length
                    ? licenses.map((l) => (
                      <tr key={l.id}>
                        <td>{l.id}</td><td>{l.resource_name}</td>
                        <td>{l.licensor} → {l.licensee}</td>
                        <td>{l.kind === "buy" ? "买入" : "卖出"}</td>
                        <td className="num">{fmtMoney(l.price_cents)}</td>
                        <td>{l.status === "pending" ? "待生效" : l.status === "active" ? "生效中" : "已过期"}</td>
                        <td>{[l.start_at, l.end_at].filter(Boolean).join(" ~ ") || "—"}</td>
                      </tr>
                    ))
                    : <tr><td colSpan="7"><div className="empty">暂无版权登记</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "storedvalue" ? " on" : "")} id="view-storedvalue">
            <div className="search-row">
              <button type="button" className="btn-export" onClick={() => openStoredValuePlanForm(null)}>添加储值套餐</button>
            </div>
            <div className="note">文惠卡按店配置：顾客选套餐充值（充多少送多少，模拟充值，未产生真实扣款），下单支付时先扣卡内余额、余款走模拟支付，退款批准时先返还卡内已扣的部分。每账户余额上限 ¥5000。平台补贴是发到卡里的赠送余额，不是第二套卡。</div>
            {storedValuePlanForm ? (
              <fieldset className="tag-rule">
                <legend>{storedValuePlanForm.id === null ? "添加储值套餐" : "编辑储值套餐"}</legend>
                <label>充值金额（分） <input type="number" min={1} value={storedValuePlanForm.amount_cents} onChange={(e) => editStoredValuePlanForm("amount_cents", e.target.value)} /></label>
                <label>赠送金额（分） <input type="number" min={0} value={storedValuePlanForm.bonus_cents} onChange={(e) => editStoredValuePlanForm("bonus_cents", e.target.value)} /></label>
                <label>状态 <select value={storedValuePlanForm.status} onChange={(e) => editStoredValuePlanForm("status", e.target.value)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select></label>
                {storedValuePlanForm.id === null && isPlatformAdmin ? (
                  <label>店铺 <select value={storedValuePlanForm.shop_id} onChange={(e) => editStoredValuePlanForm("shop_id", e.target.value)}>
                    {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                  </select></label>
                ) : null}
                <div>
                  <button type="button" className="btn-export" disabled={storedValuePlanBusyId !== null} onClick={saveStoredValuePlanForm}>{storedValuePlanBusyId !== null ? "保存中…" : "保存"}</button>{" "}
                  <button type="button" className="btn-resolve" onClick={() => setStoredValuePlanForm(null)}>取消</button>
                </div>
              </fieldset>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">套餐</th><th scope="col">店铺</th><th scope="col" className="num">充值金额</th><th scope="col" className="num">赠送金额</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="storedValuePlansBody">
                  {storedValuePlans.length
                    ? storedValuePlans.map((pl) => (
                      <tr key={pl.id}>
                        <td>充 ¥{(pl.amount_cents / 100).toString()} 送 ¥{(pl.bonus_cents / 100).toString()}</td><td>{shopName(pl.shop_id)}</td>
                        <td className="num">{fmtMoney(pl.amount_cents)}</td>
                        <td className="num">{fmtMoney(pl.bonus_cents)}</td>
                        <td>{pl.status === "active" ? "启用" : "停用"}</td>
                        <td>
                          <span className="row-actions">
                            <button type="button" className="btn-view" disabled={storedValuePlanBusyId !== null} onClick={() => openStoredValuePlanForm(pl)}>编辑</button>
                          </span>
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="6"><div className="empty">暂无储值套餐</div></td></tr>}
                </tbody>
              </table>
            </div>
            <fieldset className="tag-rule">
              <legend>发放平台补贴</legend>
              <label>用户编号 <input type="number" min={1} value={grantForm.user_id} onChange={(e) => setGrantForm((f) => ({ ...f, user_id: e.target.value }))} /></label>
              <label>补贴金额（分） <input type="number" min={1} max={500000} value={grantForm.amount_cents} onChange={(e) => setGrantForm((f) => ({ ...f, amount_cents: e.target.value }))} /></label>
              <label>备注 <input type="text" value={grantForm.note} maxLength={200} placeholder="平台补贴" onChange={(e) => setGrantForm((f) => ({ ...f, note: e.target.value }))} /></label>
              {isPlatformAdmin ? (
                <label>店铺 <select value={grantForm.shop_id} onChange={(e) => setGrantForm((f) => ({ ...f, shop_id: e.target.value }))}>
                  {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                </select></label>
              ) : null}
              <div>
                <button type="button" className="btn-export" disabled={grantBusy} onClick={doGrantStoredValue}>{grantBusy ? "发放中…" : "发放补贴"}</button>
              </div>
            </fieldset>
            <fieldset className="tag-rule">
              <legend>按用户查储值账户</legend>
              <label>用户编号 <input type="number" min={1} value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)} /></label>
              <div>
                <button type="button" className="btn-export" onClick={doLookupStoredValue}>查询</button>{" "}
                {lookupResult && lookupResult.account ? (
                  <button type="button" className="btn-view" onClick={() => apiDownloadCsv("/api/admin/stored-value/" + lookupResult.user.id + "?format=csv", "guiyan-stored-value.csv")}>导出流水 CSV</button>
                ) : null}
              </div>
              {lookupResult ? (
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th scope="col">用户</th><th scope="col" className="num">余额</th><th scope="col" className="num">流水条数</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{lookupResult.user.name}（{lookupResult.user.username}）</td>
                        <td className="num">{fmtMoney(lookupResult.account ? lookupResult.account.balance_cents : 0)}</td>
                        <td className="num">{lookupResult.total}</td>
                      </tr>
                    </tbody>
                  </table>
                  {lookupResult.ledger.length ? (
                    <table>
                      <thead><tr><th scope="col">类型</th><th scope="col" className="num">金额</th><th scope="col">订单号</th><th scope="col">备注</th><th scope="col">时间</th></tr></thead>
                      <tbody>
                        {lookupResult.ledger.map((l) => (
                          <tr key={l.id}>
                            <td>{l.kind_label}</td>
                            <td className="num">{l.amount_cents >= 0 ? "+" : "−"}{fmtMoney(Math.abs(l.amount_cents))}</td>
                            <td>{l.order_code || "—"}</td>
                            <td>{l.note || "—"}</td>
                            <td>{String(l.created_at).slice(0, 19).replace("T", " ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div className="empty">暂无储值记录</div>}
                </div>
              ) : null}
            </fieldset>
          </section>

          <section className={"view" + (view === "verify" ? " on" : "")} id="view-verify">
            <div className="note">扫票核销：输入票码（GY + 8 位字母数字，不区分大小写）后核销。核销只查票状态，不校验演出日期。每次核销尝试都会记入核销记录。</div>
            <fieldset className="tag-rule">
              <legend>核销一张票</legend>
              <label>票码 <input type="text" value={verifyCode} maxLength={10} placeholder="例如 GY7K2Q9X4M" onChange={(e) => setVerifyCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doVerify(); }} /></label>
              <div>
                <button type="button" className="btn-export" disabled={verifyBusy} onClick={doVerify}>{verifyBusy ? "核销中…" : "核销"}</button>
              </div>
            </fieldset>
            {/* R4-3 批量核销 + 离线队列: paste many codes (one per
                line, max 50) and verify them in one batch call; a
                bad code never stops the rest. Codes whose batch
                call failed sit in the localStorage offline queue
                (same key as the mini-program) until 同步 succeeds.
                Voice + vibration are H5-only (Web Speech API +
                navigator.vibrate); the mini-program has no TTS. */}
            <fieldset className="tag-rule">
              <legend>批量核销</legend>
              <div className="note">一次粘贴多个票码（每行一个，最多 50 个），一次调用全部核销；单个坏码不影响其余。语音播报与震动仅限本页（Web Speech API + navigator.vibrate），小程序无语音播报。</div>
              <label>票码 <textarea className="copy-prompt" aria-label="批量票码" placeholder={"每行一个票码，例如\nGY7K2Q9X4M\nGY00000000"} value={batchCodes} onChange={(e) => setBatchCodes(e.target.value)} /></label>
              <div>
                <button type="button" className="btn-export" disabled={batchBusy} onClick={() => doBatchVerify()}>{batchBusy ? "核销中…" : "批量核销"}</button>
              </div>
              {batchResults.length ? (
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th scope="col">票码</th><th scope="col">结果</th><th scope="col">资源</th></tr></thead>
                    <tbody>
                      {batchResults.map((r, i) => (
                        <tr key={r.code + "-" + i}>
                          <td><span className="code">{r.code}</span></td>
                          <td>{batchResultText[r.result] || r.result}</td>
                          <td>{r.order ? r.order.resource_name : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </fieldset>
            <fieldset className="tag-rule">
              <legend>离线队列（{verifyQueue.length}）</legend>
              <div className="note">批量核销失败的票码会存入本地队列；点“同步”重新发送，同步成功后才移出队列。</div>
              {verifyQueue.length ? (
                <>
                  <div className="note">{verifyQueue.join("、")}</div>
                  <div>
                    <button type="button" className="btn-export" disabled={batchBusy} onClick={syncVerifyQueue}>{batchBusy ? "同步中…" : "同步"}</button>
                    <button type="button" className="btn-export" onClick={() => saveVerifyQueue([])}>清空队列</button>
                  </div>
                </>
              ) : <div className="empty">离线队列为空</div>}
            </fieldset>
            {/* R4-2 打印纸质票: record the print event for one order's
                tickets, then open the ticket layout for the browser
                to print (window.print). The server only records the
                event — paper output is the browser print, no
                physical printer is connected. */}
            <fieldset className="tag-rule">
              <legend>打印纸质票</legend>
              <div className="note">只记录打印事件；纸张由浏览器打印票面出票，不接实体打印机。已核销 / 已作废 / 退款审核中的票不能打印；已打印过的票可重打（卡纸重打）。</div>
              <label>订单号 <input type="text" value={printOrderId} placeholder="例如 123" onChange={(e) => setPrintOrderId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doPrintOrder(); }} /></label>
              <div>
                <button type="button" className="btn-export" disabled={printBusy} onClick={() => doPrintOrder()}>{printBusy ? "打印中…" : "打印该单"}</button>
              </div>
            </fieldset>
            {verifyResult ? (
              <div className="copy-card">
                <h3>{verifyResult.ok ? "核销成功" : verifyResult.result}</h3>
                {verifyResult.ticket ? (
                  <>
                    <div className="row"><span>票码</span><span className="code">{verifyResult.ticket.code}</span></div>
                    <div className="row"><span>状态</span><span>{verifyResult.ticket.status === "used" ? "已核销" : verifyResult.ticket.status === "void" ? "已作废" : "已出票"}</span></div>
                  </>
                ) : (
                  <div className="row"><span>票码</span><span className="code">{verifyResult.code}</span></div>
                )}
                {verifyResult.order ? (
                  <>
                    <div className="row"><span>资源</span><span>{verifyResult.order.resource_name}</span></div>
                    <div className="row"><span>预订日期</span><span>{verifyResult.order.booking_date}</span></div>
                    <div className="row"><span>数量</span><span>{verifyResult.order.quantity} 张</span></div>
                    <div className="row"><span>订单号</span><span className="code">{verifyResult.order.code}</span></div>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">票码</th><th scope="col">结果</th><th scope="col">资源</th><th scope="col">时间</th><th scope="col">打印</th></tr></thead>
                <tbody id="verifyLogsBody">
                  {verifyHistory.length
                    ? verifyHistory.map((h, i) => (
                      <tr key={h.code + "-" + i}>
                        <td><span className="code">{h.code}</span></td>
                        <td>{h.ok ? "已核销" : h.result}</td>
                        <td>{h.order ? h.order.resource_name : "—"}</td>
                        <td>{String(h.at).slice(0, 19).replace("T", " ")}</td>
                        {/* R4-2: print button per order (this session's
                            verify history only — the fieldset above
                            prints any order by id). */}
                        <td>{h.order ? <button type="button" className="mini" disabled={printBusy} onClick={() => doPrintOrder(h.order.id)}>打印</button> : "—"}</td>
                      </tr>
                    ))
                    : <tr><td colSpan="5"><div className="empty">暂无核销记录</div></td></tr>}
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

          {/* R7-1 IP 配置: 文小惠 config frame — name / avatar URL /
              greeting. All three default to empty (= unset): with no
              文小惠 design from Lam/Group, GET /api/ip returns {} and
              AiChat keeps its current button, title and greeting
              byte-identical. Setting a value here is what makes AiChat
              use it; clearing a field (empty) unsets it again. */}
          <section className={"view" + (view === "ipconfig" ? " on" : "")} id="view-ipconfig">
            <div className="note">文小惠形象配置（设计未到，仅留配置入口）：名称、头像链接、问候语均可留空——留空即未设置，聊天保持原样，不编造任何形象、名字或问候语。头像须为 https:// 链接或站内路径（如 /uploads/ip.png）。</div>
            {ipConfig === null ? <div className="empty">加载中…</div> : (
              <>
                <div className="search-row">
                  <label>IP 名称（≤20字） <input type="text" maxLength={20} value={ipForm.ip_name} onChange={(e) => setIpForm(function (f) { return { ...f, ip_name: e.target.value }; })} /></label>
                  <label>头像链接 <input type="text" maxLength={500} placeholder="https://… 或 /uploads/…" value={ipForm.ip_avatar_url} onChange={(e) => setIpForm(function (f) { return { ...f, ip_avatar_url: e.target.value }; })} /></label>
                </div>
                <div className="search-row">
                  <label>问候语（≤200字） <input type="text" maxLength={200} value={ipForm.ip_greeting} onChange={(e) => setIpForm(function (f) { return { ...f, ip_greeting: e.target.value }; })} /></label>
                  <button type="button" className="btn-export" disabled={ipBusy} onClick={saveIpConfig}>{ipBusy ? "保存中…" : "保存 IP 配置"}</button>
                </div>
                {ipForm.ip_avatar_url.trim() ? (<div className="note">头像预览：<img src={ipForm.ip_avatar_url.trim()} alt="IP 头像预览" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", verticalAlign: "middle" }} /></div>) : null}
                <div className="note">当前配置：{ipConfig.ip_name ? "名称“" + ipConfig.ip_name + "”" : "名称未设置"} · {ipConfig.ip_avatar_url ? "头像已设置" : "头像未设置"} · {ipConfig.ip_greeting ? "问候语已设置" : "问候语未设置"}</div>
              </>
            )}
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

          {/* R6-5 评论审核: pending list + approve/reject + reply.
              Approval makes the comment public (rating/review_count
              follow from the server aggregation); a reply notifies
              the comment author. */}
          <section className={"view" + (view === "comments" ? " on" : "")} id="view-comments">
            <div className="chips">
              {[["pending", "待审核"], ["", "全部"], ["approved", "已通过"], ["rejected", "已拒绝"]].map(([v, label]) => (
                <button key={v || "all"} type="button" className={cmtFilter === v ? "on" : ""}
                  aria-pressed={cmtFilter === v ? "true" : "false"} onClick={() => setCmtFilter(v)}>{label}</button>
              ))}
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">编号</th><th scope="col">资源</th><th scope="col">用户</th><th scope="col">评分</th><th scope="col">评价内容</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                <tbody id="cmtBody">
                  {comments.length
                    ? comments.map((c) => (
                      <tr key={c.id}>
                        <td className="num">{c.id}</td><td>{c.resource_name || ""}</td><td>{c.user_name || ""}</td>
                        <td className="num">{"★".repeat(c.rating)}{"☆".repeat(5 - c.rating)}</td>
                        <td>{c.content}{c.reply ? (<div style={{ fontSize: 12.5, color: "var(--ink2)" }}>回复：{c.reply}</div>) : null}</td>
                        <td>{c.status === "approved" ? "已通过" : c.status === "pending" ? "待审核" : c.status === "rejected" ? "已拒绝" : (c.status || "")}</td>
                        <td>
                          {c.status === "pending" ? (
                            <span className="row-actions">
                              <button type="button" className="btn-approve" disabled={reviewBusyId === c.id} onClick={() => doReviewComment(c.id, "approved")}>{reviewBusyId === c.id ? "处理中…" : "通过"}</button>
                              <button type="button" className="btn-reject" disabled={reviewBusyId === c.id} onClick={() => doReviewComment(c.id, "rejected")}>{reviewBusyId === c.id ? "处理中…" : "拒绝"}</button>
                            </span>
                          ) : (
                            <span className="row-actions">
                              <input type="text" maxLength={500} placeholder="写回复…" value={replyDraft[c.id] || ""}
                                onChange={(e) => setReplyDraft(function (m) { return { ...m, [c.id]: e.target.value }; })}
                                style={{ width: 160 }} />
                              <button type="button" className="btn-approve" disabled={reviewBusyId === c.id} onClick={() => doReplyComment(c.id)}>{reviewBusyId === c.id ? "处理中…" : "回复"}</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="7"><div className="empty">暂无评价</div></td></tr>}
                </tbody>
              </table>
            </div>
            <p className="def-note">通过后评价公开可见，资源评分与评价数随之更新；回复会通知评价作者。</p>
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
            <p className="cache-note">数据最多每 60 秒更新一次（服务端缓存）。
              <button type="button" className="btn-export" disabled={analysisBusy} onClick={doRefreshAnalysis}>{analysisBusy ? "刷新中…" : "刷新快照"}</button>
              {analysis && analysis.source === "snapshot" && analysis.computed_at ? <span>快照时间 {String(analysis.computed_at).slice(0, 16)}</span> : null}
            </p>
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
                {/* R5-4 数据汇聚 + 智能分析: per-show table, promos,
                    members and rule-text recommendations, all from
                    real R2–R4 data. The recommendations are fixed
                    rule text, NOT AI (the AI half stays in R7). */}
                <div className="sec">
                  <h2>演出分析</h2>
                  {(analysis.shows || []).length ? (
                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th scope="col">演出</th><th scope="col" className="num">场次</th><th scope="col" className="num">订单</th><th scope="col" className="num">收入</th><th scope="col" className="num">上座率</th></tr></thead>
                        <tbody>
                          {(analysis.shows || []).map((s) => (
                            <tr key={s.show_id}>
                              <td>{s.title}</td><td className="num">{s.performances}</td><td className="num">{s.orders}</td>
                              <td className="num">{fmtMoney(s.revenue_cents)}</td><td className="num">{s.occupancy === null ? "暂无座位样本" : s.occupancy + "%"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="empty">暂无演出</div>}
                  <p className="def-note">订单与收入只计有效已支付订单；上座率为已售座位 / 全部座位，无座位数据的演出显示“暂无座位样本”。</p>
                </div>
                <div className="sec">
                  <h2>促销效果</h2>
                  {analysis.promos ? (
                    <>
                      <p>优惠券核销 {analysis.promos.total_redemptions} 次，共减免 {fmtMoney(analysis.promos.total_discount_cents)}；用券订单 {analysis.promos.orders_with_coupon} 笔，不用券订单 {analysis.promos.orders_without_coupon} 笔。</p>
                      {(analysis.promos.coupons || []).length ? (
                        <div className="tbl-wrap">
                          <table>
                            <thead><tr><th scope="col">优惠券</th><th scope="col" className="num">核销数</th><th scope="col" className="num">总折扣</th></tr></thead>
                            <tbody>
                              {(analysis.promos.coupons || []).map((c) => (
                                <tr key={c.coupon_id}><td>{c.code}</td><td className="num">{c.redemptions}</td><td className="num">{fmtMoney(c.total_discount_cents)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="empty">暂无优惠券核销</div>}
                      {(analysis.promos.flash_sales || []).length ? (
                        <div className="tbl-wrap">
                          <table>
                            <thead><tr><th scope="col">限时抢购</th><th scope="col" className="num">已售</th><th scope="col" className="num">收入</th><th scope="col" className="num">总折扣</th></tr></thead>
                            <tbody>
                              {(analysis.promos.flash_sales || []).map((f) => (
                                <tr key={f.flash_sale_id}><td>{f.name}</td><td className="num">{f.sold}</td><td className="num">{fmtMoney(f.revenue_cents)}</td><td className="num">{fmtMoney(f.total_discount_cents)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="empty">暂无限时抢购</div>}
                    </>
                  ) : <div className="empty">暂无促销数据</div>}
                </div>
                <div className="sec">
                  <h2>会员结构</h2>
                  {analysis.members ? (
                    <>
                      <p>会员总数 {analysis.members.total_users} 人（主店等级，按实际消费实时划分）。</p>
                      {(analysis.members.tiers || []).length ? (
                        <div className="tbl-wrap">
                          <table>
                            <thead><tr><th scope="col">等级</th><th scope="col" className="num">人数</th><th scope="col" className="num">流失人数</th><th scope="col" className="num">流失率</th></tr></thead>
                            <tbody>
                              {(analysis.members.tiers || []).map((t) => (
                                <tr key={t.name}><td>{t.name}</td><td className="num">{t.users}</td><td className="num">{t.churned_users}</td><td className="num">{t.churn_rate}%</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="empty">暂无会员等级</div>}
                      <p className="def-note">消费分档：{(analysis.members.buckets || []).map((b) => `${b.label} ${b.users} 人`).join(" · ")}</p>
                    </>
                  ) : <div className="empty">暂无会员数据</div>}
                </div>
                <div className="sec">
                  <h2>智能建议</h2>
                  <p className="def-note">规则建议（按上座率、流失率、收入等固定阈值生成），非 AI 生成；AI 建议见后续版本。</p>
                  {(analysis.recommendations || []).length ? (
                    <ul className="insights">
                      {(analysis.recommendations || []).map((r, i) => <li key={i}>{r.text}</li>)}
                    </ul>
                  ) : <div className="empty">暂无建议</div>}
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
            <div className="note">以下预警中，库存/预约/售后为真实数据规则触发；标注（模拟事件）的是模拟演练事件，不代表真实故障。标注“自动”的预警由预警规则读时现算、不入库；停用规则或修好底层问题即可消警。</div>
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
                    {a.auto ? <span className="pill confirmed">自动 · {{ sales_drop: "销量下滑", scan_abuse: "核销异常", low_stock: "库存不足" }[a.rule_kind] || a.rule_kind}</span> : null}
                    <b>{a.title}</b>
                    <p>{a.detail}</p>
                    {!a.auto && a.id ? <button type="button" className="btn-resolve" onClick={() => doResolveAlert(a.id)}>处理模拟预警</button> : null}
                  </div>
                )) : (
                  <div className="empty">没有找到匹配的结果<br />
                    <button type="button" className="link-btn" onClick={() => setQuery("")}>清除搜索</button>
                  </div>
                ))
                : <div className="empty">暂无预警</div>}
            </div>
            {/* R5-5 预警规则: auto alerts are computed on read from
                these rules (never stored); disabling a rule dismisses
                its auto alerts. Platform-level rules (empty shop)
                apply to all shops. */}
            <div className="sec">
              <h2>预警规则</h2>
              <fieldset className="tag-rule">
                <legend>新增预警规则</legend>
                <label>类型 <select value={ruleForm.kind} onChange={(e) => setRuleForm(function (f) { return { ...f, kind: e.target.value }; })}>
                  <option value="sales_drop">销量下滑</option>
                  <option value="scan_abuse">核销异常</option>
                  <option value="low_stock">库存不足</option>
                </select></label>
                <label>店铺编号（空 = 平台级） <input type="number" min={1} value={ruleForm.shop_id} onChange={(e) => setRuleForm(function (f) { return { ...f, shop_id: e.target.value }; })} /></label>
                {ruleForm.kind === "sales_drop" ? (<>
                  <label>跌幅百分比（%） <input type="number" min={1} max={100} value={ruleForm.drop_pct} onChange={(e) => setRuleForm(function (f) { return { ...f, drop_pct: e.target.value }; })} /></label>
                  <label>窗口天数 <input type="number" min={1} max={90} value={ruleForm.window_days} onChange={(e) => setRuleForm(function (f) { return { ...f, window_days: e.target.value }; })} /></label>
                </>) : ruleForm.kind === "scan_abuse" ? (<>
                  <label>失败次数 <input type="number" min={1} max={1000} value={ruleForm.fail_count} onChange={(e) => setRuleForm(function (f) { return { ...f, fail_count: e.target.value }; })} /></label>
                  <label>窗口分钟 <input type="number" min={1} max={1440} value={ruleForm.window_minutes} onChange={(e) => setRuleForm(function (f) { return { ...f, window_minutes: e.target.value }; })} /></label>
                </>) : (
                  <label>库存阈值 <input type="number" min={0} max={100000} value={ruleForm.stock_lt} onChange={(e) => setRuleForm(function (f) { return { ...f, stock_lt: e.target.value }; })} /></label>
                )}
                <div>
                  <button type="button" className="btn-export" disabled={ruleBusy} onClick={doCreateRule}>{ruleBusy ? "保存中…" : "新增规则"}</button>
                </div>
              </fieldset>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th scope="col">类型</th><th scope="col">店铺</th><th scope="col">配置</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
                  <tbody>
                    {alertRules.length ? alertRules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.kind_label || r.kind}</td>
                        <td>{r.shop_id === null || r.shop_id === undefined ? "平台级" : r.shop_id + "号店"}</td>
                        <td>{JSON.stringify(r.config)}</td>
                        <td>{r.status === "active" ? "启用" : "停用"}</td>
                        <td><button type="button" className="btn-view" disabled={ruleBusy} onClick={() => doToggleRule(r)}>{ruleBusy ? "处理中…" : (r.status === "active" ? "停用" : "启用")}</button></td>
                      </tr>
                    )) : <tr><td colSpan="5"><div className="empty">暂无预警规则</div></td></tr>}
                  </tbody>
                </table>
              </div>
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
          {/* R5-1 数据运营: stored event aggregates by period + date
              + type. The table reads the aggregates table only — it
              never recomputes live. "重新聚合" recomputes from the
              raw events for the chosen period/date (manual trigger
              only; there is no cron/worker this wave) and is
              idempotent: running it twice changes nothing. */}
          <section className={"view" + (view === "events" ? " on" : "")} id="view-events">
            <div className="note">埋点事件（浏览 / 点击 / 搜索 / 停留）按小时或天汇总。聚合按人工触发重算，无定时任务；重新聚合可重复执行，结果不变。</div>
            <div className="search-row">
              <label>周期 <select value={eventPeriod} onChange={(e) => setEventPeriod(e.target.value)}>
                <option value="day">按天</option>
                <option value="hour">按小时</option>
              </select></label>
              <label>日期 <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
              <label>事件类型 <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="">全部</option>
                <option value="view">浏览</option>
                <option value="click">点击</option>
                <option value="search">搜索</option>
                <option value="dwell">停留</option>
              </select></label>
              <button type="button" className="btn-export" disabled={eventBusy} onClick={doAggregateEvents}>{eventBusy ? "聚合中…" : "重新聚合"}</button>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">时段</th><th scope="col">事件类型</th><th scope="col">对象</th><th scope="col">次数</th><th scope="col">总停留时长（毫秒）</th></tr></thead>
                <tbody>
                  {eventAggregates.length
                    ? eventAggregates.map((a) => (
                      <tr key={a.period + "-" + a.period_key + "-" + a.type + "-" + a.key}>
                        <td>{a.period_key}</td>
                        <td>{({ view: "浏览", click: "点击", search: "搜索", dwell: "停留" })[a.type] || a.type}</td>
                        <td><span className="code">{a.key}</span></td>
                        <td className="num">{a.count}</td>
                        <td className="num">{a.total_duration_ms}</td>
                      </tr>
                    ))
                    : <tr><td colSpan="5"><div className="empty">暂无聚合数据（先点“重新聚合”从事件汇总）</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* R5-2 会员数据: per-shop member rows (spending = R3-1
              PAID_STATUSES sum, tier resolved live) with churn /
              upgrade-candidate markers, the rule-text operating
              suggestions, and the rules editor. The suggestions are
              RULES, not AI — row 54's AI-personalized half stays in
              R7, and this view never claims otherwise. */}
          <section className={"view" + (view === "memberinsights" ? " on" : "")} id="view-memberinsights">
            <div className="note">会员消费与经营建议（规则建议，非 AI）。流失 = 超过流失天数无已付订单（从未购买也算流失，但无消费的不进回访建议）；可升级 = 距下一等级门槛在差距百分比以内；推广演出 = 近 30 天本店收入最高的演出。</div>
            <div className="search-row">
              {isPlatformAdmin ? (
                <label>店铺 <select value={insightShop} onChange={(e) => setInsightShop(e.target.value)}>
                  {shops.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                </select></label>
              ) : (<span>本店铺</span>)}
              <label>流失天数 <input type="number" min={1} max={365} value={insightRuleForm.churnDays} onChange={(e) => setInsightRuleForm(function (f) { return { ...f, churnDays: e.target.value }; })} /></label>
              <label>可升级差距（%） <input type="number" min={0} max={100} value={insightRuleForm.upgradeGapPct} onChange={(e) => setInsightRuleForm(function (f) { return { ...f, upgradeGapPct: e.target.value }; })} /></label>
              <label>回访天数 <input type="number" min={1} max={365} value={insightRuleForm.callbackDays} onChange={(e) => setInsightRuleForm(function (f) { return { ...f, callbackDays: e.target.value }; })} /></label>
              <button type="button" className="btn-export" disabled={insightBusy} onClick={saveInsightRules}>{insightBusy ? "保存中…" : "保存规则"}</button>
            </div>
            {insightRules ? (<div className="note">当前规则：流失天数 {insightRules.churnDays} 天 · 可升级差距 {insightRules.upgradeGapPct}% · 回访天数 {insightRules.callbackDays} 天</div>) : null}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">经营建议</th><th scope="col">对象</th><th scope="col">建议内容</th></tr></thead>
                <tbody>
                  {memberInsights && memberInsights.suggestions.length
                    ? memberInsights.suggestions.map((s, i) => (
                      <tr key={s.type + "-" + (s.user_id || s.show_id || i)}>
                        <td>{{ upgrade: "可升级", callback: "回访", push_show: "推广演出" }[s.type] || s.type}</td>
                        <td>{s.name || s.title || "—"}</td>
                        <td>{s.text}</td>
                      </tr>
                    ))
                    : <tr><td colSpan="3"><div className="empty">暂无经营建议</div></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">会员</th><th scope="col" className="num">累计消费</th><th scope="col">等级</th><th scope="col">最近已付订单</th><th scope="col">流失</th><th scope="col">可升级</th><th scope="col">下一等级</th><th scope="col" className="num">还差</th></tr></thead>
                <tbody>
                  {memberInsights && memberInsights.users.length
                    ? memberInsights.users.map((u) => (
                      <tr key={u.user_id}>
                        <td>{u.name}</td>
                        <td className="num">{fmtMoney(u.spending_cents)}</td>
                        <td>{u.tier || "—"}</td>
                        <td>{u.last_order_at ? u.last_order_at.slice(0, 10) : "—"}</td>
                        <td>{u.churn ? "流失" : "—"}</td>
                        <td>{u.upgrade_candidate ? "可升级" : "—"}</td>
                        <td>{u.next_tier || "—"}</td>
                        <td className="num">{u.next_tier ? fmtMoney(u.remaining_cents) : "—"}</td>
                      </tr>
                    ))
                    : <tr><td colSpan="8"><div className="empty">暂无会员数据</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* R5-3 数据大屏: fullscreen BI layout — big KPI cards
              (same scope as GET /api/admin/stats: 已付 = paid /
              completed) + the 30-day series via the existing
              TrendChart + horizontal bars for the top shows and top
              venues. Export: XLSX is a real .xlsx built by the
              server (no new dependency); CSV carries the BOM.
              PDF honesty boundary: the server does NOT generate PDF
              files this wave (no CJK font dependency) — the button
              below prints via the browser ("浏览器打印另存为 PDF"),
              it never claims the server produced a PDF file. */}
          <section className={"view" + (view === "bi" ? " on" : "") + (biFullscreen ? " bi-fullscreen" : "")} id="view-bi">
            <div className="note">关键指标与 admin 统计同口径（已付 = 已支付 / 已完成）；近 30 天按日（北京时间）统计已付订单。PDF 不由服务端生成：点“打印/导出 PDF”后用浏览器打印另存为 PDF。</div>
            <div className="search-row bi-actions">
              <button type="button" className="btn-export" disabled={biBusy} onClick={() => doExportBi("xlsx")}>{biBusy ? "导出中…" : "导出 Excel（.xlsx）"}</button>
              <button type="button" className="btn-export" disabled={biBusy} onClick={() => doExportBi("csv")}>{biBusy ? "导出中…" : "导出 CSV"}</button>
              <button type="button" className="btn-export" onClick={doPrintBi}>打印 / 导出 PDF（浏览器打印另存为 PDF）</button>
              <button type="button" className="btn-export" onClick={() => setBiFullscreen(function (f) { return !f; })}>{biFullscreen ? "退出全屏" : "全屏"}</button>
              <button type="button" className="btn-export" onClick={loadBi}>刷新</button>
            </div>
            {biData ? (
              <>
                <div className="stats bi-stats">
                  <div className="stat hero"><b>{fmtMoney(biData.kpis.revenue_cents)}</b><span>总收入（已付）</span></div>
                  <div className="stat"><b>{biData.kpis.users}</b><span>用户数</span></div>
                  <div className="stat"><b>{biData.kpis.orders}</b><span>订单数</span></div>
                  <div className="stat"><b>{biData.kpis.resources}</b><span>资源数</span></div>
                  <div className="stat"><b>{biData.kpis.demands}</b><span>需求数</span></div>
                  <div className="stat"><b>{biData.kpis.today_orders}</b><span>今日订单（已付）</span></div>
                  <div className="stat"><b>{fmtMoney(biData.kpis.today_revenue_cents)}</b><span>今日收入（已付）</span></div>
                  <div className="stat"><b>{(biData.kpis.paid_rate * 100).toFixed(1)}%</b><span>已付订单占比</span></div>
                </div>
                <h2>近 30 天趋势</h2>
                <TrendChart series={biData.series.map(function (s) { return { date: s.date, label: s.date.slice(5), amount: s.revenue_cents, count: s.orders }; })} period="day" />
                <h2>热门演出</h2>
                {biData.top_shows.length ? (
                  <div className="bi-bars">
                    {biData.top_shows.map(function (s) {
                      const max = Math.max.apply(null, biData.top_shows.map(function (x) { return x.revenue_cents; }).concat([1]));
                      return (
                        <div className="bi-bar-row" key={s.show_id}>
                          <span className="bi-bar-label">{s.title}</span>
                          <span className="bi-bar-track"><span className="bi-bar-fill" style={{ width: Math.max(1, Math.round((s.revenue_cents / max) * 100)) + "%" }} /></span>
                          <span className="bi-bar-val">{fmtMoney(s.revenue_cents)} · {s.orders}单</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="empty">暂无已付演出收入</div>}
                <h2>热门场馆</h2>
                {biData.top_venues.length ? (
                  <div className="bi-bars">
                    {biData.top_venues.map(function (v) {
                      const max = Math.max.apply(null, biData.top_venues.map(function (x) { return x.revenue_cents; }).concat([1]));
                      return (
                        <div className="bi-bar-row" key={v.venue_id}>
                          <span className="bi-bar-label">{v.name}</span>
                          <span className="bi-bar-track"><span className="bi-bar-fill" style={{ width: Math.max(1, Math.round((v.revenue_cents / max) * 100)) + "%" }} /></span>
                          <span className="bi-bar-val">{fmtMoney(v.revenue_cents)} · {v.orders}单</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="empty">暂无已付场馆收入</div>}
              </>
            ) : <div className="empty">加载中…</div>}
          </section>

          {/* R5-5 财务账本: order_income / refund_out / topup_in /
              card_refund rows, written in the same transaction as
              the money movement (pay / approveRefund / topup). The
              ledger-vs-orders invariant is income + refunds ==
              SUM(amount) over paid/completed orders (refund rows are
              negative; card_refund is positive — money back onto the
              card, same direction as the stored_value_ledger refund
              row). Reconcile is manual (one row at a time); the CSV
              export carries the BOM like the orders CSV. */}
          <section className={"view" + (view === "financeledger" ? " on" : "")} id="view-financeledger">
            <div className="note">账本与订单同事务记账：支付记订单收入、批准退款记退款支出（退回文惠卡的部分另记一行正数）、充值记储值充值。收入合计 + 退款合计 = 仍为已支付/已完成订单的金额合计。</div>
            <div className="search-row">
              <select className="tag-filter" aria-label="按类型筛选" value={ledgerKind} onChange={(e) => setLedgerKind(e.target.value)}>
                <option value="">全部类型</option>
                <option value="order_income">订单收入</option>
                <option value="refund_out">退款支出</option>
                <option value="topup_in">储值充值</option>
                <option value="card_refund">退回文惠卡</option>
              </select>
              <select className="tag-filter" aria-label="按对账状态筛选" value={ledgerReconciled} onChange={(e) => setLedgerReconciled(e.target.value)}>
                <option value="">全部对账状态</option>
                <option value="0">未对账</option>
                <option value="1">已对账</option>
              </select>
              <button type="button" className="btn-export" onClick={doExportLedger}>导出 CSV</button>
              <button type="button" className="btn-export" onClick={loadFinanceLedger}>刷新</button>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">流水号</th><th scope="col">时间</th><th scope="col">类型</th><th scope="col" className="num">金额</th><th scope="col">订单号</th><th scope="col">备注</th><th scope="col">对账</th><th scope="col">操作</th></tr></thead>
                <tbody>
                  {financeLedger.length
                    ? financeLedger.map((l) => (
                      <tr key={l.id}>
                        <td>{l.id}</td>
                        <td>{String(l.created_at || "").slice(0, 16)}</td>
                        <td>{l.kind_label || l.kind}</td>
                        <td className="num">{fmtMoney(l.amount_cents)}</td>
                        <td>{l.order_code || "—"}</td>
                        <td>{l.note || ""}</td>
                        <td>{l.reconciled ? "已对账" : "未对账"}</td>
                        <td>
                          {l.reconciled ? "—" : (
                            <button type="button" className="btn-view" disabled={ledgerBusyId !== null} onClick={() => doReconcileLedger(l.id)}>{ledgerBusyId === l.id ? "处理中…" : "对账"}</button>
                          )}
                        </td>
                      </tr>
                    ))
                    : <tr><td colSpan="8"><div className="empty">暂无账本记录</div></td></tr>}
                </tbody>
              </table>
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
