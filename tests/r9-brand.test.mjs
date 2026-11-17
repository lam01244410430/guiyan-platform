// tests/r9-brand.test.mjs: R9-1 (row 80) — brand site /brand.html + SEO.
// Spawns server/server.mjs on TEST_PORT (default 3123) and talks to it
// over HTTP. DATABASE_URL must point at a FRESH disposable database
// (npm test is NOT idempotent on a reused DB).
//
// Covered: vite entry + flatten move for brand.html; brand.html meta
// (title/description/keywords/OG/canonical) + brandMain.jsx mount;
// Brand.jsx has exactly one <h1> and NO buy/pay/book action (no
// apiPost("/api/orders", no bookNow); the 13 brand* i18n keys exist in
// zh/vi/en and H5 totals 488; static.mjs serves /brand.html, /robots.txt
// and /sitemap.xml; robots.txt + sitemap.xml list the 3 URLs; only the
// client's existing channels (Damai / WeChat Pay / 北京银行） are listed;
// live: /brand.html + /robots.txt + /sitemap.xml -> 200, the 6 seeded
// venues are listed (other test files may leave extra venues behind in
// the shared DB, so the count is not asserted — only the 6 real ones),
// featured shows = the first 4 show-category resources by real views.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { I18N } from "../web/assets/js/data.js";

const PORT = Number(process.env.TEST_PORT || 3123);
const BASE = `http://127.0.0.1:${PORT}`;
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repoDir, p), "utf8");

const BRAND_KEYS = [
  "brandNav",
  "brandHeroKicker",
  "brandHeroSub",
  "brandAboutTitle",
  "brandAboutText",
  "brandStatsTitle",
  "brandVenuesTitle",
  "brandVenuesSub",
  "brandShowsTitle",
  "brandShowsSub",
  "brandChannelsTitle",
  "brandChannelsSub",
  "brandCtaBook",
];
const SITE_URLS = [
  "https://guiyan-platform.vercel.app/",
  "https://guiyan-platform.vercel.app/brand.html",
  "https://guiyan-platform.vercel.app/user.html",
];

test("r9-brand: vite entry + flatten move brand.html to the dist root", () => {
  const vite = read("vite.config.js");
  assert.ok(vite.includes('brand: "web/brand.html"'), "vite input has the brand entry");
  assert.ok(vite.includes('main: "web/index.html"'), "the 4 existing entries stay");
  assert.ok(vite.includes('user: "web/user.html"'), "the 4 existing entries stay");
  assert.ok(vite.includes('admin: "admin/index.html"'), "the 4 existing entries stay");
  assert.ok(vite.includes('dashboard: "admin/dashboard.html"'), "the 4 existing entries stay");
  const flatten = read("scripts/flatten-dist.mjs");
  assert.ok(flatten.includes('rename("dist/web/brand.html", "dist/brand.html")'), "flatten moves brand.html");
});

test("r9-brand: brand.html meta + brandMain.jsx mount", () => {
  const html = read("web/brand.html");
  assert.ok(html.includes("<title>桂演品牌官网"), "brand title");
  assert.ok(html.includes('name="description"'), "meta description");
  assert.ok(html.includes('name="keywords"'), "meta keywords");
  assert.ok(html.includes('property="og:title"'), "og:title");
  assert.ok(html.includes('property="og:description"'), "og:description");
  assert.ok(html.includes('property="og:type" content="website"'), "og:type website");
  assert.ok(html.includes('rel="canonical" href="https://guiyan-platform.vercel.app/brand.html"'), "canonical /brand.html");
  assert.ok(html.includes('<script type="module" src="assets/js/brandMain.jsx">'), "brandMain entry");
  const main = read("web/assets/js/brandMain.jsx");
  assert.ok(main.includes('from "./Brand.jsx"'), "brandMain renders Brand");
  assert.ok(main.includes("applyTheme()"), "brandMain applies the saved theme first");
});

test("r9-brand: Brand.jsx has exactly one h1 and no buy/pay/book action", () => {
  const src = read("web/assets/js/Brand.jsx");
  assert.equal((src.match(/<h1>/g) || []).length, 1, "exactly one <h1>");
  assert.ok(src.includes("桂演"), "hero names the platform");
  assert.ok(!src.includes('apiPost("/api/orders"'), "no order creation on the brand page");
  assert.ok(!src.includes("bookNow"), "no booking action on the brand page");
  assert.ok(!src.includes("apiPost(\"/api/orders\""), "no order creation (double-quote form)");
  // Links back home only — the only CTAs are anchors to index.html.
  assert.ok(src.includes('href="index.html#catalog"'), "CTA links back to the home catalog");
  for (const k of BRAND_KEYS) assert.ok(src.includes(`t("${k}")`), `Brand.jsx uses ${k}`);
});

test("r9-brand: the 13 brand keys exist in zh/vi/en, H5 totals 488", () => {
  for (const lang of ["zh", "vi", "en"]) {
    for (const k of BRAND_KEYS) {
      assert.ok(k in I18N[lang], `${k} present in ${lang}`);
      assert.ok(typeof I18N[lang][k] === "string" && I18N[lang][k].length > 0, `${k} non-empty in ${lang}`);
    }
  }
  assert.deepEqual(
    ["zh", "vi", "en", "th", "ms", "id"].map((l) => Object.keys(I18N[l]).length),
    [488, 488, 488, 82, 82, 82],
    "i18n counts: H5 488 (484 + 4 bottom-nav keys), mini stays 270 + 82",
  );
  // The mission line is the project's own stated goal, not a new slogan.
  assert.equal(I18N.zh.brandHeroSub, "一站式文化消费入口 · 产业服务枢纽");
});

test("r9-brand: hero 资源目录 ghost button is white on the dark hero", () => {
  const css = read("web/assets/css/main.css");
  // Scoped to the brand hero only — the shared .btn.ghost rule keeps its
  // dark text for the light customer pages (UserDashboard / App.jsx).
  assert.ok(
    css.includes(".brand-hero .btn.ghost{color:#ffffff;border-color:rgba(255,255,255,.55)}"),
    "brand hero ghost button is white with a light border",
  );
  assert.ok(
    css.includes(".brand-hero .btn.ghost:hover{background:rgba(255,255,255,.14);color:#ffffff}"),
    "brand hero ghost button stays white on hover",
  );
  assert.ok(css.includes(".btn.ghost{border-color:var(--line2)}"), "shared .btn.ghost rule unchanged (no color)");
  const brand = read("web/assets/js/Brand.jsx");
  assert.ok(brand.includes('className="btn ghost"'), "hero still uses the ghost button");
  assert.ok(brand.includes('{t("navCatalog")}'), "hero button still renders navCatalog");
  assert.equal(I18N.zh.navCatalog, "资源目录", "i18n value unchanged — only the colour changed");
});

test("r9-brand: only the client's existing channels are listed", () => {
  const src = read("web/assets/js/Brand.jsx");
  for (const c of ["大麦", "微信支付", "北京银行"]) assert.ok(src.includes(`"${c}"`), `channel listed: ${c}`);
  for (const bad of ["支付宝", "北部湾", "Alipay", "建行", "一键游"]) assert.ok(!src.includes(bad), `no new channel: ${bad}`);
});

test("r9-brand: static.mjs serves brand.html + robots.txt + sitemap.xml", () => {
  const src = read("server/static.mjs");
  assert.ok(src.includes('"/brand.html"'), "allowlist has /brand.html");
  assert.ok(src.includes('"/robots.txt"'), "allowlist has /robots.txt");
  assert.ok(src.includes('"/sitemap.xml"'), "allowlist has /sitemap.xml");
  assert.ok(src.includes('".txt": "text/plain; charset=utf-8"'), "content type .txt");
  assert.ok(src.includes('".xml": "application/xml; charset=utf-8"'), "content type .xml");
  assert.ok(!src.includes("#232323") && !src.includes("#a1ffcb"), "no admin palette in the customer server file");
});

test("r9-brand: robots.txt + sitemap.xml list the 3 URLs", () => {
  const robots = read("public/robots.txt");
  assert.ok(robots.includes("Allow: /brand.html"), "robots allows /brand.html");
  assert.ok(robots.includes("Allow: /user.html"), "robots allows /user.html");
  assert.ok(robots.includes("Sitemap: https://guiyan-platform.vercel.app/sitemap.xml"), "robots points at the sitemap");
  const sitemap = read("public/sitemap.xml");
  assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "sitemap is XML");
  assert.equal((sitemap.match(/<loc>/g) || []).length, 3, "sitemap lists exactly 3 URLs");
  for (const u of SITE_URLS) assert.ok(sitemap.includes(`<loc>${u}</loc>`), `sitemap lists ${u}`);
});

// ---------- live server checks (fresh disposable DB) ----------
let child;

async function get(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type") || "", text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: new URL("../server", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  if (child) child.kill("SIGTERM");
});

test("r9-brand: GET /brand.html -> 200 with the brand page", async () => {
  const r = await get("/brand.html");
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.ok(r.type.includes("text/html"), `content-type html, got ${r.type}`);
  assert.ok(r.text.includes("<title>桂演品牌官网"), "brand title served");
  assert.ok(r.text.includes("brandMain"), "brand entry script served");
});

test("r9-brand: GET /robots.txt + /sitemap.xml -> 200 with the right types", async () => {
  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200, robots.text.slice(0, 200));
  assert.ok(robots.type.includes("text/plain"), `robots type, got ${robots.type}`);
  assert.ok(robots.text.includes("Allow: /brand.html"), "robots allows /brand.html");
  const sitemap = await get("/sitemap.xml");
  assert.equal(sitemap.status, 200, sitemap.text.slice(0, 200));
  assert.ok(sitemap.type.includes("application/xml"), `sitemap type, got ${sitemap.type}`);
  assert.equal((sitemap.text.match(/<loc>/g) || []).length, 3, "sitemap lists 3 URLs live");
});

test("r9-brand: featured shows = first 4 show-category resources by real views", async () => {
  const r = await get("/api/resources?sort=hot");
  assert.equal(r.status, 200);
  const all = r.json.resources;
  assert.ok(Array.isArray(all) && all.length >= 4, `resources listed: ${all.length}`);
  // The API sorts hot by views desc — verify, do not assume.
  const views = all.map((x) => x.views || 0);
  assert.deepEqual(views, [...views].sort((a, b) => b - a), "sort=hot is views desc");
  const featured = all.filter((x) => x.category === "show").slice(0, 4);
  assert.equal(featured.length, 4, "4 featured shows");
  assert.ok(featured.every((x) => (x.views || 0) > 0), "featured shows have real views");
  // The brand page reads the same two public endpoints; the venue list
  // the page renders comes from /api/venues (checked in the next test).
  const names = featured.map((x) => x.name).join(" / ");
  assert.ok(names.length > 0, `featured: ${names}`);
});

test("r9-brand: GET /api/venues returns the 6 real venues", async () => {
  const r = await get("/api/venues");
  assert.equal(r.status, 200);
  const venues = r.json.venues;
  // The 6 seeded venues (server/seed.mjs + server/catalog-content.mjs).
  // Other test files leave extra venues in the shared DB (e.g. R2/R5
  // test venues), so assert presence of the 6 real ones, not the total.
  const SEED_VENUES = [
    "广西文化艺术中心",
    "南宁小剧场",
    "邕江艺术空间·黑匣子剧场",
    "漓江畔·山水露天舞台",
    "柳江青年艺术剧场",
    "海风文化客厅·多功能厅",
  ];
  const names = venues.map((v) => v.name);
  for (const n of SEED_VENUES) {
    const v = venues.find((x) => x.name === n);
    assert.ok(v, `seeded venue listed: ${n} (got ${venues.length} venues)`);
    assert.ok(v.address, `seeded venue ${n} has a verified address`);
  }
});
