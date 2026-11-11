/* Shared search box (redesign 2026-11-11) — one per admin view.
   Controlled: the query state lives in AdminDashboard; this component
   only renders the field and reports changes. No fetch, no filtering,
   no debounce (at most ~310 rows, filtered synchronously in render).
   The search icon is inlined (not <img>) so currentColor renders ink3
   — through <img> it resolved to black at 0.6 opacity. Path data copied
   verbatim from admin/assets/icons/ui-search.svg. */
import { useRef } from "react";

export default function SearchBox({ id, label, placeholder, value, onChange, resultCount, countText }) {
  const inputRef = useRef(null);

  function clear() {
    onChange("");
    if (inputRef.current) inputRef.current.focus();
  }

  return (
    <div className="search-box">
      <label htmlFor={id}>{label}</label>
      <div className="search-input">
        <svg className="search-ic" data-icon="ui:search" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21l-4.34-4.34" /></svg>
        <input
          ref={inputRef}
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && value) onChange(""); }}
        />
        {value ? (
          <button type="button" className="search-clear" aria-label="清除搜索" onClick={clear}>×</button>
        ) : null}
      </div>
      {resultCount !== null && resultCount !== undefined ? (
        <p className="search-count" role="status" aria-live="polite">
          {countText || `找到 ${resultCount} 条`}
        </p>
      ) : null}
    </div>
  );
}
