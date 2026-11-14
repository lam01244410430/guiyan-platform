var i18n = require('../../utils/i18n.js');

// Shared top bar: brand mark + language picker. One component replaces the
// copy-pasted block that used to live in every page. The picker lives here;
// the page still owns the language change (bind:langchange="onLangChange"
// receives {value: index} exactly like the old picker did).
Component({
  options: { styleIsolation: 'shared' },
  data: { brandTag: '', langIdx: 0, langName: '中文', langs: ['中文', 'Tiếng Việt', 'English', 'ภาษาไทย', 'Bahasa Melayu', 'Bahasa Indonesia'] },
  lifetimes: {
    attached: function () { this.refresh(); }
  },
  pageLifetimes: {
    // Language can change on another tab; refresh when this page shows.
    show: function () { this.refresh(); }
  },
  methods: {
    refresh: function () {
      var idx = i18n.langIndex();
      this.setData({ brandTag: i18n.t('brandTag'), langIdx: idx,
        langName: i18n.LANGS[idx].label });
    },
    onLangChange: function (e) {
      var idx = e.detail.value;
      i18n.setLang(i18n.LANGS[idx].code);
      this.refresh();
      this.triggerEvent('langchange', { value: idx });
    }
  }
});
