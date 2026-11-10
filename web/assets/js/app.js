
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
/* ============ Guiyan PostgreSQL API layer (graceful offline fallback) ============ */
/* Contract: same-origin by default; override via window.GUIYAN_API_BASE or
   ?api=<origin>. API paths below include the /api prefix (same convention
   as miniprogram/utils/api.js); the server only routes /api/* to the API.
   All money is INTEGER CENTS on the wire; embedded RES rows stay in
   YUAN. If the API is unreachable, apiAvailable stays false and every feature
   silently keeps its original local in-memory behaviour. No error is ever shown
   for an unreachable API (the login form is the one exception: a user-initiated
   sign-in shows its failure inline in the dialog). */
var apiAvailable=false;
var apiUser=null;
var APIRES={};    /* RES index -> {id, stock, capacity, rating, review_count, status, tags} */
var APIID2IDX={}; /* API resource id -> RES index */
var APICAT={};    /* API category Chinese name -> CATS id */
function apiBase(){
  var b="";
  try{ var m=/[?&]api=([^&]+)/.exec(location.search); if(m) b=decodeURIComponent(m[1]); }catch(e){}
  if(!b && window.GUIYAN_API_BASE) b=window.GUIYAN_API_BASE;
  return String(b||"").replace(/\/+$/,"");
}
function getToken(){ try{ return sessionStorage.getItem("guiyan-token")||""; }catch(e){ return ""; } }
function setToken(token,user){
  apiUser=user||null;
  try{
    if(token){ sessionStorage.setItem("guiyan-token",token); sessionStorage.setItem("guiyan-user",JSON.stringify(user||{})); }
    else { sessionStorage.removeItem("guiyan-token"); sessionStorage.removeItem("guiyan-user"); }
  }catch(e){}
}
function clearToken(){ setToken("",null); }
function apiFetch(path,opts){
  opts=opts||{};
  var ctrl=null;
  try{ ctrl=new AbortController(); }catch(e){ ctrl=null; }
  var timer=null;
  if(ctrl){ timer=setTimeout(function(){ try{ ctrl.abort(); }catch(e){} },5000); }
  var headers={"Content-Type":"application/json"};
  var tk=getToken(); if(tk) headers.Authorization="Bearer "+tk;
  return fetch(apiBase()+path,{method:opts.method||"GET",headers:headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:ctrl?ctrl.signal:undefined})
    .then(function(res){
      if(timer) clearTimeout(timer);
      return res.text().then(function(txt){
        var data=null; try{ data=txt?JSON.parse(txt):null; }catch(e){ data=null; }
        if(!res.ok){ var err=new Error((data&&data.error)||("HTTP "+res.status)); err.status=res.status; err.data=data; throw err; }
        apiAvailable=true; return data;
      });
    })
    .catch(function(e){
      if(timer) clearTimeout(timer);
      if(e&&e.status){ apiAvailable=true; } /* HTTP answer = API reachable, even on 4xx/5xx */
      else { apiAvailable=false; }           /* network failure / timeout / abort = offline */
      throw e;
    });
}
function apiGet(path){ return apiFetch(path,{method:"GET"}); }
function apiPost(path,body){ return apiFetch(path,{method:"POST",body:body}); }
function apiDel(path){ return apiFetch(path,{method:"DELETE"}); }
function apiCatId(name){
  if(!name) return "show";
  for(var i=0;i<CATS.length;i++){ if(CATS[i][0]===name) return name; }
  if(APICAT[name]) return APICAT[name];
  for(var j=0;j<CATS.length;j++){ if(CATS[j][1]===name) return CATS[j][0]; }
  return "show";
}
function mergeCategories(data){
  if(!data||!data.categories) return;
  data.categories.forEach(function(c){
    if(!c||!c.name) return;
    for(var i=0;i<CATS.length;i++){ if(CATS[i][1]===c.name) APICAT[c.name]=CATS[i][0]; }
  });
}
function mergeResources(data){
  if(!data||!data.resources) return;
  data.resources.forEach(function(a){
    if(!a||!a.name) return;
    var idx=-1;
    for(var i=0;i<RES.length;i++){ if(RES[i][0]===a.name){ idx=i; break; } }
    var priceYuan=(typeof a.price==="number")?a.price/100:(idx>=0?RES[idx][3]:0);
    if(idx<0){
      var dsc=a.description||a.name;
      RES.push([a.name,apiCatId(a.category),a.city||"南宁",priceYuan,a.unit||"张",(typeof a.views==="number"?a.views:0),[dsc,dsc,dsc]]);
      idx=RES.length-1;
    }else{
      RES[idx][3]=priceYuan;
      if(typeof a.views==="number") RES[idx][5]=a.views;
      /* embedded trilingual desc, category, city and unit are kept */
    }
    APIRES[idx]={id:a.id,stock:a.stock,capacity:a.capacity,rating:a.rating,review_count:a.review_count,status:a.status,tags:a.tags||[]};
    if(a.id!=null) APIID2IDX[a.id]=idx;
  });
}
function mergeDemands(data){
  if(!data||!data.demands) return;
  data.demands.forEach(function(a){
    if(!a||!a.title) return;
    var budgetYuan=(typeof a.budget==="number")?a.budget/100:0;
    var catId=apiCatId(a.category);
    var idx=-1;
    for(var i=0;i<DEMANDS.length;i++){ if(DEMANDS[i][0][0]===a.title){ idx=i; break; } }
    if(idx<0){
      var dsc=a.description||a.title;
      DEMANDS.push([[a.title,a.title,a.title],catId,budgetYuan,a.city||"南宁",[dsc,dsc,dsc]]);
    }else{
      DEMANDS[idx][1]=catId; DEMANDS[idx][2]=budgetYuan;
      if(a.city) DEMANDS[idx][3]=a.city;
      if(a.description) DEMANDS[idx][4][1]=a.description; /* zh slot; vi/en stay embedded */
    }
  });
}
function mapApiOrder(o){
  if(!o) return null;
  var idx=-1;
  if(o.resource_id!=null&&APIID2IDX[o.resource_id]!=null) idx=APIID2IDX[o.resource_id];
  if(idx<0){ for(var i=0;i<RES.length;i++){ if(RES[i][0]===o.resource_name){ idx=i; break; } } }
  if(idx<0) return null;
  var st=o.status==="refund_requested"?"refunded":o.status;
  if(!STATUS[st]) st="pending";
  return {code:o.code||("GY"+o.id),idx:idx,qty:o.quantity||1,date:String(o.booking_date||"").slice(0,10),total:(o.amount||0)/100,status:st,apiId:o.id};
}
function refreshOrdersApi(){
  if(!apiAvailable||!getToken()) return Promise.resolve(false);
  return apiGet("/api/orders").then(function(d){
    if(!d||!d.orders) return false;
    var mapped=[];
    d.orders.forEach(function(o){ var m=mapApiOrder(o); if(m) mapped.push(m); });
    state.orders=mapped; renderOrders(); renderWx(); return true;
  }).catch(function(){ return false; });
}
function loadFavoritesApi(){
  if(!apiAvailable||!getToken()) return Promise.resolve(false);
  return apiGet("/api/favorites").then(function(d){
    if(!d||!d.favorites) return false;
    d.favorites.forEach(function(r){
      var idx=-1;
      if(r.id!=null&&APIID2IDX[r.id]!=null) idx=APIID2IDX[r.id];
      if(idx<0){ for(var i=0;i<RES.length;i++){ if(RES[i][0]===r.name){ idx=i; break; } } }
      if(idx>=0) state.favs[idx]=true;
    });
    renderGrid(); return true;
  }).catch(function(){ return false; });
}
function toggleFav(i){
  var rid=APIRES[i]&&APIRES[i].id;
  function done(){ renderGrid(); toast(state.favs[i]?t("favAdd"):t("favRemove")); }
  /* Favorites live on the user account: login is required to save.
     No local fallback — the heart only changes when the server confirms. */
  if(!getToken()){ toast(t("favLogin")); openLogin(); return Promise.resolve(); }
  if(rid==null){ toast(t("loadErr")); return Promise.resolve(); }
  return apiPost("/api/favorites",{resourceId:rid}).then(function(d){
    if(d&&typeof d.favorite==="boolean") state.favs[i]=d.favorite; else state.favs[i]=!state.favs[i];
    done();
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); updateAuthUI(); openLogin(); return; }
    toast((e&&e.data&&e.data.error)||t("loadErr"));
  });
}
function bookResource(i,qty,date){
  var r=RES[i];
  function localBook(){
    var code="GY2026"+String(state.seq++).padStart(6,"0");
    state.orders.unshift({code:code,idx:i,qty:qty,date:date,total:r[3]*qty,status:"pending"});
    closeSheet(); renderOrders(); renderWx(); toast(fmt(t("orderCreated"),{code:code})); openDrawer();
  }
  var rid=APIRES[i]&&APIRES[i].id;
  if(!apiAvailable||!getToken()||rid==null){ localBook(); return; }
  apiPost("/api/orders",{resourceId:rid,quantity:qty,booking_date:date,channel:"web"}).then(function(d){
    if(d&&d.ok){
      var code=d.code||("GY2026"+String(state.seq++).padStart(6,"0"));
      var total=(typeof d.amount==="number")?d.amount/100:r[3]*qty;
      state.orders.unshift({code:code,idx:i,qty:qty,date:date,total:total,status:"pending",apiId:d.id});
      closeSheet(); renderOrders(); renderWx(); toast(fmt(t("orderCreated"),{code:code})); openDrawer();
    }else{ localBook(); }
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); updateAuthUI(); openLogin(); }
    localBook();
  });
}
function handleOrderAction(b){
  var o=state.orders[+b.dataset.oi]; if(!o) return;
  var map={confirm:"confirmed",pay:"paid",complete:"completed",cancel:"cancelled",refund:"refunded"};
  var act=b.dataset.act; if(!map[act]) return;
  if(o.apiId!=null&&apiAvailable&&getToken()){
    var ep={confirm:"confirm",pay:"pay",complete:"complete",cancel:"cancel",refund:"refund"}[act];
    apiPost("/api/orders/"+encodeURIComponent(o.apiId)+"/"+ep,{}).then(function(){
      o.status=map[act]; renderOrders(); renderWx();
      toast(fmt(t("statusToast"),{code:o.code,st:t(STATUS[o.status])}));
      refreshOrdersApi();
    }).catch(function(e){
      if(e&&e.status===401){ clearToken(); updateAuthUI(); openLogin(); return; }
      if(e&&e.data&&e.data.error) toast(e.data.error);
      refreshOrdersApi();
    });
    return;
  }
  o.status=map[act]; renderOrders(); renderWx();
  toast(fmt(t("statusToast"),{code:o.code,st:t(STATUS[o.status])}));
}
function askBotApi(q){
  if(!apiAvailable){ addMsg(botAnswer(q),false); return; }
  apiGet("/api/assistant?q="+encodeURIComponent(q)).then(function(d){
    if(d&&d.answer) addMsg(d.answer,false); else addMsg(botAnswer(q),false);
  }).catch(function(){ addMsg(botAnswer(q),false); });
}
/* ---- auth UI ---- */
function updateAuthUI(){
  var lb=$("loginBtn"), st=$("loginState"), nm=$("loginName");
  if(!lb||!st) return;
  var logged=!!getToken();
  lb.style.display=logged?"none":"";
  st.style.display=logged?"":"none";
  if(logged&&nm) nm.textContent=fmt(t("loggedInAs"),{name:(apiUser&&(apiUser.name||apiUser.username))||"demo"});
}
function openLogin(){ var o=$("loginOverlay"); if(o){ o.classList.add("open"); var u=$("loginUser"); if(u) u.focus(); } }
function closeLogin(){ var o=$("loginOverlay"); if(o) o.classList.remove("open"); }
function doLogin(ev){
  if(ev) ev.preventDefault();
  var u=$("loginUser").value.trim()||"demo", pw=$("loginPass").value, err=$("loginErr");
  if(err) err.textContent="";
  apiPost("/api/auth/login",{username:u,password:pw}).then(function(d){
    if(d&&d.token){ setToken(d.token,d.user||{username:u,name:u}); apiAvailable=true; updateAuthUI(); closeLogin(); loadFavoritesApi(); refreshOrdersApi(); }
    else if(err){ err.textContent=t("loginFailed"); }
  }).catch(function(e){
    if(err) err.textContent=(e&&e.data&&e.data.error)||t("loginFailed");
  });
}
function doLogout(){ clearToken(); updateAuthUI(); state.favs={}; renderGrid(); }
/* ---- post-demand UI (no posting form existed before; this is the new minimal one) ---- */
function openDemandDialog(){
  if(!getToken()){ openLogin(); return; }
  var o=$("demandOverlay"); if(o) o.classList.add("open");
}
function closeDemandDialog(){ var o=$("demandOverlay"); if(o) o.classList.remove("open"); }
function submitDemand(ev){
  if(ev) ev.preventDefault();
  var title=$("demTitle").value.trim(); if(!title) return;
  var cat=$("demCat").value, city=$("demCity").value;
  var by=parseFloat($("demBudget").value)||0;
  var desc=$("demDesc").value.trim();
  function localAdd(){
    DEMANDS.unshift([[title,title,title],cat,by,city,[desc,desc,desc]]);
    renderDemands(); renderWx(); closeDemandDialog();
  }
  if(!apiAvailable||!getToken()){ if(!getToken()){ closeDemandDialog(); openLogin(); return; } localAdd(); return; }
  apiPost("/api/demands",{title:title,category:catZh(cat),budget:Math.round(by*100),city:city,description:desc}).then(function(){
    localAdd();
  }).catch(function(e){
    if(e&&e.status===401){ clearToken(); updateAuthUI(); closeDemandDialog(); openLogin(); return; }
    localAdd();
  });
}
/* ---- boot ---- */
function loadApiData(){
  return apiGet("/api/health").then(function(){
    apiAvailable=true;
    return Promise.all([
      apiGet("/api/resources?sort=hot").catch(function(){ return null; }),
      apiGet("/api/categories").catch(function(){ return null; }),
      apiGet("/api/demands").catch(function(){ return null; })
    ]);
  }).then(function(arr){
    if(!arr) return false;
    mergeCategories(arr[1]); mergeResources(arr[0]); mergeDemands(arr[2]);
    renderAll();
    if(getToken()){ loadFavoritesApi(); refreshOrdersApi(); }
    return true;
  }).catch(function(){ return false; });
}
function bootApi(){
  try{
    var u=sessionStorage.getItem("guiyan-user");
    if(u) apiUser=JSON.parse(u);
  }catch(e){ apiUser=null; }
  updateAuthUI();
  loadApiData().catch(function(){ /* offline: embedded data stays exactly as-is */ });
}
function bindAuthUI(){
  var lb=$("loginBtn"); if(lb) lb.addEventListener("click",openLogin);
  var lo=$("logoutBtn"); if(lo) lo.addEventListener("click",doLogout);
  var lf=$("loginForm"); if(lf) lf.addEventListener("submit",doLogin);
  var lc=$("loginCancel"); if(lc) lc.addEventListener("click",closeLogin);
  var lov=$("loginOverlay"); if(lov) lov.addEventListener("click",function(e){ if(e.target===this) closeLogin(); });
  var pd=$("postDemandBtn"); if(pd) pd.addEventListener("click",openDemandDialog);
  var df=$("demandForm"); if(df) df.addEventListener("submit",submitDemand);
  var dc=$("demandCancel"); if(dc) dc.addEventListener("click",closeDemandDialog);
  var dov=$("demandOverlay"); if(dov) dov.addEventListener("click",function(e){ if(e.target===this) closeDemandDialog(); });
  var catSel=$("demCat"), citySel=$("demCity");
  if(catSel) catSel.innerHTML=CATS.map(function(c){ return '<option value="'+c[0]+'">'+c[1]+'</option>'; }).join("");
  if(citySel) citySel.innerHTML=Object.keys(CITYN).map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join("");
}
bindAuthUI();

function desc(r){ return lang==="zh" ? r[6][1] : lang==="en" ? r[6][2] : r[6][0]; }
function toast(msg){ var tEl=$("toast"); tEl.textContent=msg; tEl.classList.add("show"); clearTimeout(tEl._h); tEl._h=setTimeout(function(){ tEl.classList.remove("show"); },2600); }
function catCount(id){ return RES.filter(function(r){ return r[1]===id; }).length; }

/* ---- language application ---- */
function applyStatic(){
  document.documentElement.lang = lang==="zh" ? "zh-CN" : lang;
  document.querySelectorAll("[data-i18n]").forEach(function(el){ var v=t(el.dataset.i18n); if(typeof v==="string") el.textContent=v; });
  document.querySelectorAll("[data-i18n-ph]").forEach(function(el){ el.placeholder=t(el.dataset.i18nPh); });
  var ls=$("langSel"); if(ls) ls.value=lang;
  if(window.innerWidth<560) $("heroQ").placeholder=t("heroSearchPhShort");
}
function renderHero(){
  var stats=[[RES.length,t("sRes")],[catCount("show"),t("sShow")],[catCount("venue"),t("sVenue")],[7,t("sCity")],[CATS.length,t("sCat")],[DEMANDS.length,t("sDem")]];
  $("heroStats").innerHTML = stats.map(function(s){ return "<div><b>"+s[0]+"</b><span>"+s[1]+"</span></div>"; }).join("");
  var tags=["刘三姐","壮锦","非遗体验","漓江","数字演出"];
  $("heroTags").innerHTML = tags.map(function(x){ return '<button type="button" data-q="'+x+'">'+x+'</button>'; }).join("");
}
function renderCats(){
  var max=1; CATS.forEach(function(c){ max=Math.max(max,catCount(c[0])); });
  $("catRail").innerHTML = CATS.map(function(c){
    var n=catCount(c[0]);
    return '<button type="button" class="cat" data-cat="'+c[0]+'"><b>'+n+'</b><span class="zh">'+c[1]+'</span><span>'+catName(c[0])+'</span><span class="bar"><i style="width:'+Math.round(n/max*100)+'%"></i></span></button>';
  }).join("");
  $("footCats").innerHTML = ["show","heritage","tourism","digital"].map(function(id){
    return '<li><a href="#catalog" data-goto-cat="'+id+'">'+catZh(id)+' · '+catName(id)+'</a></li>';
  }).join("");
  bindGotoCat();
}
function renderFilters(){
  var html='<button type="button" class="chip'+(state.cat==="all"?" on":"")+'" data-c="all">'+t("allChip")+' ('+RES.length+')</button>';
  html += CATS.map(function(c){ return '<button type="button" class="chip'+(state.cat===c[0]?" on":"")+'" data-c="'+c[0]+'">'+catZh(c[0])+' · '+catName(c[0])+'</button>'; }).join("");
  $("catFilters").innerHTML=html;
}
function renderCities(){
  var cities=[]; RES.forEach(function(r){ if(cities.indexOf(r[2])<0) cities.push(r[2]); });
  var cur=state.city;
  $("citySel").innerHTML='<option value="all">'+t("allCities")+'</option>'+cities.map(function(c){ return '<option value="'+c+'">'+cityName(c)+' '+c+'</option>'; }).join("");
  $("citySel").value=cur;
}
function filtered(){
  var list=RES.map(function(r,i){ return {r:r,i:i}; }).filter(function(o){
    var r=o.r;
    if(state.cat!=="all"&&r[1]!==state.cat) return false;
    if(state.city!=="all"&&r[2]!==state.city) return false;
    if(state.q){ var hay=(r[0]+r[2]+catZh(r[1])+desc(r)).toLowerCase(); if(hay.indexOf(state.q.toLowerCase())<0) return false; }
    return true;
  });
  if(state.pref){ list.sort(function(a,b){ return (b.r[1]===state.pref)-(a.r[1]===state.pref) || b.r[5]-a.r[5]; }); }
  else if(state.sort==="asc") list.sort(function(a,b){ return a.r[3]-b.r[3]; });
  else if(state.sort==="desc") list.sort(function(a,b){ return b.r[3]-a.r[3]; });
  else if(state.sort==="name") list.sort(function(a,b){ return a.r[0].localeCompare(b.r[0],"zh"); });
  else list.sort(function(a,b){ return b.r[5]-a.r[5]; });
  return list;
}
function renderGrid(){
  var list=filtered(), show=list.slice(0,state.shown);
  $("resultLine").textContent=fmt(t("results"),{a:show.length,b:list.length})+(state.pref?fmt(t("prefSuffix"),{c:catName(state.pref)}):"");
  if(!list.length){ $("grid").innerHTML='<div class="empty">'+t("emptyRes")+'</div>'; }
  else $("grid").innerHTML=show.map(function(o){
    var r=o.r, fav=state.favs[o.i];
    return '<article class="card" data-open="'+o.i+'" tabindex="0" role="button" aria-label="'+esc(r[0])+'">'
      +'<div class="ph"><img src="'+CATIMG[r[1]]+'" alt="'+esc(r[0])+'" loading="lazy"/><span class="city">'+cityName(r[2])+'</span>'
      +'<button type="button" class="fav'+(fav?" on":"")+'" data-fav="'+o.i+'" aria-label="Favourite"><svg width="16" height="16" viewBox="0 0 24 24" fill="'+(fav?"currentColor":"none")+'" stroke="currentColor" stroke-width="2"><path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z"/></svg></button></div>'
      +'<div class="bd"><span class="catline">'+catName(r[1])+' · '+cityName(r[2])+'</span><h3>'+esc(r[0])+'</h3><p>'+esc(desc(r))+'</p>'
      +'<div class="ft"><span class="price">'+money(r[3])+'</span><span class="unit">/ '+unitName(r[4])+'</span><span class="views">'+r[5]+' '+t("viewsUnit")+'</span></div></div></article>';
  }).join("");
  $("moreBtn").style.display = list.length>state.shown ? "" : "none";
}
function renderDemands(){
  $("demandGrid").innerHTML=DEMANDS.map(function(d,i){
    var dd = lang==="zh" ? d[4][1] : lang==="en" ? d[4][2] : d[4][0];
    return '<button type="button" class="demand" data-d="'+i+'"><h3>'+esc(d[0][li()])+'</h3><p>'+esc(dd)+'</p><div class="meta"><span>'+t("budget")+' <b>'+money(d[2])+'</b></span><span>'+cityName(d[3])+'</span><span>'+catName(d[1])+'</span></div></button>';
  }).join("");
}
function renderPrefs(){
  var prefs=[["show","爱看演出","Thích xem diễn","Live shows"],["heritage","迷非遗","Mê di sản","Heritage crafts"],["creative","爱文创","Thích văn sáng","Creative goods"],["digital","玩数字","Trải nghiệm số","Digital experiences"],["tourism","跟着演出旅行","Đi theo vở diễn","Travel for shows"]];
  $("prefTags").innerHTML=prefs.map(function(p){ return '<button type="button" data-p="'+p[0]+'" class="'+(state.pref===p[0]?"on":"")+'">'+p[1+li()]+'</button>'; }).join("");
}
function renderChatHome(){
  $("chatLog").innerHTML="";
  addMsg(t("greeting"),false);
  $("chatQuick").innerHTML=t("quicks").map(function(q){ return '<button type="button">'+q+'</button>'; }).join("");
}
function renderAll(){
  applyStatic(); renderHero(); renderCats(); renderFilters(); renderCities(); renderGrid(); renderDemands(); renderPrefs(); renderOrders(); renderChatHome(); renderWx(); updateAuthUI();
  $("matchBox").classList.remove("show");
}
function setLang(l){
  if(l===lang) return;
  lang=l; state.shown=12;
  closeSheet();
  renderAll();
}
$("langSel").addEventListener("change",function(){ setLang(this.value); });

/* ---- WeChat mini program (mirrors the web version, same data & booking) ---- */
function wxCard(o){
  var r=o.r;
  return '<button type="button" class="wx-card" data-wxopen="'+o.i+'"><img src="'+CATIMG[r[1]]+'" alt="'+esc(r[0])+'" loading="lazy"/><span style="flex:1;min-width:0"><h4>'+esc(r[0])+'</h4><p>'+esc(desc(r))+'</p><span style="display:flex;gap:8px;align-items:baseline;margin-top:5px"><span class="pr">'+money(r[3])+'</span><span class="mt">/ '+unitName(r[4])+' · '+cityName(r[2])+' · '+r[5]+' '+t("viewsUnit")+'</span></span></span></button>';
}
function renderWx(){
  if(!$("wxBody")) return;
  document.querySelectorAll("#wxTabs [data-wxtab]").forEach(function(b){ b.classList.toggle("on", b.dataset.wxtab===state.wxTab); });
  var badge=$("wxOrderCount"); badge.textContent=state.orders.length; badge.style.display=state.orders.length?"grid":"none";
  $("wxChips").style.display = (state.wxTab==="home"||state.wxTab==="catalog") ? "" : "none";
  $("wxChips").innerHTML='<button type="button" data-wxcat="all" class="'+(state.wxCat==="all"?"on":"")+'">'+t("allChip")+'</button>'+CATS.map(function(c){ return '<button type="button" data-wxcat="'+c[0]+'" class="'+(state.wxCat===c[0]?"on":"")+'">'+catName(c[0])+'</button>'; }).join("");
  var body="";
  if(state.wxTab==="orders"){
    body = state.orders.length ? state.orders.map(function(o){ var r=RES[o.idx]; return '<div class="wx-order"><b style="font-family:\'Noto Serif SC\',serif">'+esc(r[0])+'</b><br/><span style="color:#999;font-size:11.5px">'+o.code+' · '+o.date+' · '+o.qty+' × '+unitName(r[4])+' · '+money(o.total)+'</span><br/><span class="pill '+o.status+'" style="margin-top:7px;display:inline-block">'+t(STATUS[o.status])+'</span></div>'; }).join("") : '<div class="wx-order" style="text-align:center;color:#999;padding:28px 12px">'+t("emptyOrders")+'</div>';
  } else if(state.wxTab==="demands"){
    body = DEMANDS.map(function(d,i){ return '<button type="button" class="wx-card" data-wxdem="'+i+'"><span style="flex:1;min-width:0"><h4>'+esc(d[0][li()])+'</h4><p>'+esc(lang==="zh"?d[4][1]:lang==="en"?d[4][2]:d[4][0])+'</p><span style="display:flex;gap:8px;margin-top:5px"><span class="pr">'+money(d[2])+'</span><span class="mt">'+cityName(d[3])+' · '+catName(d[1])+'</span></span></span></button>'; }).join("");
  } else {
    var list=RES.map(function(r,i){ return {r:r,i:i}; }).filter(function(o){
      if(state.wxTab==="catalog"&&state.wxCat!=="all"&&o.r[1]!==state.wxCat) return false;
      if(state.wxQ){ var hay=(o.r[0]+o.r[2]+catZh(o.r[1])+desc(o.r)).toLowerCase(); if(hay.indexOf(state.wxQ.toLowerCase())<0) return false; }
      return true;
    }).sort(function(a,b){ return b.r[5]-a.r[5]; });
    if(state.wxTab==="home") body='<div class="wx-hero"><span class="zh">桂演 Guiyan</span><p>'+t("heroSub")+' · '+RES.length+' '+t("sRes")+'</p></div><div style="font-weight:800;font-size:14px;padding:2px 2px 0">'+t("wxFeatured")+'</div>'+list.slice(0,4).map(wxCard).join("");
    else body = list.length ? list.map(wxCard).join("") : '<div class="wx-order" style="text-align:center;color:#999;padding:28px 12px">'+t("emptyRes")+'</div>';
  }
  $("wxBody").innerHTML=body;
}
$("wxTabs").addEventListener("click",function(e){ var b=e.target.closest("[data-wxtab]"); if(!b) return; state.wxTab=b.dataset.wxtab; renderWx(); });
$("wxChips").addEventListener("click",function(e){ var b=e.target.closest("[data-wxcat]"); if(!b) return; state.wxCat=b.dataset.wxcat; if(state.wxTab==="home") state.wxTab="catalog"; renderWx(); });
$("wxQ").addEventListener("input",function(){ state.wxQ=this.value; if(state.wxTab==="home") state.wxTab="catalog"; renderWx(); });
$("wxBody").addEventListener("click",function(e){
  var c=e.target.closest("[data-wxopen]"); if(c){ openDetail(+c.dataset.wxopen); return; }
  var d=e.target.closest("[data-wxdem]");
  if(d){ var dem=DEMANDS[+d.dataset.wxdem]; var m=RES.map(function(r,i){ return {r:r,i:i}; }).filter(function(o){ return o.r[1]===dem[1]&&o.r[3]<=dem[2]; }).sort(function(a,b){ return b.r[5]-a.r[5]; })[0]; if(m) openDetail(m.i); }
});
if(/MicroMessenger/i.test(navigator.userAgent)) document.body.classList.add("is-wechat");

/* ---- catalog events ---- */
function setCat(c){ state.cat=c; state.shown=12; renderFilters(); renderGrid(); }
$("catRail").addEventListener("click",function(e){ var b=e.target.closest("[data-cat]"); if(!b) return; setCat(b.dataset.cat); document.getElementById("catalog").scrollIntoView({behavior:"smooth"}); });
$("catFilters").addEventListener("click",function(e){ var b=e.target.closest("[data-c]"); if(b) setCat(b.dataset.c); });
$("grid").addEventListener("click",function(e){
  var f=e.target.closest("[data-fav]");
  if(f){ e.stopPropagation(); toggleFav(+f.dataset.fav); return; }
  var c=e.target.closest("[data-open]"); if(c) openDetail(+c.dataset.open);
});
$("grid").addEventListener("keydown",function(e){ if(e.key==="Enter"){ var c=e.target.closest("[data-open]"); if(c) openDetail(+c.dataset.open); } });
$("moreBtn").addEventListener("click",function(){ state.shown+=12; renderGrid(); });
$("q").addEventListener("input",function(){ state.q=this.value; state.shown=12; renderGrid(); });
$("citySel").addEventListener("change",function(){ state.city=this.value; state.shown=12; renderGrid(); });
$("sortSel").addEventListener("change",function(){ state.sort=this.value; state.shown=12; renderGrid(); });
function doSearch(q){ state.q=q; state.cat="all"; state.shown=12; $("q").value=q; renderFilters(); renderGrid(); document.getElementById("catalog").scrollIntoView({behavior:"smooth"}); }
$("heroSearch").addEventListener("submit",function(e){ e.preventDefault(); doSearch($("heroQ").value.trim()); });
$("heroTags").addEventListener("click",function(e){ var b=e.target.closest("button"); if(!b) return; $("heroQ").value=b.dataset.q; doSearch(b.dataset.q); });
function bindGotoCat(){
  document.querySelectorAll("[data-goto-cat]").forEach(function(b){
    if(b._bound) return; b._bound=true;
    b.addEventListener("click",function(){ setCat(b.dataset.gotoCat); document.getElementById("catalog").scrollIntoView({behavior:"smooth"}); });
  });
}

/* ---- detail + booking ---- */
var cur=null;
function openDetail(i){
  cur=i; var r=RES[i];
  var flow=t("flow").map(function(s,x){ return '<span'+(x===0?' class="on"':"")+'>'+s+'</span>'; }).join("");
  $("sheet").innerHTML='<div class="ph"><img src="'+CATIMG[r[1]].replace("-card","")+'" alt="'+esc(r[0])+'"/><button type="button" class="x" id="sheetX" aria-label="Close">✕</button></div>'
    +'<div class="in"><span style="font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--gold)">'+catName(r[1])+' · '+cityName(r[2])+'</span>'
    +'<h3>'+esc(r[0])+'</h3><p class="desc">'+esc(desc(r))+'</p>'
    +'<div class="meta"><span>'+fmt(t("viewsMeta"),{n:r[5]})+'</span><span>'+fmt(t("priceMeta"),{p:money(r[3]),u:unitName(r[4])})+'</span></div>'
    +'<div class="flowline">'+flow+'</div>'
    +'<div class="bookrow"><label>'+t("dateLabel")+'<input type="date" id="bkDate" value="2026-12-05" min="2026-11-11"/></label>'
    +'<label>'+fmt(t("qtyLabel"),{u:unitName(r[4])})+'<select id="bkQty"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>10</option><option>20</option></select></label></div>'
    +'<div class="totalrow"><span>'+t("totalLabel")+'</span><b id="bkTotal">'+money(r[3])+'</b></div>'
    +'<div class="acts"><button type="button" class="btn red" id="bkGo">'+t("bookNow")+'</button>'
    +'<button type="button" class="btn ghost" id="bkFav">'+(state.favs[i]?t("favOn"):t("favOff"))+'</button></div></div>';
  $("overlay").classList.add("open");
  $("sheetX").addEventListener("click",closeSheet);
  $("bkQty").addEventListener("change",function(){ $("bkTotal").textContent=money(r[3]*+this.value); });
  $("bkFav").addEventListener("click",function(){ var btn=this; toggleFav(i).then(function(){ btn.textContent=state.favs[i]?t("favOn"):t("favOff"); }); });
  $("bkGo").addEventListener("click",function(){
    var qty=+$("bkQty").value, date=$("bkDate").value||"2026-12-05";
    bookResource(i,qty,date);
  });
}
function closeSheet(){ $("overlay").classList.remove("open"); }
$("overlay").addEventListener("click",function(e){ if(e.target===this) closeSheet(); });
document.addEventListener("keydown",function(e){ if(e.key==="Escape"){ closeSheet(); $("drawer").classList.remove("open"); } });

/* ---- orders ---- */
var STATUS={pending:"stPending",confirmed:"stConfirmed",paid:"stPaid",completed:"stCompleted",cancelled:"stCancelled",refunded:"stRefunded"};
function renderOrders(){
  $("orderCount").textContent=state.orders.length;
  if(!state.orders.length){ $("orderList").innerHTML='<div class="emptybox">'+t("emptyOrders")+'</div>'; return; }
  $("orderList").innerHTML=state.orders.map(function(o,oi){
    var r=RES[o.idx];
    var acts="";
    if(o.status==="pending") acts='<button type="button" class="mini" data-act="confirm" data-oi="'+oi+'">'+t("actConfirm")+'</button><button type="button" class="mini" data-act="cancel" data-oi="'+oi+'">'+t("actCancel")+'</button>';
    if(o.status==="confirmed") acts='<button type="button" class="mini red" data-act="pay" data-oi="'+oi+'">'+fmt(t("actPay"),{amt:money(o.total)})+'</button><button type="button" class="mini" data-act="cancel" data-oi="'+oi+'">'+t("actCancel")+'</button>';
    if(o.status==="paid") acts='<button type="button" class="mini red" data-act="complete" data-oi="'+oi+'">'+t("actComplete")+'</button><button type="button" class="mini" data-act="refund" data-oi="'+oi+'">'+t("actRefund")+'</button>';
    if(o.status==="completed") acts='<span style="font-size:12.5px;color:var(--ink2)">'+t("doneNote")+'</span>';
    return '<div class="order"><h4>'+esc(r[0])+'</h4><span class="code">'+o.code+' · '+o.date+' · '+o.qty+' × '+unitName(r[4])+' · '+money(o.total)+'</span>'
      +'<div class="row"><span class="pill '+o.status+'">'+t(STATUS[o.status])+'</span>'+acts+'</div></div>';
  }).join("");
}
$("orderList").addEventListener("click",function(e){
  var b=e.target.closest("[data-act]"); if(!b) return;
  handleOrderAction(b);
});
function openDrawer(){ renderOrders(); $("drawer").classList.add("open"); }
$("openOrders").addEventListener("click",openDrawer);
$("footOrders").addEventListener("click",openDrawer);
$("closeDrawer").addEventListener("click",function(){ $("drawer").classList.remove("open"); });

/* ---- demands + matching ---- */
$("demandGrid").addEventListener("click",function(e){
  var b=e.target.closest("[data-d]"); if(!b) return;
  document.querySelectorAll(".demand").forEach(function(x){ x.classList.remove("sel"); }); b.classList.add("sel");
  var d=DEMANDS[+b.dataset.d];
  var m=RES.map(function(r,i){ return {r:r,i:i}; }).filter(function(o){ return o.r[1]===d[1] && o.r[3]<=d[2]; })
    .sort(function(a,b2){ return (b2.r[2]===d[3])-(a.r[2]===d[3]) || b2.r[5]-a.r[5]; }).slice(0,5);
  $("matchTitle").textContent=fmt(t("matchTitle"),{t:d[0][li()]});
  $("matchNote").textContent=fmt(t("matchNote"),{c:catName(d[1]),b:money(d[2]),city:cityName(d[3]),n:m.length});
  $("matchList").innerHTML=m.map(function(o){ return '<button type="button" data-m="'+o.i+'">'+esc(o.r[0])+' · '+cityName(o.r[2])+' · '+money(o.r[3])+'</button>'; }).join("")||t("matchNone");
  $("matchBox").classList.add("show"); $("matchBox").scrollIntoView({behavior:"smooth",block:"nearest"});
});
$("matchList").addEventListener("click",function(e){ var b=e.target.closest("[data-m]"); if(b) openDetail(+b.dataset.m); });

/* ---- preferences ---- */
$("prefTags").addEventListener("click",function(e){
  var b=e.target.closest("[data-p]"); if(!b) return;
  state.pref = state.pref===b.dataset.p ? null : b.dataset.p;
  renderPrefs(); state.shown=12; renderGrid();
  toast(state.pref ? fmt(t("prefOn"),{c:catName(state.pref)}) : t("prefOff"));
  if(state.pref) document.getElementById("catalog").scrollIntoView({behavior:"smooth"});
});

/* ---- assistant (rule-based, answers from live catalog data) ---- */
function botAnswer(q){
  var s=q.toLowerCase();
  if(/退款|退票|refund|hoàn/.test(s)) return t("ansRefund");
  if(/改签|resched|đổi lịch|dời/.test(s)) return t("ansResched");
  if(/非遗|heritage|di sản|壮锦|tráng cẩm/.test(s)){
    var h=RES.filter(function(r){ return r[1]==="heritage"; });
    var list=h.map(function(r){ return "• "+r[0]+" — "+cityName(r[2])+" · "+money(r[3])+"/"+unitName(r[4]); }).join("\n");
    return fmt(t("ansHeritage"),{n:h.length,list:list});
  }
  if(/预订|预约|订票|book|đặt/.test(s)) return t("ansBook");
  if(/今晚|热门|推荐|tonight|hot|popular|gợi ý|hôm nay|vở nào/.test(s)){
    var top=RES.map(function(r,i){ return {r:r,i:i}; }).sort(function(a,b){ return b.r[5]-a.r[5]; }).slice(0,3);
    var list2=top.map(function(o){ return "• "+o.r[0]+" — "+cityName(o.r[2])+" · "+money(o.r[3])+"/"+unitName(o.r[4]); }).join("\n");
    return fmt(t("ansHot"),{list:list2});
  }
  if(/你好|您好|hello|chào|hi\b/.test(s)) return t("ansHello");
  return t("ansFallback");
}
function addMsg(txt,me){ var d=document.createElement("div"); d.className="msg "+(me?"me":"bot"); d.textContent=txt; $("chatLog").appendChild(d); $("chatLog").scrollTop=$("chatLog").scrollHeight; }
function askBot(q){ addMsg(q,true); setTimeout(function(){ askBotApi(q); },280); }
$("chatQuick").addEventListener("click",function(e){ var b=e.target.closest("button"); if(b) askBot(b.textContent); });
$("chatForm").addEventListener("submit",function(e){ e.preventDefault(); var v=$("chatIn").value.trim(); if(!v) return; $("chatIn").value=""; askBot(v); });
document.querySelectorAll("[data-help]").forEach(function(b){
  b.addEventListener("click",function(){
    document.getElementById("ai").scrollIntoView({behavior:"smooth"});
    var key=b.dataset.help;
    if(key==="refund") askBot(t("quicks")[0]);
    else if(key==="book") askBot(t("quicks")[3]);
    else { addMsg(t("helpResched"),true); setTimeout(function(){ addMsg(t("ansResched"),false); },280); }
  });
});

/* init */
bindGotoCat();
renderAll();
bootApi();
