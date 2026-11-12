# Guiyan 夜剧场 (Night Theatre)

> Category: Cultural & Performing Arts
> The admin console of 桂演, a Guangxi performing-arts ticketing platform.
> A theatre house, not a SaaS product: deep pine, cinnabar, gold on warm
> paper — serif for display, sans for data, flat surfaces, one accent
> per screen. Written after the bright 2026-11-11 redesign was judged
> AI slop (white sidebar, `#fafbfc`, generic blue, pill buttons
> everywhere) and rebuilt from the original night-theatre brand using
> our own brand-contract method (`DESIGN.md` as brand contract, with
> tokens in `tokens.css` and `design-tokens.json`).

## 1. Visual Theme & Atmosphere

A theatre at night: dark pine house, warm paper programme, cinnabar
seal, gold leaf. The console is an operator's desk backstage — dense,
legible, calm — with the brand showing in exactly three places: the
pine sidebar, the serif display type, and one cinnabar accent per
screen. Everything else is paper, ink, and data.

- **Visual style:** night-theatre editorial — not SaaS, not a book.
- **Design intent:** a screenshot must be identifiable as 桂演. If the
  sidebar, the serif numerals and the cinnabar rule were removed, the
  screen would be a template — that is the failure this contract exists
  to prevent.

## 2. Color Palette & Roles

- **Pine (brand ground):** `#0B3D36` — sidebar, hero revenue card,
  chart line, primary structure. Lighter pine `#14564D` for active
  sidebar item background. Pine soft `#DFF2EE` for selected tint on
  paper. Pine deep `#0B4F47` for hover on pine.
- **Paper (page):** `#F7F3EC` — page background only, never a card.
- **Surface:** `#FFFDF8` — cards, tables, inputs, dropdowns.
- **Surface 2:** `#F3ECDF` — hover rows, secondary wells.
- **Ink:** `#1C1710` — data, numbers, primary text. Never pure black.
- **Ink 2:** `#5D5344` — secondary text, labels. **Ink 3:** `#8A7D68`
  — metadata, axis labels, placeholders.
- **Line:** `#DDD2BF` — card and table borders. **Line 2:** `#CBBD9F`
  — input borders.
- **Cinnabar (the one accent):** `#C8452C` — primary buttons, links,
  the brand rule under 桂演, danger. Deep `#A83A20` on hover. Soft
  `#FDECE7` for danger tint, `#F9DCD2` for focus ring. **Cap: at most
  2 visible cinnabar roles per screen** — the cap counts roles, not
  instances: the brand rule is one role, the action/danger role is the
  second. Data-driven status colours (a cancelled/refunded chip on a
  row, a pending demand) are data, not accent uses, and do not count
  toward the cap — a per-instance reading cannot be satisfied on any
  data screen and is explicitly not the rule. Pine is ground, not
  accent — it does not count toward the cap.
- **Gold (highlight only):** `#C9A24B` — quarter bar in the chart,
  active sidebar icon, the ¥ unit in the hero numeral. Bar gold
  `#B8860B`, gold ink `#7C5A10`, gold soft `#FDF3D7`.
- **Jade (success):** `#0D6E5F`, soft `#DCF2EA`.
- **No blue.** The generic SaaS blue (`#2563EB`) is removed entirely:
  links are cinnabar, info states are pine. No indigo, no violet.
- **No gradients.** Every surface is flat. No purple-blue gradients,
  no teal-green gradients, no gradient brand mark.

## 3. Typography Rules

- **Display:** `"Noto Serif SC"` 700/900 — brand mark 桂演, page
  titles (h1), view titles (h2), hero numerals, chart hero value.
  Serif is display-only; it never appears in tables, labels, or body.
- **Body / data:** `"Noto Sans SC"` 400/500/700 + `"Be Vietnam Pro"`
  (Latin/Vietnamese) + `system-ui` fallback. All tables, labels,
  buttons, inputs, navigation, and metadata are sans.
- **Mono:** `ui-monospace, monospace` — order codes and IDs only.
- **Tables:** every record table has an ID column first — the ID
  (mono, muted ink3, 13px) is the disambiguator; never append `·N`
  or any other suffix to a name to make it unique. Table text is
  neutral ink/ink2 only — no blue links, no green, no cream tint
  inside cells (status pills excepted).
- **SortButton:** a 14px icon button beside the header label, vertically
  centred inside `<th>`. Inactive is muted ink3; active is pine. Icon
  states: unsorted = up-down arrows, ascending = up arrow, descending =
  down arrow. Click cycles unsorted → ascending → descending → unsorted.
  Sorting is client-side only, applies after search, and never changes
  the stored order — unsorted is the original order.
- **Scale (px):** 12 · 13.5 · 15 · 18 · 22 · 28 · 34. Page title 34,
  view title 22, stat numerals 28 (hero 34), body 15, meta 12.5.
- **Line-height:** 1.6 body, 1.15 display.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a
  number appears. Serif for numbers only when they matter (hero
  revenue, chart hero value); tabular sans for all other numbers.

## 4. Spacing & Grid

- **Shell:** sidebar 240px fixed; main `padding: 34px 36px 60px`.
- **Stat grid:** featured hero `2fr` + 4 compact `1fr` — never equal
  widths. Gap 14px, margin below 30px.
- **Spacing scale:** 4 · 8 · 12 · 14 · 16 · 18 · 20 · 24 · 28 · 34 · 36.
- **Radii:** cards 14px, controls 9px, status chips 99px (small pills
  only). **Buttons are 9px, never 99px pills** — the pill button is
  the slop tell. Inputs 9px.
- **Elevation:** flat. 1px borders, no shadow on cards, tables, or
  inputs. Shadow only on hover (cards: y+2px, blur 16, ink at 6%) and
  on dropdown menus. No neumorphism, no glassmorphism, no decorative
  blob or wave backgrounds, no giant watermark glyph behind the login.

## 5. Layout & Composition

- **Sidebar (the brand anchor):** deep pine `#0B3D36`, cream text
  `#F5EEDD`. Brand mark 桂演 in Noto Serif SC 900, cream, with a 3px
  cinnabar rule beneath it — **64px wide, left-aligned under the
  mark, never full-width** (a full-width rule reads as a divider,
  not an accent). Nav
  groups separated by a hairline; group labels 11px letterspaced.
  Nav item: transparent, cream-dim text; hover lighter pine;
  **active: lighter-pine fill `#14564D` + cream text + gold icon —
  no left-border accent** (the rounded-card-with-left-border is the
  canonical AI dashboard tile; the active state is a fill, not a
  border). A **返回首页** link sits directly above the operator card at the
  bottom of the sidebar: full-width, 9px radius, 1px `--sidebar-line`
  border, cream text, home icon on the left; hover is a lighter-pine
  fill. It links to `/` in the same tab. Footer: operator name + role,
  logout as a bordered button.
- **Main:** paper background, one view at a time. Page head: serif
  h1 + sans sub-line + the read-only badge at the far right.
- **Stat cards:** white surface, 1px line border, 14px radius.
  Hero card: flat pine, cream text, serif numerals, gold ¥ unit.
  Never three or five equal-width cards.
- **Tables:** header 13px 700 ink2, row dividers 1px line, row hover
  surface2, status chips as small soft pills (muted bg + ink text,
  never saturated badges).
- **TrendChart:** line pine, area pine at 8%, quarter bar flat gold,
  grid lines `#E8E0D2`, axis labels sans 12px ink3, tooltip white
  card with 1px border. No chart filtering by search — the chart
  shows the whole series; search filters the table below it.
- **Alert cards:** flat tinted card (gold-soft warning / pine-soft
  info), no left border. The severity is the tint + the label, never
  a coloured border.
- **SearchBox (shared, all 8 views):** boxed input, 1px line2
  border, 9px radius, 44px height, search icon ink3, clear × button,
  Esc clears, result count line, empty state with a clear action.
  Focus: pine border + pine-soft ring. No shadow.

## 6. Components

- **Buttons:** primary = cinnabar fill, white label, 9px radius,
  13px padding-block. Secondary = 1px line2 border, transparent
  fill, ink text. Danger = cinnabar. Never a 99px pill. Press moves
  2px (the one micro-interaction).
- **Inputs:** boxed, 1px line2, 9px radius, 12px padding. Focus:
  pine border + 3px pine-soft ring. Real `<label>`, never
  placeholder-as-label.
- **Login:** paper page, centered white card, serif brand mark in
  pine with a 3px cinnabar rule beneath (64px wide, left-aligned,
  never full-width), sans form, cinnabar primary
  button (9px). No watermark, no gradient mark, no pill button.
- **Icons:** Lucide monoline SVG, 1.6–1.8px stroke, `currentColor`.
  No emoji as icons, no emoji in product copy.
- **Badges/chips:** small pills, soft background + ink text.
  Read-only badge: gold soft + gold ink.

## 7. Motion & Interaction

- Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; enter ~200ms, exit
  ~140ms. Never `ease-in` for UI.
- Hover states are explicit on every interactive element; focus-visible
  is a 2px pine ring (cinnabar ring on pine surfaces).
- Button press translates 2px. Numbers do not animate. No scroll
  fade-ins, no decorative motion.

## 8. Voice & Brand

- UI is Chinese-first. Admin microcopy stays in the product's voice:
  the read-only notice ("订单、用户、资源仅查看；需求可在需求页审核，
  操作留痕。支付与 AI 均为模拟。") stays verbatim.
- **All numbers are real** (live API data). Never invent a metric,
  never a placeholder number. Empty states say what is empty and what
  to do next — never filler copy.

## 9. Do's and Don'ts

- ✅ Serif for display and hero numbers; sans for data.
- ✅ One cinnabar accent per screen (max 2 visible uses).
- ✅ Flat surfaces, 1px borders, tabular numerals.
- ✅ The sidebar, the serif, and the cinnabar rule make the screen
  identifiable as 桂演.
- ❌ No gradients of any kind.
- ❌ No generic blue, no indigo, no violet.
- ❌ No 99px pill buttons; no rounded card with a left-border accent.
- ❌ No Inter, no three equal-width cards, no white generic sidebar.
- ❌ No emoji icons, no invented metrics, no filler copy.
- ❌ No new hex values outside `:root` — every color is a token.
- ❌ No serif in tables, labels, or body copy.

## 10. Responsive Behavior

- ≤1100px: tighter main padding; stat grid wraps to 2 columns.
- ≤860px: sidebar collapses to an overlay drawer (hamburger);
  tables scroll horizontally inside their card.
- ≤560px: single-column stats; hero numeral 28px; search full width.
- The sidebar never wraps and never overflows; the header never wraps.

## 11. Agent Prompt Guide

When refactoring components against this design system:

- Lead with the sidebar, the serif display type, and the cinnabar
  rule; chrome (borders, shadows) is subtractive.
- Color tokens are non-negotiable. Do not invent new hex values. If a
  state needs a color outside this palette, use the closest existing
  token and note it in the commit message.
- Keep every behavior: all 8 views, search on all 8 views, chart
  periods + toggle + tooltip, demand approve/reject, CSV export,
  alerts, audit log, login/logout. This refactor changes appearance
  only — no API, data, or logic changes.
- Verify like every other Guiyan change: `npm run build` passes,
  `npm test` 29 pass / 0 fail / 10 skip, smoke 30/0, then a live
  browser check (login, sidebar, all 8 views, search, chart periods)
  before any commit.
