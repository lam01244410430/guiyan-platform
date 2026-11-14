// tests/theme-toggle.test.mjs: manual light/dark theme toggle + account
// settings redesign (customer web only, no server/DB changes).
// Pure client-side checks — no DATABASE_URL needed, no server spawned.
//
// Covered: (1) theme.mjs pure logic — default LIGHT, stored choice wins
// over the system setting, "system" follows matchMedia, toggle flips the
// effective theme and always writes an explicit choice, applyTheme sets /
// removes data-theme; (2) main.css — the manual override layer exists
// (:root[data-theme="dark"]), the auto media query survives only as the
// no-preference fallback (:root:not([data-theme])), the old bare dark
// block is gone, .pill.confirmed dark override exists in data-theme form,
// .themebtn / .theme-seg / .set-link rules exist; (3) dark contrast —
// every text pair parsed from the dark token block measures >= 4.5:1,
// borders >= 3:1 (WCAG, computed, not guessed); (4) i18n — H5 467 keys
// in zh/vi/en + 82 in th/ms/id, the 12 new settings/theme keys present
// in zh/vi/en (mini-program 269 + 82); (5) bootstrap — both HTML
// entries carry the inline script that sets data-theme before first
// paint; (6) wiring — chrome.jsx has the header toggle (id themeBtn,
// useTheme), UserDashboard.jsx has the settings tab (?tab=settings),
// both entries call applyTheme() on boot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.resolve(repoDir, "web", "assets", "js", "..", "css", "main.css"), "utf8");

const THEME_KEYS = ["tabSettings", "setAppearance", "setTheme", "themeLight", "themeDark", "themeSystem", "themeNote", "setLanguage", "setProfile", "setSecurity", "setSocial", "themeToggle"];

// --- WCAG contrast (same math as the /tmp/contrast.mjs check) -----------
function lum(hex) {
  const c = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function darkTokens() {
  const m = css.match(/:root\[data-theme="dark"\]\{([^}]*)\}/);
  assert.ok(m, "no :root[data-theme=\"dark\"] block in main.css");
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)) out[k] = v;
  return out;
}

// --- theme.mjs with stubbed browser globals ------------------------------
function stubBrowser({ stored = null, systemDark = false } = {}) {
  const store = stored === null ? {} : { "guiyan-theme": stored };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const attrs = {};
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => attrs[k] ?? null,
    },
  };
  globalThis.window = {
    matchMedia: () => ({
      matches: systemDark,
      addEventListener: () => {},
      addListener: () => {},
    }),
  };
  return { store, attrs };
}
let importN = 0;
async function freshTheme() {
  importN += 1;
  return import(path.resolve(repoDir, "web", "assets", "js", "theme.mjs") + `?v=${importN}`);
}
function unStub() {
  delete globalThis.localStorage;
  delete globalThis.document;
  delete globalThis.window;
}

test("theme: resolveTheme is pure — light/dark pass through, system follows the OS, invalid falls back to light", async () => {
  stubBrowser();
  try {
    const m = await freshTheme();
    assert.equal(m.resolveTheme("light", "dark"), "light");
    assert.equal(m.resolveTheme("dark", "light"), "dark");
    assert.equal(m.resolveTheme("system", "dark"), "dark");
    assert.equal(m.resolveTheme("system", "light"), "light");
    assert.equal(m.resolveTheme("bogus", "dark"), "light");
  } finally { unStub(); }
});

test("theme: default is LIGHT with nothing stored, even on a dark system", async () => {
  const { attrs } = stubBrowser({ stored: null, systemDark: true });
  try {
    const m = await freshTheme();
    assert.equal(m.getThemeChoice(), "light");
    assert.equal(m.getEffectiveTheme(), "light");
    m.applyTheme();
    assert.equal(attrs["data-theme"], "light");
  } finally { unStub(); }
});

test("theme: a stored choice wins over the system setting", async () => {
  const { attrs } = stubBrowser({ stored: "dark", systemDark: false });
  try {
    const m = await freshTheme();
    assert.equal(m.getThemeChoice(), "dark");
    assert.equal(m.getEffectiveTheme(), "dark");
    m.applyTheme();
    assert.equal(attrs["data-theme"], "dark");
  } finally { unStub(); }
});

test("theme: choice system removes data-theme so the CSS media query decides", async () => {
  const { attrs } = stubBrowser({ stored: "system", systemDark: true });
  try {
    const m = await freshTheme();
    assert.equal(m.getThemeChoice(), "system");
    assert.equal(m.getEffectiveTheme(), "dark");
    m.applyTheme();
    assert.equal(attrs["data-theme"], undefined);
  } finally { unStub(); }
});

test("theme: setTheme persists + applies; toggleTheme flips effective and always writes an explicit choice", async () => {
  const { store, attrs } = stubBrowser({ stored: "system", systemDark: true });
  try {
    const m = await freshTheme();
    assert.equal(m.getEffectiveTheme(), "dark"); // system + dark OS
    m.toggleTheme();
    assert.equal(store["guiyan-theme"], "light");
    assert.equal(attrs["data-theme"], "light");
    m.toggleTheme();
    assert.equal(store["guiyan-theme"], "dark");
    assert.equal(attrs["data-theme"], "dark");
    m.setTheme("system");
    assert.equal(store["guiyan-theme"], "system");
    assert.equal(attrs["data-theme"], undefined);
    m.setTheme("bogus");
    assert.equal(store["guiyan-theme"], "system"); // invalid ignored
  } finally { unStub(); }
});

test("css: manual override layer exists, auto query is only the no-preference fallback, old bare dark block is gone", () => {
  assert.ok(css.includes(':root[data-theme="dark"]'), "missing data-theme dark block");
  assert.ok(css.includes(":root:not([data-theme])"), "missing :not([data-theme]) fallback");
  assert.ok(!/@media \(prefers-color-scheme:dark\)\{\s*:root\{/.test(css), "old bare dark :root block still present");
  assert.ok(css.includes(':root[data-theme="dark"] .pill.confirmed'), "pill.confirmed dark override missing in data-theme form");
  assert.ok(css.includes(".themebtn"), "missing .themebtn rule");
  assert.ok(css.includes(".theme-seg"), "missing .theme-seg rule");
  assert.ok(css.includes(".set-link"), "missing .set-link rule");
  assert.ok(css.includes("--red-solid"), "missing --red-solid token");
  assert.ok(css.includes("--jade-solid"), "missing --jade-solid token");
});

test("css: dark text pairs measure >= 4.5:1, borders >= 3:1 (parsed from the token block)", () => {
  const tk = darkTokens();
  for (const k of ["bg", "surface", "ink", "ink2", "ink3", "line", "line2", "red", "red-deep", "red-soft", "red-solid", "gold", "gold-soft", "jade", "jade-soft", "jade-solid"]) {
    assert.ok(tk[k], `dark token --${k} missing`);
  }
  const textPairs = [
    ["ink/bg", tk.ink, tk.bg], ["ink/surface", tk.ink, tk.surface],
    ["ink2/bg", tk.ink2, tk.bg], ["ink2/surface", tk.ink2, tk.surface],
    ["ink3/bg", tk.ink3, tk.bg], ["ink3/surface", tk.ink3, tk.surface],
    ["red/surface (links, brand, price)", tk.red, tk.surface],
    ["red/bg", tk.red, tk.bg],
    ["red on red-soft (.cat b)", tk.red, tk["red-soft"]],
    ["gold on gold-soft (pill)", tk.gold, tk["gold-soft"]],
    ["jade on jade-soft (pill)", tk.jade, tk["jade-soft"]],
    ["#fff on red-solid (buttons)", "#ffffff", tk["red-solid"]],
    ["#fff on jade-solid (pill.completed)", "#ffffff", tk["jade-solid"]],
    ["#fff on red-deep (btn hover)", "#ffffff", tk["red-deep"]],
    ["gold/surface", tk.gold, tk.surface],
    ["jade/surface", tk.jade, tk.surface],
  ];
  for (const [label, fg, bg] of textPairs) {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${label}: ${r.toFixed(2)}:1 < 4.5:1`);
  }
  for (const [label, fg, bg] of [["line/surface", tk.line, tk.surface], ["line/bg", tk.line, tk.bg], ["line2/surface", tk.line2, tk.surface]]) {
    const r = ratio(fg, bg);
    assert.ok(r >= 3, `${label}: ${r.toFixed(2)}:1 < 3:1`);
  }
});

test("i18n: H5 467 keys/language in zh/vi/en + 82 in th/ms/id, equal sets in zh/vi/en, the 12 theme/settings keys present in zh/vi/en", async () => {
  const data = await import(path.resolve(repoDir, "web", "assets", "js", "data.js"));
  const counts = data.LANGS.map((l) => Object.keys(data.I18N[l]).length);
  assert.deepEqual(counts, [467, 467, 467, 82, 82, 82]);
  for (const k of THEME_KEYS) {
    // theme keys live in zh/vi/en only (R7-8: th/ms/id carry the 82-key core
    // set; t() falls back to zh for the rest).
    for (const l of ["zh", "vi", "en"]) assert.ok(k in data.I18N[l], `${k} missing in H5 ${l}`);
  }
  const sets = data.LANGS.map((l) => new Set(Object.keys(data.I18N[l])));
  assert.ok([...sets[0]].every((k) => sets[1].has(k) && sets[2].has(k)), "H5 i18n key sets must be equal across zh/vi/en");
  const mini = fs.readFileSync(path.resolve(repoDir, "miniprogram", "utils", "i18n.js"), "utf8");
  for (const lang of ["zh", "vi", "en"]) {
    const start = mini.indexOf(`  ${lang}: {`);
    assert.ok(start >= 0, `no ${lang} block in miniprogram i18n`);
    const block = mini.slice(start, mini.indexOf("\n  }", start));
    const keys = [...block.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    assert.equal(keys.length, 269, `${lang} mini key count (R7: 236 -> 269)`);
  }
});

test("bootstrap: both HTML entries set data-theme before first paint (default light)", () => {
  for (const f of ["web/index.html", "web/user.html"]) {
    const html = fs.readFileSync(path.resolve(repoDir, f), "utf8");
    assert.ok(html.includes("guiyan-theme"), `${f}: no theme key in bootstrap script`);
    assert.ok(html.includes('setAttribute("data-theme"'), `${f}: bootstrap does not set data-theme`);
    assert.ok(html.includes("localStorage.getItem"), `${f}: bootstrap does not read localStorage`);
  }
});

test("wiring: header toggle + settings tab + boot applyTheme", () => {
  const chrome = fs.readFileSync(path.resolve(repoDir, "web", "assets", "js", "chrome.jsx"), "utf8");
  assert.ok(chrome.includes('id="themeBtn"'), "chrome.jsx: no header theme button");
  assert.ok(chrome.includes("useTheme"), "chrome.jsx: Header does not use useTheme");
  assert.ok(chrome.includes("aria-pressed"), "chrome.jsx: toggle missing aria-pressed");
  const dash = fs.readFileSync(path.resolve(repoDir, "web", "assets", "js", "UserDashboard.jsx"), "utf8");
  assert.ok(dash.includes('["settings", "tabSettings"]'), "UserDashboard.jsx: settings tab missing from ACCT_TABS");
  assert.ok(dash.includes('acctTab === "settings"'), "UserDashboard.jsx: no settings tab content");
  assert.ok(dash.includes("theme-seg"), "UserDashboard.jsx: no theme segmented control");
  for (const f of ["web/assets/js/main.jsx", "web/assets/js/userMain.jsx"]) {
    const src = fs.readFileSync(path.resolve(repoDir, f), "utf8");
    assert.ok(src.includes("applyTheme()"), `${f}: applyTheme() not called on boot`);
  }
});
