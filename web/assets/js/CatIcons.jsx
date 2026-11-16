/* Category rail icons (2026-11-16, Lam: Q1(a) — hand-drawn line icons).
   One icon per CATS id, same 24x24 / stroke 1.7 line language as the
   admin KPI_ICONS (admin/assets/js/AdminDashboard.jsx). Each entry is
   the inner SVG markup only — the caller renders the <svg> wrapper so
   size, stroke and colour stay in one place (App.jsx catrail).
   No emoji, no i18n keys: the icon is inline SVG. */
export const CAT_ICONS = {
  // show 演出剧目 — stage curtain: rod + two drapes + stage floor.
  show: (<><path d="M3 4h18" /><path d="M6 4v15l4-3V4" /><path d="M18 4v15l-4-3V4" /><path d="M10 20h4" /></>),
  // venue 演出场馆 — hall with pediment, columns and base.
  venue: (<><path d="M3 9l9-5 9 5" /><path d="M5 9v11" /><path d="M9.5 9v11" /><path d="M14.5 9v11" /><path d="M19 9v11" /><path d="M3 20h18" /><path d="M5 13h14" /></>),
  // artist 艺人团队 — group of people (same users motif as KPI_ICONS).
  artist: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  // equipment 设备租赁 — speaker + sound waves.
  equipment: (<><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>),
  // copyright 版权与IP — document with ©.
  copyright: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><circle cx="12" cy="14.5" r="3.5" /><path d="M14.8 12.8a2.2 2.2 0 1 0 0 3.4" /></>),
  // heritage 非遗体验 — lantern: caps, ribbed body, tassel.
  heritage: (<><path d="M10 2h4" /><path d="M12 2v2" /><path d="M8 6h8" /><ellipse cx="12" cy="12" rx="6.5" ry="6" /><path d="M12 6v12" /><path d="M8.5 7.5c-1 1.2-1.5 2.8-1.5 4.5s.5 3.3 1.5 4.5" /><path d="M15.5 7.5c1 1.2 1.5 2.8 1.5 4.5s-.5 3.3-1.5 4.5" /><path d="M10 19h4" /><path d="M12 19v3" /></>),
  // creative 文创衍生 — gift box.
  creative: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>),
  // digital 数字演出 — screen + play button.
  digital: (<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M10 9l5 2.5-5 2.5z" /><path d="M8 21h8" /><path d="M12 17v4" /></>),
  // tourism 文旅套餐 — folded map + pin.
  tourism: (<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14" /><path d="M15 6v14" /><circle cx="6" cy="10.5" r="1.8" /><path d="M6 12.3 4.8 15h2.4L6 12.3z" /></>),
  // service 配套服务 — service bell (cloche).
  service: (<><path d="M4 17a8 8 0 0 1 16 0" /><path d="M2 17h20" /><path d="M3 20h18" /><path d="M12 9V6.5" /><path d="M10.8 6.5h2.4" /></>),
  // show-license 剧目授权 — landscape certificate + ribbon seal.
  "show-license": (<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h6" /><path d="M6 13.5h4" /><circle cx="16.5" cy="13" r="2.5" /><path d="M15.5 15.2 14.8 18l1.7-1 1.7 1-.7-2.8" /></>),
};
