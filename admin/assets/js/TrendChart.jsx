/* Trend chart — pure SVG, no chart library (admin is desktop-first,
   at most ~90 points). Line chart for day/week/month, bar chart for
   quarter (only 2 points — a 2-point line reads poorly). Props:
   {series, prevSeries, period, metric, onMetricChange}.
   - metric is controlled-or-uncontrolled: when AdminDashboard passes
     `metric` + `onMetricChange` (overview + trends views) the KPI
     tiles drive it and no toggle renders here; when it is omitted
     (the BI view) the chart keeps its own toggle, like before.
   - prevSeries (D1) is the previous window, index-aligned with the
     series: drawn as a grey dashed line behind the current one, with
     its own hollow last dot (its last bucket is also partial, cut by
     elapsed time). The legend reads 本期 / 上期.
   - The last bucket is partial (D1, backend knows "today"): the line
     runs solid to the second-to-last point and dotted to the last,
     and the last dot is hollow; quarter's last bar gets a dashed
     outline instead of a fill.
   - Y ticks are compact (1k / ¥4k, never 2,103). Summary chips under
     the chart come from summarizeSeries (adminApi.js): 日均 / 最高日
     for every period, plus 工作日 vs 周末 when period=day.
   - The tooltip is dark (.chart-tip) and shows 本期 + 上期 + the
     change vs the same-index previous bucket. Keyboard: the chart box
     is focusable; ←/→ move the hovered point, Home/End jump to the
     ends; the aria-label always names the current point.
   Zero buckets are drawn as 0, never interpolated. The last X tick
   label is anchored "end" so it never clips past the right edge
   (P3-6), and the tooltip's centre is clamped to its measured
   half-width so it never overflows the chart box (P3-5). Quarter
   bars are clamped the same way: a bar's centre is shifted left when
   its right edge would pass the viewBox edge, so the last bar and its
   value label stay fully visible (a 64px bar centred at the last
   point x=744 would run to 776 > W=760). X labels also keep a
   minimum centre-to-centre gap (tick-density): the day series shows
   every 10th label, so the last shown label can sit only ~7 points
   from the final label (live day series: 32 buckets, the 11-10 label
   sat 22 units from the 11-11 label) and the two collide into an
   unreadable jumble — a too-close label is dropped, and if the final
   label is the close one, the previous label is dropped instead so
   the final label always stays. */
import { useLayoutEffect, useRef, useState } from "react";
import { fmtMoney, fmtCompactTick, summarizeSeries } from "./adminApi.js";

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

export default function TrendChart({ series, prevSeries, period, metric, onMetricChange }) {
  const controlled = metric !== undefined;
  const [innerMetric, setInnerMetric] = useState("amount");
  const curMetric = controlled ? metric : innerMetric;
  const [hover, setHover] = useState(null); // index into series, or null
  const boxRef = useRef(null);
  const tipRef = useRef(null);
  // Half the tooltip's rendered width, in viewBox units. The tooltip is an
  // HTML overlay (CSS-pixel width, content-dependent) while the chart is
  // SVG viewBox units, so a fixed margin cannot be exact at every rendered
  // width — measure the live element instead. Fallback 70 = old clamp.
  const [tipHalfVb, setTipHalfVb] = useState(70);
  const data = Array.isArray(series) ? series : [];
  const prev = Array.isArray(prevSeries) ? prevSeries : [];
  const isQuarter = period === "quarter";
  const hov = hover === null ? null : data[hover];
  const hovPrev = hover === null ? null : prev[hover] || null;
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

  const val = (s) => (curMetric === "amount" ? s.amount / 100 : s.count);
  const values = data.map(val);
  const prevValues = prev.map(val);
  const max = niceMax(Math.max(...values, ...prevValues, 0));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const y = (v) => PAD_T + innerH - (v / max) * innerH;
  const x = (i) =>
    data.length === 1
      ? PAD_L + innerW / 2
      : PAD_L + (i / (data.length - 1)) * innerW;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const fmtTick = (v) => fmtCompactTick(v, curMetric === "amount");
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

  // Current line: solid to the second-to-last point, dotted to the last
  // when the last bucket is partial (today — the data is not final).
  const lastPartial = data.length > 1 && data[data.length - 1].partial === true;
  const solidEnd = lastPartial ? data.length - 2 : data.length - 1;
  const linePath = data.slice(0, solidEnd + 1).map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
  const tailPath = lastPartial
    ? `M${x(data.length - 2).toFixed(1)},${y(values[data.length - 2]).toFixed(1)} L${x(data.length - 1).toFixed(1)},${y(values[data.length - 1]).toFixed(1)}`
    : "";
  const areaPath = `${linePath}${lastPartial ? ` L${x(data.length - 1).toFixed(1)},${y(values[data.length - 1]).toFixed(1)}` : ""} L${x(data.length - 1).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;
  // Previous line: same geometry, index-aligned; the whole line is
  // dashed, so no separate tail — only its last dot is hollow.
  const prevPath = prevValues.length
    ? prevValues.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    : "";
  const prevLastPartial = prev.length > 0 && prev[prev.length - 1].partial === true;
  const barW = Math.min(64, (innerW / Math.max(data.length, 1)) * 0.5);
  // Quarter-bar centre, clamped so the bar never overflows the viewBox's
  // right edge: the last bar's centre x=744 with barW=64 would run to 776
  // (> W=760), so it is shifted left to 712 (bar 680–744) and its value
  // label follows the bar centre. Only the last bar can overflow — the
  // first sits at x=68, well inside — and line-chart geometry is untouched.
  const barCx = (i) => Math.min(x(i), W - PAD_R - barW / 2);

  function setMetric(m) {
    if (controlled) {
      if (onMetricChange) onMetricChange(m);
    } else {
      setInnerMetric(m);
    }
  }

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

  function onKey(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = hover === null
        ? (e.key === "ArrowRight" ? 0 : data.length - 1)
        : Math.min(data.length - 1, Math.max(0, hover + (e.key === "ArrowRight" ? 1 : -1)));
      setHover(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHover(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHover(data.length - 1);
    } else if (e.key === "Escape") {
      setHover(null);
    }
  }

  const tipX = hov ? Math.min(Math.max(x(hover), tipHalfVb), W - tipHalfVb) : 0;
  const summary = summarizeSeries(data, period, curMetric);
  // fmtVal takes a RAW series value (amount in cents, or a count) —
  // summarizeSeries works in those units, unlike the chart's `values`
  // (amount in yuan for the Y scale).
  const fmtVal = (v) => (curMetric === "amount" ? fmtMoney(v) : `${Math.round(v)}单`);
  const hovChange = hov && hovPrev && val(hovPrev) > 0
    ? (((val(hov) - val(hovPrev)) / val(hovPrev)) * 100)
    : null;
  const ariaSummary = `趋势图：${data.length} 个周期，`
    + `日均 ${fmtVal(summary.avg)}，`
    + (summary.best ? `最高 ${summary.best.label} ${fmtVal(summary.best.value)}` : "暂无最高日")
    + (hov ? `，当前 ${hov.label} ${fmtVal(curMetric === "amount" ? hov.amount : hov.count)}` : "，方向键选择周期");

  return (
    <div className="chart-wrap">
      {!controlled ? (
        <div className="chips chart-toggle">
          <button type="button" className={curMetric === "amount" ? "on" : ""} aria-pressed={curMetric === "amount" ? "true" : "false"} onClick={() => setMetric("amount")}>金额</button>
          <button type="button" className={curMetric === "count" ? "on" : ""} aria-pressed={curMetric === "count" ? "true" : "false"} onClick={() => setMetric("count")}>订单量</button>
        </div>
      ) : null}
      {prevValues.length ? (
        <div className="chart-legend" aria-hidden="true">
          <span><span className="lg-line" />本期</span>
          <span><span className="lg-line lg-prev" />上期</span>
        </div>
      ) : null}
      <div
        className={"chart-box metric-" + curMetric}
        ref={boxRef}
        tabIndex={0}
        role="img"
        aria-label={ariaSummary}
        onKeyDown={onKey}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} className="grid" />
              <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="axis">{fmtTick(t)}</text>
            </g>
          ))}
          {prevPath ? <path d={prevPath} className="prev-line" /> : null}
          {isQuarter
            ? data.map((s, i) => {
              const partial = s.partial === true;
              // Previous quarter as a dashed-outline bar beside the
              // current one (same grouped geometry as the line chart's
              // grey dashed previous line).
              const w2 = (barW - 4) / 2;
              const prevV = prevValues[i];
              return (
                <g key={s.date}>
                  {prevV !== undefined ? (
                    <rect x={barCx(i) - barW / 2} y={y(prevV)} width={w2}
                      height={Math.max(0, PAD_T + innerH - y(prevV))} className="bar-prev" />
                  ) : null}
                  <rect x={barCx(i) - barW / 2 + w2 + 4} y={y(values[i])} width={w2}
                    height={Math.max(0, PAD_T + innerH - y(values[i]))} className={partial ? "bar-partial" : "bar"} />
                  <text x={barCx(i)} y={y(values[i]) - 6} textAnchor="middle" className="bar-val">
                    {curMetric === "amount" ? fmtMoney(s.amount) : `${s.count}单`}
                  </text>
                </g>
              );
            })
            : (
              <>
                <path d={areaPath} className="area" />
                <path d={linePath} className="line" />
                {tailPath ? <path d={tailPath} className="line-tail" /> : null}
                {data.map((s, i) => (
                  <circle key={s.date} cx={x(i)} cy={y(values[i])} r={hover === i ? 5 : 3}
                    className={s.partial === true ? "dot-partial" : "dot"} />
                ))}
                {prevValues.length ? prevValues.map((v, i) => (
                  <circle key={"prev-" + prev[i].date} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3}
                    className={i === prev.length - 1 && prevLastPartial ? "dot-partial prev" : "dot-prev"} opacity={hover === null || hover === i ? 0.9 : 0.35} />
                )) : null}
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
            <b>{hov.label}{hov.partial === true ? "（未完）" : ""}</b>
            <span>本期 {fmtMoney(hov.amount)} · {hov.count}单</span>
            {hovPrev ? (
              <span>上期 {fmtMoney(hovPrev.amount)} · {hovPrev.count}单</span>
            ) : null}
            {hovChange !== null ? (
              <span>较上期 {hovChange > 0 ? "▲ " : hovChange < 0 ? "▼ " : ""}{Math.abs(hovChange).toFixed(1)}%</span>
            ) : null}
          </div>
        )}
      </div>
      <div className="chart-chips">
        <span className="chart-chip">日均 <b>{fmtVal(summary.avg)}</b></span>
        {summary.best ? (
          <span className="chart-chip">最高 {summary.best.label} <b>{fmtVal(summary.best.value)}</b></span>
        ) : null}
        {summary.weekdayAvg !== null ? (
          <span className="chart-chip">工作日 <b>{fmtVal(summary.weekdayAvg)}</b> / 周末 <b>{fmtVal(summary.weekendAvg)}</b></span>
        ) : null}
      </div>
    </div>
  );
}
