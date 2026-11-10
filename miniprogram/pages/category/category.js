var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    kw: '', catSel: 'all', citySel: 'all', sortSel: 'hot',
    cityNames: [], cityIds: [], sortNames: [], sortIds: ['hot', 'asc', 'desc', 'name'],
    list: [], resultLine: ''
  },
  onLoad: function () { this.applyLang(); },
  onShow: function () {
    var app = getApp();
    var changed = false;
    if (app.globalData.pendingKeyword !== undefined && app.globalData.pendingKeyword !== null) {
      this.setData({ kw: app.globalData.pendingKeyword });
      app.globalData.pendingKeyword = null; changed = true;
    }
    if (app.globalData.pendingCat) {
      this.setData({ catSel: app.globalData.pendingCat });
      app.globalData.pendingCat = ''; changed = true;
    }
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else if (changed) this.refresh();
    else this.refresh();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'searchPh', 'searchBtn', 'allChip', 'allCities',
      'sortLabel', 'cityLabel', 'sortHot', 'sortAsc', 'sortDesc', 'sortName',
      'results', 'emptyRes', 'viewsUnit', 'favAdd', 'favRemove', 'catTitle'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.catTitle });
    var cityIds = ['all'];
    var cityNames = [L.allCities];
    Object.keys(data.CITYN).forEach(function (c) {
      cityIds.push(c); cityNames.push(data.cityName(c, lang));
    });
    var cats = data.CATS.map(function (c) { return { id: c.id, name: c[lang] || c.zh }; });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label, cats: cats,
      cityIds: cityIds, cityNames: cityNames,
      sortNames: [L.sortHot, L.sortAsc, L.sortDesc, L.sortName],
      cityIdx: cityIds.indexOf(this.data.citySel),
      sortIdx: this.data.sortIds.indexOf(this.data.sortSel) });
    this.refresh();
  },
  // Same filter/sort rules as data.searchRes, but over the merged catalog
  // (local RES + any API resources merged in by name).
  buildView: function () {
    var lang = i18n.getLang();
    var kw = (this.data.kw || '').toLowerCase();
    var catSel = this.data.catSel;
    var citySel = this.data.citySel;
    var sortSel = this.data.sortSel;
    var list = api.getCatalog().map(function (r, i) { return { r: r, i: i }; })
      .filter(function (o) {
        if (catSel && catSel !== 'all' && o.r.cat !== catSel) return false;
        if (citySel && citySel !== 'all' && o.r.city !== citySel) return false;
        if (!kw) return true;
        var hay = (o.r.name + ' ' + o.r.city + ' ' + o.r.desc.zh + ' '
          + o.r.desc.vi + ' ' + o.r.desc.en).toLowerCase();
        return hay.indexOf(kw) !== -1;
      });
    if (sortSel === 'asc') list.sort(function (a, b) { return a.r.price - b.r.price; });
    else if (sortSel === 'desc') list.sort(function (a, b) { return b.r.price - a.r.price; });
    else if (sortSel === 'name') list.sort(function (a, b) { return a.r.name.localeCompare(b.r.name, 'zh'); });
    else list.sort(function (a, b) { return b.r.views - a.r.views; });
    return list.map(function (o) {
      return { idx: o.i, name: o.r.name, cat: data.catName(o.r.cat, lang),
        city: data.cityName(o.r.city, lang), price: data.money(o.r.price),
        unit: data.unitName(o.r.unit, lang), views: o.r.views,
        desc: data.descOf(o.r, lang), fav: store.isFav(o.i) };
    });
  },
  resultLineFor: function (n) {
    return i18n.fmt(i18n.t('results'), { a: n, b: api.getCatalog().length });
  },
  refresh: function () {
    var view = this.buildView();
    this.setData({ list: view, resultLine: this.resultLineFor(view.length) });
    this.refreshOnline();
  },
  // Online: GET /api/resources with the same filters, merge by name, then
  // re-render from the merged catalog. Silent fallback on any failure.
  refreshOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; return; }
      var params = {};
      if (self.data.catSel !== 'all') params.category = data.catName(self.data.catSel, 'zh');
      if (self.data.citySel !== 'all') params.city = self.data.citySel;
      if (self.data.kw) params.q = self.data.kw;
      params.sort = self.data.sortSel === 'asc' ? 'price_asc'
        : self.data.sortSel === 'desc' ? 'price_desc' : 'hot';
      api.loadResources(params).then(function () {
        self._loadingOnline = false;
        var view = self.buildView();
        self.setData({ list: view, resultLine: self.resultLineFor(view.length) });
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  onKw: function (e) { this.setData({ kw: e.detail.value }); this.refresh(); },
  onCat: function (e) { this.setData({ catSel: e.currentTarget.dataset.cat }); this.refresh(); },
  onCity: function (e) {
    var id = this.data.cityIds[e.detail.value];
    this.setData({ citySel: id, cityIdx: e.detail.value });
    this.refresh();
  },
  onSort: function (e) {
    var id = this.data.sortIds[e.detail.value];
    this.setData({ sortSel: id, sortIdx: e.detail.value });
    this.refresh();
  },
  goDetail: function (e) {
    wx.navigateTo({ url: '/pages/detail/detail?idx=' + e.currentTarget.dataset.idx });
  },
  toggleFav: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var self = this;
    api.toggleFav(idx).then(function (on) {
      wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
      self.refresh();
    });
  }
});
