/* Trend chart — pure SVG, no chart library (admin is desktop-first,
   at most ~90 points). Line chart for day/week/month, bar chart for
   quarter (only 2 points — a 2-point line reads poorly). Props:
   {series: [{date, label, amount, count}], period}. Toggle switches the
   Y metric between 金额 (cents → yuan) and 订单量. Hover shows a tooltip
   with label + amount + count. Zero buckets are drawn as 0, never
   interpolated. The last X tick label is anchored "end" so it never
   clips past the right edge (P3-6), and the tooltip's centre is clamped
   to its measured half-width so it never overflows the chart box (P3-5).
   Quarter bars are clamped the same way: a bar's centre is shifted left
   when its right edge would pass the viewBox edge, so the last bar and
   its value label stay fully visible (a 64px bar centred at the last
   point x=744 would run to 776 > W=760). X labels also keep a minimum
   centre-to-centre gap (tick-density): the day series shows every 10th
   label, so the last shown label can sit only ~7 points from the final
   label (live day series: 32 buckets, the 11-10 label sat 22 units from
   the 11-11 label) and the two collide into an unreadable jumble — a
   too-close label is dropped, and if the final label is the close one,
   the previous label is dropped instead so the final label always stays. */
import { useState, useLayoutEffect, useRef } from "react";
import { fmtMoney } from "./adminApi.js";

const W = 760;
const H = 300;
const PAD_L = 68;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 32;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

export default function TrendChart({ series, period }) {
  const [metric, setMetric] = useState("amount");
  const [hover, setHover] = useState(null); // index into series, or null
  const boxRef = useRef(null);
  const tipRef = useRef(null);
  // Half the tooltip's rendered width, in viewBox units. The tooltip is an
  // HTML overlay (CSS-pixel width, content-dependent) while the chart is
  // SVG viewBox units, so a fixed margin cannot be exact at every rendered
  // width — measure the live element instead. Fallback 70 = old clamp.
  const [tipHalfVb, setTipHalfVb] = useState(70);
  const data = Array.isArray(series) ? series : [];
  const isQuarter = period === "quarter";
  const hov = hover === null ? null : data[hover];
  // Measure the tooltip once it mounts (and whenever the hovered point
  // changes — the label length differs per point) and clamp its centre so
  // the whole tooltip stays inside [0, W]. Runs before paint, so even the
  // first hovered frame is already correct. This hook sits above the empty
  // early return on purpose — hooks must never be called conditionally.
  useLayoutEffect(() => {
    if (hov && tipRef.current && boxRef.current) {
      const boxW = boxRef.current.getBoundingClientRect().width;
      if (boxW > 0) setTipHalfVb((tipRef.current.offsetWidth / 2) * (W / boxW));
    }
  }, [hov]);

  if (!data.length) {
    return (
      <div className="chart-wrap">
        <div className="empty">暂无数据</div>
      </div>
    );
  }

  const values = data.map((s) =>
    metric === "amount" ? s.amount / 100 : s.count,
  );
  const max = niceMax(Math.max(...values));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const y = (v) => PAD_T + innerH - (v / max) * innerH;
  const x = (i) =>
    data.length === 1
      ? PAD_L + innerW / 2
      : PAD_L + (i / (data.length - 1)) * innerW;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const fmtTick = (v) =>
    metric === "amount" ? "¥" + Math.round(v).toLocaleString("zh-CN") : String(Math.round(v));
  // Sparse X labels so ~90 day points never collide: every 10th label.
  const labelStep = period === "day" ? 10 : 1;
  // Minimum centre-to-centre gap (viewBox units) between two shown X
  // labels. Candidates are the sparse labels above plus the final label,
  // walked left to right: a candidate too close to the previous shown
  // label is skipped — except the final label, which is always kept: if
  // it is too close, the previous shown label is dropped instead. So the
  // live day series (32 buckets) shows 10-11 / 10-21 / 10-31 / 11-11 with
  // the colliding 11-10 dropped, and the 14-bucket week series thins to
  // every other label, which also clears its mild overlap. 56 units keeps
  // the 6-bucket live week (135 apart), month (225+) and quarter (676)
  // untouched.
  const MIN_LABEL_GAP = 56;
  const labelIdx = [];
  for (let i = 0; i < data.length; i++) {
    if (i % labelStep !== 0 && i !== data.length - 1) continue;
    while (
      labelIdx.length &&
      x(i) - x(labelIdx[labelIdx.length - 1]) < MIN_LABEL_GAP
    ) {
      if (i === data.length - 1) labelIdx.pop(); // keep the final label
      else break; // skip this intermediate label
    }
    if (
      !labelIdx.length ||
      x(i) - x(labelIdx[labelIdx.length - 1]) >= MIN_LABEL_GAP
    ) {
      labelIdx.push(i);
    }
  }
  const showLabel = (i) => labelIdx.includes(i);

  const linePath = data.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;
  const barW = Math.min(64, (innerW / Math.max(data.length, 1)) * 0.5);
  // Quarter-bar centre, clamped so the bar never overflows the viewBox's
  // right edge: the last bar's centre x=744 with barW=64 would run to 776
  // (> W=760), so it is shifted left to 712 (bar 680–744) and its value
  // label follows the bar centre. Only the last bar can overflow — the
  // first sits at x=68, well inside — and line-chart geometry is untouched.
  const barCx = (i) => Math.min(x(i), W - PAD_R - barW / 2);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(x(i) - px);
      if (d < best) { best = d; idx = i; }
    }
    setHover(idx);
  }

  const tipX = hov ? Math.min(Math.max(x(hover), tipHalfVb), W - tipHalfVb) : 0;

  return (
    <div className="chart-wrap">
      <div className="chips chart-toggle">
        <button type="button" className={metric === "amount" ? "on" : ""} aria-pressed={metric === "amount" ? "true" : "false"} onClick={() => setMetric("amount")}>金额</button>
        <button type="button" className={metric === "count" ? "on" : ""} aria-pressed={metric === "count" ? "true" : "false"} onClick={() => setMetric("count")}>订单量</button>
      </div>
      <div className="chart-box" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="趋势图"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} className="grid" />
              <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="axis">{fmtTick(t)}</text>
            </g>
          ))}
          {isQuarter
            ? data.map((s, i) => (
              <g key={s.date}>
                <rect x={barCx(i) - barW / 2} y={y(values[i])} width={barW}
                  height={Math.max(0, PAD_T + innerH - y(values[i]))} className="bar" />
                <text x={barCx(i)} y={y(values[i]) - 6} textAnchor="middle" className="bar-val">
                  {metric === "amount" ? fmtMoney(s.amount) : `${s.count}单`}
                </text>
              </g>
            ))
            : (
              <>
                <path d={areaPath} className="area" />
                <path d={linePath} className="line" />
                {data.map((s, i) => (
                  <circle key={s.date} cx={x(i)} cy={y(values[i])} r={hover === i ? 5 : 3} className="dot" />
                ))}
              </>
            )}
          {data.map((s, i) => (
            showLabel(i) ? (
              <text key={"x" + s.date} x={x(i)} y={H - 10}
                textAnchor={i === data.length - 1 && data.length > 1 ? "end" : "middle"}
                className="axis">{s.label}</text>
            ) : null
          ))}
          {hov && (
            <line x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + innerH} className="hover-line" />
          )}
        </svg>
        {hov && (
          <div className="chart-tip" ref={tipRef} style={{ left: ((tipX / W) * 100).toFixed(2) + "%" }}>
            <b>{hov.label}</b>
            <span>金额 {fmtMoney(hov.amount)}</span>
            <span>订单 {hov.count}单</span>
          </div>
        )}
      </div>
    </div>
  );
}
