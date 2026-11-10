var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    demands: [], open: -1, matches: [], matchTitle: '', matchNote: ''
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
    var keys = ['brandTag', 'demTitle', 'demSub', 'demNote', 'budget',
      'matchTitle', 'matchNote', 'matchNone', 'viewsUnit', 'matchCount'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.demTitle });
    var demands = data.DEMANDS.map(function (d, i) {
      return { i: i, title: d.title[lang] || d.title.zh, desc: d.desc[lang] || d.desc.zh,
        cat: data.catName(d.cat, lang), budget: data.money(d.budget),
        city: data.cityName(d.city, lang) };
    });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label, demands: demands,
      open: -1, matches: [], matchTitle: '', matchNote: '' });
  },
  toggle: function (e) {
    var i = e.currentTarget.dataset.i;
    var lang = i18n.getLang();
    if (this.data.open === i) {
      this.setData({ open: -1, matches: [], matchTitle: '', matchNote: '' });
      return;
    }
    var d = data.DEMANDS[i];
    var list = data.matchDemand(d).map(function (o) {
      return { idx: o.i, name: o.r.name, cat: data.catName(o.r.cat, lang),
        city: data.cityName(o.r.city, lang), price: data.money(o.r.price),
        unit: data.unitName(o.r.unit, lang), views: o.r.views };
    });
    var note = list.length === 0
      ? i18n.t('matchNone', lang)
      : i18n.fmt(i18n.t('matchNote', lang), {
          c: data.catName(d.cat, lang), b: data.money(d.budget),
          city: data.cityName(d.city, lang), n: list.length });
    this.setData({ open: i, matches: list,
      matchTitle: i18n.fmt(i18n.t('matchTitle', lang), { t: d.title[lang] || d.title.zh }),
      matchNote: note });
  },
  goDetail: function (e) {
    wx.navigateTo({ url: '/pages/detail/detail?idx=' + e.currentTarget.dataset.idx });
  }
});
