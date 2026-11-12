// utils/api.js — Guiyan real-API client (Node + PostgreSQL backend).
// Graceful offline fallback: with no apiBase (app.globalData.apiBase === '')
// every call fails closed and pages keep using local data.js exactly as
// before. With apiBase set, /api/health decides apiAvailable; a failed
// health check just means offline mode — API errors are never shown as
// scary alerts, pages fall back silently to local data.
// ALL money from the API is INTEGER CENTS; this module converts to yuan
// (cents / 100) at the boundary. The client never sends an amount.
var data = require('./data.js');
var store = require('./store.js');

var TOKEN_KEY = 'guiyan-token';
var USER_KEY = 'guiyan-user';

// Merged catalog: local RES (indices 0..61, never reordered) with API
// overrides applied by NAME, plus API-only resources appended after them.
// null = no API data merged yet, getCatalog() returns data.RES as-is.
var mergedCatalog = null;

function getAppSafe() {
  try { return getApp(); } catch (e) { return null; }
}

function getBase() {
  var app = getAppSafe();
  return (app && app.globalData && app.globalData.apiBase) || '';
}

function setAvailable(v) {
  var app = getAppSafe();
  if (app && app.globalData) app.globalData.apiAvailable = !!v;
}

function isOnline() {
  var app = getAppSafe();
  return !!getBase() && !!(app && app.globalData && app.globalData.apiAvailable);
}

function request(opts) {
  var base = getBase();
  if (!base) return Promise.reject(new Error('offline'));
  var token = opts.auth ? getToken() : null;
  var header = { 'content-type': 'application/json' };
  if (token) header.Authorization = 'Bearer ' + token;
  return new Promise(function (resolve, reject) {
    wx.request({
      url: base.replace(/\/$/, '') + opts.path,
      method: opts.method || 'GET',
      data: opts.data || {},
      header: header,
      timeout: 6000,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(res.data); return; }
        var msg = (res.data && res.data.error) || ('HTTP ' + res.statusCode);
        var err = new Error(msg);
        err.status = res.statusCode;
        err.data = res.data;
        reject(err);
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || 'network error'));
      }
    });
  });
}

function get(path, params, auth) {
  return request({ method: 'GET', path: path, data: params || {}, auth: !!auth });
}
function post(path, body, auth) {
  return request({ method: 'POST', path: path, data: body || {}, auth: !!auth });
}
function del(path, auth) {
  return request({ method: 'DELETE', path: path, auth: !!auth });
}
function patch(path, body, auth) {
  return request({ method: 'PATCH', path: path, data: body || {}, auth: !!auth });
}

// --- health / availability -----------------------------------------------
function checkHealth() {
  if (!getBase()) { setAvailable(false); return Promise.resolve(false); }
  return request({ method: 'GET', path: '/api/health' }).then(function () {
    setAvailable(true);
    return true;
  }).catch(function () {
    setAvailable(false);
    return false;
  });
}

// --- token + user session --------------------------------------------------
function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || null; } catch (e) { return null; }
}
function saveToken(t) {
  try { wx.setStorageSync(TOKEN_KEY, t); } catch (e) {}
}
function getStoredUser() {
  try {
    var u = wx.getStorageSync(USER_KEY);
    return (u && typeof u === 'object') ? u : null;
  } catch (e) { return null; }
}
function saveUser(u) {
  try { wx.setStorageSync(USER_KEY, u); } catch (e) {}
}
function clearSession() {
  try { wx.removeStorageSync(TOKEN_KEY); } catch (e) {}
  try { wx.removeStorageSync(USER_KEY); } catch (e) {}
  var app = getAppSafe();
  if (app && app.globalData) app.globalData.user = null;
}

// Returns the stored token, or null. Never auto-logs in: there is no
// hardcoded credential anywhere in this mini-program.
function ensureLogin() { return getToken(); }

function login(username, password) {
  return request({ method: 'POST', path: '/api/auth/login',
    data: { username: username, password: password } }).then(function (res) {
    if (res.token) saveToken(res.token);
    if (res.user) {
      saveUser(res.user);
      var app = getAppSafe();
      if (app && app.globalData) app.globalData.user = res.user;
    }
    return res.user || null;
  });
}

function logout() { clearSession(); }

// --- WeChat mini-program sign-in (layer 1 + layer 2, pages/me) ------------
// wechatLogin(code): one-tap sign-in. Resolves {linked:false} when the
// openid has no Guiyan account yet (the 我 tab then opens the link form);
// resolves {token, user, linked:true} when linked. Sends the stored
// token too, so an already signed-in user links their WeChat instead.
function wechatLogin(code) {
  return saveWechatSession(post('/api/auth/wechat-mini', { code: code }, !!getToken()));
}
// linkWechat(code, username, password): verify the Guiyan account once
// and link this WeChat openid to it; later opens auto-login via layer 1.
function linkWechat(code, username, password) {
  return saveWechatSession(post('/api/auth/wechat-mini',
    { code: code, username: username, password: password }));
}
function saveWechatSession(promise) {
  return promise.then(function (res) {
    if (res && res.token) saveToken(res.token);
    if (res && res.user) {
      saveUser(res.user);
      var app = getAppSafe();
      if (app && app.globalData) app.globalData.user = res.user;
    }
    return res || null;
  });
}

// Authenticated action without a token: open the link/login form on the
// 我 tab instead of failing.
function promptLogin() {
  var app = getAppSafe();
  if (app && app.globalData) app.globalData.meShowLink = true;
  try { wx.switchTab({ url: '/pages/me/me' }); } catch (e) {}
}

// --- money -----------------------------------------------------------------
function centsToYuan(c) { return (typeof c === 'number' ? c : 0) / 100; }
function yuanToCents(y) { return Math.round((parseFloat(y) || 0) * 100); }

// --- resources: merge API list into the local catalog by NAME --------------
function catIdFromName(name) {
  if (!name) return 'show';
  for (var i = 0; i < data.CATS.length; i++) {
    if (data.CATS[i].zh === name) return data.CATS[i].id;
  }
  for (var j = 0; j < data.CATS.length; j++) {
    if (data.CATS[j].id === name) return name;
  }
  return name; // unknown category: keep the raw name so it still displays
}

function toLocalResource(apiR, local) {
  var zhDesc = apiR.description || apiR.name;
  var desc = local ? local.desc : { zh: zhDesc, vi: zhDesc, en: zhDesc };
  return {
    name: apiR.name,
    cat: catIdFromName(apiR.category),
    city: apiR.city || (local ? local.city : '全区'),
    price: typeof apiR.price === 'number' ? apiR.price / 100 : (local ? local.price : 0),
    unit: apiR.unit || (local ? local.unit : '张'),
    views: typeof apiR.views === 'number' ? apiR.views : (local ? local.views : 0),
    desc: desc, // local trilingual desc kept when matched; Chinese-only otherwise
    apiId: apiR.id != null ? apiR.id : (local ? local.apiId : null),
    stock: apiR.stock, rating: apiR.rating, review_count: apiR.review_count,
    image: apiR.image, capacity: apiR.capacity, status: apiR.status,
    tags: apiR.tags || []
  };
}

function mergeResources(apiList) {
  var catalog = data.RES.map(function (r) {
    var c = {};
    for (var k in r) c[k] = r[k];
    c.desc = { zh: r.desc.zh, vi: r.desc.vi, en: r.desc.en };
    return c;
  });
  var byName = {};
  catalog.forEach(function (r, i) { byName[r.name] = i; });
  (apiList || []).forEach(function (apiR) {
    if (!apiR || !apiR.name) return;
    var idx = byName[apiR.name];
    if (idx !== undefined) catalog[idx] = toLocalResource(apiR, catalog[idx]);
    else { byName[apiR.name] = catalog.length; catalog.push(toLocalResource(apiR, null)); }
  });
  mergedCatalog = catalog;
  return catalog;
}

function getCatalog() { return mergedCatalog || data.RES; }
function resourceByIdx(idx) {
  var c = getCatalog();
  return (idx >= 0 && idx < c.length) ? c[idx] : null;
}
function apiIdForIdx(idx) {
  var r = resourceByIdx(idx);
  return (r && r.apiId != null) ? r.apiId : null;
}

function loadResources(params) {
  return get('/api/resources', params || {}).then(function (res) {
    return mergeResources(res.resources || []);
  });
}

// --- orders ------------------------------------------------------------------
var API_STATUS_TO_LOCAL = {
  pending: 'pending', confirmed: 'confirmed', paid: 'paid',
  completed: 'completed', cancelled: 'cancelled',
  refund_requested: 'refunded', refunded: 'refunded'
};

function mapApiOrder(o) {
  var catalog = getCatalog();
  var idx = -1;
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i].name === o.resource_name) { idx = i; break; }
  }
  return {
    code: o.code, idx: idx, resourceId: o.resource_id,
    apiId: o.id, online: true,
    qty: o.quantity, date: o.booking_date,
    total: centsToYuan(o.amount), // yuan, for the local order shape
    status: API_STATUS_TO_LOCAL[o.status] || o.status || 'pending',
    name: o.resource_name || '',
    city: idx >= 0 ? catalog[idx].city : '',
    createdAt: o.created_at ? Date.parse(o.created_at) : 0
  };
}

// --- demands ------------------------------------------------------------------
function mapApiDemand(d) {
  return {
    titleZh: d.title, cat: catIdFromName(d.category),
    budget: centsToYuan(d.budget), city: d.city || '全区',
    descZh: d.description || '', apiId: d.id != null ? d.id : null,
    user_name: d.user_name || '', status: d.status || ''
  };
}

// Merge API demands into the local list by TITLE (Chinese title). Matched
// demands keep the local trilingual title/desc and take the API budget
// (cents -> yuan); unmatched ones are appended, Chinese text for all langs.
function mergeDemands(apiList) {
  var out = data.DEMANDS.map(function (d) {
    return {
      title: { zh: d.title.zh, vi: d.title.vi, en: d.title.en },
      desc: { zh: d.desc.zh, vi: d.desc.vi, en: d.desc.en },
      cat: d.cat, budget: d.budget, city: d.city
    };
  });
  var byTitle = {};
  out.forEach(function (d, i) { byTitle[d.title.zh] = i; });
  (apiList || []).forEach(function (ad) {
    if (!ad || !ad.title) return;
    var m = mapApiDemand(ad);
    var i = byTitle[ad.title];
    if (i !== undefined) {
      out[i].budget = m.budget; out[i].cat = m.cat; out[i].city = m.city;
      out[i].apiId = m.apiId;
    } else {
      byTitle[ad.title] = out.length;
      out.push({
        title: { zh: m.titleZh, vi: m.titleZh, en: m.titleZh },
        desc: { zh: m.descZh, vi: m.descZh, en: m.descZh },
        cat: m.cat, budget: m.budget, city: m.city, apiId: m.apiId
      });
    }
  });
  return out;
}

// --- favorites ---------------------------------------------------------------
// API favorites are full resource objects: merge them into the catalog
// (by name) and return their catalog indices.
function favIdxsFromApi(apiFavs) {
  mergeResources(apiFavs || []);
  var catalog = getCatalog();
  var idxs = [];
  (apiFavs || []).forEach(function (f) {
    if (!f || !f.name) return;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].name === f.name) { idxs.push(i); break; }
    }
  });
  return idxs;
}

// Toggle a favorite on the server when online + logged in and the resource
// exists on the server. Online but logged out: open the link/login form
// on the 我 tab and change nothing (no silent local save). Offline: keep
// the local toggle. Resolves to the new favorite state (true/false).
function toggleFav(idx) {
  if (isOnline() && !getToken()) {
    promptLogin();
    return Promise.resolve(store.isFav(idx));
  }
  if (!isOnline() || !getToken()) return Promise.resolve(store.toggleFav(idx));
  var apiId = apiIdForIdx(idx);
  if (apiId == null) return Promise.resolve(store.toggleFav(idx));
  return post('/api/favorites', { resourceId: apiId }, true).then(function (res) {
    var on = (res && typeof res.favorite === 'boolean')
      ? res.favorite : !store.isFav(idx);
    var favs = store.getFavs();
    var i = favs.indexOf(idx);
    if (on && i === -1) favs.push(idx);
    if (!on && i !== -1) favs.splice(i, 1);
    store.saveFavs(favs);
    return on;
  }).catch(function () {
    return store.toggleFav(idx);
  });
}

module.exports = {
  getBase: getBase, isOnline: isOnline, checkHealth: checkHealth,
  request: request, get: get, post: post, del: del, patch: patch,
  getToken: getToken, getStoredUser: getStoredUser, saveUser: saveUser,
  ensureLogin: ensureLogin,
  login: login, logout: logout, promptLogin: promptLogin,
  wechatLogin: wechatLogin, linkWechat: linkWechat,
  centsToYuan: centsToYuan, yuanToCents: yuanToCents,
  mergeResources: mergeResources, getCatalog: getCatalog,
  resourceByIdx: resourceByIdx, apiIdForIdx: apiIdForIdx,
  loadResources: loadResources, mapApiOrder: mapApiOrder,
  mergeDemands: mergeDemands, favIdxsFromApi: favIdxsFromApi,
  toggleFav: toggleFav, catIdFromName: catIdFromName
};
