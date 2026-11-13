// Stored value 文惠卡 (Roadmap 82 Wave R3-6, 2026-11-14) — xlsx rows
// 26, 27, 28, 77. One account per (user, shop); a top-up plan is
// "pay X, get Y bonus"; the card is spent at `pay` time and refunded
// to FIRST on refund approval. Row 77's platform 满减券 lives in the
// coupons table (shop_id NULL = platform-wide, see coupons.mjs) and
// the "专属补贴卡" is NOT a second card system — it is a stored-value
// account whose balance an admin grants as a bonus (see grantStoredValue
// below). Payment stays simulated (Q3 default (a)): top-ups and card
// payments move no real money; they are arithmetic on simulated
// balances, stated in internal docs, with no user-facing demo labels
// (Lam's rebuild decision).
//
// Fixed rules (see docs/10-she-ji-wen-dang/03-xiang-mu-jie-duan.md
// §"Lộ trình 82 module — Sóng R3" R3-6):
// - Balance cap ¥5000 (500000 cents) per account; a top-up or grant
//   pushing the balance over it -> 400.
// - Top-up takes a plan_id only (no free-amount top-up this wave); the
//   plan must exist and be active. One transaction: account upsert +
//   `topup` ledger row (+amount) + `bonus` ledger row (+bonus, omitted
//   when the bonus is 0).
// - Spending happens at `pay`, never at order creation: used =
//   min(balance, amount) where amount is the final flash -> tier ->
//   coupon total. Stored value changes the PAYMENT METHOD, not the
//   amount, so tier spending SUM(amount) is unaffected. The pay
//   transaction debits the balance, writes a `spend` ledger row and
//   snapshots orders.stored_value_cents; the remainder goes through the
//   existing simulated payment path. There is no opt-out switch this
//   wave — a balance is always applied at pay.
// - Refund approval returns the card's share first: this wave has
//   full-order refunds only (partial refunds are R4-4), so the credit
//   is exactly the order's stored_value_cents, in the same transaction
//   as the status change, with a `refund` ledger row. Cancel /
//   refund_requested / disputed write no ledger rows.
// - Shop scoping follows R1-1 / R3-1: role=admin only (anonymous and
//   non-admin -> 403); a shop-scoped admin works only in their own
//   shop, cross-shop -> 403 (explicit-403, NOT admin-resources'
//   silent re-scoping). A buyer may top up any shop's plan and buy any
//   shop's tickets; the deduction uses the ORDER shop's account.
// - Validate first, write after, never throw after a write in the same
//   request (OTP lesson). All balance changes run inside the caller's
//   transaction with the advisory lock (same reasoning as the R2-5 seat
//   hold), so check-then-write is race-safe.
import { assert, text, int, time } from "../lib/http.mjs";
import { MAIN_SHOP_ID } from "./member-tiers.mjs";

// Per-account balance cap, integer cents (¥5000).
export const BALANCE_CAP_CENTS = 500000;

// Default plans for the main shop, seeded by postgres.mjs setup when
// shop 1 has no plans at all (guard pattern — an admin's edits are
// never overwritten). Amounts in integer cents.
export const DEFAULT_PLANS = [
  { amount_cents: 10000, bonus_cents: 1000 },
  { amount_cents: 20000, bonus_cents: 3000 },
  { amount_cents: 50000, bonus_cents: 10000 },
];

const KIND_LABELS = {
  topup: "充值",
  spend: "消费",
  refund: "退款返还",
  bonus: "赠送",
};

function assertAdmin(session) {
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

// R1-1 shop scoping: platform admin (shop_id NULL) sees all shops; a
// shop-scoped admin sees/edits only their own shop.
function scopedShopId(session) {
  return session.shop_id ?? null;
}

function assertStoredValueAccess(session, shopId) {
  const scope = scopedShopId(session);
  assert(scope === null || shopId === scope, "无权管理该店铺的文惠卡", 403);
}

async function getShopOr404(get, id) {
  const s = await get("SELECT * FROM shops WHERE id=?", id);
  assert(s, "店铺不存在", 404);
  return s;
}

function accountRow(a) {
  if (!a) return null;
  return {
    id: a.id,
    user_id: a.user_id,
    shop_id: a.shop_id,
    balance_cents: a.balance_cents,
    created_at: a.created_at,
  };
}

function planRow(pl) {
  if (!pl) return null;
  return {
    id: pl.id,
    shop_id: pl.shop_id,
    amount_cents: pl.amount_cents,
    bonus_cents: pl.bonus_cents,
    status: pl.status,
    created_at: pl.created_at,
  };
}

function ledgerRow(l) {
  if (!l) return null;
  return {
    id: l.id,
    account_id: l.account_id,
    kind: l.kind,
    kind_label: KIND_LABELS[l.kind] || l.kind,
    amount_cents: l.amount_cents,
    order_id: l.order_id,
    order_code: l.order_code ?? null,
    note: l.note ?? "",
    created_at: l.created_at,
  };
}

// The account for (user, shop), creating it at balance 0 when it does
// not exist yet. Runs inside the caller's transaction.
export async function getOrCreateAccount(get, run, userId, shopId, now) {
  const existing = await get(
    "SELECT * FROM stored_value_accounts WHERE user_id=? AND shop_id=?",
    userId,
    shopId,
  );
  if (existing) return existing;
  const result = await run(
    "INSERT INTO stored_value_accounts(user_id,shop_id,balance_cents,created_at) VALUES(?,?,0,?)",
    userId,
    shopId,
    now,
  );
  return get(
    "SELECT * FROM stored_value_accounts WHERE id=?",
    Number(result.lastInsertRowid),
  );
}

// One ledger row, inside the caller's transaction.
async function addLedger(run, accountId, kind, amountCents, orderId, note, now) {
  await run(
    "INSERT INTO stored_value_ledger(account_id,kind,amount_cents,order_id,note,created_at) VALUES(?,?,?,?,?,?)",
    accountId,
    kind,
    amountCents,
    orderId,
    note || "",
    now,
  );
}

// Credit an account by `amountCents` (positive) with a `bonus` ledger
// row, enforcing the balance cap BEFORE any write. The account is
// created at the credited balance when it does not exist yet, so a cap
// failure throws before any write at all (OTP lesson). Runs inside the
// caller's transaction; returns { account, newBalance }.
export async function creditAccount(get, run, userId, shopId, amountCents, note, now) {
  const account = await get(
    "SELECT * FROM stored_value_accounts WHERE user_id=? AND shop_id=?",
    userId,
    shopId,
  );
  const newBalance = (account?.balance_cents || 0) + amountCents;
  assert(newBalance <= BALANCE_CAP_CENTS, "储值余额上限为 ¥5000", 400);
  let accountId;
  if (!account) {
    const result = await run(
      "INSERT INTO stored_value_accounts(user_id,shop_id,balance_cents,created_at) VALUES(?,?,?,?)",
      userId,
      shopId,
      newBalance,
      now,
    );
    accountId = Number(result.lastInsertRowid);
  } else {
    accountId = account.id;
    await run(
      "UPDATE stored_value_accounts SET balance_cents=? WHERE id=?",
      newBalance,
      accountId,
    );
  }
  await addLedger(run, accountId, "bonus", amountCents, null, note, now);
  return {
    account: await get(
      "SELECT * FROM stored_value_accounts WHERE id=?",
      accountId,
    ),
    newBalance,
  };
}

// Apply the card at `pay` time, inside the caller's (order-transition)
// transaction: used = min(balance, amount); the balance is debited, a
// `spend` ledger row is written and the order snapshots what the card
// paid. Returns { used, remainder } — the remainder goes through the
// existing simulated payment path. A missing account or a zero balance
// means used = 0 and nothing is written.
export async function applyStoredValueAtPay(get, run, userId, shopId, orderId, amountCents, now) {
  const account = await get(
    "SELECT * FROM stored_value_accounts WHERE user_id=? AND shop_id=?",
    userId,
    shopId,
  );
  const used = Math.min(account?.balance_cents || 0, amountCents);
  if (used <= 0) return { used: 0, remainder: amountCents };
  await run(
    "UPDATE stored_value_accounts SET balance_cents=balance_cents-? WHERE id=?",
    used,
    account.id,
  );
  await addLedger(run, account.id, "spend", -used, orderId, "购票抵扣", now);
  await run(
    "UPDATE orders SET stored_value_cents=? WHERE id=?",
    used,
    orderId,
  );
  return { used, remainder: amountCents - used };
}

// Refund approval returns the card's share first: the credit is the
// order's stored_value_cents (full-order refunds only this wave), in
// the caller's transaction, with a `refund` ledger row. Returns the
// credited amount (0 when the order paid nothing from the card).
export async function refundStoredValue(get, run, userId, shopId, orderId, storedValueCents, now) {
  if (!storedValueCents || storedValueCents <= 0) return 0;
  const account = await getOrCreateAccount(get, run, userId, shopId, now);
  await run(
    "UPDATE stored_value_accounts SET balance_cents=balance_cents+? WHERE id=?",
    storedValueCents,
    account.id,
  );
  await addLedger(
    run,
    account.id,
    "refund",
    storedValueCents,
    orderId,
    "订单退款返还",
    now,
  );
  return storedValueCents;
}

async function listLedger(all, accountId, limit, offset) {
  const rows = await all(
    `SELECT l.*, o.code AS order_code FROM stored_value_ledger l
     LEFT JOIN orders o ON o.id=l.order_id
     WHERE l.account_id=? ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    accountId,
    limit,
    offset,
  );
  return rows.map(ledgerRow);
}

async function ledgerCount(get, accountId) {
  const row = await get(
    "SELECT COUNT(*) AS n FROM stored_value_ledger WHERE account_id=?",
    accountId,
  );
  return row?.n || 0;
}

async function ledgerAll(all, accountId) {
  const rows = await all(
    `SELECT l.*, o.code AS order_code FROM stored_value_ledger l
     LEFT JOIN orders o ON o.id=l.order_id
     WHERE l.account_id=? ORDER BY l.id DESC LIMIT 1000`,
    accountId,
  );
  return rows.map(ledgerRow);
}

// ?limit= / ?offset= paging: limit defaults to 50, clamped 1..200;
// offset defaults to 0, never negative. Query params arrive as
// strings, so they are Number()ed first (int() needs a real integer).
function parsePage(url) {
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isSafeInteger(rawLimit)
    ? Math.min(200, Math.max(1, rawLimit))
    : 50;
  const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

// ?shop= : the shop whose account/plans are wanted; defaults to the
// main shop. A shop-scoped admin naming another shop -> 403.
function resolveShop(session, url) {
  const scope = scopedShopId(session);
  const raw = url.searchParams.get("shop");
  let shopId = MAIN_SHOP_ID;
  if (raw !== null && raw !== "") {
    shopId = int(Number(raw), "店铺", 1);
  }
  if (scope !== null) {
    assert(shopId === scope, "无权管理该店铺的文惠卡", 403);
  }
  return shopId;
}

function ledgerCsv(rows) {
  const csv = (v) =>
    `"${String(v ?? "")
      .replace(/"/g, '""')
      .replace(/^[=+@-]/, "'$&")}"`;
  const beijing = (value) =>
    new Date(new Date(value).getTime() + 8 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  return (
    "\uFEFF" +
    [
      ["流水号", "时间", "类型", "金额(元)", "订单号", "备注"],
      ...rows.map((l) => [
        l.id,
        beijing(l.created_at),
        KIND_LABELS[l.kind] || l.kind,
        (l.amount_cents / 100).toFixed(2),
        l.order_code || "",
        l.note || "",
      ]),
    ]
      .map((r) => r.map(csv).join(","))
      .join("\r\n")
  );
}

export async function listShopPlans(ctx) {
  const { p, req, send, get, all } = ctx;
  const m = p.match(/^\/api\/shops\/(\d+)\/stored-value-plans$/);
  if (!m || req.method !== "GET") return false;
  const shopId = Number(m[1]);
  await getShopOr404(get, shopId);
  const rows = await all(
    "SELECT * FROM stored_value_plans WHERE shop_id=? AND status='active' ORDER BY amount_cents ASC, id ASC",
    shopId,
  );
  send({ stored_value_plans: rows.map(planRow) });
  return true;
}

export async function listAdminPlans(ctx) {
  const { req, p, send, session, all, url } = ctx;
  if (p !== "/api/admin/stored-value-plans" || req.method !== "GET") return false;
  assertAdmin(session);
  const scope = scopedShopId(session);
  const shopParam = url.searchParams.get("shop");
  let shopId = scope;
  if (shopParam !== null && shopParam !== "") {
    shopId = int(Number(shopParam), "店铺", 1);
  }
  if (scope !== null) shopId = scope;
  const rows =
    shopId === null
      ? await all("SELECT * FROM stored_value_plans ORDER BY shop_id ASC, amount_cents ASC, id ASC")
      : await all(
          "SELECT * FROM stored_value_plans WHERE shop_id=? ORDER BY amount_cents ASC, id ASC",
          shopId,
        );
  send({ stored_value_plans: rows.map(planRow) });
  return true;
}

export async function createPlan(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  if (p !== "/api/admin/stored-value-plans" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson). A shop-scoped
  // admin works only in their own shop — an explicit shop_id naming
  // another shop is a cross-shop write -> 403 (same explicit-403
  // choice as R3-1 member tiers, NOT admin-resources' silent
  // re-scoping). The platform admin creates into the main shop
  // unless shop_id names another shop.
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的文惠卡", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertStoredValueAccess(session, shopId);
  await getShopOr404(get, shopId);
  const amountCents = int(b.amount_cents, "充值金额（分）", 1);
  const bonusCents = int(b.bonus_cents ?? 0, "赠送金额（分）", 0);
  const status =
    b.status === undefined || b.status === null ? "active" : b.status;
  assert(status === "active" || status === "disabled", "套餐状态须为 active 或 disabled", 400);
  const result = await run(
    "INSERT INTO stored_value_plans(shop_id,amount_cents,bonus_cents,status,created_at) VALUES(?,?,?,?,?)",
    shopId,
    amountCents,
    bonusCents,
    status,
    time(),
  );
  const id = Number(result.lastInsertRowid);
  const created = await get("SELECT * FROM stored_value_plans WHERE id=?", id);
  await audit(session, "新增储值套餐", `充¥${(amountCents / 100).toString()}送¥${(bonusCents / 100).toString()}（${shopId}号店）`);
  send({ ok: true, id, stored_value_plan: planRow(created) });
  return true;
}

export async function patchPlan(ctx) {
  const { req, p, b, send, session, get, run, audit } = ctx;
  const m = p.match(/^\/api\/admin\/stored-value-plans\/(\d+)$/);
  if (!m || req.method !== "PATCH") return false;
  assertAdmin(session);
  const id = Number(m[1]);
  const plan = await get("SELECT * FROM stored_value_plans WHERE id=?", id);
  assert(plan, "储值套餐不存在", 404);
  assertStoredValueAccess(session, plan.shop_id);
  // The shop is immutable after creation — a PATCH naming it is a
  // 400, never a silent re-scope.
  assert(b.shop_id === undefined, "套餐所属店铺不可修改", 400);
  // Validate everything BEFORE any write (OTP lesson).
  const updates = {};
  if (b.amount_cents !== undefined)
    updates.amount_cents = int(b.amount_cents, "充值金额（分）", 1);
  if (b.bonus_cents !== undefined)
    updates.bonus_cents = int(b.bonus_cents, "赠送金额（分）", 0);
  if (b.status !== undefined) {
    assert(
      b.status === "active" || b.status === "disabled",
      "套餐状态须为 active 或 disabled",
      400,
    );
    updates.status = b.status;
  }
  assert(Object.keys(updates).length > 0, "未提供可修改的字段", 400);
  const keys = Object.keys(updates);
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await run(
    `UPDATE stored_value_plans SET ${sets} WHERE id=?`,
    ...keys.map((k) => updates[k]),
    id,
  );
  const fresh = await get("SELECT * FROM stored_value_plans WHERE id=?", id);
  await audit(session, "修改储值套餐", `套餐 ${id}（${fresh.shop_id}号店）`);
  send({ ok: true, stored_value_plan: planRow(fresh) });
  return true;
}

export async function topup(ctx) {
  const { p, req, b, send, needUser, get, run, transaction, notify, audit } = ctx;
  if (p !== "/api/account/topup" || req.method !== "POST") return false;
  const u = needUser();
  // Validate everything BEFORE any write (OTP lesson): the plan must
  // exist and be active. A disabled plan is a 400 (it exists, it just
  // cannot be bought); an unknown plan id is a 404.
  const planId = int(b.plan_id, "储值套餐", 1);
  const plan = await get("SELECT * FROM stored_value_plans WHERE id=?", planId);
  assert(plan, "储值套餐不存在", 404);
  assert(plan.status === "active", "该储值套餐已停用", 400);
  const now = time();
  const { account, newBalance } = await transaction(async () => {
    const accountRow0 = await get(
      "SELECT * FROM stored_value_accounts WHERE user_id=? AND shop_id=?",
      u.id,
      plan.shop_id,
    );
    const target = (accountRow0?.balance_cents || 0) + plan.amount_cents + plan.bonus_cents;
    assert(target <= BALANCE_CAP_CENTS, "储值余额上限为 ¥5000", 400);
    let accountId;
    if (!accountRow0) {
      const result = await run(
        "INSERT INTO stored_value_accounts(user_id,shop_id,balance_cents,created_at) VALUES(?,?,?,?)",
        u.id,
        plan.shop_id,
        target,
        now,
      );
      accountId = Number(result.lastInsertRowid);
    } else {
      accountId = accountRow0.id;
      await run(
        "UPDATE stored_value_accounts SET balance_cents=? WHERE id=?",
        target,
        accountId,
      );
    }
    await addLedger(run, accountId, "topup", plan.amount_cents, null, "储值充值", now);
    if (plan.bonus_cents > 0)
      await addLedger(run, accountId, "bonus", plan.bonus_cents, null, "充值赠送", now);
    return {
      account: await get(
        "SELECT * FROM stored_value_accounts WHERE id=?",
        accountId,
      ),
      newBalance: target,
    };
  });
  await notify(
    u.id,
    "储值充值成功",
    `文惠卡已充值 ¥${(plan.amount_cents / 100).toString()}${plan.bonus_cents > 0 ? `，获赠 ¥${(plan.bonus_cents / 100).toString()}` : ""}，当前余额 ¥${(newBalance / 100).toString()}（模拟充值，未产生真实扣款）。`,
  );
  await audit(u, "储值充值", `充¥${(plan.amount_cents / 100).toString()}送¥${(plan.bonus_cents / 100).toString()}（${plan.shop_id}号店）`);
  send({
    ok: true,
    simulated: true,
    account: accountRow(account),
    stored_value_plan: planRow(plan),
  });
  return true;
}

// Shared body of the own-account and admin account reads: the account
// (null when the user has never topped up in this shop), the shop's
// active plans, and the ledger page. `format=csv` answers with a BOM
// CSV download instead (same pattern as the Wave 5 admin CSV export).
async function accountPayload(get, all, userId, shopId, url) {
  const account = await get(
    "SELECT * FROM stored_value_accounts WHERE user_id=? AND shop_id=?",
    userId,
    shopId,
  );
  const plans = await all(
    "SELECT * FROM stored_value_plans WHERE shop_id=? AND status='active' ORDER BY amount_cents ASC, id ASC",
    shopId,
  );
  const { limit, offset } = parsePage(url);
  const ledger = account
    ? await listLedger(all, account.id, limit, offset)
    : [];
  const total = account ? await ledgerCount(get, account.id) : 0;
  return {
    account: accountRow(account),
    plans: plans.map(planRow),
    ledger,
    total,
  };
}

export async function getAccountStoredValue(ctx) {
  const { p, req, send, needUser, get, all, url, res, audit } = ctx;
  if (p !== "/api/account/stored-value" || req.method !== "GET") return false;
  const u = needUser();
  const shopId = resolveShop(u, url);
  const payload = await accountPayload(get, all, u.id, shopId, url);
  if (url.searchParams.get("format") === "csv") {
    const rows = payload.account
      ? await ledgerAll(all, payload.account.id)
      : [];
    await audit(u, "导出储值流水", `${rows.length}条`);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="guiyan-stored-value.csv"',
    });
    res.end(ledgerCsv(rows));
    return true;
  }
  send(payload);
  return true;
}

export async function getAdminStoredValue(ctx) {
  const { p, req, send, session, get, all, url, res, audit } = ctx;
  const m = p.match(/^\/api\/admin\/stored-value\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  assertAdmin(session);
  const userId = Number(m[1]);
  const user = await get("SELECT * FROM users WHERE id=?", userId);
  assert(user, "用户不存在", 404);
  const shopId = resolveShop(session, url);
  const payload = await accountPayload(get, all, userId, shopId, url);
  if (url.searchParams.get("format") === "csv") {
    const rows = payload.account
      ? await ledgerAll(all, payload.account.id)
      : [];
    await audit(session, "导出储值流水", `${user.username} ${rows.length}条`);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="guiyan-stored-value.csv"',
    });
    res.end(ledgerCsv(rows));
    return true;
  }
  send({
    user: { id: user.id, username: user.username, name: user.name },
    ...payload,
  });
  return true;
}

// Row 77's "专属补贴卡": NOT a second card system — a stored-value
// account whose balance the platform/admin grants as a bonus. The
// grant is a `bonus` ledger row on the (user, shop) account, created
// when missing; the ¥5000 cap applies exactly like a top-up.
export async function grantStoredValue(ctx) {
  const { p, req, b, send, session, get, run, transaction, notify, audit } = ctx;
  if (p !== "/api/admin/stored-value/grant" || req.method !== "POST") return false;
  assertAdmin(session);
  // Validate everything BEFORE any write (OTP lesson).
  const userId = int(b.user_id, "用户", 1);
  const user = await get("SELECT * FROM users WHERE id=?", userId);
  assert(user, "用户不存在", 404);
  const scope = scopedShopId(session);
  let shopId;
  if (scope !== null) {
    if (b.shop_id !== undefined && b.shop_id !== null) {
      const named = int(b.shop_id, "店铺", 1);
      assert(named === scope, "无权管理该店铺的文惠卡", 403);
    }
    shopId = scope;
  } else {
    shopId =
      b.shop_id === undefined || b.shop_id === null
        ? MAIN_SHOP_ID
        : int(b.shop_id, "店铺", 1);
  }
  assertStoredValueAccess(session, shopId);
  await getShopOr404(get, shopId);
  const amountCents = int(b.amount_cents, "补贴金额（分）", 1, BALANCE_CAP_CENTS);
  const note =
    b.note === undefined || b.note === null || b.note === ""
      ? "平台补贴"
      : text(b.note, "备注", 200);
  const now = time();
  const { account } = await transaction(async () =>
    creditAccount(get, run, userId, shopId, amountCents, note, now),
  );
  await notify(
    userId,
    "文惠卡补贴到账",
    `平台已向您的文惠卡发放补贴 ¥${(amountCents / 100).toString()}（${note}），当前余额 ¥${(account.balance_cents / 100).toString()}。`,
  );
  await audit(session, "发放储值补贴", `${user.username} +¥${(amountCents / 100).toString()}（${shopId}号店）`);
  send({ ok: true, account: accountRow(account) });
  return true;
}
