/* Guiyan admin login — simple screen, username + password.
   On success stores the admin token and goes to dashboard.html. */
$("loginForm").addEventListener("submit",function(ev){
  ev.preventDefault();
  var u=$("loginUser").value.trim(), p=$("loginPass").value;
  var errEl=$("loginErr"); errEl.textContent="";
  var btn=$("loginBtn"); btn.disabled=true;
  apiPost("/api/auth/login",{username:u,password:p}).then(function(d){
    if(d&&d.token){
      if(d.user&&d.user.role!=="admin"){
        clearToken();
        errEl.textContent="该账号无权访问管理后台";
        btn.disabled=false;
        return;
      }
      setToken(d.token,d.user||{username:u,name:u});
      location.href="/admin/dashboard.html";
    }else{
      errEl.textContent="账号或密码不正确";
      btn.disabled=false;
    }
  }).catch(function(e){
    errEl.textContent=(e&&e.data&&e.data.error)||"登录失败，请稍后重试";
    btn.disabled=false;
  });
});
/* Already logged in as admin? Skip the form. */
(function(){
  if(getToken()){
    var u=currentUser();
    if(u&&u.role==="admin") location.href="/admin/dashboard.html";
  }
})();
