var i18n = require('../../utils/i18n.js');
var api = require('../../utils/api.js');

// R4-3 (rows 31, 78) — PDA + phone scanning: manual code input +
// wx.scanCode (camera) + an offline queue that syncs through
// POST /api/verify/batch. Sub-page via wx.navigateTo from the 我页;
// tabBar stays 5 pages. Only a linked ADMIN account may scan —
// staff = admin role, there is no separate staff role; a non-admin
// sees "仅管理员可用" and no scan UI.
// Offline queue: codes scanned with no network are stored locally
// under `guiyan-verify-queue` and auto-sync on network restore
// (wx.onNetworkStatusChange) + a manual "同步" button. A queued
// code leaves the queue only after the batch call succeeds; a
// failed batch call keeps it queued.
// Vibration + voice — HONESTY BOUNDARY: the mini-program vibrates
// (wx.vibrateShort on success, wx.vibrateLong on failure) and
// shows a large result text. It has NO native TTS: voice
// announcement is H5-only (Web Speech API in the admin dashboard);
// never claim this page speaks, and no third-party voice plugin
// is used here.
var QUEUE_KEY = 'guiyan-verify-queue';

function loadQueue() {
  try {
    var q = wx.getStorageSync(QUEUE_KEY);
    return Array.isArray(q) ? q : [];
  } catch (e) { return []; }
}
function saveQueue(q) {
  try { wx.setStorageSync(QUEUE_KEY, q); } catch (e) {}
}

Page({
  data: {
    L: {}, langIdx: 0, langName: '中文', langs: ['中文', 'Tiếng Việt', 'English'],
    isAdmin: false, code: '', results: [], queue: [], busy: false, syncing: false
  },
  onLoad: function () {
    this.applyLang();
    this.setData({ queue: loadQueue() });
    var self = this;
    try {
      wx.onNetworkStatusChange(function (res) {
        if (res && res.isConnected) self.syncQueue();
      });
    } catch (e) {}
  },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.checkAdmin();
    this.setData({ queue: loadQueue() });
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['verifyBatchTitle', 'verifyScan', 'verifyBatchPaste', 'verifyBatchSync',
      'verifyQueueTitle', 'verifyQueueEmpty', 'verifyAdminOnly',
      'ticketCode', 'ticketUsed', 'ticketEmpty', 'confirmBtn', 'cancelBtn'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.verifyBatchTitle });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label });
    this.checkAdmin();
  },
  // The linked Guiyan account's role decides: the stored session
  // user (api.getStoredUser) carries role 'admin' for admins.
  checkAdmin: function () {
    var app = null;
    try { app = getApp(); } catch (e) {}
    var user = (app && app.globalData && app.globalData.user) || api.getStoredUser();
    this.setData({ isAdmin: !!(user && user.role === 'admin') });
  },
  onCodeInput: function (e) {
    this.setData({ code: (e.detail.value || '').trim().toUpperCase() });
  },
  // Camera scan — the PDA/phone path. The scanned text is the
  // ticket code (GY + 8 chars); it goes through the same
  // verify-one-code flow as a manual entry.
  scanCode: function () {
    if (!this.data.isAdmin || this.data.busy) return;
    var self = this;
    wx.scanCode({
      onlyFromCamera: false,
      success: function (res) {
        var code = String(res.result || '').trim().toUpperCase();
        if (code) self.verifyCodes([code]);
      },
      fail: function () {}
    });
  },
  verifyManual: function () {
    if (!this.data.isAdmin || this.data.busy) return;
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    this.setData({ code: '' });
    this.verifyCodes([code]);
  },
  // One batch call for 1..N codes. On success the per-code results
  // are shown (large text + vibration) and any of these codes that
  // were queued are removed. On a network/API failure the codes
  // are appended to the offline queue instead — nothing is lost.
  verifyCodes: function (codes) {
    var self = this;
    if (!codes.length || this.data.busy) return;
    this.setData({ busy: true });
    api.post('/api/verify/batch', { codes: codes }, true).then(function (d) {
      var results = (d && d.results) || [];
      var okCount = results.filter(function (r) { return r.result === 'used'; }).length;
      try {
        if (okCount === results.length && results.length) wx.vibrateShort();
        else wx.vibrateLong();
      } catch (e) {}
      var done = {};
      results.forEach(function (r) { done[r.code] = true; });
      var queue = loadQueue().filter(function (c) { return !done[c]; });
      saveQueue(queue);
      self.setData({ results: results.concat(self.data.results).slice(0, 20),
        queue: queue, busy: false });
    }).catch(function () {
      var queue = loadQueue();
      codes.forEach(function (c) { if (queue.indexOf(c) < 0) queue.push(c); });
      saveQueue(queue);
      self.setData({ queue: queue, busy: false });
      try { wx.vibrateLong(); } catch (e) {}
    });
  },
  // Manual sync: send the whole offline queue through the batch
  // endpoint. Queued codes leave the queue only after the call
  // succeeds; a failed call keeps them queued.
  syncQueue: function () {
    var self = this;
    var queue = loadQueue();
    if (!queue.length || this.data.syncing || !this.data.isAdmin) return;
    this.setData({ syncing: true });
    api.post('/api/verify/batch', { codes: queue }, true).then(function (d) {
      var results = (d && d.results) || [];
      var okCount = results.filter(function (r) { return r.result === 'used'; }).length;
      try {
        if (okCount === results.length && results.length) wx.vibrateShort();
        else wx.vibrateLong();
      } catch (e) {}
      saveQueue([]);
      self.setData({ results: results.concat(self.data.results).slice(0, 20),
        queue: [], syncing: false });
    }).catch(function () {
      self.setData({ syncing: false });
    });
  },
  clearQueue: function () {
    saveQueue([]);
    this.setData({ queue: [] });
  }
});
