import { today } from "../lib/http.mjs";

export async function health(ctx) {
  const { p, send, dialect } = ctx;
  if (p === "/api/health") {
    send({ ok: true, mode: "postgres", database: dialect, today });
    return true;
  }
  return false;
}

export async function listCategories(ctx) {
  const { p, send, categories } = ctx;
  if (p === "/api/categories") {
    send({ categories });
    return true;
  }
  return false;
}
