/* Shared dark tooltip (dashboard redesign): one system for the whole
   admin screen — dark surface (--p-tip), white text, 12px, 9px radius,
   placed above the element and kept inside the viewport. Shows on
   hover AND on keyboard focus (focus/blur bubble from the wrapped
   control, so the wrapper itself needs no tab stop); hides on mouse
   leave, blur, Escape, or scroll. The tooltip element is measured
   live so the clamp uses its real width, like the chart tooltip
   (P3-5). Content is a string or nodes (<b> + .tip-sub lines). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function Tooltip({ content, children, className }) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({ left: 0, top: 0, visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const r = wrap.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const cx = Math.min(
      Math.max(r.left + r.width / 2, 8 + w / 2),
      window.innerWidth - 8 - w / 2,
    );
    const above = r.top - h - 8;
    const top = above >= 8 ? above : r.bottom + 8;
    setStyle({ left: cx, top, visibility: "visible", transform: "translateX(-50%)" });
  }, [open, content]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span
      className={"tooltip-wrap" + (className ? " " + className : "")}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span className="tooltip" role="tooltip" ref={tipRef} style={style}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
