var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');

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
  refresh: function () {
    var lang = i18n.getLang();
    var list = data.searchRes(this.data.kw, this.data.catSel, this.data.citySel, this.data.sortSel);
    var view = list.map(function (o) {
      return { idx: o.i, name: o.r.name, cat: data.catName(o.r.cat, lang),
        city: data.cityName(o.r.city, lang), price: data.money(o.r.price),
        unit: data.unitName(o.r.unit, lang), views: o.r.views,
        desc: data.descOf(o.r, lang), fav: store.isFav(o.i) };
    });
    this.setData({ list: view,
      resultLine: i18n.fmt(i18n.t('results', lang), { a: view.length, b: data.RES.length }) });
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
    var on = store.toggleFav(idx);
    wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
    this.refresh();
  }
});
