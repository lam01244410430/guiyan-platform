import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const useDist = process.env.STATIC_DIR === "dist";
const webRoot = fileURLToPath(
  new URL(useDist ? "../dist/" : "../web/", import.meta.url),
);
const adminRoot = fileURLToPath(
  new URL(useDist ? "../dist/admin/" : "../admin/", import.meta.url),
);
// R9-1: the SEO files live in Vite `public/` at the repo root, so in dev
// mode they are served from there; in dist mode Vite has already copied
// them to the dist root, so publicRoot == webRoot and nothing changes.
const publicRoot = fileURLToPath(
  new URL(useDist ? "../dist/" : "../public/", import.meta.url),
);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  /* R9-1 brand site: robots.txt + sitemap.xml are static files at the
     dist root (Vite `public/`), served like any other static file. */
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function insideWeb(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function serveStatic(req, res) {
  try {
    // Inspect the original path before URL normalization can remove '..'.
    const pathname = decodeURIComponent(req.url.split(/[?#]/, 1)[0]);
    if (pathname.includes("\\") || pathname.split("/").includes(".."))
      throw new Error("Invalid web path");
    const file = pathname === "/" ? "/index.html" : pathname;
    // The admin console is a separate web under /admin/, served from admin/.
    const isAdmin = file === "/admin" || file.startsWith("/admin/");
    const isSeoFile = file === "/robots.txt" || file === "/sitemap.xml";
    const root = isAdmin ? adminRoot : isSeoFile ? publicRoot : webRoot;
    const serveFile = isAdmin
      ? file === "/admin" || file === "/admin/"
        ? "/index.html"
        : file.slice("/admin".length)
      : file;
    const contentType = contentTypes[path.extname(serveFile)];
    const allowed = isAdmin
      ? ["/index.html", "/dashboard.html"].includes(serveFile) || serveFile.startsWith("/assets/")
      /* R9-1: the brand page + the SEO files are public static files at
         the dist root (robots.txt / sitemap.xml come from Vite `public/`). */
      : ["/index.html", "/user.html", "/brand.html", "/robots.txt", "/sitemap.xml"].includes(serveFile) || serveFile.startsWith("/assets/");
    if (!contentType || !allowed) throw new Error("Unknown web path");
    const target = path.resolve(root, `.${serveFile}`);
    if (!insideWeb(root, target)) throw new Error("Invalid web path");
    // Also prevent a symlink inside the root from exposing files outside it.
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!insideWeb(realRoot, realTarget)) throw new Error("Invalid web path");
    const data = await readFile(realTarget);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: "页面不存在" }));
  }
}
