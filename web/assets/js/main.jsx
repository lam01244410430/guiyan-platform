/* Customer SPA entry — mounts App on #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyTheme } from "./theme.mjs";
import "../css/main.css";

/* Re-apply the stored theme on boot (the inline script in index.html
   already set data-theme before first paint; this is the same call, so a
   skipped inline script still ends in the right theme). */
applyTheme();
createRoot(document.getElementById("root")).render(<App />);
