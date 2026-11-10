/* Guiyan user dashboard — my profile, orders, favorites, demands.
   Uses only existing customer endpoints (GET /api/orders, /api/favorites,
   /api/demands; POST /api/orders/:id/<action>). Order actions follow the
   same state machine as the SPA's My Tickets drawer. */
var usrOrders=[], usrFavs=[], usrDemands=[];

function usrActs(o){
  var acts="";
  if(o.status==="pending") acts='<button type="button" class="mini" data-act="confirm" data-id="'+o.id+'">'+esc(t("actConfirm"))+'</button><button type="button" class="mini" data-act="cancel" data-id="'+o.id+'">'+esc(t("actCancel"))+'</button>';
  if(o.status==="confirmed") acts='<button type="button" class="mini red" data-act="pay" data-id="'+o.id+'">'+esc(fmt(t("actPay"),{amt:fmtMoney(o.amount)}))+'</button><button type="button" class="mini" data-act="cancel" data-id="'+o.id+'">'+esc(t("actCancel"))+'</button>';
  if(o.status==="paid") acts='<button type="button" class="mini red" data-act="complete" data-id="'+o.id+'">'+esc(t("actComplete"))+'</button><button type="button" class="mini" data-act="refund" data-id="'+o.id+'">'+esc(t("actRefund"))+'</button>';
  if(o.status==="completed") acts='<span style="font-size:12.5px;color:var(--ink2)">'+esc(t("doneNote"))+'</span>';
  return acts;
}
function usrOrderRow(o){
  return '<div class="order"><h4>'+esc(o.resource_name||"")+'</h4><span class="code">'+esc(o.code)+' · '+esc(o.booking_date||"")+' · '+o.quantity+' × '+esc(unitName(o.unit||""))+' · '+fmtMoney(o.amount)+'</span>'
    +'<div class="row">'+statusPill(o.status)+'<span class="db-actions">'+usrActs(o)+'</span></div></div>';
}
function usrRows(){
  var u=currentUser();
  if(u){
    var prof=[["lblName",u.name||""],["lblUsername",u.username||""],["lblCity",u.city||"—"],["lblAge",(u.age==null?"—":u.age)],["lblChannel",u.channel||"—"],["lblPref",u.preference||"—"],["lblVerified",u.verified?t("verifiedYes"):t("verifiedNo")]];
    $("profileRows").innerHTML=prof.map(function(r){
      return '<div class="row"><span class="k">'+esc(t(r[0]))+'</span><span class="v">'+esc(String(r[1]))+'</span></div>';
    }).join("");
  }
  $("myStatOrders").textContent=usrOrders.length;
  $("myStatFavs").textContent=usrFavs.length;
  $("myStatDemands").textContent=usrDemands.length;
  $("ordersList").innerHTML=usrOrders.length
    ? usrOrders.map(usrOrderRow).join("")
    : '<div class="db-empty">'+esc(t("emptyOrders"))+'</div>';
  $("favsBody").innerHTML=usrFavs.length?usrFavs.map(function(r){
    return "<tr><td>"+esc(r.name)+"</td><td>"+esc(catName(r.category))+"</td><td>"+esc(r.city)+"</td><td class=\"num\">"+fmtMoney(r.price)+"</td><td><a href=\"index.html#catalog\">"+esc(t("goCatalog"))+"</a></td></tr>";
  }).join(""):"<tr><td colspan=\"5\"><div class=\"db-empty\">"+esc(t("emptyFavs"))+"</div></td></tr>";
  $("demsBody").innerHTML=usrDemands.length?usrDemands.map(function(d){
    return "<tr><td>"+esc(d.title)+"</td><td>"+esc(catName(d.category))+"</td><td class=\"num\">"+fmtMoney(d.budget)+"</td><td>"+esc(d.city)+"</td><td>"+esc(d.status||"")+"</td></tr>";
  }).join(""):"<tr><td colspan=\"5\"><div class=\"db-empty\">"+esc(t("emptyMyDemands"))+"</div></td></tr>";
}
function usrShow(id){
  ["usrGate","usrMain"].forEach(function(x){ var el=$(x); if(el) el.style.display=(x===id?"":"none"); });
}
function usrLoadOrders(){
  return apiGet("/api/orders").then(function(d){ usrOrders=d.orders||[]; });
}
function usrLoad(){
  var u=currentUser();
  if(!getToken()||!u){ usrShow("usrGate"); return; }
  Promise.all([usrLoadOrders(), apiGet("/api/favorites"), apiGet("/api/demands")]).then(function(res){
    usrFavs=res[1].favorites||[];
    var mine=(res[2].demands||[]).filter(function(d){ return d.user_id===u.id; });
    usrDemands=mine;
    usrShow("usrMain");
    usrRows();
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); updateAuthUI(); usrShow("usrGate"); return; }
    toast(t("loadErr"));
  });
}
function usrOrderAction(b){
  var act=b.dataset.act, id=b.dataset.id;
  apiPost("/api/orders/"+encodeURIComponent(id)+"/"+act,{}).then(function(){
    toast(t("statusToast"));
    usrLoadOrders().then(usrRows);
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); updateAuthUI(); usrShow("usrGate"); return; }
    if(e&&e.data&&e.data.error) toast(e.data.error);
    usrLoadOrders().then(usrRows);
  });
}
function usrBoot(){
  applyStatic();
  fillFootCats();
  bindDashAuth(usrLoad);
  var g=$("gateLoginBtn"); if(g) g.addEventListener("click",openLogin);
  var ol=$("ordersList");
  if(ol) ol.addEventListener("click",function(e){
    var b=e.target.closest("[data-act]"); if(!b) return;
    usrOrderAction(b);
  });
  usrLoad();
}
usrBoot();
