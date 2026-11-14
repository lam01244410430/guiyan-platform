var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    kw: '', catSel: 'all', citySel: 'all', sortSel: 'hot',
    cityNames: [], cityIds: [], sortNames: [], sortIds: ['hot', 'asc', 'desc', 'name'],
    list: [], resultLine: '',
    licKindSel: 'all', licStatusSel: 'all',
    licKindIds: ['all', 'buy', 'sell'], licStatusIds: ['all', 'pending', 'active', 'expired'],
    licKindNames: [], licStatusNames: [], licKindIdx: 0, licStatusIdx: 0, licenses: []
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
      'results', 'emptyRes', 'viewsUnit', 'favAdd', 'favRemove', 'catTitle',
      'licLibrary', 'licKind', 'licBuy', 'licSell', 'licStatus', 'licPending',
      'licActive', 'licExpired', 'licHolder', 'licType', 'licRegion', 'licInfo'];
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
      licKindNames: [L.allChip, L.licBuy, L.licSell],
      licStatusNames: [L.allChip, L.licPending, L.licActive, L.licExpired],
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
    this.refreshLicenses();
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
  // R6-1: the copyright library (GET /api/licenses, public) shows
  // only when the category is copyright/show-license; kind/status
  // filter server-side, the category filters client-side (the
  // endpoint has no category parameter). Offline the list stays
  // empty — no error is ever shown.
  refreshLicenses: function () {
    var self = this;
    var cat = this.data.catSel;
    if (cat !== 'copyright' && cat !== 'show-license') { if (this.data.licenses.length) this.setData({ licenses: [] }); return; }
    if (!api.getBase()) { this.setData({ licenses: [] }); return; }
    var params = {};
    if (this.data.licKindSel && this.data.licKindSel !== 'all') params.kind = this.data.licKindSel;
    if (this.data.licStatusSel && this.data.licStatusSel !== 'all') params.status = this.data.licStatusSel;
    api.get('/api/licenses', params, false).then(function (d) {
      var rows = (d.licenses || []).filter(function (l) { return l.resource_category === cat; });
      self.setData({ licenses: rows.map(function (l) {
        return { id: l.id, name: l.resource_name, licensor: l.licensor, licensee: l.licensee,
          kind: i18n.t(l.kind === 'buy' ? 'licBuy' : 'licSell'),
          status: i18n.t(l.status === 'pending' ? 'licPending' : l.status === 'active' ? 'licActive' : 'licExpired'),
          price: data.money(l.price_cents / 100),
          dates: (l.start_at || '') + (l.end_at ? ' ~ ' + l.end_at : '') };
      }) });
    }, function () { self.setData({ licenses: [] }); });
  },
  onLicKind: function (e) {
    var id = this.data.licKindIds[e.detail.value];
    this.setData({ licKindSel: id, licKindIdx: e.detail.value });
    this.refreshLicenses();
  },
  onLicStatus: function (e) {
    var id = this.data.licStatusIds[e.detail.value];
    this.setData({ licStatusSel: id, licStatusIdx: e.detail.value });
    this.refreshLicenses();
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
