// After `vite build`: Vite MPA keeps the input directory structure, so the
// customer entries land in dist/web/. The live URLs are / and /user.html,
// so move them to the dist root. Asset refs in the built HTML are absolute
// (/assets/...), so moving the HTML files changes nothing else.
// dist/admin/ stays as-is (/admin/, /admin/dashboard.html).
import { rename, rm } from "node:fs/promises";

await rename("dist/web/index.html", "dist/index.html");
await rename("dist/web/user.html", "dist/user.html");
await rm("dist/web", { recursive: true, force: true });
console.log("dist flattened: /index.html /user.html /admin/ /admin/dashboard.html");
