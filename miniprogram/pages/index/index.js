var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

// Home: no login form here any more (sign-in lives on the 我 tab);
// no online/offline line (internal detail, not user content).
Page({
  data: {
    L: {}, langIdx: 0, langName: '中文', langs: ['中文', 'Tiếng Việt', 'English'],
    kw: '', featured: [], cats: [], heroLead: '', shopBanner: '', shopPrimary: ''
  },
  onLoad: function () { this.applyLang(); this.loadOnline(); },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    this.loadOnline();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'heroSub', 'heroLead', 'heroSearchPh',
      'searchBtn', 'catTitle', 'catSub', 'featured', 'assistantEntry',
      'assistantEntrySub', 'aiNote', 'tapToBook', 'viewsUnit', 'favOn',
      'favOff'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: '桂演 Guiyan' });
    var featured = this._topViewed(6).map(function (o) { return this._view(o); }, this);
    var cats = data.CATS.map(function (c) {
      var n = 0;
      var catalog = api.getCatalog();
      catalog.forEach(function (r) { if (r.cat === c.id) n++; });
      return { id: c.id, name: c[lang] || c.zh, count: n };
    });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      featured: featured, cats: cats, heroLead: L.heroLead });
  },
  // Online: health-check, then merge GET /api/resources into the catalog
  // (by name) and re-render. Offline or on failure: keep local data.
  loadOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; return; }
      self.loadTheme();
      api.loadResources().then(function () {
        self._loadingOnline = false;
        self.applyLang();
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  // R1-3: shop theme for shop 1 (best-effort): banner + primary color.
  // A failed fetch just keeps the brand defaults.
  loadTheme: function () {
    if (!api.getBase()) return;
    var self = this;
    api.request({ path: '/api/shops/1/theme' }).then(function (d) {
      if (!d || !d.theme) return;
      self.setData({
        shopBanner: d.theme.banner || '',
        shopPrimary: d.theme.primaryColor || ''
      });
    }, function () {});
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
  }
});
