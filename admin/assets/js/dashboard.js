/* Guiyan admin dashboard — read-only.
   Loads /api/admin/stats, /api/admin/orders, /api/admin/users and
   /api/admin/demands (admin role only) plus public /api/resources.
   Demands come from the admin endpoint because the public list hides
   pending ones; the stat card counts all demands. No edit / approve /
   delete actions exist here by design. */
var D={stats:null,orders:[],users:[],resources:[],demands:[],filter:"all"};

function showView(name){
  document.querySelectorAll(".sidebar nav button").forEach(function(b){
    b.classList.toggle("on",b.dataset.view===name);
  });
  document.querySelectorAll(".view").forEach(function(v){
    v.classList.toggle("on",v.id==="view-"+name);
  });
  var titles={overview:["总览","运营数据一览"],orders:["全部订单","共 "+D.orders.length+" 单 · 仅查看"],users:["全部用户","共 "+D.users.length+" 人"],resources:["资源总览","共 "+D.resources.length+" 项"],demands:["需求总览","共 "+D.demands.length+" 条"]};
  $("pageTitle").textContent=titles[name][0];
  $("pageSub").textContent=titles[name][1];
}
function renderStats(){
  var s=D.stats;
  $("statUsers").textContent=s.users;
  $("statOrders").textContent=s.orders;
  $("statRevenue").textContent=fmtMoney(s.revenue_cents);
  $("statResources").textContent=s.resources;
  $("statDemands").textContent=s.demands;
  var by=s.orders_by_status||{};
  $("orderBreakdown").innerHTML=["pending","confirmed","paid","completed","cancelled","refunded"]
    .filter(function(k){ return by[k]; })
    .map(function(k){ return statusPill(k)+" × "+by[k]; }).join(" ");
}
function orderRow(o){
  return "<tr><td>"+esc(o.code)+"</td><td>"+esc(o.user_name||"")+"</td><td>"+esc(o.resource_name||"")+"</td><td class=\"num\">"+fmtMoney(o.amount)+"</td><td>"+esc(o.booking_date||"")+"</td><td>"+statusPill(o.status)+"</td></tr>";
}
function renderOrders(){
  var list=D.filter==="all"?D.orders:D.orders.filter(function(o){ return o.status===D.filter; });
  $("ordersBody").innerHTML=list.length?list.map(orderRow).join(""):"<tr><td colspan=\"6\"><div class=\"empty\">暂无订单</div></td></tr>";
  document.querySelectorAll(".chips button").forEach(function(b){
    b.classList.toggle("on",b.dataset.f===D.filter);
  });
}
function renderTables(){
  $("recentBody").innerHTML=D.orders.length?D.orders.slice(0,8).map(orderRow).join(""):"<tr><td colspan=\"6\"><div class=\"empty\">暂无订单</div></td></tr>";
  $("usersBody").innerHTML=D.users.length?D.users.map(function(u){
    return "<tr><td>"+esc(u.name||"")+"</td><td>"+esc(u.username)+"</td><td>"+esc(u.role)+"</td><td>"+esc(u.city||"")+"</td><td>"+esc(u.channel||"")+"</td><td>"+(u.verified?"已认证":"未认证")+"</td></tr>";
  }).join(""):"<tr><td colspan=\"6\"><div class=\"empty\">暂无用户</div></td></tr>";
  $("resBody").innerHTML=D.resources.length?D.resources.map(function(r){
    return "<tr><td>"+esc(r.name)+"</td><td>"+esc(r.category)+"</td><td>"+esc(r.city)+"</td><td class=\"num\">"+fmtMoney(r.price)+"</td><td class=\"num\">"+r.stock+"</td></tr>";
  }).join(""):"<tr><td colspan=\"5\"><div class=\"empty\">暂无资源</div></td></tr>";
  $("demBody").innerHTML=D.demands.length?D.demands.map(function(d){
    return "<tr><td>"+esc(d.title)+"</td><td>"+esc(d.category)+"</td><td class=\"num\">"+fmtMoney(d.budget)+"</td><td>"+esc(d.city)+"</td><td>"+esc(d.user_name||"")+"</td><td>"+(d.status==="approved"?"已通过":d.status==="pending"?"待审核":d.status==="rejected"?"已拒绝":esc(d.status||""))+"</td></tr>";
  }).join(""):"<tr><td colspan=\"6\"><div class=\"empty\">暂无需求</div></td></tr>";
}
function showForbidden(){
  $("app").style.display="none";
  $("forbidden").style.display="block";
}
function boot(){
  var u=currentUser();
  if(!getToken()||!u){ location.href="/admin/index.html"; return; }
  $("whoName").textContent=u.name||u.username||"管理员";
  document.querySelectorAll(".sidebar nav button").forEach(function(b){
    b.addEventListener("click",function(){ showView(b.dataset.view); });
  });
  document.querySelectorAll(".chips button").forEach(function(b){
    b.addEventListener("click",function(){ D.filter=b.dataset.f; renderOrders(); });
  });
  $("logoutBtn").addEventListener("click",function(){
    apiPost("/api/auth/logout",{}).catch(function(){});
    clearToken();
    location.href="/admin/index.html";
  });
  $("backLoginBtn").addEventListener("click",function(){
    clearToken();
    location.href="/admin/index.html";
  });
  Promise.all([
    apiGet("/api/admin/stats"), apiGet("/api/admin/orders"), apiGet("/api/admin/users"),
    apiGet("/api/resources"), apiGet("/api/admin/demands")
  ]).then(function(res){
    D.stats=res[0];
    D.orders=res[1].orders||[];
    D.users=res[2].users||[];
    D.resources=res[3].resources||[];
    D.demands=res[4].demands||[];
    renderStats();
    renderOrders();
    renderTables();
    showView("overview");
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); location.href="/admin/index.html"; return; }
    if(e&&e.status===403){ showForbidden(); return; }
    toast("加载失败，请稍后重试");
  });
}
boot();
