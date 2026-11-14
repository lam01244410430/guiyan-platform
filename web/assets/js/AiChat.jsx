/* Floating AI chat widget (customer site) — AI-first with rule fallback.
   Mounted on the homepage (App.jsx) and the user dashboard
   (UserDashboard.jsx); anonymous, no login required. History lives only in
   component state — navigating away loses it (no localStorage).
   Transport is raw fetch with its own 30 s AbortController (the shared
   apiFetch has a hard-coded 5 s timeout, too short for the 25 s proxy):
   POST apiBase() + "/api/assistant/chat" with {message, language}. The
   language comes from the parent (App.jsx / UserDashboard.jsx `lang` state,
   the single source of truth) — new replies follow it, history already
   shown stays as written, and the greeting is a derived first bubble while
   the chat is still empty so it re-renders on a language switch. Rule
   fallback replies are rendered from the existing i18n answer keys by the
   `kind` the proxy returns, never from the proxy's Chinese `reply` text.
   Upstream replies are untrusted third-party strings: rendered through
   renderRich (minimal safe subset — **bold** + line breaks — as React
   elements only, never dangerouslySetInnerHTML), so any HTML in a reply
   stays inert text. User messages stay plain text. */
import { useEffect, useRef, useState } from "react";
import { t, fmt, money, cityName, unitName } from "./data.js";
import { apiBase, apiGet } from "./apiClient.js";

// Rule kind -> existing i18n answer key (same keys botAnswer in App.jsx
// uses). `items` (heritage/hot) are the proxy's {name, city, price, unit}
// rows; price is DB cents, like the server's yuan() it is divided by 100.
// The unit is rendered exactly as botAnswer does: money + "/" +
// unitName(unit) (e.g. ¥168/人); an item with no unit renders no suffix.
const RULE_KEYS = {
  refund: "ansRefund",
  reschedule: "ansResched",
  heritage: "ansHeritage",
  book: "ansBook",
  hot: "ansHot",
  hello: "ansHello",
  fallback: "ansFallback",
};
function renderRules(kind, items, serverText) {
  const key = RULE_KEYS[kind];
  if (!key) return serverText || t("ansFallback");
  if (kind === "heritage" || kind === "hot") {
    if (!Array.isArray(items)) return serverText || t(key);
    const list = items
      .map((r) => `• ${r.name} — ${cityName(r.city)} · ${money(r.price / 100)}${r.unit ? "/" + unitName(r.unit) : ""}`)
      .join("\n");
    return kind === "heritage"
      ? fmt(t("ansHeritage"), { n: items.length, list })
      : fmt(t("ansHot"), { list });
  }
  return t(key);
}

// Minimal safe Markdown for bot replies: **bold** segments become
// <strong>, line breaks become <br/>. Built from React elements only —
// the text is never parsed as HTML, so tags in a reply (e.g. <script>,
// <img onerror>) render as inert text. Unmatched ** stays literal.
function renderRich(text) {
  const nodes = [];
  String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .forEach((part, pi) => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      (bold ? bold[1] : part).split("\n").forEach((line, li) => {
        if (li > 0) nodes.push(<br key={pi + "-" + li + "-br"} />);
        if (line)
          nodes.push(
            bold ? (
              <strong key={pi + "-" + li}>{line}</strong>
            ) : (
              <span key={pi + "-" + li}>{line}</span>
            ),
          );
      });
    });
  return nodes;
}

/* R7-1 文小惠 IP config (no design has arrived): AiChat fetches
   GET /api/ip once on mount and uses the set name/avatar/greeting
   ONLY when set — name replaces the panel title, avatar replaces
   the 桂演 mark, greeting replaces the default first bubble. While
   unset (or while the fetch is still in flight / failed) every
   default stays byte-identical: nothing is invented. */
export default function AiChat({ lang }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // R7-1: the IP config (null = not loaded yet; {} = unset).
  const [ipConfig, setIpConfig] = useState(null);
  useEffect(() => {
    let cancelled = false;
    apiGet("/api/ip")
      .then((d) => { if (!cancelled) setIpConfig(d || {}); })
      .catch(() => { if (!cancelled) setIpConfig({}); });
    return () => { cancelled = true; };
  }, []);
  // R7-2 voice input (speech -> text): browser Web Speech API only —
  // free, no server cost, no new model. `voiceStatus` is null |
  // "listening" | "unsupported" | "failed".
  const [voiceStatus, setVoiceStatus] = useState(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  // R7-1 IP avatar: shown ONLY when the R7-1 config sets one. The
  // /api/ip endpoint may not exist yet (R7-1 lands separately) — a
  // 404 here just keeps the current appearance.
  const [ipAvatar, setIpAvatar] = useState("");
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fabRef = useRef(null);
  const ctrlRef = useRef(null);
  const quicks = t("quicks");

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open ]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        if (fabRef.current) fabRef.current.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);

  useEffect(
    () => () => {
      if (ctrlRef.current) ctrlRef.current.abort();
      // R7-2: stop any in-flight recognition when the widget unmounts.
      try {
        if (recRef.current) recRef.current.stop();
      } catch (e) {}
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    apiGet("/api/ip")
      .then((d) => {
        if (
          !cancelled &&
          d &&
          typeof d.ip_avatar_url === "string" &&
          d.ip_avatar_url
        )
          setIpAvatar(d.ip_avatar_url);
      })
      .catch(() => {
        // No R7-1 config yet (or no endpoint): keep the current look.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // R7-2 voice input: the transcript goes into the input for the user to
  // confirm — it is NEVER auto-sent. Unsupported browsers / recognition
  // errors show a message, never a faked transcript. Recognition language
  // follows the chat language (zh -> zh-CN, vi -> vi-VN, en -> en-US).
  function toggleVoice() {
    if (listening) {
      try {
        if (recRef.current) recRef.current.stop();
      } catch (e) {}
      return;
    }
    const SR =
      (typeof window !== "undefined" &&
        (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setVoiceStatus("unsupported");
      return;
    }
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      setVoiceStatus("failed");
      return;
    }
    rec.lang = lang === "vi" ? "vi-VN" : lang === "en" ? "en-US" : "zh-CN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    setVoiceStatus("listening");
    setListening(true);
    rec.onresult = (e) => {
      try {
        const text =
          e.results && e.results[0] && e.results[0][0]
            ? String(e.results[0][0].transcript || "").trim()
            : "";
        if (text) setInput((prev) => (prev ? prev + text : text));
      } catch (err) {}
      setVoiceStatus(null);
      if (inputRef.current) inputRef.current.focus();
    };
    rec.onerror = () => {
      setVoiceStatus("failed");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    try {
      rec.start();
    } catch (e) {
      setVoiceStatus("failed");
      setListening(false);
    }
  }

  function close() {
    setOpen(false);
    try {
      if (recRef.current) recRef.current.stop();
    } catch (e) {}
    if (fabRef.current) fabRef.current.focus();
  }

  async function send(q) {
    const text = (q || "").trim();
    if (!text || busy) return;
    setMsgs((prev) => [...prev, { me: true, text }]);
    setInput("");
    setBusy(true);
    let answer = null;
    try {
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(apiBase() + "/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, language: lang || "zh" }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (data && data.source === "rules" && data.kind)
          answer = renderRules(data.kind, data.items, data.reply);
        else if (data && typeof data.reply === "string" && data.reply.trim())
          answer = data.reply;
        else throw new Error("empty chat reply");
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      try {
        const d = await apiGet(
          "/api/assistant?q=" + encodeURIComponent(text),
        );
        if (d && d.kind) answer = renderRules(d.kind, d.items, d.answer);
        else if (d && d.answer) answer = d.answer;
      } catch (e2) {
        // fall through to the local fallback below
      }
      if (!answer) answer = t("ansFallback");
    } finally {
      ctrlRef.current = null;
      setBusy(false);
    }
    setMsgs((prev) => [...prev, { me: false, text: answer }]);
  }

  return (
    <>
      <button
        type="button"
        ref={fabRef}
        className="ai-fab"
        aria-label={open ? t("aiChatClose") : t("aiChatOpen")}
        aria-expanded={open}
        aria-controls={open ? "ai-chat-panel" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
        )}
      </button>
      {open && (
        <div className="ai-panel" id="ai-chat-panel" role="dialog" aria-label={t("aiChatTitle")}>
          <div className="ai-panel-head">
            <span className="ai-mark">{ipConfig && ipConfig.ip_avatar_url ? <img src={ipConfig.ip_avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", display: "block" }} /> : ipAvatar ? <img className="ai-avatar" src={ipAvatar} alt="" /> : "桂演"}</span>
            <b>{(ipConfig && ipConfig.ip_name) || t("aiChatTitle")}</b>
            <button type="button" className="ai-close" aria-label={t("aiChatClose")} onClick={close}>✕</button>
          </div>
          <p className="ai-note">{t("aiChatNote")}</p>
          <div className="ai-log" ref={logRef}>
            {msgs.length === 0 && (
              <div className="ai-msg bot">{(ipConfig && ipConfig.ip_greeting) || t("aiChatGreeting")}</div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={"ai-msg " + (m.me ? "me" : "bot")}>
                {m.me ? m.text : renderRich(m.text)}
              </div>
            ))}
            {busy && (
              <div className="ai-msg bot ai-thinking">{t("aiChatThinking")}</div>
            )}
          </div>
          <div className="ai-chips">
            {quicks.map((q, i) => (
              <button key={i} type="button" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          <form
            className="ai-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("aiChatPh")}
              aria-label={t("aiChatPh")}
            />
            <button
              type="button"
              className={"ai-mic" + (listening ? " on" : "")}
              aria-label={t("voiceMic")}
              aria-pressed={listening}
              onClick={toggleVoice}
              disabled={busy}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
            <button type="submit" disabled={busy}>{t("sendBtn")}</button>
          </form>
          {voiceStatus && (
            <p className="ai-voice-status" aria-live="polite">
              {t(
                voiceStatus === "listening"
                  ? "voiceListening"
                  : voiceStatus === "unsupported"
                    ? "voiceUnsupported"
                    : "voiceFailed",
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
