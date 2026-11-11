/* Shared search box (redesign 2026-11-11) — one per admin view.
   Controlled: the query state lives in AdminDashboard; this component
   only renders the field and reports changes. No fetch, no filtering,
   no debounce (at most ~310 rows, filtered synchronously in render). */
import { useRef } from "react";
import searchIcon from "../icons/ui-search.svg";

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
        <img className="search-ic" data-icon="ui:search" src={searchIcon} alt="" aria-hidden="true" />
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
