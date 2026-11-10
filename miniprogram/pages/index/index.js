var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    kw: '', featured: [], cats: [], stats: '', heroLead: '',
    showLogin: false, loginUser: 'demo', loginPass: '',
    loggedUser: '', loggedAsText: '', online: false
  },
  onLoad: function () { this.applyLang(); this.loadOnline(); },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.syncAuth();
    this.loadOnline();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'heroKicker', 'heroSub', 'heroLead', 'heroSearchPh',
      'searchBtn', 'sRes', 'sShow', 'sVenue', 'sCity', 'sCat', 'sDem', 'catTitle',
      'catSub', 'featured', 'assistantEntry', 'assistantEntrySub', 'aiNote',
      'tapToBook', 'viewsUnit', 'favOn', 'favOff', 'heroStats',
      'loginBtn', 'loginTitle', 'userPh', 'passPh', 'logoutBtn', 'loggedAs',
      'onlineMode', 'offlineMode'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: '桂演 Guiyan' });
    var cities = {};
    var catalog = api.getCatalog();
    catalog.forEach(function (r) { cities[r.city] = true; });
    var stats = i18n.fmt(L.heroStats, {
      a: catalog.length, b: data.CATS.length,
      c: Object.keys(cities).length, d: data.DEMANDS.length
    });
    var featured = this._topViewed(6).map(function (o) { return this._view(o); }, this);
    var cats = data.CATS.map(function (c) {
      var n = 0;
      catalog.forEach(function (r) { if (r.cat === c.id) n++; });
      return { id: c.id, name: c[lang] || c.zh, count: n };
    });
    var app = getApp();
    var user = app.globalData.user;
    var loggedUser = user ? (user.name || user.username || '') : '';
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      featured: featured, cats: cats, stats: stats, heroLead: L.heroLead,
      loggedUser: loggedUser,
      loggedAsText: loggedUser ? i18n.fmt(L.loggedAs, { name: loggedUser }) : '',
      online: api.isOnline(),
      showLogin: !!app.globalData.showLogin });
    if (app.globalData.showLogin) app.globalData.showLogin = false;
  },
  // Light refresh of login/online state without rebuilding the page.
  syncAuth: function () {
    var app = getApp();
    var user = app.globalData.user;
    var loggedUser = user ? (user.name || user.username || '') : '';
    var showLogin = !!app.globalData.showLogin;
    if (showLogin) app.globalData.showLogin = false;
    this.setData({ loggedUser: loggedUser,
      loggedAsText: loggedUser ? i18n.fmt(i18n.t('loggedAs'), { name: loggedUser }) : '',
      online: api.isOnline(), showLogin: showLogin });
  },
  // Online: health-check, then merge GET /api/resources into the catalog
  // (by name) and re-render. Offline or on failure: keep local data.
  loadOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; self.setData({ online: false }); return; }
      api.loadResources().then(function () {
        self._loadingOnline = false;
        self.applyLang();
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  _topViewed: function (n) {
    return api.getCatalog().map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return b.r.views - a.r.views; }).slice(0, n);
  },
  _view: function (o) {
    var lang = i18n.getLang();
    return { idx: o.i, name: o.r.name, cat: data.catName(o.r.cat, lang),
      city: data.cityName(o.r.city, lang), price: data.money(o.r.price),
      unit: data.unitName(o.r.unit, lang), views: o.r.views,
      desc: data.descOf(o.r, lang), fav: store.isFav(o.i) };
  },
  onKw: function (e) { this.setData({ kw: e.detail.value }); },
  goSearch: function () {
    var app = getApp();
    app.globalData.pendingKeyword = this.data.kw || '';
    app.globalData.pendingCat = '';
    wx.switchTab({ url: '/pages/category/category' });
  },
  goCat: function (e) {
    var app = getApp();
    app.globalData.pendingCat = e.currentTarget.dataset.cat;
    app.globalData.pendingKeyword = '';
    wx.switchTab({ url: '/pages/category/category' });
  },
  goDetail: function (e) {
    wx.navigateTo({ url: '/pages/detail/detail?idx=' + e.currentTarget.dataset.idx });
  },
  goAssistant: function () { wx.switchTab({ url: '/pages/assistant/assistant' }); },
  toggleFav: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var self = this;
    api.toggleFav(idx).then(function (on) {
      wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
      self.applyLang();
    });
  },
  // --- login (username prefilled "demo"; password is always empty) ---
  toggleLoginForm: function () {
    this.setData({ showLogin: !this.data.showLogin });
  },
  onLoginUser: function (e) { this.setData({ loginUser: e.detail.value }); },
  onLoginPass: function (e) { this.setData({ loginPass: e.detail.value }); },
  doLogin: function () {
    var self = this;
    var u = (this.data.loginUser || '').trim();
    var p = this.data.loginPass || '';
    if (!u || !p) {
      wx.showToast({ title: i18n.t('loginTitle'), icon: 'none' });
      return;
    }
    if (!api.getBase()) {
      // No server configured: nothing to log in to, stay in offline mode.
      wx.showToast({ title: i18n.t('offlineMode'), icon: 'none' });
      return;
    }
    api.login(u, p).then(function (user) {
      var name = user ? (user.name || user.username || u) : u;
      self.setData({ showLogin: false, loginPass: '', loggedUser: name,
        loggedAsText: i18n.fmt(i18n.t('loggedAs'), { name: name }) });
      wx.showToast({ title: i18n.fmt(i18n.t('loggedAs'), { name: name }), icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || i18n.t('loginTitle'), icon: 'none' });
    });
  },
  doLogout: function () {
    api.logout();
    this.setData({ loggedUser: '', loggedAsText: '' });
  }
});
