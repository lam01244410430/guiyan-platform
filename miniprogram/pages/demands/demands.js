var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var api = require('../../utils/api.js');

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    demands: [], allDemands: [], open: -1, matches: [], matchTitle: '', matchNote: '',
    cityNames: [], cityIds: [], cats: [],
    showPost: false, postTitle: '', postBudget: '', postDesc: '',
    postCatSel: 'show', postCatIdx: 0, postCitySel: '南宁', postCityIdx: 1
  },
  onLoad: function () {
    this.setData({ allDemands: data.DEMANDS.map(function (d) {
      return { title: d.title, desc: d.desc, cat: d.cat, budget: d.budget, city: d.city };
    }) });
    this.applyLang();
    this.loadOnline();
  },
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
      'matchTitle', 'matchNote', 'matchNone', 'viewsUnit', 'matchCount', 'postDemand',
      'cityLabel', 'confirmBtn', 'allCities'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.demTitle });
    var cityIds = ['all'];
    var cityNames = [L.allCities || ''];
    Object.keys(data.CITYN).forEach(function (c) {
      cityIds.push(c); cityNames.push(data.cityName(c, lang));
    });
    var cats = data.CATS.map(function (c) { return { id: c.id, name: c[lang] || c.zh }; });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      demands: this._viewDemands(lang),
      open: -1, matches: [], matchTitle: '', matchNote: '',
      cityIds: cityIds, cityNames: cityNames, cats: cats,
      postCityIdx: cityIds.indexOf(this.data.postCitySel),
      postCatIdx: cats.map(function (c) { return c.id; }).indexOf(this.data.postCatSel) });
  },
  _viewDemands: function (lang) {
    return this.data.allDemands.map(function (d, i) {
      return { i: i, title: d.title[lang] || d.title.zh, desc: d.desc[lang] || d.desc.zh,
        cat: data.catName(d.cat, lang), budget: data.money(d.budget),
        city: data.cityName(d.city, lang) };
    });
  },
  // Online: GET /api/demands, merge by title (budgets cents -> yuan),
  // re-render. Offline or on failure: keep the local 9 demands.
  loadOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; return; }
      api.get('/api/demands').then(function (res) {
        self._loadingOnline = false;
        var merged = api.mergeDemands(res.demands || []);
        self.setData({ allDemands: merged,
          demands: self._viewDemands(i18n.getLang()) });
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  // Same matching rule as data.matchDemand, over the merged catalog.
  _match: function (d) {
    var list = api.getCatalog().map(function (r, i) { return { r: r, i: i }; })
      .filter(function (o) { return o.r.cat === d.cat && o.r.price <= d.budget; });
    list.sort(function (a, b) {
      var ac = a.r.city === d.city ? 0 : 1;
      var bc = b.r.city === d.city ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return b.r.views - a.r.views;
    });
    return list;
  },
  toggle: function (e) {
    var i = e.currentTarget.dataset.i;
    var lang = i18n.getLang();
    if (this.data.open === i) {
      this.setData({ open: -1, matches: [], matchTitle: '', matchNote: '' });
      return;
    }
    var d = this.data.allDemands[i];
    var list = this._match(d).map(function (o) {
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
  },
  // --- post a demand (online only; login required) ---
  togglePost: function () {
    this.setData({ showPost: !this.data.showPost });
  },
  onPostTitle: function (e) { this.setData({ postTitle: e.detail.value }); },
  onPostBudget: function (e) { this.setData({ postBudget: e.detail.value }); },
  onPostDesc: function (e) { this.setData({ postDesc: e.detail.value }); },
  onPostCat: function (e) {
    var id = this.data.cats[e.detail.value].id;
    this.setData({ postCatSel: id, postCatIdx: e.detail.value });
  },
  onPostCity: function (e) {
    var id = this.data.cityIds[e.detail.value];
    this.setData({ postCitySel: id, postCityIdx: e.detail.value });
  },
  submitDemand: function () {
    var self = this;
    // No server, or not logged in: prompt the login form (home tab).
    if (!api.isOnline() || !api.ensureLogin()) { api.promptLogin(); return; }
    var title = (this.data.postTitle || '').trim();
    var budgetYuan = parseFloat(this.data.postBudget || '');
    if (!title || isNaN(budgetYuan) || budgetYuan <= 0) {
      wx.showToast({ title: i18n.t('demTitle'), icon: 'none' });
      return;
    }
    var city = this.data.postCitySel && this.data.postCitySel !== 'all'
      ? this.data.postCitySel : '南宁';
    api.post('/api/demands', {
      title: title,
      category: data.catName(this.data.postCatSel, 'zh'),
      budget: api.yuanToCents(budgetYuan), // yuan -> integer cents
      city: city,
      description: this.data.postDesc || ''
    }, true).then(function () {
      self.setData({ postTitle: '', postBudget: '', postDesc: '', showPost: false });
      wx.showToast({ title: title, icon: 'none' });
      self.loadOnline();
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || i18n.t('demTitle'), icon: 'none' });
    });
  }
});
