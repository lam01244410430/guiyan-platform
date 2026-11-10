/* Guiyan dashboard API client (user.html).
   Same contract as the customer SPA (web/assets/js/app.js): same-origin
   by default, override via window.GUIYAN_API_BASE or ?api=<origin>; API
   paths include the /api prefix (as in miniprogram/utils/api.js); token in
   sessionStorage ("guiyan-token", user JSON in "guiyan-user"); 5s timeout;
   all money is INTEGER CENTS on the wire — divide by 100 before money().
   data.js must load before this file (it provides I18N, t(), fmt(), money(),
   catName(), cityName(), unitName(), LANGS, lang). */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }

var apiAvailable=false;
var apiUser=null;
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
function currentUser(){
  if(apiUser) return apiUser;
  try{ var u=JSON.parse(sessionStorage.getItem("guiyan-user")||"null"); if(u) apiUser=u; }catch(e){}
  return apiUser;
}
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
      if(e&&e.status){ apiAvailable=true; }
      else { apiAvailable=false; }
      throw e;
    });
}
function apiGet(path){ return apiFetch(path,{method:"GET"}); }
function apiPost(path,body){ return apiFetch(path,{method:"POST",body:body}); }
function apiDel(path){ return apiFetch(path,{method:"DELETE"}); }
/* API amounts are integer cents; the SPA's money() formats a yuan number. */
function fmtMoney(cents){ return money((typeof cents==="number"?cents:0)/100); }
var STATUS={pending:"stPending",confirmed:"stConfirmed",paid:"stPaid",completed:"stCompleted",cancelled:"stCancelled",refunded:"stRefunded"};
function statusPill(status){ return '<span class="pill '+esc(status)+'">'+esc(t(STATUS[status]||"stPending"))+'</span>'; }

/* ---- language application (same data-i18n contract as the SPA) ---- */
function applyStatic(){
  document.documentElement.lang = lang==="zh" ? "zh-CN" : lang;
  document.querySelectorAll("[data-i18n]").forEach(function(el){ var v=t(el.dataset.i18n); if(typeof v==="string") el.textContent=v; });
  document.querySelectorAll("[data-i18n-ph]").forEach(function(el){ el.placeholder=t(el.dataset.i18nPh); });
  var ls=$("langSel"); if(ls) ls.value=lang;
}
function setLang(l, rerender){
  if(l===lang) return;
  lang=l;
  closeUserMenu();
  applyStatic();
  if(typeof rerender==="function") rerender();
}
function toast(msg){ var tEl=$("toast"); if(!tEl) return; tEl.textContent=msg; tEl.classList.add("show"); clearTimeout(tEl._h); tEl._h=setTimeout(function(){ tEl.classList.remove("show"); },2600); }

/* Footer category list (same CATS data as the SPA, links go to the customer page). */
function fillFootCats(){
  var el=$("footCats"); if(!el) return;
  el.innerHTML=CATS.map(function(c){ return '<li><a href="index.html#catalog">'+esc(c[1+li()])+'</a></li>'; }).join("");
}

/* ---- auth UI (same dialog markup + ids as the SPA) ---- */
function updateAuthUI(){
  var lb=$("loginBtn"), st=$("loginState"), nm=$("loginName");
  if(!lb||!st) return;
  var logged=!!getToken();
  lb.style.display=logged?"none":"";
  st.style.display=logged?"":"none";
  var u=currentUser();
  if(logged&&nm){
    var name=(u&&(u.name||u.username))||"demo";
    nm.textContent=fmt(t("hiName"),{name:name});
    var av=$("userAvatar"); if(av) av.textContent=name.charAt(0).toUpperCase();
  }
  closeUserMenu();
}
/* ---- signed-in user menu ("Hi + name" dropdown; same markup as the SPA) ---- */
function closeUserMenu(){ var m=$("loginState"); if(m) m.classList.remove("open"); var c=$("userChip"); if(c) c.setAttribute("aria-expanded","false"); }
function toggleUserMenu(ev){ if(ev) ev.stopPropagation(); var m=$("loginState"); if(!m) return; var open=!m.classList.contains("open"); m.classList.toggle("open",open); var c=$("userChip"); if(c) c.setAttribute("aria-expanded",open?"true":"false"); }
function openLogin(){ var o=$("loginOverlay"); if(o){ o.classList.add("open"); var u=$("loginUser"); if(u) u.focus(); } }
function closeLogin(){ var o=$("loginOverlay"); if(o) o.classList.remove("open"); }
function doLogin(ev, after){
  if(ev) ev.preventDefault();
  var u=$("loginUser").value.trim(), p=$("loginPass").value;
  var errEl=$("loginErr"); if(errEl) errEl.textContent="";
  apiPost("/api/auth/login",{username:u,password:p}).then(function(d){
    if(d&&d.token){ setToken(d.token,d.user||{username:u,name:u}); apiAvailable=true; updateAuthUI(); closeLogin(); if(typeof after==="function") after(); }
    else if(errEl){ errEl.textContent=t("loginFailed"); }
  }).catch(function(e){
    if(e&&e.status===401){ if(errEl) errEl.textContent=t("loginFailed"); }
    else if(errEl){ errEl.textContent=t("loadErr"); }
  });
}
function doLogout(after){
  var tk=getToken();
  if(tk) apiPost("/api/auth/logout",{}).catch(function(){});
  clearToken(); updateAuthUI();
  if(typeof after==="function") after();
}
function bindDashAuth(afterLogin){
  var lb=$("loginBtn"); if(lb) lb.addEventListener("click",openLogin);
  var lg=$("logoutBtn"); if(lg) lg.addEventListener("click",function(){ doLogout(afterLogin); });
  var uc=$("userChip"); if(uc) uc.addEventListener("click",toggleUserMenu);
  var mo=$("menuOrders"); if(mo) mo.addEventListener("click",function(){ closeUserMenu(); var h=document.querySelector("h3[data-i18n='usrOrders']"); if(h) h.scrollIntoView({behavior:"smooth",block:"start"}); });
  var mb=$("menuBtn"); if(mb) mb.addEventListener("click",function(){ var nv=$("mainNav"); if(nv){ var open=!nv.classList.contains("open"); nv.classList.toggle("open",open); mb.setAttribute("aria-expanded",open?"true":"false"); } });
  var nv=$("mainNav"); if(nv) nv.addEventListener("click",function(e){ if(e.target&&e.target.tagName==="A"){ nv.classList.remove("open"); var b=$("menuBtn"); if(b) b.setAttribute("aria-expanded","false"); } });
  document.addEventListener("click",function(e){ var m=$("loginState"); if(m&&m.classList.contains("open")&&!m.contains(e.target)) closeUserMenu(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"){ closeUserMenu(); var n2=$("mainNav"); if(n2) n2.classList.remove("open"); } });
  var lf=$("loginForm"); if(lf) lf.addEventListener("submit",function(ev){ doLogin(ev,afterLogin); });
  var lc=$("loginCancel"); if(lc) lc.addEventListener("click",closeLogin);
  var lo=$("loginOverlay"); if(lo) lo.addEventListener("click",function(e){ if(e.target===this) closeLogin(); });
  var ls=$("langSel"); if(ls) ls.addEventListener("change",function(){ setLang(this.value,afterLogin); });
  updateAuthUI();
}
