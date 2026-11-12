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
    var lang = 'vi';
    try {
      var saved = wx.getStorageSync('guiyan-lang');
      if (saved === 'zh' || saved === 'vi' || saved === 'en') lang = saved;
    } catch (e) {}
    this.globalData.lang = lang;
    var user = api.getStoredUser();
    if (user) this.globalData.user = user;
    if (api.getBase()) api.checkHealth();
  },
  globalData: { lang: 'vi', apiBase: 'https://guiyan-platform.vercel.app', apiAvailable: false, user: null }
});
