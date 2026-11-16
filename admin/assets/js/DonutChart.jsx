/* Channel donut — pure SVG, no chart library. Props:
   {channels: [{name, amount, orders}], total} (total = revenue_cents,
   the same 交易总额 as the KPI card). One ring segment per channel,
   sized by its share of total; the centre shows the total; the legend
   lists name + % + amount in the same rank order. Colours are the
   muted brand fills in fixed rank order (never a rainbow, never a
   saturated fill): pine, cinnabar, gold, gray, ink, deep amber, light
   gray. A channel with no paid orders never appears — the list comes
   straight from the analysis `channelRows`, so every slice is real.
   Hovering a slice (or its legend row) dims the rest. */
import { useState } from "react";
import { fmtMoney } from "./adminApi.js";

const DONUT_COLORS = [
  "var(--brand-pine)",
  "var(--brand-cinnabar)",
  "var(--brand-gold)",
  "var(--gray-600)",
  "var(--p-ink)",
  "var(--signal-yellow-deep)",
  "var(--gray-400)",
];

export default function DonutChart({ channels, total }) {
  const [hover, setHover] = useState(null);
  const rows = Array.isArray(channels) ? channels : [];
  const sum = rows.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const base = Number(total) > 0 ? Number(total) : sum;
  // Donut geometry: r=80, circumference 2πr ≈ 502.65; pathLength=100
  // normalises the dash math so a share p is exactly "p 100-p".
  let acc = 0;
  const slices = rows.map((c, i) => {
    const share = base > 0 ? (Number(c.amount) || 0) / base : 0;
    const s = { ...c, share, start: acc };
    acc += share;
    return s;
  });
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="交易渠道分布">
        <circle cx="100" cy="100" r="80" fill="none" stroke="var(--gray-100)" strokeWidth="30" />
        {slices.map((s, i) => (
          <circle key={s.name} cx="100" cy="100" r="80" fill="none"
            stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={hover === i ? 36 : 30}
            pathLength="100" strokeDasharray={`${s.share * 100} ${100 - s.share * 100}`}
            strokeDashoffset={-s.start * 100} transform="rotate(-90 100 100)"
            opacity={hover === null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${s.name} ${fmtMoney(s.amount)} (${(s.share * 100).toFixed(1)}%)`}</title>
          </circle>
        ))}
        <text x="100" y="96" textAnchor="middle" className="donut-total">{fmtMoney(base)}</text>
        <text x="100" y="116" textAnchor="middle" className="donut-total-label">交易总额</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li key={s.name} className={hover === i ? "on" : ""}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="donut-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="donut-name">{s.name}</span>
            <span className="donut-val">{fmtMoney(s.amount)}</span>
            <span className="donut-pct">{(s.share * 100).toFixed(1)}%</span>
          </li>
        ))}
        {slices.length === 0 ? (<li className="donut-empty">暂无已付渠道收入</li>) : null}
      </ul>
    </div>
  );
}
