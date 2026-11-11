/* Admin login entry — mounts AdminLogin on #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import AdminLogin from "./AdminLogin.jsx";
import "../css/admin.css";

createRoot(document.getElementById("root")).render(<AdminLogin />);
