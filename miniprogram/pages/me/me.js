var i18n = require('../../utils/i18n.js');
var api = require('../../utils/api.js');

// 我 tab: profile + orders/favorites/demands shortcuts + account info +
// settings. Sign-in has two layers: (1) wx.login -> POST
// /api/auth/wechat-mini (one tap; proves only "this device opened with
// WeChat account X" — no phone/email/real name without user consent);
// (2) link an existing Guiyan account once with username/password, then
// auto-login via the stored token. Password/email/phone changes stay on
// the H5 site (OTP there), not in the mini-program.
var WX_PROFILE_KEY = 'guiyan-wx-profile';

function loadWxProfile() {
  try {
    var p = wx.getStorageSync(WX_PROFILE_KEY);
    return (p && typeof p === 'object') ? p : null;
  } catch (e) { return null; }
}

Page({
  data: {
    L: {}, langIdx: 0, langName: '中文', langs: ['中文', 'Tiếng Việt', 'English'],
    loggedUser: '', displayName: '', avatarChar: '桂', linkStatus: '',
    wxAvatar: '', wxNick: '', profile: {}, genderText: '', memberTier: null,
    tierLine: '', tierNextLine: '',
    showLink: false, linkUser: '', linkPass: '',
    showEdit: false, editName: '', editCity: '', editAge: '', editGenderIdx: 0,
    genderNames: [], showAbout: false
  },
  onLoad: function () { this.applyLang(); this.syncAuth(); },
  onShow: function () {
    var app = getApp();
    if (app.globalData.meShowLink) {
      app.globalData.meShowLink = false;
      this.setData({ showLink: true });
    }
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
    else this.syncAuth();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'meTitle', 'wechatLoginBtn', 'linkAccountBtn',
      'linkHint', 'wxProfileBtn', 'notLoggedIn', 'linkedAs',
      'unlinkedAccount', 'ordersSection', 'favSection', 'myDemandsRow',
      'accountInfoRow', 'settingsRow', 'aboutRow', 'aboutText',
      'logoutBtn', 'userPh', 'passPh', 'nameLabel', 'cityLabel',
      'ageLabel', 'genderLabel', 'genderMale', 'genderFemale',
      'genderNone', 'editProfileBtn', 'saveBtn', 'profileSaved',
      'wxLoginFailed', 'linkFailed', 'langLabel',
      'memberTierTitle', 'memberTierCurrent', 'memberTierNext',
      'memberTierSpendMore', 'memberTierDiscount'];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.meTitle });
    var wxp = loadWxProfile();
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label,
      genderNames: [L.genderNone, L.genderMale, L.genderFemale],
      wxAvatar: wxp ? (wxp.avatar || '') : '',
      wxNick: wxp ? (wxp.nick || '') : '' });
    this.syncAuth();
  },
  syncAuth: function () {
    var app = getApp();
    var user = app.globalData.user || api.getStoredUser();
    var lang = i18n.getLang();
    if (!user) {
      this.setData({ loggedUser: '', profile: {}, genderText: '', memberTier: null,
        displayName: this.data.wxNick || i18n.t('notLoggedIn', lang),
        avatarChar: (this.data.wxNick || '桂').slice(0, 1),
        linkStatus: i18n.t('unlinkedAccount', lang) });
      return;
    }
    var name = user.name || user.username || '';
    var gender = user.gender || '';
    var genderText = gender === '男' ? i18n.t('genderMale', lang)
      : gender === '女' ? i18n.t('genderFemale', lang)
      : i18n.t('genderNone', lang);
    this.setData({ loggedUser: name, profile: user, genderText: genderText,
      // Display name defaults to the linked Guiyan account; the WeChat
      // nickname is shown only while no Guiyan account is linked.
      displayName: name,
      avatarChar: (name || '桂').slice(0, 1),
      linkStatus: i18n.fmt(i18n.t('linkedAs', lang), { name: name }),
      editName: user.name || '', editCity: user.city || '',
      editAge: user.age != null ? String(user.age) : '',
      editGenderIdx: gender === '男' ? 1 : gender === '女' ? 2 : 0 });
    // R3-1: own member tier (best-effort — a failed fetch leaves the
    // row hidden, it never blocks the page). Display strings are built
    // here: WXML bindings cannot call String.replace.
    var self = this;
    api.get('/api/account/tier', {}, true).then(function (d) {
      if (!d) { self.setData({ memberTier: null }); return; }
      var tierLine = (d.tier ? d.tier.name : '-');
      if (d.discount_pct) tierLine += ' · ' + i18n.fmt(i18n.t('memberTierDiscount', lang), { p: d.discount_pct });
      var nextLine = '';
      if (d.next_tier) nextLine = d.next_tier.name + ' · ' + i18n.fmt(i18n.t('memberTierSpendMore', lang), { a: d.remaining_cents / 100 });
      self.setData({ memberTier: d, tierLine: tierLine, tierNextLine: nextLine });
    }).catch(function () { /* keep memberTier null */ });
  },
  // --- layer 1: one-tap WeChat sign-in -------------------------------------
  wechatLogin: function () {
    var self = this;
    wx.login({
      success: function (res) {
        if (!res.code) { self._wxFail(); return; }
        api.wechatLogin(res.code).then(function (r) {
          if (r && r.linked === false) {
            // WeChat is fine, but this openid has no Guiyan account yet:
            // open the link form instead of failing.
            self.setData({ showLink: true });
            wx.showToast({ title: i18n.t('linkHint'), icon: 'none', duration: 3000 });
            return;
          }
          self.afterLogin(r && r.user);
        }).catch(function (err) { self._wxFail(err); });
      },
      fail: function () { self._wxFail(); }
    });
  },
  _wxFail: function (err) {
    wx.showToast({ title: (err && err.message) || i18n.t('wxLoginFailed'), icon: 'none', duration: 3000 });
    this.setData({ showLink: true });
  },
  // --- layer 2: link an existing Guiyan account (once) --------------------
  toggleLink: function () {
    this.setData({ showLink: !this.data.showLink });
  },
  onLinkUser: function (e) { this.setData({ linkUser: e.detail.value }); },
  onLinkPass: function (e) { this.setData({ linkPass: e.detail.value }); },
  doLink: function () {
    var self = this;
    var u = (this.data.linkUser || '').trim();
    var p = this.data.linkPass || '';
    if (!u || !p) {
      wx.showToast({ title: i18n.t('linkAccountBtn'), icon: 'none' });
      return;
    }
    wx.login({
      success: function (res) {
        if (!res.code) { self._linkFail(); return; }
        api.linkWechat(res.code, u, p).then(function (r) {
          self.afterLogin(r && r.user);
        }).catch(function () { self._linkFail(); });
      },
      fail: function () { self._linkFail(); }
    });
  },
  _linkFail: function () {
    wx.showToast({ title: i18n.t('linkFailed'), icon: 'none', duration: 3000 });
  },
  afterLogin: function (user) {
    var app = getApp();
    if (user) app.globalData.user = user;
    this.setData({ showLink: false, linkPass: '' });
    this.syncAuth();
    var name = user ? (user.name || user.username || '') : '';
    wx.showToast({ title: i18n.fmt(i18n.t('linkedAs'), { name: name }), icon: 'none' });
  },
  // --- WeChat display name + avatar (tap-to-agree, each time) -------------
  getWxProfile: function () {
    var self = this;
    wx.getUserProfile({
      desc: '用于显示头像与昵称',
      success: function (res) {
        var u = res.userInfo || {};
        try { wx.setStorageSync(WX_PROFILE_KEY, { avatar: u.avatarUrl || '', nick: u.nickName || '' }); } catch (e) {}
        self.setData({ wxAvatar: u.avatarUrl || '', wxNick: u.nickName || '' });
        self.syncAuth();
      },
      fail: function () {}
    });
  },
  // --- navigation -----------------------------------------------------------
  goOrders: function () { wx.navigateTo({ url: '/pages/orders/orders' }); },
  goDemands: function () { wx.switchTab({ url: '/pages/demands/demands' }); },
  toggleAbout: function () { this.setData({ showAbout: !this.data.showAbout }); },
  doLogout: function () {
    api.logout();
    this.setData({ loggedUser: '', profile: {}, genderText: '' });
    this.syncAuth();
  },
  // --- account info (read + edit via PATCH /api/account/profile) -----------
  toggleEdit: function () {
    this.setData({ showEdit: !this.data.showEdit });
  },
  onEditName: function (e) { this.setData({ editName: e.detail.value }); },
  onEditCity: function (e) { this.setData({ editCity: e.detail.value }); },
  onEditAge: function (e) { this.setData({ editAge: e.detail.value }); },
  onEditGender: function (e) { this.setData({ editGenderIdx: e.detail.value }); },
  saveProfile: function () {
    var self = this;
    var age = this.data.editAge === '' ? null : parseInt(this.data.editAge, 10);
    var genders = ['', '男', '女'];
    api.patch('/api/account/profile', {
      name: this.data.editName,
      city: this.data.editCity,
      age: isNaN(age) ? null : age,
      gender: genders[this.data.editGenderIdx]
    }, true).then(function (res) {
      var app = getApp();
      if (res && res.user) {
        app.globalData.user = res.user;
        api.saveUser(res.user);
      }
      self.setData({ showEdit: false });
      self.syncAuth();
      wx.showToast({ title: i18n.t('profileSaved'), icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || i18n.t('profileSaved'), icon: 'none' });
    });
  }
});
