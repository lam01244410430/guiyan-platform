// Guiyan frontend — Vite multi-page build (React 19).
//
// Four entries keep the exact URLs of the old static site:
//   /                     <- web/index.html     (customer SPA)
//   /user.html            <- web/user.html      (user dashboard)
//   /admin/               <- admin/index.html   (admin login)
//   /admin/dashboard.html <- admin/dashboard.html (admin console)
// No new URL is introduced; the SPA fallback for unknown paths stays in
// vercel.json (homepage 200), as before. Locally the Node server
// (server/static.mjs, untouched in phase 1a) still serves the old
// web//admin/ roots, so local verification serves the build with
// `vite preview` (proxy /api to the Node server) — see /tmp/smoke.sh.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.GUIYAN_API_PORT || "3001";

export default defineConfig({
  plugins: [react()],
  appType: "mpa",
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "web/index.html",
        user: "web/user.html",
        admin: "admin/index.html",
        dashboard: "admin/dashboard.html",
      },
    },
  },
});
