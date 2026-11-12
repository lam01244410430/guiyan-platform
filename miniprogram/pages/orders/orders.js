var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

var STATUS_KEY = { pending: 'stPending', confirmed: 'stConfirmed', paid: 'stPaid',
  completed: 'stCompleted', cancelled: 'stCancelled', refunded: 'stRefunded' };
var ACT_API = { confirm: 'confirm', pay: 'pay', complete: 'complete',
  cancel: 'cancel', refund: 'refund' };
var ACT_STATUS = { confirm: 'confirmed', pay: 'paid', complete: 'completed',
  cancel: 'cancelled', refund: 'refunded' };

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    orders: [], favs: []
  },
  onLoad: function () { this.applyLang(); },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.refresh();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'myTickets', 'emptyOrdersMini', 'favTitle', 'emptyFav',
      'favSection', 'ordersSection', 'actConfirm', 'actCancel', 'actPay',
      'actComplete', 'actRefund', 'doneNote', 'statusToast', 'stPending',
      'stConfirmed', 'stPaid', 'stCompleted', 'stCancelled', 'stRefunded',
      'simPay', 'ticketTitle', 'modalCancel', 'modalRefund',
      'confirmBtn', 'cancelBtn', 'viewsUnit'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.myTickets });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label });
    this.refresh();
  },
  _orderView: function (o, lang) {
    var r = api.resourceByIdx(o.idx);
    return { code: o.code, idx: o.idx, qty: o.qty, date: o.date,
      total: data.money(o.total), status: o.status,
      statusText: i18n.t(STATUS_KEY[o.status], lang),
      name: o.name || (r ? r.name : ''),
      city: o.city || (r ? data.cityName(r.city, lang) : ''),
      online: !!o.online, apiId: o.apiId != null ? o.apiId : null,
      payLabel: i18n.fmt(i18n.t('actPay', lang), { amt: data.money(o.total) }) };
  },
  _favView: function (idx, lang) {
    var r = api.resourceByIdx(idx);
    if (!r) return null;
    return { idx: idx, name: r.name, cat: data.catName(r.cat, lang),
      city: data.cityName(r.city, lang), price: data.money(r.price),
      unit: data.unitName(r.unit, lang), views: r.views };
  },
  refresh: function () {
    var lang = i18n.getLang();
    var self = this;
    var orders = store.getOrders().map(function (o) { return self._orderView(o, lang); });
    var favs = store.getFavs().map(function (idx) { return self._favView(idx, lang); })
      .filter(function (x) { return x; });
    this.setData({ orders: orders, favs: favs });
    this.refreshOnline();
  },
  // Online: merge GET /api/orders into the list (deduped by code; the
  // server's status wins for an order we already hold locally) and
  // GET /api/favorites into the favorites section (merged by name).
  // Local orders/favorites stay visible too. Silent fallback on failure.
  refreshOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    var lang = i18n.getLang();
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; return; }
      var jobs = [];
      if (api.ensureLogin()) {
        jobs.push(api.get('/api/orders', {}, true).then(function (res) {
          var serverOrders = (res.orders || []).map(api.mapApiOrder);
          var view = self.data.orders.slice();
          var byCode = {};
          view.forEach(function (o, i) { byCode[o.code] = i; });
          var extra = [];
          serverOrders.forEach(function (o) {
            var v = self._orderView(o, lang);
            if (byCode[v.code] !== undefined) view[byCode[v.code]] = v;
            else extra.push(v);
          });
          self.setData({ orders: extra.concat(view) });
        }).catch(function () {}));
        jobs.push(api.get('/api/favorites', {}, true).then(function (res) {
          var idxs = api.favIdxsFromApi(res.favorites || []);
          var seen = {};
          store.getFavs().forEach(function (i) { seen[i] = true; });
          idxs.forEach(function (i) { seen[i] = true; });
          var favs = Object.keys(seen).map(function (k) {
            return self._favView(parseInt(k, 10), lang);
          }).filter(function (x) { return x; });
          self.setData({ favs: favs });
        }).catch(function () {}));
      }
      Promise.all(jobs).then(function () { self._loadingOnline = false; },
        function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  act: function (e) {
    var action = e.currentTarget.dataset.act;
    var code = e.currentTarget.dataset.code;
    var lang = i18n.getLang();
    var self = this;
    var order = null;
    for (var i = 0; i < this.data.orders.length; i++) {
      if (this.data.orders[i].code === code) { order = this.data.orders[i]; break; }
    }
    function done(status) {
      store.updateOrder(code, status);
      wx.showToast({ title: i18n.fmt(i18n.t('statusToast', lang),
        { code: code, st: i18n.t(STATUS_KEY[status], lang) }), icon: 'none' });
      self.refresh();
    }
    function doneOnline() {
      api.post('/api/orders/' + order.apiId + '/' + ACT_API[action], {}, true).then(function () {
        done(ACT_STATUS[action]);
      }).catch(function (err) {
        wx.showToast({ title: (err && err.message) || i18n.t('statusToast', lang), icon: 'none' });
        self.refresh();
      });
    }
    // Online order: drive the server state machine, local store mirrors it.
    var online = order && order.online && order.apiId != null && api.isOnline();
    var run = online ? doneOnline : function () { done(ACT_STATUS[action]); };
    if (action === 'cancel') {
      wx.showModal({ title: i18n.t('modalCancel', lang), confirmText: i18n.t('confirmBtn', lang),
        cancelText: i18n.t('cancelBtn', lang),
        success: function (res) { if (res.confirm) run(); } });
    } else if (action === 'refund') {
      wx.showModal({ title: i18n.t('modalRefund', lang), confirmText: i18n.t('confirmBtn', lang),
        cancelText: i18n.t('cancelBtn', lang),
        success: function (res) { if (res.confirm) run(); } });
    } else if (ACT_STATUS[action]) run();
  },
  goDetail: function (e) {
    wx.navigateTo({ url: '/pages/detail/detail?idx=' + e.currentTarget.dataset.idx });
  },
  goCatalog: function () { wx.switchTab({ url: '/pages/category/category' }); }
});
