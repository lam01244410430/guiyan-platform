// 文小惠 IP config (Roadmap 82 Wave R7-1, 2026-11-14) — xlsx rows 40, 41.
// Config frame ONLY: no 文小惠 design has arrived from Lam/Group, so
// there is no character, name, avatar or greeting in this repo — the
// three settings keys below default to empty (= unset) and GET /api/ip
// returns an empty object until an admin sets them. Nothing here
// invents a value.
//
// Storage: the existing `settings` table (keys `ip_name`,
// `ip_avatar_url`, `ip_greeting`), seeded empty by server/seed.mjs +
// the postgres.mjs guard-key backfill (same pattern as tagRules /
// memberInsightRules). Values are stored JSON-encoded (JSON.stringify
// on write, JSON.parse on read with a raw-string fallback for rows
// written before encoding).
//
// GET /api/ip (public): returns only the fields that are set, e.g.
// {ip_name, ip_avatar_url, ip_greeting}; unset -> {}.
// PATCH /api/admin/ip (admin): partial patch — only the provided known
// keys change; unknown keys -> 400; an empty string clears a field.
//   ip_name: string, ≤20 chars (empty clears)
//   ip_avatar_url: "" or an https:// URL or a site-relative path
//     (starts with "/" but not "//"); ≤500 chars
//   ip_greeting: string, ≤200 chars (empty clears)
// Audits "修改IP配置". Anonymous -> 403 (tag-rules precedent: the
// assert is on role only, no separate 401 — see docs/03 R7-1).
import { assert } from "../lib/http.mjs";

export const IP_KEYS = ["ip_name", "ip_avatar_url", "ip_greeting"];
const MAX_LEN = { ip_name: 20, ip_avatar_url: 500, ip_greeting: 200 };
const LABELS = { ip_name: "IP 名称", ip_avatar_url: "头像链接", ip_greeting: "问候语" };

function decodeSetting(raw) {
  if (raw === undefined || raw === null) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Rows written as plain text (guard-key backfill) fall through.
  }
  return String(raw);
}

// Read the stored config; only set (non-empty) fields are returned.
// Missing rows or broken values fall back to unset — never throws,
// never invents a value.
export async function loadIpConfig(ctx) {
  const rows = await ctx.all(
    "SELECT key, value FROM settings WHERE key IN ('ip_name','ip_avatar_url','ip_greeting')",
  );
  const out = {};
  for (const row of rows || []) {
    if (!IP_KEYS.includes(row.key)) continue;
    const v = decodeSetting(row.value).trim();
    if (v) out[row.key] = v;
  }
  return out;
}

function validateIpPatch(body) {
  assert(body && typeof body === "object" && !Array.isArray(body), "配置格式错误");
  const updates = {};
  for (const key of Object.keys(body)) {
    assert(IP_KEYS.includes(key), `未知配置项：${key}`, 400);
    const raw = body[key];
    assert(typeof raw === "string", `${LABELS[key]}须为字符串`, 400);
    const v = raw.trim();
    assert(
      [...v].length <= MAX_LEN[key],
      `${LABELS[key]}不能超过${MAX_LEN[key]}字`,
      400,
    );
    if (key === "ip_avatar_url" && v !== "") {
      assert(
        /^https:\/\/\S+$/.test(v) || /^\/[^/\s]\S*$/.test(v),
        "头像链接须为 https:// 开头或站内路径",
        400,
      );
    }
    updates[key] = v;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的配置项", 400);
  return updates;
}

export async function getIp(ctx) {
  const { req, p, send } = ctx;
  if (p !== "/api/ip" || req.method !== "GET") return false;
  send(await loadIpConfig(ctx));
  return true;
}

export async function patchIp(ctx) {
  const { req, p, b, send, session, run, audit } = ctx;
  if (p !== "/api/admin/ip" || req.method !== "PATCH") return false;
  assert(session?.role === "admin", "无权访问管理后台", 403);
  // Validate everything BEFORE any write (OTP lesson).
  const updates = validateIpPatch(b);
  for (const [k, v] of Object.entries(updates)) {
    await run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT (key) DO UPDATE SET value=?",
      k,
      JSON.stringify(v),
      JSON.stringify(v),
    );
  }
  await audit(session, "修改IP配置", JSON.stringify(updates));
  send({ ok: true, ...(await loadIpConfig(ctx)) });
  return true;
}
