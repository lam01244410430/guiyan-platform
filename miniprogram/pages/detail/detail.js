var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var store = require('../../utils/store.js');
var api = require('../../utils/api.js');

var STATUS_KEY = { pending: 'stPending', confirmed: 'stConfirmed', paid: 'stPaid',
  completed: 'stCompleted', cancelled: 'stCancelled', refunded: 'stRefunded',
  refund_requested: 'stRefundRequested', disputed: 'stDisputed' };
// R6-2: venue free-day calendar (read-only). Weekday/month names are
// fixed per-language arrays (the mini-program JS runtime has no
// reliable Intl). Navigation stops at the demo-baseline month 2026-11.
var CAL_WEEKDAYS = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
};
var CAL_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
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
    order: null, flowSteps: [], perfs: null, perfSel: null, tierSel: null,
    pickupPoints: null, pickupSel: null, // R2-3: pickup points of the selected performance's show (null = not loaded); the chosen point id
    seats: null, seatSel: [], seatZones: [], seatSelectedText: '', // R2-5: seats of the selected performance (null = not loaded); the chosen seat ids + the grouped grid
    couponCode: '', // R3-2: coupon code typed on this page (optional, sent with the order)
    flashLeft: '', // R3-3: live flash-sale countdown text for the selected tier ('' = no live sale)
    // R6-2: venue free-day calendar (null = not loaded / not a venue).
    calMonth: '', calDays: null, calWeekdays: [], calLabel: '', calOccupied: []
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
    // R5-1 埋点采集: opening a detail is a click on that resource,
    // fire-and-forget (no await, no retry, never blocks the UI).
    // Offline the send is simply dropped — the client never claims
    // an event was recorded when it was not. Anonymous sends count
    // too (server-side). No apiId yet (offline/local catalog) means
    // nothing is recorded. The dwell clock starts here as well.
    this._detailOpenedAt = Date.now();
    var apiId = api.apiIdForIdx(idx);
    this._detailApiId = apiId;
    if (apiId != null) {
      api.post('/api/events', { type: 'click', detail: 'resource:' + apiId }).then(function () {}, function () {});
    }
  },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.refreshOrder();
    // R3-3: restart the flash-sale countdown while this page is shown.
    this.startFlashTimer();
  },
  onHide: function () {
    // R3-3: the countdown never ticks on a hidden page.
    this.stopFlashTimer();
  },
  onUnload: function () {
    // R3-3: drop the countdown timer with the page.
    this.stopFlashTimer();
    // R5-1: one dwell event for the detail just left, capped at the
    // server's 3600000 ms. Fire-and-forget, like the click above.
    if (this._detailApiId != null && this._detailOpenedAt) {
      var ms = Date.now() - this._detailOpenedAt;
      if (ms > 3600000) ms = 3600000;
      api.post('/api/events', { type: 'dwell', detail: 'resource:' + this._detailApiId, duration_ms: ms }).then(function () {}, function () {});
    }
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
      'confirmBtn', 'cancelBtn', 'bookFirst', 'viewsUnit', 'myTickets',
      'perfTitle', 'perfEmpty', 'perfOnSale',
      'tierTitle', 'tierEmpty', 'tierSoldOut', 'tierLeft', 'tierPick',
      'pickupTitle', 'pickupEmpty', 'pickupPick',
      'venueTitle', 'seatPick', 'seatSelected',
      // R6-2: venue free-day calendar.
      'venueCalendar', 'venueFree', 'venueOccupied', 'venueOccupiedDays',
      'couponCode', 'couponCodePh', 'couponSaved',
      'flashSale', 'flashSaleLeft', 'flashSaleSaved',
      'licInfo', 'licHolder', 'licType', 'licRegion'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    var r = api.resourceByIdx(this.data.idx) || data.RES[0];
    wx.setNavigationBarTitle({ title: r.name });
    // R6-1: copyright facts from resources.meta (fact fields only,
    // never invented — the block hides when none are set).
    var licMeta = (r && r.meta) || {};
    var licRows = [];
    if (licMeta.copyright_holder) licRows.push({ k: L.licHolder, v: licMeta.copyright_holder });
    if (licMeta.license_type) licRows.push({ k: L.licType, v: licMeta.license_type });
    if (licMeta.ip_region) licRows.push({ k: L.licRegion, v: licMeta.ip_region });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      res: { name: r.name, cat: data.catName(r.cat, lang),
        city: data.cityName(r.city, lang), price: data.money(r.price),
        unit: data.unitName(r.unit, lang), views: r.views,
        desc: data.descOf(r, lang) },
      total: data.money(r.price * this.data.qty),
      fav: store.isFav(this.data.idx),
      flowSteps: L.flow, licRows: licRows });
    // R2-2: a language switch re-renders the tier left/sold-out text
    // (baked per language in refreshTierText), and the total follows
    // the selected tier price.
    this.refreshTierText();
    this.refreshSeats();
    this.refreshTotal();
    this.refreshOrder();
    // R6-2: a language switch re-renders the calendar labels from
    // the cached month data (no refetch).
    this.renderCalendar();
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
        self.loadPerformances();
        self.loadCalendar();
      }, function () { self._loadingOnline = false; });
    }, function () { self._loadingOnline = false; });
  },
  // R6-2: venue free-day calendar (read-only, best-effort like
  // loadPerformances): only for venue-category resources staged in
  // a real venue row. A failed fetch just leaves the calendar
  // hidden; the month grid is rebuilt by renderCalendar below.
  loadCalendar: function () {
    var self = this;
    var r = api.resourceByIdx(this.data.idx);
    if (!r || r.cat !== 'venue') return;
    var venueId = r.venue_id != null ? r.venue_id
      : (r.venue && r.venue.id != null ? r.venue.id : null);
    if (venueId == null || !api.getBase()) return;
    if (!this.data.calMonth) {
      var now = new Date();
      this.setData({ calMonth: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') });
    }
    var month = this.data.calMonth;
    api.get('/api/venues/available?venue_id=' + venueId + '&month=' + month, {}, false).then(function (d) {
      var byDate = {};
      (d.occupied || []).forEach(function (o) { byDate[o.date] = o.performances || []; });
      self._calByDate = byDate;
      self.renderCalendar();
    }, function () {});
  },
  renderCalendar: function () {
    if (!this.data.calMonth || !this._calByDate) return;
    var self = this;
    var lang = i18n.getLang();
    var parts = this.data.calMonth.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var days = new Date(y, m, 0).getDate();
    var first = new Date(y, m - 1, 1).getDay();
    var cells = [];
    for (var i = 0; i < first; i++) cells.push(null);
    for (var d = 1; d <= days; d++) {
      var key = this.data.calMonth + '-' + String(d).padStart(2, '0');
      var perfs = this._calByDate[key];
      cells.push({ d: d, occ: !!(perfs && perfs.length),
        titles: perfs ? perfs.map(function (p) { return p.show_title; }).join('、') : '' });
    }
    var label = lang === 'zh' ? y + '年' + m + '月'
      : lang === 'vi' ? 'Tháng ' + m + '/' + y
      : CAL_MONTHS_EN[m - 1] + ' ' + y;
    var occList = Object.keys(this._calByDate).sort().map(function (date) {
      return { date: date,
        titles: self._calByDate[date].map(function (p) { return p.show_title; }).join('、') };
    });
    this.setData({ calDays: cells, calWeekdays: CAL_WEEKDAYS[lang] || CAL_WEEKDAYS.zh,
      calLabel: label, calOccupied: occList });
  },
  onCalPrev: function () { this.shiftCalMonth(-1); },
  onCalNext: function () { this.shiftCalMonth(1); },
  shiftCalMonth: function (delta) {
    if (!this.data.calMonth) return;
    var parts = this.data.calMonth.split('-');
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1);
    var next = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (next < '2026-11') return;
    this.setData({ calMonth: next });
    this.loadCalendar();
  },
  // R2-1: on-sale performances for a show resource (read-only,
  // best-effort like the theme fetch on the home page): a failed
  // fetch just leaves the list hidden (offline fallback keeps the
  // local behaviour, no error is ever shown).
  // R2-2: each performance carries its ticket_types (id, name, price,
  // quota, sold, available); picking a performance then a tier drives
  // the total and the order (performance_id + ticket_type_id).
  loadPerformances: function () {
    var self = this;
    var r = api.resourceByIdx(this.data.idx);
    if (!r || r.cat !== 'show') return;
    var apiId = api.apiIdForIdx(this.data.idx);
    if (apiId == null || !api.getBase()) return;
    api.get('/api/resources/' + apiId + '/availability', {}, false).then(function (d) {
      var list = (d && d.performances) || [];
      self.setData({ perfs: list.map(function (p) {
        return { id: p.id, show_id: p.show_id, start_at: p.start_at,
          price: data.money(api.centsToYuan(p.price_cents)),
          ticket_types: (p.ticket_types || []).map(function (t) {
            return { id: t.id, name: t.name,
              price: data.money(api.centsToYuan(t.price_cents)),
              priceCents: t.price_cents, quota: t.quota,
              sold: t.sold, available: t.available,
              sale_until: t.sale_until, leftText: '',
              // R3-3: the live flash sale on this tier (null = none)
              // + its sale price as a display string ('' = no sale).
              flash_sale: t.flash_sale || null,
              salePrice: t.flash_sale ? data.money(api.centsToYuan(t.flash_sale.sale_price_cents)) : '' };
          }) };
      }) });
      self.refreshTierText();
      self.refreshTotal();
      self.refreshFlashCountdown();
    }, function () {});
  },
  // R2-2: per-language tier availability text ("剩余 3 张" / "已售罄"),
  // recomputed whenever the language or the tier list changes.
  refreshTierText: function () {
    var perfs = this.data.perfs;
    if (!perfs) return;
    var lang = i18n.getLang();
    this.setData({ perfs: perfs.map(function (p) {
      return Object.assign({}, p, { ticket_types: (p.ticket_types || []).map(function (tt) {
        return Object.assign({}, tt, { leftText: tt.available > 0
          ? i18n.fmt(i18n.t('tierLeft', lang), { a: tt.available })
          : i18n.t('tierSoldOut', lang) });
      }) });
    }) });
  },
  selectedPerf: function () {
    var perfs = this.data.perfs || [];
    for (var i = 0; i < perfs.length; i++)
      if (perfs[i].id === this.data.perfSel) return perfs[i];
    return null;
  },
  selectedTier: function () {
    var p = this.selectedPerf();
    if (!p) return null;
    var tiers = p.ticket_types || [];
    for (var j = 0; j < tiers.length; j++)
      if (tiers[j].id === this.data.tierSel) return tiers[j];
    return null;
  },
  unitPriceYuan: function () {
    var tier = this.selectedTier();
    // R3-3: the sale price drives the total while a flash sale is
    // live on the selected tier (the server prices the order — this
    // is display only, like the tier price above it).
    if (tier) return api.centsToYuan(tier.flash_sale ? tier.flash_sale.sale_price_cents : tier.priceCents);
    var r = api.resourceByIdx(this.data.idx) || data.RES[this.data.idx];
    return r.price;
  },
  refreshTotal: function () {
    this.setData({ total: data.money(this.unitPriceYuan() * this.data.qty) });
  },
  // R3-3: the live flash-sale countdown for the selected tier —
  // seconds left from ends_at, re-rendered once a second while this
  // page is shown. The timer is started on show and cleared on hide
  // (and on unload), so it never ticks on a hidden page.
  refreshFlashCountdown: function () {
    var tier = this.selectedTier();
    var lang = i18n.getLang();
    if (!tier || !tier.flash_sale) { this.setData({ flashLeft: '' }); return; }
    var left = Math.max(0, Math.floor((new Date(tier.flash_sale.ends_at).valueOf() - Date.now()) / 1000));
    this.setData({ flashLeft: i18n.t('flashSale', lang) + ' · ' + i18n.fmt(i18n.t('flashSaleLeft', lang), { s: left }) });
  },
  startFlashTimer: function () {
    var self = this;
    this.stopFlashTimer();
    this._flashTimer = setInterval(function () { self.refreshFlashCountdown(); }, 1000);
    this.refreshFlashCountdown();
  },
  stopFlashTimer: function () {
    if (this._flashTimer) { clearInterval(this._flashTimer); this._flashTimer = null; }
  },
  // R2-5: seats of the selected performance, grouped by zone for the
  // tap-to-select grid (zones in first-seen order; cells row-major).
  // The selected-count text is baked per language, like the tier text.
  refreshSeats: function () {
    var seats = this.data.seats || [];
    var sel = this.data.seatSel || [];
    var lang = i18n.getLang();
    var order = [];
    var byZone = {};
    seats.forEach(function (s) {
      var z = s.zone || '';
      if (!byZone[z]) { byZone[z] = { name: z, cells: {} }; order.push(byZone[z]); }
      byZone[z].cells[s.row + ':' + s.col] = s;
    });
    var zones = order.map(function (z) {
      var rows = 0;
      var cols = 0;
      Object.keys(z.cells).forEach(function (k) {
        rows = Math.max(rows, z.cells[k].row);
        cols = Math.max(cols, z.cells[k].col);
      });
      var cells = [];
      for (var r = 1; r <= rows; r++)
        for (var c = 1; c <= cols; c++) {
          var s = z.cells[r + ':' + c];
          if (s) cells.push({ id: s.id, label: r + '-' + c, status: s.status, sel: sel.indexOf(s.id) >= 0 });
        }
      return { name: z.name, cols: cols, cells: cells };
    });
    this.setData({ seatZones: zones,
      seatSelectedText: sel.length ? i18n.fmt(i18n.t('seatSelected', lang), { n: sel.length }) : '' });
  },
  onSeatTap: function (e) {
    if (e.currentTarget.dataset.status !== 'available') return;
    var id = e.currentTarget.dataset.id;
    var sel = this.data.seatSel.slice();
    var i = sel.indexOf(id);
    if (i >= 0) sel.splice(i, 1); else sel.push(id);
    this.setData({ seatSel: sel });
    this.refreshSeats();
  },
  onPerfTap: function (e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    if (this.data.perfSel === id) {
      this.setData({ perfSel: null, tierSel: null, pickupPoints: null, pickupSel: null, seats: null, seatSel: [] });
      this.refreshSeats();
      this.refreshTotal();
      this.refreshFlashCountdown();
      return;
    }
    this.setData({ perfSel: id, tierSel: null, pickupSel: null, pickupPoints: null, seats: null, seatSel: [] });
    // R5-1: picking a performance is a click on that show
    // (fire-and-forget, never blocks the UI).
    api.post('/api/events', { type: 'click', detail: 'show:' + id }).then(function () {}, function () {});
    this.refreshSeats();
    // R2-3: selecting a performance loads its show's pickup points
    // (public, best-effort like the performance list); a failed fetch
    // leaves the list empty and the server still enforces the
    // requirement at order time.
    // R2-5: selecting also loads the performance's seats (public,
    // best-effort); a failed fetch leaves the grid hidden and the
    // order still books without seats.
    var perf = this.selectedPerf();
    if (perf && perf.show_id) {
      api.get('/api/shows/' + perf.show_id + '/pickup-points', {}, false).then(function (d) {
        self.setData({ pickupPoints: d.pickup_points || [] });
      }, function () { self.setData({ pickupPoints: [] }); });
    } else {
      this.setData({ pickupPoints: [] });
    }
    api.get('/api/performances/' + id + '/seats', {}, false).then(function (d) {
      self.setData({ seats: d.seats || [] });
      self.refreshSeats();
    }, function () { self.setData({ seats: [] }); self.refreshSeats(); });
    this.refreshTotal();
  },
  onPickupTap: function (e) {
    var id = e.currentTarget.dataset.id;
    this.setData({ pickupSel: this.data.pickupSel === id ? null : id });
  },
  onTierTap: function (e) {
    var id = e.currentTarget.dataset.id;
    if (Number(e.currentTarget.dataset.avail || 0) <= 0) return;
    this.setData({ tierSel: this.data.tierSel === id ? null : id });
    // R5-1: picking a ticket type is a click on it (fire-and-forget).
    if (this.data.tierSel === id) {
      api.post('/api/events', { type: 'click', detail: 'ticket_type:' + id }).then(function () {}, function () {});
    }
    this.refreshTotal();
    this.refreshFlashCountdown();
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
      pickup: order.pickup || null, template: order.template || null,
      // R3-2: the coupon discount line, computed per language from the
      // stored cents ('' = no coupon on this order).
      couponSavedText: (order.coupon_cents > 0)
        ? i18n.fmt(i18n.t('couponSaved', lang), { a: (order.coupon_cents / 100).toFixed(2) }) : '',
      // R3-3: the flash-sale discount line, same pattern ('' = no sale
      // on this order).
      flashSavedText: (order.flash_cents > 0)
        ? i18n.fmt(i18n.t('flashSaleSaved', lang), { a: (order.flash_cents / 100).toFixed(2) }) : '',
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
    this.setData({ qty: q });
    this.refreshTotal();
  },
  qtyPlus: function () {
    var q = this.data.qty + 1;
    this.setData({ qty: q });
    this.refreshTotal();
  },
  toggleFav: function () {
    var self = this;
    api.toggleFav(this.data.idx).then(function (on) {
      wx.showToast({ title: i18n.t(on ? 'favAdd' : 'favRemove'), icon: 'none' });
      self.setData({ fav: on });
    });
  },
  onCouponInput: function (e) {
    this.setData({ couponCode: e.detail.value || '' });
  },
  book: function () {
    if (!this.data.date) {
      wx.showToast({ title: i18n.t('bookFirst'), icon: 'none' });
      return;
    }
    var self = this;
    // R2-2: a selected tier drives the order — the server prices it and
    // takes the booking date from the performance; the local order
    // mirrors that with the tier price + performance date.
    var tier = this.selectedTier();
    var perf = this.selectedPerf();
    var orderDate = tier ? perf.start_at.slice(0, 10) : this.data.date;
    var orderTotal = this.unitPriceYuan() * this.data.qty;
    // R2-3: a tier order against a show with pickup points must name
    // one; the order button is blocked until it is picked.
    var pickupPoints = this.data.pickupPoints || [];
    var pickupSel = null;
    for (var k = 0; k < pickupPoints.length; k++)
      if (pickupPoints[k].id === this.data.pickupSel) { pickupSel = pickupPoints[k]; break; }
    if (tier && pickupPoints.length > 0 && !pickupSel) {
      wx.showToast({ title: i18n.t('pickupPick'), icon: 'none' });
      return;
    }
    // Online + logged in + resource exists on the server: book via API.
    // The amount is computed server-side; the client never sends one.
    if (api.isOnline() && api.apiIdForIdx(this.data.idx) != null) {
      if (!api.ensureLogin()) { api.promptLogin(); return; }
      var body = {
        resourceId: api.apiIdForIdx(this.data.idx),
        quantity: this.data.qty,
        booking_date: orderDate,
        channel: '微信小程序'
      };
      if (tier) {
        body.performance_id = perf.id;
        body.ticket_type_id = tier.id;
        if (pickupSel) body.pickup_point_id = pickupSel.id;
      }
      // R3-2: a typed coupon code rides along; the server validates it
      // (shop, window, min spend, quota, per-user limit) and prices it.
      var couponCode = (self.data.couponCode || '').trim();
      if (couponCode) body.coupon_code = couponCode;
      api.post('/api/orders', body, true).then(function (res) {
        var o = { code: res.code, idx: self.data.idx,
          resourceId: api.apiIdForIdx(self.data.idx), apiId: res.id,
          online: true, qty: self.data.qty, date: orderDate,
          total: api.centsToYuan(res.amount), status: res.status || 'pending',
          coupon_cents: (typeof res.coupon_cents === 'number' ? res.coupon_cents : 0),
          couponSavedText: (typeof res.coupon_cents === 'number' && res.coupon_cents > 0)
            ? i18n.fmt(i18n.t('couponSaved'), { a: (res.coupon_cents / 100).toFixed(2) }) : '',
          flash_cents: (typeof res.flash_cents === 'number' ? res.flash_cents : 0),
          flashSavedText: (typeof res.flash_cents === 'number' && res.flash_cents > 0)
            ? i18n.fmt(i18n.t('flashSaleSaved'), { a: (res.flash_cents / 100).toFixed(2) }) : '',
          pickup: res.pickup_point || pickupSel || null,
          template: res.ticket_template || null,
          createdAt: Date.now() };
        store.addOrder(o);
        self.setData({ couponCode: '' });
        // R2-5: hold the seats the buyer picked on the pending order.
        // A failed hold leaves the order standing (pending) — the
        // server error is shown, never a silent loss.
        if (tier && self.data.seatSel.length > 0) {
          api.post('/api/orders/' + res.id + '/seats', { seat_ids: self.data.seatSel }, true).then(function () {}, function (err) {
            wx.showToast({ title: (err && err.message) || '选座失败', icon: 'none', duration: 2500 });
          });
        }
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
      orderDate, orderTotal));
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
