/* User dashboard entry — mounts UserDashboard on #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import UserDashboard from "./UserDashboard.jsx";
import "../css/main.css";

createRoot(document.getElementById("root")).render(<UserDashboard />);
