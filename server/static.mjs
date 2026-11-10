import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const adminRoot = fileURLToPath(new URL("../admin/", import.meta.url));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
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
    const root = isAdmin ? adminRoot : webRoot;
    const serveFile = isAdmin
      ? file === "/admin" || file === "/admin/"
        ? "/index.html"
        : file.slice("/admin".length)
      : file;
    const contentType = contentTypes[path.extname(serveFile)];
    const allowed = isAdmin
      ? ["/index.html", "/dashboard.html"].includes(serveFile) || serveFile.startsWith("/assets/")
      : ["/index.html", "/user.html"].includes(serveFile) || serveFile.startsWith("/assets/");
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
