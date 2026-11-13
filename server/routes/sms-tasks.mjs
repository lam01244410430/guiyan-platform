// SMS tasks + account linking (Roadmap 82 Wave R3-5, 2026-11-14) — xlsx
// rows 18, 25. A task belongs to one shop and is only ever a DRAFT of a
// send: this wave registers NO SMS provider, spends no money and sends
// no real SMS (Q5 default (a)), so there is no send endpoint and no
// `sent` status anywhere. A task can only travel draft -> queued ->
// waiting_provider ("未发送 — 等待服务商", terminal in this wave);
// `waiting_provider` is as far as a task goes until Lam decides on a
// provider. The task, the UI and the docs all say plainly that nothing
// was really sent — never claim a message was sent.
//
// Status machine (fixed, never ambiguous): draft -> queued ->
// waiting_provider; queued may go back to draft; waiting_provider is
// terminal (any later PATCH -> 400). Any status outside
// draft/queued/waiting_provider — including `sent` — is a 400, on
// create and on patch alike. Content fields (name/template/audience)
// are editable only while the task is a draft; editing them later is
// a 400. Changing the audience recomputes audience_count.
//
// Audience (fixed): a rule JSON with only two types — {type: "all"}
// (every user) or {type: "tier", tier_id} (users holding that tier,
// counted from the stored users.tier_id, which holds the MAIN shop
// tier only — a sub-shop tier audience counts 0 this wave, documented
// in the design note, never faked). The count is computed AT CREATION
// (and recomputed when the audience changes in draft) and stored as
// audience_count plus the rule snapshot; there is no live query at
// send time because there is no send. Tag audiences are OUT: no
// per-user tags are stored anywhere yet. No phone harvesting: the
// audience never uses phone numbers and no phone list is stored on
// the task — only the rule and the count.
//
// Templates (fixed): admin-defined text, 1–500 chars, with only
// {{name}} (recipient name) and {{code}} (coupon-code placeholder)
// allowed — any other {{...}} or unbalanced braces -> 400. There are
// no provider-side template IDs, and the template IS the content:
// no separate rendered-content column exists, because nothing is
// rendered or sent this wave.
//
// Account linking (fixed): PATCH /api/account/social gains `maoyan`
// (see server/routes/account.mjs). Linking here means STORING +
// LABELING a handle the user types, display-only ("仅展示，不验证归属"),
// NOT a real OAuth verification flow — no provider, no token exchange.
// The real WeChat link already exists (POST /api/auth/wechat-mini ->
// oauth_accounts) and is untouched. `maoyan` is a profile field only:
// it is NOT a new channel integration and must never be presented as
// an integrated login or payment (甲方渠道 constraint: only the
// client's existing channels Damai / WeChat Pay / Beijing Bank;
// Douyin/Maoyan appear only as profile handles + portrait channel
// sources).
//
// Shop scoping follows R1-1 / R3-1: role=admin only (anonymous and
// non-admin -> 403); a shop-scoped admin works only in their own
// shop, cross-shop -> 403 (explicit-403, NOT admin-resources' silent
// re-scoping).
import { assert, text, int, time } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";

export const SMS_TASK_STATUSES = ["draft", "queued", "waiting_provider"];
const SMS_STATUS_LABEL = {
  draft: "草稿",
  queued: "已排队",
  waiting_provider: "未发送 — 等待服务商",
};
// Allowed next statuses from each current status (same-status PATCH
// is a no-op and is allowed).
const SMS_TRANSITIONS = {
  draft: ["queued"],
  queued: ["draft", "waiting_provider"],
  waiting_provider: [],
};
const TEMPLATE_MAX_CHARS = 500;
const TEMPLATE_PLACEHOLDERS = ["{{name}}", "{{code}}"];

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertTaskAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的短信任务", 403);
}

// A template is admin-defined text, 1–500 chars, with only {{name}}
// and {{code}} as placeholders. Any other {{...}}, or a brace that
// does not belong to one of those two placeholders, is a 400.
function validateTemplate(raw) {
  const template = text(raw, "短信模板", TEMPLATE_MAX_CHARS);
  const found = [...template.matchAll(/\{\{[^}]*\}\}/g)];
  for (const m of found)
    assert(
      TEMPLATE_PLACEHOLDERS.includes(m[0]),
      `模板占位符无效：${m[0]}，仅支持 {{name}} 与 {{code}}`,
      400,
    );
  const stripped = template.replace(/\{\{[^}]*\}\}/g, "");
  assert(
    !stripped.includes("{") && !stripped.includes("}"),
    "模板花括号不成对",
    400,
  );
  return template;
}

// Validate an audience rule (already-parsed JSON from the request
// body): an object with only known keys, type "all" or "tier", and —
// for a tier audience — a tier that exists and belongs to this task's
// shop. Returns the normalized rule ({type} or {type, tier_id}).
// Omitted audience defaults to {type: "all"}.
async function parseAudience(get, raw, shopId) {
  if (raw === undefined || raw === null) return { type: "all" };
  assert(
    typeof raw === "object" && !Array.isArray(raw),
    "受众规则须为对象",
    400,
  );
  for (const k of Object.keys(raw))
    assert(k === "type" || k === "tier_id", `未知的受众规则字段：${k}`, 400);
  assert(
    raw.type === "all" || raw.type === "tier",
    "受众类型须为 all 或 tier",
    400,
  );
  if (raw.type === "all") {
    assert(raw.tier_id === undefined, "全部用户受众不需要 tier_id", 400);
    return { type: "all" };
  }
  const tierId = int(raw.tier_id, "会员等级", 1);
  const tier = await get("SELECT * FROM member_tiers WHERE id=?", tierId);
  assert(tier && tier.shop_id === shopId, "会员等级不存在或不属于该店铺", 400);
  return { type: "tier", tier_id: tierId };
}

// The audience size, computed from stored data at task creation (and
// recomputed when the audience changes in draft). `all` counts every
// user; `tier` counts users whose stored users.tier_id is that tier
// (main-shop tier only — see the header comment).
async function audienceCount(get, audience) {
  if (audience.type === "tier") {
    const row = await get(
      "SELECT COUNT(*) AS n FROM users WHERE tier_id=?",
      audience.tier_id,
    );
    return row?.n || 0;
  }
  const row = await get("SELECT COUNT(*) AS n FROM users");
  return row?.n || 0;
}

function taskRow(r) {
  if (!r) return null;
  let audience = {};
  try {
    audience = JSON.parse(r.audience || "{}") || {};
  } catch {
    audience = {};
  }
  return {
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    template: r.template,
    audience,
    audience_count: r.audience_count,
    status: r.status,
    status_label: SMS_STATUS_LABEL[r.status] || r.status,
    created_at: r.created_at,
  };
}

async function getShopOr404(get, id) {
  const s = await get("SELECT * FROM shops WHERE id=?", id);
  assert(s, "店铺不存在", 404);
  return s;
}

export async function listAdminSmsTasks(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/sms-tasks" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const shopParam = url.searchParams.get("shop");
  let shopId = scope;
  if (shopParam !== null && shopParam !== "") {
    shopId = Number(shopParam);
    assert(Number.isSafeInteger(shopId) && shopId >= 1, "店铺编号错误", 400);
  }
  if (scope !== null) shopId = scope;
  const rows =
    shopId === null
      ? await all("SELECT * FROM sms_tasks ORDER BY shop_id ASC, id ASC")
      : await all(
          "SELECT * FROM sms_tasks WHERE shop_id=? ORDER BY id ASC",
          shopId,
        );
  send({ sms_tasks: rows.map(taskRow) });
  return true;
}

export async function getAdminSmsTask(ctx) {
  const { req, p, send, session, get } = ctx;
  const m = p.match(/^\/api\/admin\/sms-tasks\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  assertAdmin(session);
  const task = await get("SELECT * FROM sms_tasks WHERE id=?", Number(m[1]));
  assert(task, "短信任务不存在", 404);
  assertTaskAccess(session, task.shop_id);
  send({ sms_task: taskRow(task) });
  return true;
}

export async function createSmsTask(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/sms-tasks" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson). A shop-scoped
  // admin works only in their own shop — an explicit shop_id naming
  // another shop is a cross-shop write -> 403 (same explicit-403
  // choice as R3-1/R3-2/R3-3/R3-4, NOT admin-resources' silent
  // re-scoping). The platform admin creates into the main shop
  // unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的短信任务", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertTaskAccess(session, shopId);
  await getShopOr404(get, shopId);
  const name = text(b.name, "任务名称", 100);
  const template = validateTemplate(b.template);
  const audience = await parseAudience(get, b.audience, shopId);
  // A task is always created as a draft. There is no `sent` status
  // in this wave — a create that names any other status is a 400.
  if (b.status !== undefined && b.status !== null)
    assert(b.status === "draft", "新建短信任务只能是草稿", 400);
  const count = await audienceCount(get, audience);
  const result = await run(
    "INSERT INTO sms_tasks(shop_id,name,template,audience,audience_count,status,created_at) VALUES(?,?,?,?,?,?,?)",
    shopId,
    name,
    template,
    JSON.stringify(audience),
    count,
    "draft",
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM sms_tasks WHERE id=?", id);
  await audit(session, "新增短信任务", `${created.name}（${shopId}号店）`);
  send({ ok: true, id, sms_task: taskRow(created) });
  return true;
}

export async function patchSmsTask(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/sms-tasks\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const task = await get("SELECT * FROM sms_tasks WHERE id=?", id);
  assert(task, "短信任务不存在", 404);
  assertTaskAccess(session, task.shop_id);
  // The shop is immutable after creation — a PATCH that names it is
  // a 400, never a silent re-scope.
  assert(b.shop_id === undefined, "店铺不可修改", 400);
  // Validate everything BEFORE any write (OTP lesson). Content fields
  // are editable only while the task is a draft; once queued (or
  // waiting for a provider) the content is frozen.
  const hasContent =
    b.name !== undefined ||
    b.template !== undefined ||
    b.audience !== undefined;
  if (hasContent)
    assert(task.status === "draft", "短信任务内容仅草稿状态可修改", 400);
  const updates = {};
  if (b.name !== undefined) updates.name = text(b.name, "任务名称", 100);
  if (b.template !== undefined)
    updates.template = validateTemplate(b.template);
  if (b.audience !== undefined) {
    const audience = await parseAudience(get, b.audience, task.shop_id);
    updates.audience = JSON.stringify(audience);
    updates.audience_count = await audienceCount(get, audience);
  }
  if (b.status !== undefined) {
    // Any status outside the vocabulary — including `sent` — is a
    // 400. A waiting_provider task is terminal: no transition out.
    assert(
      SMS_TASK_STATUSES.includes(b.status),
      "短信任务状态无效（本波无已发送状态）",
      400,
    );
    if (b.status !== task.status)
      assert(
        SMS_TRANSITIONS[task.status].includes(b.status),
        `短信任务状态不能从${SMS_STATUS_LABEL[task.status] || task.status}改为${SMS_STATUS_LABEL[b.status] || b.status}`,
        400,
      );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE sms_tasks SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM sms_tasks WHERE id=?", id);
  await audit(session, "修改短信任务", `${fresh.name}（${fresh.shop_id}号店）`);
  send({ ok: true, sms_task: taskRow(fresh) });
  return true;
}
