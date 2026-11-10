var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    kw: '', featured: [], cats: [], stats: '', heroLead: ''
  },
  onLoad: function () { this.applyLang(); },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
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
      'tapToBook', 'viewsUnit', 'favOn', 'favOff', 'heroStats'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: '桂演 Guiyan' });
    var cities = {};
    data.RES.forEach(function (r) { cities[r.city] = true; });
    var stats = i18n.fmt(L.heroStats, {
      a: data.RES.length, b: data.CATS.length,
      c: Object.keys(cities).length, d: data.DEMANDS.length
    });
    var featured = data.topViewed(6).map(function (o) { return this._view(o); }, this);
    var cats = data.CATS.map(function (c) {
      var n = 0;
      data.RES.forEach(function (r) { if (r.cat === c.id) n++; });
      return { id: c.id, name: c[lang] || c.zh, count: n };
    });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      featured: featured, cats: cats, stats: stats, heroLead: L.heroLead });
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
    var on = store.toggleFav(idx);
    wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
    this.applyLang();
  }
});
