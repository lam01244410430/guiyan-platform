/* Channel donut — pure SVG, no chart library. Props:
   {channels: [{name, amount, orders}], total} (total = the windowed
   交易总额, the same number as the KPI strip — D1). One ring segment
   per channel, sized by its share of total; the centre shows the
   total; the legend is ranked rows (rank + name + amount + %) with a
   3px share bar on each row's bottom edge.
   Colours (D4): one muted colour per channel, by rank
   (var(--donut-1) .. var(--donut-4)) — rank 1 money green, rank 2
   accent blue, rank 3 gold, rank 4 warm grey; rank 5+ cycles the
   four; never the old 7 brand colours;
   channel names are raw as the API returns them (H5 / 微信小程序 /
   抖音 / 猫眼）. A share below 0.1% reads "<0.1%", never "0.0%".
   Hovering a slice (or its legend row) dims the rest; the legend row
   tooltip adds the order count. A channel with no paid orders never
   appears — the list comes straight from the analysis `channelRows`,
   so every slice is real. */
import { useState } from "react";
import { fmtMoney } from "./adminApi.js";
import Tooltip from "./Tooltip.jsx";

const DONUT_SHADES = [
  "var(--donut-1)",
  "var(--donut-2)",
  "var(--donut-3)",
  "var(--donut-4)",
];

export { DONUT_SHADES };

function pctText(share) {
  if (share > 0 && share * 100 < 0.1) return "<0.1%";
  return (share * 100).toFixed(1) + "%";
}

export { pctText };

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
            stroke={DONUT_SHADES[i % DONUT_SHADES.length]} strokeWidth={hover === i ? 36 : 30}
            pathLength="100" strokeDasharray={`${s.share * 100} ${100 - s.share * 100}`}
            strokeDashoffset={-s.start * 100} transform="rotate(-90 100 100)"
            opacity={hover === null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${s.name} ${fmtMoney(s.amount)} (${pctText(s.share)})`}</title>
          </circle>
        ))}
        <text x="100" y="96" textAnchor="middle" className="donut-total">{fmtMoney(base)}</text>
        <text x="100" y="116" textAnchor="middle" className="donut-total-label">交易总额</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li key={s.name} className={hover === i ? "on" : ""}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Tooltip content={<><b>{s.name}</b><span className="tip-sub">{s.orders}单 · {fmtMoney(s.amount)} · {pctText(s.share)}</span></>}>
              <span className="donut-rank">{i + 1}</span>
              <span className="donut-name">{s.name}</span>
              <span className="donut-val">{fmtMoney(s.amount)}</span>
              <span className="donut-pct">{pctText(s.share)}</span>
            </Tooltip>
            <span className="donut-bar"><i style={{ width: (s.share * 100) + "%", background: DONUT_SHADES[i % DONUT_SHADES.length] }} /></span>
          </li>
        ))}
        {slices.length === 0 ? (<li className="donut-empty">暂无已付渠道收入</li>) : null}
      </ul>
    </div>
  );
}
