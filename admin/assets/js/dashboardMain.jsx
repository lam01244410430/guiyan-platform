/* Admin dashboard entry — mounts AdminDashboard on #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import AdminDashboard from "./AdminDashboard.jsx";
import "../css/admin.css";

createRoot(document.getElementById("root")).render(<AdminDashboard />);
