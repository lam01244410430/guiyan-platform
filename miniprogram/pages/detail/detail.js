var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

var STATUS_KEY = { pending: 'stPending', confirmed: 'stConfirmed', paid: 'stPaid',
  completed: 'stCompleted', cancelled: 'stCancelled', refunded: 'stRefunded',
  refund_requested: 'stRefundRequested', disputed: 'stDisputed' };
var STATUS_STEP = { pending: 0, confirmed: 1, paid: 2, completed: 3, cancelled: -1, refunded: -1 };
// Local action -> API endpoint + resulting local status.
var ACT_API = { confirm: 'confirm', pay: 'pay', complete: 'complete',
  cancel: 'cancel', refund: 'refund' };
var ACT_STATUS = { confirm: 'confirmed', pay: 'paid', complete: 'completed',
  cancel: 'cancelled', refund: 'refunded' };

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    idx: 0, res: null, date: '', qty: 1, total: '', fav: false,
    order: null, flowSteps: []
  },
  onLoad: function (options) {
    var idx = parseInt(options.idx || '0', 10);
    var max = api.getCatalog().length;
    if (isNaN(idx) || idx < 0 || idx >= max) idx = 0;
    var d = new Date(Date.now() + 7 * 86400000);
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ idx: idx, date: date });
    this.applyLang();
    this.loadOnline();
  },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.refreshOrder();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'dateLabel', 'qtyLabel', 'totalLabel', 'bookNow',
      'favOn', 'favOff', 'flow', 'viewsMeta', 'priceMeta', 'orderCreated',
      'actConfirm', 'actCancel', 'actPay', 'actComplete', 'actRefund',
      'doneNote', 'statusToast', 'stPending', 'stConfirmed', 'stPaid',
      'stCompleted', 'stCancelled', 'stRefunded', 'stRefundRequested', 'stDisputed', 'simPay',       'ticketTitle', 'ticketCode', 'datePh', 'modalCancel', 'modalRefund',
      'confirmBtn', 'cancelBtn', 'bookFirst', 'viewsUnit', 'myTickets'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    var r = api.resourceByIdx(this.data.idx) || data.RES[0];
    wx.setNavigationBarTitle({ title: r.name });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      res: { name: r.name, cat: data.catName(r.cat, lang),
        city: data.cityName(r.city, lang), price: data.money(r.price),
        unit: data.unitName(r.unit, lang), views: r.views,
        desc: data.descOf(r, lang) },
      total: data.money(r.price * this.data.qty),
      fav: store.isFav(this.data.idx),
      flowSteps: L.flow });
    this.refreshOrder();
  },
  // Online: refresh the catalog from the server, then re-render.
  loadOnline: function () {
    if (!api.getBase() || this._loadingOnline) return;
    var self = this;
    this._loadingOnline = true;
    api.checkHealth().then(function (ok) {
      if (!ok) { self._loadingOnline = false; return; }
      api.loadResources().then(function () {
        self._loadingOnline = false;
        self.applyLang();
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  refreshOrder: function () {
    var lang = i18n.getLang();
    var list = store.getOrders();
    var order = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].idx === this.data.idx) { order = list[i]; break; }
    }
    if (!order) {
      this.setData({ order: null });
      this.refreshOrderOnline();
      return;
    }
    var r = api.resourceByIdx(order.idx) || data.RES[order.idx];
    this.setData({ order: {
      code: order.code, qty: order.qty, date: order.date,
      total: data.money(order.total), status: order.status,
      statusText: i18n.t(STATUS_KEY[order.status], lang),
      step: STATUS_STEP[order.status], name: r ? r.name : '',
      online: !!order.online, apiId: order.apiId != null ? order.apiId : null,
      payLabel: i18n.fmt(i18n.t('actPay', lang), { amt: data.money(order.total) })
    } });
  },
  // No local order for this resource: pull the server's orders and, if one
  // belongs to this resource, keep a local copy (deduped by code on the
  // orders page) so the ticket shows here too.
  refreshOrderOnline: function () {
    if (!api.isOnline() || !api.ensureLogin() || this._loadingOrders) return;
    var self = this;
    var apiId = api.apiIdForIdx(this.data.idx);
    this._loadingOrders = true;
    api.get('/api/orders', {}, true).then(function (res) {
      self._loadingOrders = false;
      var list = (res.orders || []).map(api.mapApiOrder);
      var found = null;
      for (var i = 0; i < list.length; i++) {
        if (apiId != null && list[i].resourceId === apiId) { found = list[i]; break; }
      }
      if (!found) {
        for (var j = 0; j < list.length; j++) {
          if (list[j].idx === self.data.idx && list[j].status !== 'cancelled') { found = list[j]; break; }
        }
      }
      if (!found) return;
      var local = store.getOrders();
      var exists = false;
      for (var k = 0; k < local.length; k++) {
        if (local[k].code === found.code) { exists = true; break; }
      }
      if (!exists) store.addOrder(found);
      self.refreshOrder();
    }, function () { self._loadingOrders = false; });
  },
  onDate: function (e) { this.setData({ date: e.detail.value }); },
  qtyMinus: function () {
    if (this.data.qty <= 1) return;
    var q = this.data.qty - 1;
    var r = api.resourceByIdx(this.data.idx) || data.RES[this.data.idx];
    this.setData({ qty: q, total: data.money(r.price * q) });
  },
  qtyPlus: function () {
    var q = this.data.qty + 1;
    var r = api.resourceByIdx(this.data.idx) || data.RES[this.data.idx];
    this.setData({ qty: q, total: data.money(r.price * q) });
  },
  toggleFav: function () {
    var self = this;
    api.toggleFav(this.data.idx).then(function (on) {
      wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
      self.setData({ fav: on });
    });
  },
  book: function () {
    if (!this.data.date) {
      wx.showToast({ title: i18n.t('bookFirst'), icon: 'none' });
      return;
    }
    var self = this;
    var r = api.resourceByIdx(this.data.idx) || data.RES[this.data.idx];
    // Online + logged in + resource exists on the server: book via API.
    // The amount is computed server-side; the client never sends one.
    if (api.isOnline() && api.apiIdForIdx(this.data.idx) != null) {
      if (!api.ensureLogin()) { api.promptLogin(); return; }
      api.post('/api/orders', {
        resourceId: api.apiIdForIdx(this.data.idx),
        quantity: this.data.qty,
        booking_date: this.data.date,
        channel: '微信小程序'
      }, true).then(function (res) {
        var o = { code: res.code, idx: self.data.idx,
          resourceId: api.apiIdForIdx(self.data.idx), apiId: res.id,
          online: true, qty: self.data.qty, date: self.data.date,
          total: api.centsToYuan(res.amount), status: res.status || 'pending',
          createdAt: Date.now() };
        store.addOrder(o);
        wx.showToast({ title: i18n.fmt(i18n.t('orderCreated'), { code: o.code }), icon: 'none', duration: 2500 });
        self.refreshOrder();
      }).catch(function (err) {
        // Server refused (e.g. illegal date/stock): show its message,
        // do NOT create a local order for a rejected booking.
        wx.showToast({ title: (err && err.message) || i18n.t('bookFirst'), icon: 'none', duration: 2500 });
      });
      return;
    }
    // Resource not on the server: local booking, as in offline mode.
    var o = store.addOrder(store.newOrder(this.data.idx, this.data.qty,
      this.data.date, r.price * this.data.qty));
    wx.showToast({ title: i18n.fmt(i18n.t('orderCreated'), { code: o.code }), icon: 'none', duration: 2500 });
    this.refreshOrder();
  },
  act: function (e) {
    var action = e.currentTarget.dataset.act;
    var order = this.data.order;
    if (!order) return;
    var self = this;
    var lang = i18n.getLang();
    function done(status) {
      store.updateOrder(order.code, status);
      wx.showToast({ title: i18n.fmt(i18n.t('statusToast', lang),
        { code: order.code, st: i18n.t(STATUS_KEY[status], lang) }), icon: 'none' });
      self.refreshOrder();
    }
    function doneOnline() {
      var status = ACT_STATUS[action];
      api.post('/api/orders/' + order.apiId + '/' + ACT_API[action], {}, true).then(function () {
        done(status);
      }).catch(function (err) {
        wx.showToast({ title: (err && err.message) || i18n.t('statusToast', lang), icon: 'none' });
        self.refreshOrder();
      });
    }
    // Online order (created via the API): drive the server state machine
    // pending -> confirmed -> paid -> completed; local store mirrors it.
    var online = order.online && order.apiId != null && api.isOnline();
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
  goOrders: function () { wx.navigateTo({ url: '/pages/orders/orders' }); }
});
