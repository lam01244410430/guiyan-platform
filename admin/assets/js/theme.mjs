/* Manual light/dark theme — admin port of web/assets/js/theme.mjs.
   Same key (guiyan-theme) and same rules, so the choice follows the
   user between the customer site and the admin: choice "light" |
   "dark" | "system", default LIGHT, a stored choice wins over the
   system setting, applied as `data-theme` on <html> (see the inline
   bootstrap script in admin/dashboard.html, which sets it before
   first paint). One divergence: admin.css has no `@media
   (prefers-color-scheme: dark)` fallback, so applyTheme always sets
   an explicit data-theme (the web removes the attribute for "system"
   and lets its CSS media query decide). Pure helpers (getThemeChoice
   / getEffectiveTheme / resolveTheme) work in node too — the
   DOM/storage access is guarded — so they are unit-tested in
   tests/admin-dashboard-redesign.test.mjs. */
export const THEME_KEY = "guiyan-theme";
export const THEMES = ["light", "dark", "system"];

const listeners = new Set();
let cachedChoice = null; // null = not read yet (tests reset via _resetThemeCache)

function readStored() {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function getThemeChoice() {
  if (cachedChoice === null) cachedChoice = readStored() || "light";
  return cachedChoice;
}

export function getSystemTheme() {
  try {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  } catch {
    /* fall through */
  }
  return "light";
}

/* Pure: which theme actually shows for a choice ("system" follows the OS). */
export function resolveTheme(choice, systemTheme) {
  if (!THEMES.includes(choice)) choice = "light";
  if (choice === "system") return systemTheme === "dark" ? "dark" : "light";
  return choice;
}

export function getEffectiveTheme() {
  return resolveTheme(getThemeChoice(), getSystemTheme());
}

export function applyTheme() {
  // Admin divergence from the customer web: admin.css has no
  // `@media (prefers-color-scheme: dark)` fallback, so "system" must
  // resolve to an explicit data-theme here (the web removes the
  // attribute and lets its CSS media query decide). The attribute is
  // always set, light or dark.
  const effective = getEffectiveTheme();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", effective);
  }
  return effective;
}

function notify() {
  const effective = getEffectiveTheme();
  const choice = getThemeChoice();
  listeners.forEach((fn) => fn(effective, choice));
}

export function setTheme(choice) {
  if (!THEMES.includes(choice)) return;
  cachedChoice = choice;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage unavailable (private mode) — in-memory choice still applies */
  }
  applyTheme();
  notify();
}

/* Header compact toggle: flip the EFFECTIVE theme; an explicit choice is
   always written, so "system" never survives a header tap. */
export function toggleTheme() {
  setTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
}

export function subscribeTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* When the OS theme changes and the choice is "system", re-apply + notify. */
if (typeof window !== "undefined" && window.matchMedia) {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getThemeChoice() === "system") {
        applyTheme();
        notify();
      }
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else if (typeof mq.addListener === "function") mq.addListener(onChange);
  } catch {
    /* old environments without matchMedia listeners — choice still applies */
  }
}

/* Test-only: drop the cached choice so a test can stub storage first. */
export function _resetThemeCache() {
  cachedChoice = null;
}
