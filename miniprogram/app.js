// Guiyan 桂演 — premium redesign mini-program.
// Customer-facing only. Offline by default on local demo data (utils/data.js);
// no server, no real payment, no real AI model. Language + favorites +
// orders are stored locally on the phone (wx storage).
// 在线模式：globalData.apiBase 默认指向生产服务器
// 'https://guiyan-platform.vercel.app'（部署后的 https 地址；本地开发
// 可改为 'http://localhost:3001'）。小程序启动时会先请求 /api/health，
// 成功后进入在线模式（apiAvailable=true），失败则静默回落到离线本地
// 数据；留空 '' 即为纯离线模式。
var api = require('./utils/api.js');
App({
  onLaunch: function () {
    var lang = 'zh';
    try {
      var saved = wx.getStorageSync('guiyan-lang');
      if (saved === 'zh' || saved === 'vi' || saved === 'en') lang = saved;
    } catch (e) {}
    this.globalData.lang = lang;
    // R7-7 elderly-friendly: large-text mode + dialect frame, both
    // stored locally (default off / putonghua). Pages re-read them on
    // every show; the dialect only changes placeholder text.
    var largeText = false;
    try { largeText = wx.getStorageSync('guiyan-large-text') === '1'; } catch (e) {}
    this.globalData.largeText = largeText;
    var dialect = 'putonghua';
    try { var savedDialect = wx.getStorageSync('guiyan-dialect'); if (savedDialect) dialect = savedDialect; } catch (e) {}
    this.globalData.dialect = dialect;
    var user = api.getStoredUser();
    if (user) this.globalData.user = user;
    if (api.getBase()) api.checkHealth();
  },
  globalData: { lang: 'zh', apiBase: 'https://guiyan-platform.vercel.app', apiAvailable: false, user: null, largeText: false, dialect: 'putonghua' }
});
