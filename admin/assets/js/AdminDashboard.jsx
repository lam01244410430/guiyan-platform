/* Guiyan admin dashboard (React) — port of admin/assets/js/dashboard.js +
   admin/dashboard.html. Read-only: loads /api/admin/stats,
   /api/admin/orders, /api/admin/users and /api/admin/demands (admin role
   only) plus public /api/resources. Demands come from the admin endpoint
   because the public list hides pending ones; the stat card counts all
   demands. No edit / approve / delete actions exist here by design. */
import { useEffect, useRef, useState } from "react";
import {
  apiGet, apiPost, clearToken, currentUser, getToken, fmtMoney, STATUS,
} from "./adminApi.js";
import iconDashboard from "../icons/ui-layout-dashboard.svg";
import iconReceipt from "../icons/ui-receipt.svg";
import iconUsers from "../icons/ui-users.svg";
import iconLayers from "../icons/ui-layers.svg";
import iconClipboard from "../icons/ui-clipboard-list.svg";

/* Order status breakdown: one row per status — label + bar sized to the
   real share + count. All six canonical statuses always render (a status
   missing from orders_by_status counts as 0); the total comes from the
   same /api/admin/stats response. No invented figures. */
const ORDER_STATUS = ["pending", "confirmed", "paid", "completed", "cancelled", "refunded"];
const VIEWS = [
  { id: "overview", label: "总览", icon: iconDashboard, iconName: "ui:layout-dashboard" },
  { id: "orders", label: "订单", icon: iconReceipt, iconName: "ui:receipt" },
  { id: "users", label: "用户", icon: iconUsers, iconName: "ui:users" },
  { id: "resources", label: "资源", icon: iconLayers, iconName: "ui:layers" },
  { id: "demands", label: "需求", icon: iconClipboard, iconName: "ui:clipboard-list" },
];
const FILTERS = [
  ["all", "全部"], ["pending", "待确认"], ["confirmed", "已确认"], ["paid", "已支付"],
  ["completed", "已完成"], ["cancelled", "已取消"], ["refunded", "已退款"],
];

function OrderRow({ o }) {
  return (
    <tr>
      <td>{o.code}</td><td>{o.user_name || ""}</td><td>{o.resource_name || ""}</td>
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
  const [whoName, setWhoName] = useState("管理员");
  const [forbidden, setForbidden] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef(null);

  function toast(msg) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
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

  function doLogout() {
    apiPost("/api/auth/logout", {}).catch(function () {});
    clearToken();
    location.href = "/admin/index.html";
  }

  const titles = {
    overview: ["总览", "运营数据一览"],
    orders: ["全部订单", "共 " + orders.length + " 单 · 仅查看"],
    users: ["全部用户", "共 " + users.length + " 人"],
    resources: ["资源总览", "共 " + resources.length + " 项"],
    demands: ["需求总览", "共 " + demands.length + " 条"],
  };
  const by = (stats && stats.orders_by_status) || {};
  const total = ORDER_STATUS.reduce(function (n, k) { return n + (by[k] || 0); }, 0);
  const filteredOrders = filter === "all" ? orders : orders.filter(function (o) { return o.status === filter; });

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
        <aside className="sidebar">
          <div className="mark">桂演<small>Admin Console</small></div>
          <nav>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" data-view={v.id} className={view === v.id ? "on" : ""}
                aria-current={view === v.id ? "page" : undefined} onClick={() => setView(v.id)}>
                <img className="ic" data-icon={v.iconName} src={v.icon} alt="" width="18" height="18" />
                {v.label}
              </button>
            ))}
          </nav>
          <div className="who">
            <div><div className="nm" id="whoName">{whoName}</div><div className="rl">管理员</div></div>
            <button type="button" id="logoutBtn" onClick={doLogout}>退出</button>
          </div>
        </aside>
        <main className="main" id="top" tabIndex={-1}>
          <div className="main-head">
            <h1><span id="pageTitle">{titles[view][0]}</span><span className="sub" id="pageSub">{titles[view][1]}</span></h1>
            <span className="badge">仅查看 · 只读</span>
          </div>

          <section className={"view" + (view === "overview" ? " on" : "")} id="view-overview">
            <div className="stats">
              <div className="stat hero"><span>总收入</span><b id="statRevenue">{stats ? fmtMoney(stats.revenue_cents) : "¥0"}</b></div>
              <div className="stat"><span>用户</span><b id="statUsers">{stats ? stats.users : 0}</b></div>
              <div className="stat"><span>订单</span><b id="statOrders">{stats ? stats.orders : 0}</b></div>
              <div className="stat"><span>资源</span><b id="statResources">{stats ? stats.resources : 0}</b></div>
              <div className="stat"><span>需求</span><b id="statDemands">{stats ? stats.demands : 0}</b></div>
            </div>
            <div className="note">管理后台仅查看：订单、用户、资源、需求均不可在此修改。支付与 AI 均为模拟。</div>
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
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th scope="col">订单号</th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num">金额</th><th scope="col">预订日期</th><th scope="col">状态</th></tr></thead>
                  <tbody id="recentBody">
                    {orders.length ? orders.slice(0, 8).map((o) => <OrderRow key={o.code} o={o} />)
                      : <tr><td colSpan="6"><div className="empty">暂无订单</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className={"view" + (view === "orders" ? " on" : "")} id="view-orders">
            <div className="chips">
              {FILTERS.map(([f, label]) => (
                <button key={f} type="button" data-f={f} className={filter === f ? "on" : ""}
                  aria-pressed={filter === f ? "true" : "false"} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">订单号</th><th scope="col">用户</th><th scope="col">资源</th><th scope="col" className="num">金额</th><th scope="col">预订日期</th><th scope="col">状态</th></tr></thead>
                <tbody id="ordersBody">
                  {filteredOrders.length ? filteredOrders.map((o) => <OrderRow key={o.code} o={o} />)
                    : <tr><td colSpan="6"><div className="empty">暂无订单</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "users" ? " on" : "")} id="view-users">
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">姓名</th><th scope="col">账号</th><th scope="col">角色</th><th scope="col">城市</th><th scope="col">渠道</th><th scope="col">认证</th></tr></thead>
                <tbody id="usersBody">
                  {users.length ? users.map((usr) => (
                    <tr key={usr.username}>
                      <td>{usr.name || ""}</td><td>{usr.username}</td><td>{usr.role}</td>
                      <td>{usr.city || ""}</td><td>{usr.channel || ""}</td><td>{usr.verified ? "已认证" : "未认证"}</td>
                    </tr>
                  )) : <tr><td colSpan="6"><div className="empty">暂无用户</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "resources" ? " on" : "")} id="view-resources">
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">名称</th><th scope="col">分类</th><th scope="col">城市</th><th scope="col" className="num">价格</th><th scope="col" className="num">库存</th></tr></thead>
                <tbody id="resBody">
                  {resources.length ? resources.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td><td>{r.category}</td><td>{r.city}</td>
                      <td className="num">{fmtMoney(r.price)}</td><td className="num">{r.stock}</td>
                    </tr>
                  )) : <tr><td colSpan="5"><div className="empty">暂无资源</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={"view" + (view === "demands" ? " on" : "")} id="view-demands">
            <div className="tbl-wrap">
              <table>
                <thead><tr><th scope="col">标题</th><th scope="col">分类</th><th scope="col" className="num">预算</th><th scope="col">城市</th><th scope="col">发布人</th><th scope="col">状态</th></tr></thead>
                <tbody id="demBody">
                  {demands.length ? demands.map((d) => (
                    <tr key={d.id}>
                      <td>{d.title}</td><td>{d.category}</td>
                      <td className="num">{fmtMoney(d.budget)}</td><td>{d.city}</td><td>{d.user_name || ""}</td>
                      <td>{d.status === "approved" ? "已通过" : d.status === "pending" ? "待审核" : d.status === "rejected" ? "已拒绝" : (d.status || "")}</td>
                    </tr>
                  )) : <tr><td colSpan="6"><div className="empty">暂无需求</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      <div className={"toast" + (toastMsg ? " show" : "")} id="toast" role="status">{toastMsg}</div>
    </>
  );
}
