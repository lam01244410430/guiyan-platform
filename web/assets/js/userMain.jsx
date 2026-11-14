/* User dashboard entry — mounts UserDashboard on #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import UserDashboard from "./UserDashboard.jsx";
import { applyTheme } from "./theme.mjs";
import "../css/main.css";

/* Re-apply the stored theme on boot (the inline script in user.html
   already set data-theme before first paint; same call, same result). */
applyTheme();
createRoot(document.getElementById("root")).render(<UserDashboard />);
