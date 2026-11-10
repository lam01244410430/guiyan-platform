var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');

var STATUS_KEY = { pending: 'stPending', confirmed: 'stConfirmed', paid: 'stPaid',
  completed: 'stCompleted', cancelled: 'stCancelled', refunded: 'stRefunded' };
var STATUS_STEP = { pending: 0, confirmed: 1, paid: 2, completed: 3, cancelled: -1, refunded: -1 };

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    idx: 0, res: null, date: '', qty: 1, total: '', fav: false,
    order: null, flowSteps: []
  },
  onLoad: function (options) {
    var idx = parseInt(options.idx || '0', 10);
    if (isNaN(idx) || idx < 0 || idx >= data.RES.length) idx = 0;
    var d = new Date(Date.now() + 7 * 86400000);
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ idx: idx, date: date });
    this.applyLang();
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
      'stCompleted', 'stCancelled', 'stRefunded', 'simPay', 'simNote',
      'ticketTitle', 'ticketCode', 'datePh', 'modalCancel', 'modalRefund',
      'confirmBtn', 'cancelBtn', 'bookFirst', 'viewsUnit', 'myTickets'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    var r = data.RES[this.data.idx];
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
  refreshOrder: function () {
    var lang = i18n.getLang();
    var list = store.getOrders();
    var order = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].idx === this.data.idx) { order = list[i]; break; }
    }
    if (!order) { this.setData({ order: null }); return; }
    var r = data.RES[order.idx];
    this.setData({ order: {
      code: order.code, qty: order.qty, date: order.date,
      total: data.money(order.total), status: order.status,
      statusText: i18n.t(STATUS_KEY[order.status], lang),
      step: STATUS_STEP[order.status], name: r.name,
      payLabel: i18n.fmt(i18n.t('actPay', lang), { amt: data.money(order.total) })
    } });
  },
  onDate: function (e) { this.setData({ date: e.detail.value }); },
  qtyMinus: function () {
    if (this.data.qty <= 1) return;
    var q = this.data.qty - 1;
    this.setData({ qty: q, total: data.money(data.RES[this.data.idx].price * q) });
  },
  qtyPlus: function () {
    var q = this.data.qty + 1;
    this.setData({ qty: q, total: data.money(data.RES[this.data.idx].price * q) });
  },
  toggleFav: function () {
    var on = store.toggleFav(this.data.idx);
    wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
    this.setData({ fav: on });
  },
  book: function () {
    if (!this.data.date) {
      wx.showToast({ title: i18n.t('bookFirst'), icon: 'none' });
      return;
    }
    var r = data.RES[this.data.idx];
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
    if (action === 'cancel') {
      wx.showModal({ title: i18n.t('modalCancel', lang), confirmText: i18n.t('confirmBtn', lang),
        cancelText: i18n.t('cancelBtn', lang),
        success: function (res) { if (res.confirm) done('cancelled'); } });
    } else if (action === 'refund') {
      wx.showModal({ title: i18n.t('modalRefund', lang), confirmText: i18n.t('confirmBtn', lang),
        cancelText: i18n.t('cancelBtn', lang),
        success: function (res) { if (res.confirm) done('refunded'); } });
    } else if (action === 'confirm') done('confirmed');
    else if (action === 'pay') done('paid');
    else if (action === 'complete') done('completed');
  },
  goOrders: function () { wx.switchTab({ url: '/pages/orders/orders' }); }
});
