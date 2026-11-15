// R9-1 brand site entry — same mount pattern as userMain.jsx:
// apply the saved theme first, then render the brand page.
import { createRoot } from "react-dom/client";
import { applyTheme } from "./theme.mjs";
import "../css/main.css";
import Brand from "./Brand.jsx";

applyTheme();
createRoot(document.getElementById("root")).render(<Brand />);
