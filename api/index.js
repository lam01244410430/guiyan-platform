// Guiyan API — Vercel Serverless Function.
//
// Reuses the standalone backend (server/app.mjs + server/postgres.mjs)
// instead of duplicating the API: the same createApp({database}) that
// `node server.mjs` runs locally. Only the transport differs — here the
// entry point is Vercel's handler, not an HTTP server listening on PORT.
//
// Routing (vercel.json): /api/* -> /api/index?route=<path>. This file
// rewrites req.url back to /api/<path> and hands it to the app handler,
// exactly like the original group demo (guiyan-demo/api/index.js).
// DATABASE_URL comes from the Vercel project environment (Neon
// Postgres); when it is missing or the database is unreachable the
// function answers 503 with a clear message instead of crashing.

import { createApp } from "../server/app.mjs";
import { openPostgresStore } from "../server/postgres.mjs";

let app;
export default async function handler(req, res) {
  try {
    app ||= openPostgresStore(process.env.DATABASE_URL)
      .then((database) => createApp({ database }))
      .catch((error) => {
        app = undefined;
        throw error;
      });
    const url = new URL(req.url, "https://demo.invalid");
    const route = url.searchParams.get("route");
    if (route !== null) {
      url.pathname = "/api/" + route;
      url.searchParams.delete("route");
      req.url = url.pathname + url.search;
    }
    await (await app).handler(req, res);
  } catch (error) {
    console.error("API initialization failed", {
      code: error.code || "INITIALIZATION_FAILED",
    });
    res.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ error: "服务正在连接数据库，请稍后重试" }));
  }
}
