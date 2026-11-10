// Guiyan 桂演 — premium redesign mini-program.
// Customer-facing only. Runs fully offline on local demo data (utils/data.js);
// no server, no real payment, no real AI model. Language + favorites +
// orders are stored locally on the phone (wx storage).
App({
  onLaunch: function () {
    var lang = 'vi';
    try {
      var saved = wx.getStorageSync('guiyan-lang');
      if (saved === 'zh' || saved === 'vi' || saved === 'en') lang = saved;
    } catch (e) {}
    this.globalData.lang = lang;
  },
  globalData: { lang: 'vi' }
});
