var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');

var STATUS_KEY = { pending: 'stPending', confirmed: 'stConfirmed', paid: 'stPaid',
  completed: 'stCompleted', cancelled: 'stCancelled', refunded: 'stRefunded' };

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
      'simPay', 'simNote', 'ticketTitle', 'modalCancel', 'modalRefund',
      'confirmBtn', 'cancelBtn', 'viewsUnit'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.myTickets });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label });
    this.refresh();
  },
  refresh: function () {
    var lang = i18n.getLang();
    var orders = store.getOrders().map(function (o) {
      var r = data.RES[o.idx];
      return { code: o.code, idx: o.idx, qty: o.qty, date: o.date,
        total: data.money(o.total), status: o.status,
        statusText: i18n.t(STATUS_KEY[o.status], lang), name: r ? r.name : '',
        city: r ? data.cityName(r.city, lang) : '',
        payLabel: i18n.fmt(i18n.t('actPay', lang), { amt: data.money(o.total) }) };
    });
    var favs = store.getFavs().map(function (idx) {
      var r = data.RES[idx];
      if (!r) return null;
      return { idx: idx, name: r.name, cat: data.catName(r.cat, lang),
        city: data.cityName(r.city, lang), price: data.money(r.price),
        unit: data.unitName(r.unit, lang), views: r.views };
    }).filter(function (x) { return x; });
    this.setData({ orders: orders, favs: favs });
  },
  act: function (e) {
    var action = e.currentTarget.dataset.act;
    var code = e.currentTarget.dataset.code;
    var lang = i18n.getLang();
    var self = this;
    function done(status) {
      store.updateOrder(code, status);
      wx.showToast({ title: i18n.fmt(i18n.t('statusToast', lang),
        { code: code, st: i18n.t(STATUS_KEY[status], lang) }), icon: 'none' });
      self.refresh();
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
  goDetail: function (e) {
    wx.navigateTo({ url: '/pages/detail/detail?idx=' + e.currentTarget.dataset.idx });
  },
  goCatalog: function () { wx.switchTab({ url: '/pages/category/category' }); }
});
