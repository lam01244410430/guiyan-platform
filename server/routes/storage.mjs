import { assert } from "../lib/http.mjs";
import { validKey } from "../storage.mjs";

function needStorage(storage) {
  assert(storage, "对象存储未配置", 503);
  return storage;
}

export async function storageHealth(ctx) {
  const { p, req, send, storage } = ctx;
  if (p === "/api/storage/health" && req.method === "GET") {
    send(await needStorage(storage).health());
    return true;
  }
  return false;
}

export async function storageUpload(ctx) {
  const { p, req, b, send, needUser, storage, audit } = ctx;
  if (p === "/api/storage/upload" && req.method === "POST") {
    const u = needUser();
    const s = needStorage(storage);
    assert(validKey(b.key), "文件路径无效", 400);
    assert(
      typeof b.content_base64 === "string" &&
        b.content_base64.length > 0,
      "文件内容不能为空",
      400,
    );
    const body = Buffer.from(b.content_base64, "base64");
    assert(
      body.length > 0 && body.length <= 200000,
      "文件大小须在 200KB 以内",
      400,
    );
    const contentType =
      typeof b.content_type === "string" &&
      b.content_type.length <= 100
        ? b.content_type
        : "application/octet-stream";
    const out = await s.put(b.key, body, contentType);
    await audit(u, "上传文件", b.key);
    send({ ok: true, ...out });
    return true;
  }
  return false;
}

export async function storageUrl(ctx) {
  const { p, req, url, send, needUser, storage } = ctx;
  if (p === "/api/storage/url" && req.method === "GET") {
    needUser();
    const s = needStorage(storage);
    const key = url.searchParams.get("key") || "";
    assert(validKey(key), "文件路径无效", 400);
    send(await s.presignedGet(key));
    return true;
  }
  return false;
}

export async function storageDelete(ctx) {
  const { p, req, send, needUser, storage, audit } = ctx;
  const m = p.match(/^\/api\/storage\/(.+)$/);
  if (
    m &&
    req.method === "DELETE" &&
    !["health", "upload", "url"].includes(m[1])
  ) {
    const u = needUser();
    const s = needStorage(storage);
    const key = decodeURIComponent(m[1]);
    assert(validKey(key), "文件路径无效", 400);
    const out = await s.remove(key);
    await audit(u, "删除文件", key);
    send({ ok: true, ...out });
    return true;
  }
  return false;
}
