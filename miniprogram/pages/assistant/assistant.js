var i18n = require('../../utils/i18n.js');
var data = require('../../utils/data.js');
var api = require('../../utils/api.js');

function botAnswer(q) {
  var s = (q || '').toLowerCase();
  var lang = i18n.getLang();
  if (/退款|退票|refund|hoàn/.test(s)) return i18n.t('ansRefund', lang);
  if (/改签|resched|đổi lịch|dời/.test(s)) return i18n.t('ansResched', lang);
  if (/非遗|heritage|di sản|壮锦|tráng cẩm/.test(s)) {
    var h = data.RES.filter(function (r) { return r.cat === 'heritage'; });
    var list = h.map(function (r) {
      return '• ' + r.name + ' — ' + data.cityName(r.city, lang)
        + ' · ' + data.money(r.price) + '/' + data.unitName(r.unit, lang);
    }).join('\n');
    return i18n.fmt(i18n.t('ansHeritage', lang), { n: h.length, list: list });
  }
  if (/预订|预约|订票|book|đặt/.test(s)) return i18n.t('ansBook', lang);
  if (/今晚|热门|推荐|tonight|hot|popular|gợi ý|hôm nay|vở nào/.test(s)) {
    var top = data.topViewed(3).map(function (o) {
      return '• ' + o.r.name + ' — ' + data.cityName(o.r.city, lang)
        + ' · ' + data.money(o.r.price) + '/' + data.unitName(o.r.unit, lang);
    }).join('\n');
    return i18n.fmt(i18n.t('ansHot', lang), { list: top });
  }
  if (/你好|您好|hello|chào|hi\b/.test(s)) return i18n.t('ansHello', lang);
  return i18n.t('ansFallback', lang);
}

Page({
  data: {
    L: {}, langIdx: 1, langName: 'Tiếng Việt', langs: ['中文', 'Tiếng Việt', 'English'],
    msgs: [], input: '', quicks: []
  },
  onLoad: function () { this.applyLang(); },
  onShow: function () {
    if (this.data.langIdx !== i18n.langIndex()) this.applyLang();
  },
  onLangChange: function (e) {
    i18n.setLang(i18n.LANGS[e.detail.value].code);
    this.applyLang();
  },
  applyLang: function () {
    var lang = i18n.getLang();
    var keys = ['brandTag', 'aiTitle', 'aiSub', 'aiNote', 'chatName', 'chatMode',
      'chatPh', 'sendBtn', 'greeting', 'quicks', ];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.aiTitle });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label, quicks: L.quicks,
      msgs: [{ who: 'bot', text: L.greeting }] });
  },
  onInput: function (e) { this.setData({ input: e.detail.value }); },
  ask: function (q) {
    var self = this;
    var msgs = this.data.msgs.concat([{ who: 'me', text: q }]);
    this.setData({ msgs: msgs, input: '' });
    function local() {
      setTimeout(function () {
        self.setData({ msgs: self.data.msgs.concat([{ who: 'bot', text: botAnswer(q) }]) });
      }, 280);
    }
    // Online: ask the server first and show its answer as-is; any failure
    // falls back silently to the local rule-based answer.
    if (api.isOnline()) {
      api.get('/api/assistant', { q: q }).then(function (res) {
        var answer = (res && res.answer) || '';
        if (!answer) { local(); return; }
        self.setData({ msgs: self.data.msgs.concat([{ who: 'bot', text: answer }]) });
      }, function () { local(); });
    } else {
      local();
    }
  },
  send: function () {
    var v = (this.data.input || '').trim();
    if (!v) return;
    this.ask(v);
  },
  quick: function (e) { this.ask(e.currentTarget.dataset.q); }
});
