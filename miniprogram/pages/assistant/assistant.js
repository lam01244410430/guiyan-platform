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
    msgs: [], input: '', quicks: [], recording: false, voiceNote: ''
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
      'chatPh', 'sendBtn', 'greeting', 'quicks',
      'voiceMic', 'voiceRecording', 'voiceRecordFailed', 'voiceNotConnected',
      'voiceTypeInstead', ];
    var L = {};
    keys.forEach(function (k) { L[k] = i18n.t(k, lang); });
    wx.setNavigationBarTitle({ title: L.aiTitle });
    this.setData({ L: L, lang: lang, langIdx: i18n.langIndex(),
      langName: i18n.LANGS[i18n.langIndex()].label, quicks: L.quicks,
      voiceNote: '',
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
  quick: function (e) { this.ask(e.currentTarget.dataset.q); },
  onHide: function () {
    // Stop a recording left running when the page is hidden.
    if (this.data.recording && this._recorder) {
      try { this._recorder.stop(); } catch (e) {}
    }
  },
  // R7-2 mini-program honesty boundary: WeChat has no browser voice API;
  // wx.getRecorderManager only records audio, and recognition needs a
  // recognition provider (a third-party service, needs a separate
  // Lam/group decision — NOT connected in this wave). So the mic button
  // records, and on stop the page says so honestly and the user types
  // the question instead: the recorded file is DISCARDED — it is never
  // uploaded (no upload call anywhere in this page) and never turned
  // into text. No fake result, ever.
  onMicTap: function () {
    var self = this;
    if (this.data.recording) {
      if (this._recorder) { try { this._recorder.stop(); } catch (e) {} }
      return;
    }
    var L = this.data.L || {};
    if (typeof wx.getRecorderManager !== 'function') {
      this.setData({ voiceNote: (L.voiceNotConnected || '') + ' — ' + (L.voiceTypeInstead || '') });
      return;
    }
    if (!this._recorder) {
      var rec = wx.getRecorderManager();
      rec.onStart(function () {
        var cur = self.data.L || {};
        self.setData({ recording: true, voiceNote: cur.voiceRecording });
      });
      rec.onStop(function () {
        // The recorded file is intentionally ignored — no provider, no text.
        var cur = self.data.L || {};
        self.setData({ recording: false, voiceNote: (cur.voiceNotConnected || '') + ' — ' + (cur.voiceTypeInstead || '') });
      });
      rec.onError(function () {
        var cur = self.data.L || {};
        self.setData({ recording: false, voiceNote: cur.voiceRecordFailed });
      });
      this._recorder = rec;
    }
    this._recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 96000, format: 'mp3' });
  }
});
