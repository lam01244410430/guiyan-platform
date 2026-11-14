import { randomBytes } from "node:crypto";
import { assert, text, int, date, bookingType } from "../lib/http.mjs";
import { ORDER_STATUS_ZH } from "../lib/status-labels.mjs";
import { enrichOrder } from "./pickup.mjs";
import { discountForOrder, evaluateTier, resolveTier, MAIN_SHOP_ID } from "./member-tiers.mjs";
import {
  normalizeCouponCode,
  validateCoupon,
  releaseCouponRedemption,
} from "./coupons.mjs";
import {
  evaluateAutoCoupons,
  markGiftRedeemed,
} from "./auto-coupons.mjs";
import { resolveFlashSale, saleUnitPrice } from "./flash-sales.mjs";
import {
  applyStoredValueAtPay,
  refundStoredValue,
} from "./stored-value.mjs";
import { addFinanceLedger } from "./alerts-ledger.mjs";
import { issueTicketsForOrder } from "./tickets.mjs";

// R3-1 + R3-2 + R3-3 pricing, in one place so the pre-check and the
// in-transaction re-price agree exactly: the flash sale applies
// FIRST (sale unit price x qty is the base), then the R3-1 member
// discount on that base, then the R3-2 coupon on the remainder.
// `flashSale` is the live sale resolved by the caller (null = no
// sale — old-flow orders always pass null); `couponCode` is the
// normalized code or null. Pure reads — safe to call before the
// order transaction (to surface 400s before any write) and again
// inside it (authoritative, with fresh quota counts). Returns the
// full pricing snapshot the order row stores.
async function computePricing(get, all, userId, shopId, unitPriceCents, qty, flashSale, couponCode) {
  const unit = flashSale
    ? saleUnitPrice(flashSale, unitPriceCents)
    : unitPriceCents;
  const base = unit * qty;
  const flashCents = flashSale ? (unitPriceCents - unit) * qty : 0;
  const { discount_cents: discountCents, tier: appliedTier } =
    await discountForOrder(get, all, userId, shopId, base);
  const afterTier = base - discountCents;
  let coupon = null;
  let couponCents = 0;
  if (couponCode) {
    const checked = await validateCoupon(
      get,
      userId,
      shopId,
      couponCode,
      afterTier,
    );
    coupon = checked.coupon;
    couponCents = checked.coupon_cents;
  }
  return {
    base,
    flash_sale: flashSale,
    flash_cents: flashCents,
    discount_cents: discountCents,
    tier: appliedTier,
    coupon,
    coupon_cents: couponCents,
    final_amount: afterTier - couponCents,
  };
}

export async function listOrders(ctx) {
  const { p, req, send, needUser, orderRows } = ctx;
  if (p === "/api/orders" && req.method === "GET") {
    const u = needUser();
    send({ orders: await orderRows(u) });
    return true;
  }
  return false;
}

export async function createOrder(ctx) {
  const { p, req, b, send, needUser, get, all, run, transaction, notify, audit, time, cache } = ctx;
  if (p === "/api/orders" && req.method === "POST") {
    const u = needUser(),
      rid = int(b.resourceId, "资源编号", 1),
      r = await get(
        "SELECT * FROM resources WHERE id=? AND status='published'",
        rid,
      );
    assert(r, "资源不存在或已下架", 404);
    const qty = int(b.quantity ?? 1, "数量", 1, 100);
    assert(!bookingType(r) || qty === 1, "租赁类资源每单数量为1");
    // R2-2: a tier order names BOTH the performance and the ticket type
    // (one without the other -> 400). Validate everything BEFORE any
    // write (OTP lesson); the amount and the booking date are computed
    // server-side and any client-sent values are ignored. A tier order
    // never touches resources.stock — the tier quota governs instead.
    const hasPerf =
      b.performance_id !== undefined && b.performance_id !== null;
    const hasTier =
      b.ticket_type_id !== undefined && b.ticket_type_id !== null;
    assert(hasPerf === hasTier, "须同时提供场次与票种", 400);
    let perf = null,
      tier = null,
      show = null,
      d = null;
    if (hasPerf) {
      const perfId = int(b.performance_id, "场次", 1);
      const tierId = int(b.ticket_type_id, "票种", 1);
      perf = await get("SELECT * FROM performances WHERE id=?", perfId);
      assert(perf, "场次不存在", 400);
      assert(perf.status === "on_sale", "场次不在售", 400);
      const showRow = await get("SELECT * FROM shows WHERE id=?", perf.show_id);
      assert(showRow && showRow.status === "approved", "演出未通过审核", 400);
      show = showRow;
      tier = await get("SELECT * FROM ticket_types WHERE id=?", tierId);
      assert(tier && tier.performance_id === perf.id, "票种不属于该场次", 400);
      assert(
        tier.sale_until === null ||
          tier.sale_until === undefined ||
          new Date(tier.sale_until).valueOf() >= Date.now(),
        "该票种已过售票截止时间",
        400,
      );
      d = String(perf.start_at).slice(0, 10);
    } else {
      d = date(b.booking_date);
    }
    // R2-3: a tier order names a pickup point when (and only when) the
    // performance's show has configured one. Required when the show
    // has >=1 point (missing -> 400) and it must belong to that show
    // (else 400); a show with no points, or a non-performance
    // (old-flow) order, passing pickup_point_id -> 400. Validate
    // everything BEFORE any write (OTP lesson).
    const hasPickup =
      b.pickup_point_id !== undefined && b.pickup_point_id !== null;
    let pickupPoint = null;
    if (hasPerf) {
      const points = await all(
        "SELECT * FROM pickup_points WHERE show_id=? ORDER BY id ASC",
        show.id,
      );
      if (points.length > 0) {
        assert(hasPickup, "该演出须选择取票点", 400);
        const pid = int(b.pickup_point_id, "取票点", 1);
        pickupPoint = points.find((x) => x.id === pid);
        assert(pickupPoint, "取票点不属于该演出", 400);
      } else {
        assert(!hasPickup, "该演出未配置取票点", 400);
      }
    } else {
      assert(!hasPickup, "该订单无需选择取票点", 400);
    }
    // R3-1 + R3-2 + R3-3 pricing (one chain, see computePricing
    // above): the flash sale applies FIRST — sale unit price x qty is
    // the base — then the member discount on that base, then the
    // coupon on the remainder. The coupon code is normalized once
    // here; the in-transaction re-price below reuses the same
    // normalized code. A flash sale only ever applies to a
    // performance order (old-flow orders pass null and pay the
    // resource price). The amount is always computed server-side
    // from the tier / resource price; any amount sent by the client
    // is ignored.
    const orderShopId = r.shop_id ?? MAIN_SHOP_ID;
    const couponCode =
      typeof b.coupon_code === "string" && b.coupon_code.trim() !== ""
        ? normalizeCouponCode(b.coupon_code)
        : null;
    const unitPrice = hasPerf ? tier.price_cents : r.price;
    const flashSale = hasPerf
      ? await resolveFlashSale(get, all, perf.id)
      : null;
    const pricing = await computePricing(
      get,
      all,
      u.id,
      orderShopId,
      unitPrice,
      qty,
      flashSale,
      couponCode,
    );
    const id = await transaction(async () => {
      if (tier) {
        // Quota check inside the transaction: write requests hold the
        // global advisory lock, so check-then-insert is race-safe here
        // with no extra lock (same reasoning as the R2-5 seat hold).
        const sold = await get(
          "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND status NOT IN ('cancelled','refunded')",
          tier.id,
        );
        assert((sold?.n || 0) + qty <= tier.quota, "该票种已售罄", 409);
      } else if (bookingType(r))
        assert(
          !(await get(
            "SELECT id FROM orders WHERE resource_id=? AND booking_date=? AND status NOT IN ('cancelled','refunded')",
            rid,
            d,
          )),
          "该档期已被预约，请选择其他日期",
          409,
        );
      else {
        const updated = await run(
          "UPDATE resources SET stock=stock-? WHERE id=? AND stock>=?",
          qty,
          rid,
          qty,
        );
        assert(updated.changes > 0, "库存不足", 409);
      }
      // R3-3 + R3-2: re-price inside the transaction — the pricing
      // from the pre-check may be stale. The flash sale can have
      // ended or sold out since (a concurrent order took the last
      // quota slot): if the pre-checked sale is no longer the live
      // sale for this performance, fall back to the original price
      // and re-price tier + coupon on the un-flashed base — never
      // 409. The coupon is then re-checked on the authoritative
      // remainder (quota / per-user counts are live COUNTs, and a
      // concurrent order could have taken the last slot after the
      // pre-check above — validateCoupon throws 400 then, as
      // before). The in-transaction pricing is authoritative: the
      // INSERT below uses it, not the pre-check values.
      let txPricing = pricing;
      if (pricing.flash_sale) {
        const live = await resolveFlashSale(get, all, perf.id);
        if (!live || live.id !== pricing.flash_sale.id)
          txPricing = await computePricing(
            get,
            all,
            u.id,
            orderShopId,
            unitPrice,
            qty,
            null,
            couponCode,
          );
      }
      if (txPricing.coupon) {
        const rechecked = await validateCoupon(
          get,
          u.id,
          orderShopId,
          txPricing.coupon.code,
          txPricing.base - txPricing.discount_cents,
        );
        txPricing = {
          ...txPricing,
          coupon: rechecked.coupon,
          coupon_cents: rechecked.coupon_cents,
          final_amount:
            txPricing.base -
            txPricing.discount_cents -
            rechecked.coupon_cents,
        };
      }
      const result = await run(
        "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,performance_id,ticket_type_id,pickup_point_id,discount_cents,tier_id,coupon_id,coupon_cents,flash_sale_id,flash_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        `GY${Date.now()}${randomBytes(2).toString("hex")}`,
        u.id,
        rid,
        qty,
        txPricing.final_amount,
        d,
        "pending",
        ["H5", "电脑网页", "微信小程序"].includes(b.channel)
          ? b.channel
          : "H5",
        String(b.note || "").slice(0, 1000),
        perf ? perf.id : null,
        tier ? tier.id : null,
        pickupPoint ? pickupPoint.id : null,
        txPricing.discount_cents,
        txPricing.tier ? txPricing.tier.id : null,
        txPricing.coupon ? txPricing.coupon.id : null,
        txPricing.coupon_cents,
        txPricing.flash_sale ? txPricing.flash_sale.id : null,
        txPricing.flash_cents,
        time(),
      );
      const orderId = Number(result.lastInsertRowid);
      // R3-2: the redemption is recorded in the same transaction as
      // the order — they commit or roll back together.
      if (txPricing.coupon) {
        await run(
          "INSERT INTO coupon_redemptions(coupon_id,user_id,order_id,amount_cents,created_at) VALUES(?,?,?,?,?)",
          txPricing.coupon.id,
          u.id,
          orderId,
          txPricing.coupon_cents,
          time(),
        );
        // R3-4: if this coupon was gifted to the user, the oldest
        // still-gifted gift of it is now used by this order.
        await markGiftRedeemed(run, u.id, txPricing.coupon.id, orderId);
      }
      await notify(
        u.id,
        "预约提交成功",
        `“${r.name}”${d}的预约已提交，等待确认。`,
      );
      await audit(u, "提交预约", r.name);
      return orderId;
    });
    // A new order changes cached admin stats/analysis (order + revenue
    // counts) and cached resource data (stock moves). Bust after the
    // write; the DB commit follows immediately after this handler
    // returns, so the re-read after a bust sees the committed row.
    if (cache) {
      await cache.bustAdmin();
      await cache.bustResources();
    }
    const created = await get("SELECT * FROM orders WHERE id=?", id);
    // R2-3: the order response carries the chosen pickup point + the
    // shop's default template (nulls for an old-flow order).
    const extra = await enrichOrder(get, created);
    send({
      ok: true,
      id,
      code: created.code,
      amount: created.amount,
      discount_cents: created.discount_cents,
      tier_id: created.tier_id,
      coupon_id: created.coupon_id,
      coupon_cents: created.coupon_cents,
      flash_sale_id: created.flash_sale_id,
      flash_cents: created.flash_cents,
      stored_value_cents: created.stored_value_cents || 0,
      status: created.status,
      pickup_point: extra.pickup_point,
      ticket_template: extra.ticket_template,
    });
    return true;
  }
  return false;
}

// R2-3: one order by id (owner or admin). Same enrichment as the
// create response: pickup point + the shop's default template.
export async function getOrder(ctx) {
  const { p, req, send, needUser, get } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)$/);
  if (!m || req.method !== "GET") return false;
  const u = needUser();
  const o = await get("SELECT * FROM orders WHERE id=?", Number(m[1]));
  assert(o, "订单不存在", 404);
  assert(o.user_id === u.id || u.role === "admin", "无权查看此订单", 403);
  const extra = await enrichOrder(get, o);
  send({
    order: { ...o, pickup_point: extra.pickup_point, ticket_template: extra.ticket_template },
  });
  return true;
}

export async function transitionOrder(ctx) {
  const { p, req, b, send, needUser, get, all, run, transaction, notify, audit, cache, time } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/(confirm|pay|complete|cancel|refund|approveRefund|rejectRefund|dispute|rejectDispute|resolve)$/);
  if (m && req.method === "POST") {
    const u = needUser(),
      [, id, action] = m,
      o = await get(
        "SELECT o.*,r.category,r.shop_id,r.name resource_name FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
        Number(id),
      );
    assert(o, "订单不存在", 404);
    // Wave 4 #13 — two-layer permission (replaces the owner-only assert:
    // an admin could not approve anything under it).
    // Layer 1: owner or admin. Layer 2: the 4 after-sales decisions are
    // admin-only. Old actions keep the owner-only rule — an admin calling
    // confirm/pay/complete/cancel on someone else's order still gets 403.
    const DECISIONS = ["approveRefund", "resolve", "rejectRefund", "rejectDispute"];
    if (DECISIONS.includes(action))
      assert(u.role === "admin", "仅管理员可处理售后", 403);
    else if (action === "refund" || action === "dispute")
      assert(o.user_id === u.id || u.role === "admin", "无权操作此订单", 403);
    else assert(o.user_id === u.id, "无权操作此订单", 403);
    const transitions = {
      confirm: ["pending", "confirmed"],
      pay: ["confirmed", "paid"],
      complete: ["paid", "completed"],
      cancel: [["pending", "confirmed"], "cancelled"],
      // Wave 4 #13 (Q2): refund no longer completes at once — paid goes
      // to refund_requested and waits for an admin decision.
      refund: ["paid", "refund_requested"],
      approveRefund: [["refund_requested", "disputed"], "refunded"],
      rejectRefund: ["refund_requested", "paid"],
      dispute: ["paid", "disputed"],
      rejectDispute: ["disputed", "paid"],
      resolve: ["disputed", "completed"],
    };
    const [from, to0] = transitions[action];
    assert(
      (Array.isArray(from) ? from : [from]).includes(o.status),
      "当前状态不允许该操作",
      400,
    );
    // R4-4: partial refund (rows 35, 22) — optional {quantity: k}
    // on the existing refund transition (NO new endpoint, NO new
    // refund table). Absent quantity -> the old full-refund request.
    // Present -> k must be an integer with 1 <= k <= remaining
    // (quantity - refund_quantity); k == remaining is the full path
    // too. Per-ticket amounts (fixed): perTicket =
    // floor(amount / quantity); cardPerTicket =
    // floor(stored_value_cents / quantity); refund for k tickets =
    // perTicket x k, card share first = cardPerTicket x k (via
    // refundStoredValue); the flooring remainder cents stay with the
    // shop. A partial refund does NOT re-price coupon/tier/flash (a
    // used coupon is not restored). Validate BEFORE any write (OTP
    // lesson): ticket selection is a read-only pre-check here.
    // Selection (fixed): unprinted issued tickets first (id ASC),
    // then printed ones. All k unprinted -> AUTOMATIC (applied in
    // this request, status stays paid); any printed -> MANUAL (ids
    // stored in pending_refund_tickets, status refund_requested).
    let to = to0;
    let partial = null; // {k, ticketIds, seatIds, auto, refundCents, cardCents}
    if (action === "refund" && b?.quantity !== undefined && b?.quantity !== null) {
      const remaining = o.quantity - (o.refund_quantity || 0);
      const k = int(b.quantity, "退票数量", 1, remaining);
      if (k < remaining) {
        const issued = await all(
          "SELECT * FROM tickets WHERE order_id=? AND status='issued' ORDER BY printed_at ASC NULLS FIRST, id ASC",
          o.id,
        );
        // A used ticket is not refundable, so the issued count can
        // fall short of k when tickets were already verified.
        assert(issued.length >= k, "已有票已核销，可退票数不足", 400);
        const selected = issued.slice(0, k);
        const perTicket = Math.floor(o.amount / o.quantity);
        const cardPerTicket = Math.floor(
          (o.stored_value_cents || 0) / o.quantity,
        );
        partial = {
          k,
          ticketIds: selected.map((t) => t.id),
          seatIds: selected
            .map((t) => t.seat_id)
            .filter((s) => s !== null && s !== undefined),
          auto: selected.every((t) => !t.printed_at),
          refundCents: perTicket * k,
          cardCents: cardPerTicket * k,
        };
        if (partial.auto) to = "paid";
      }
    }
    // R4-4: approveRefund with a pending partial request applies the
    // PARTIAL refund (void exactly the stored ids, status back to
    // paid). Any stored ticket no longer issued -> 400 "票状态已变，
    // 请重新申请" (extreme race only: frozen tickets refuse
    // verify/print/batch, so this cannot happen in normal flow).
    // Validate BEFORE any write, like the refund selection above.
    let pendingPartial = null; // {ids, seatIds, k, refundCents, cardCents}
    if (action === "approveRefund") {
      let pendingIds = [];
      try {
        pendingIds = JSON.parse(o.pending_refund_tickets || "[]");
      } catch {
        pendingIds = [];
      }
      if (Array.isArray(pendingIds) && pendingIds.length > 0) {
        const ids = pendingIds.map(Number);
        const rows = await all(
          "SELECT * FROM tickets WHERE id IN (" +
            ids.map(() => "?").join(",") +
            ")",
          ...ids,
        );
        assert(
          rows.length === ids.length &&
            rows.every(
              (t) => t.status === "issued" && t.order_id === o.id,
            ),
          "票状态已变，请重新申请",
          400,
        );
        const k = ids.length;
        const perTicket = Math.floor(o.amount / o.quantity);
        const cardPerTicket = Math.floor(
          (o.stored_value_cents || 0) / o.quantity,
        );
        pendingPartial = {
          ids,
          seatIds: rows
            .map((t) => t.seat_id)
            .filter((s) => s !== null && s !== undefined),
          k,
          refundCents: perTicket * k,
          cardCents: cardPerTicket * k,
        };
        to = "paid";
      }
    }
    // Wave 4 #13: refund_decision holds the admin's decision. Approval
    // writes the fixed simulated-refund text; a rejection stores the
    // admin's reason (Q6: missing reason -> 400 via text()). The user's
    // own reason stays in refund_reason.
    let decision = o.refund_decision || "";
    // B-035: a fresh refund/dispute starts a new round — drop the
    // previous admin decision so a re-requested order does not carry
    // a stale one (refund_reason is overwritten with the new reason
    // below, but decision was only overwritten on a decision action).
    if (action === "refund" || action === "dispute") decision = "";
    else if (action === "approveRefund")
      decision = pendingPartial
        ? "审核通过，已模拟退款（部分退款）"
        : "审核通过，已模拟退款";
    else if (action === "rejectRefund" || action === "rejectDispute")
      decision = text(b.reason || "", "拒绝原因", 500);
    // R3-6: what the pay / approveRefund did with the card (set inside
    // the transaction below, read by the notify text and the response
    // after it). Null = the action involves no stored value.
    let payStored = null;
    let refundStored = 0;
    // R4-4: the total refunded by THIS request (approveRefund full /
    // partial, or the automatic partial refund below) — carried in
    // the response as refund_cents for both cases.
    let refundCents = 0;
    await transaction(async () => {
      // R3-4: the live tier BEFORE the status change (for a pay,
      // spending excludes this order — it is still confirmed).
      const orderShopId = o.shop_id ?? MAIN_SHOP_ID;
      let beforeTier = null;
      if (["pay", "complete"].includes(action))
        beforeTier = await resolveTier(get, all, o.user_id, orderShopId);
      await run(
        "UPDATE orders SET status=?,escrow=?,refund_reason=?,refund_decision=? WHERE id=?",
        to,
        to === "paid"
          ? "模拟托管中"
          : to === "completed"
            ? "已结算"
            : to === "refunded"
              ? "已模拟退款"
              : o.escrow,
        action === "refund"
          ? text(b.reason || "用户申请退款", "申请原因", 500)
          : action === "dispute"
            ? text(b.reason || "用户发起申诉", "申诉原因", 500)
            : o.refund_reason,
        decision,
        o.id,
      );
      // R3-6 stored value (same transaction as the status change): at
      // pay the card covers up to the balance (used = min(balance,
      // amount); the remainder goes through the simulated payment
      // path); on refund approval the card's share comes back FIRST.
      // Cancel / refund_requested / disputed write no ledger rows
      // (cancel never paid, the other two are not approvals).
      if (action === "pay")
        payStored = await applyStoredValueAtPay(
          get,
          run,
          o.user_id,
          orderShopId,
          o.id,
          o.amount,
          time(),
        );
      // R5-5 finance ledger (same transaction as the status
      // change): a pay books order_income (+full amount — the card
      // split is a payment method, not a second income).
      if (action === "pay")
        await addFinanceLedger(run, {
          shopId: orderShopId,
          kind: "order_income",
          amountCents: o.amount,
          orderId: o.id,
          now: time(),
        });
      // R4-4: approveRefund — partial when a pending request exists
      // (void exactly the stored ids, release their seats, refund
      // perTicket x k with the card share first, refund_quantity /
      // refunded_cents += k / refund, pending cleared, status back to
      // paid); full otherwise (exact REMAINDER: refund = amount -
      // refunded_cents, card share = stored_value_cents -
      // cardPerTicket x refund_quantity — equals the old value when
      // refund_quantity == 0; void ALL remaining issued tickets,
      // sold seats stay sold per the R2-5 rule). Partial refunds
      // restore NO resource stock (only seats are released); the
      // full path restores stock via the existing branch below.
      if (action === "approveRefund") {
        if (pendingPartial) {
          refundCents = pendingPartial.refundCents;
          refundStored = await refundStoredValue(
            get,
            run,
            o.user_id,
            orderShopId,
            o.id,
            pendingPartial.cardCents,
            time(),
          );
          await run(
            "UPDATE tickets SET status='void' WHERE id IN (" +
              pendingPartial.ids.map(() => "?").join(",") +
              ")",
            ...pendingPartial.ids,
          );
          if (pendingPartial.seatIds.length)
            await run(
              "UPDATE seats SET status='available', order_id=NULL, held_until=NULL WHERE id IN (" +
                pendingPartial.seatIds.map(() => "?").join(",") +
                ") AND order_id=? AND status='sold'",
              ...pendingPartial.seatIds,
              o.id,
            );
          await run(
            "UPDATE orders SET refund_quantity=refund_quantity+?, refunded_cents=refunded_cents+?, pending_refund_tickets='[]' WHERE id=?",
            pendingPartial.k,
            refundCents,
            o.id,
          );
        } else {
          const cardPerTicket = Math.floor(
            (o.stored_value_cents || 0) / o.quantity,
          );
          const cardRemainder =
            (o.stored_value_cents || 0) -
            cardPerTicket * (o.refund_quantity || 0);
          refundCents = o.amount - (o.refunded_cents || 0);
          refundStored = await refundStoredValue(
            get,
            run,
            o.user_id,
            orderShopId,
            o.id,
            cardRemainder,
            time(),
          );
          // R4-1: a full refund voids every still-issued ticket of
          // the order in the same transaction.
          await run(
            "UPDATE tickets SET status='void' WHERE order_id=? AND status='issued'",
            o.id,
          );
          // The cumulative counters close out too: after a full
          // refund refund_quantity == quantity and refunded_cents
          // == amount (a partial history + the remainder add up to
          // the whole order — the counters are cumulative by
          // definition, so they must not stop at the last partial).
          await run(
            "UPDATE orders SET refund_quantity=?, refunded_cents=? WHERE id=?",
            o.quantity,
            o.amount,
            o.id,
          );
        }
      }
      // R5-5 finance ledger (same transaction): an approved refund
      // books refund_out (-refunded amount) + card_refund (+the
      // card-returned share — POSITIVE, the same direction as the
      // stored_value_ledger `refund` row — only when > 0). Both the
      // full and the partial path land here (refundCents /
      // refundStored are set by either branch above).
      if (action === "approveRefund" && refundCents > 0) {
        await addFinanceLedger(run, {
          shopId: orderShopId,
          kind: "refund_out",
          amountCents: -refundCents,
          orderId: o.id,
          now: time(),
        });
        if (refundStored > 0)
          await addFinanceLedger(run, {
            shopId: orderShopId,
            kind: "card_refund",
            amountCents: refundStored,
            orderId: o.id,
            now: time(),
          });
      }
      // R4-4: the refund request itself — automatic partial (all k
      // selected tickets unprinted): apply in this same request
      // (void the k tickets, release their sold seats, refund the
      // money with the card share first, refund_quantity /
      // refunded_cents += k / refund, status stays paid). Manual
      // partial (any selected ticket printed): only store the
      // selected ids in pending_refund_tickets — the admin decides
      // via approveRefund / rejectRefund, and the frozen tickets
      // refuse verify/print/batch meanwhile. A full request (no
      // quantity, or k == remaining) stores nothing: pending stays
      // '[]', which is also how approveRefund recognises it.
      if (action === "refund" && partial?.auto) {
        refundCents = partial.refundCents;
        refundStored = await refundStoredValue(
          get,
          run,
          o.user_id,
          orderShopId,
          o.id,
          partial.cardCents,
          time(),
        );
        await run(
          "UPDATE tickets SET status='void' WHERE id IN (" +
            partial.ticketIds.map(() => "?").join(",") +
            ")",
          ...partial.ticketIds,
        );
        if (partial.seatIds.length)
          await run(
            "UPDATE seats SET status='available', order_id=NULL, held_until=NULL WHERE id IN (" +
              partial.seatIds.map(() => "?").join(",") +
              ") AND order_id=? AND status='sold'",
            ...partial.seatIds,
            o.id,
          );
        await run(
          "UPDATE orders SET refund_quantity=refund_quantity+?, refunded_cents=refunded_cents+? WHERE id=?",
          partial.k,
          refundCents,
          o.id,
        );
        // R5-5 finance ledger: money actually left in this
        // automatic partial refund — same two rows as approveRefund.
        await addFinanceLedger(run, {
          shopId: orderShopId,
          kind: "refund_out",
          amountCents: -refundCents,
          orderId: o.id,
          now: time(),
        });
        if (refundStored > 0)
          await addFinanceLedger(run, {
            shopId: orderShopId,
            kind: "card_refund",
            amountCents: refundStored,
            orderId: o.id,
            now: time(),
          });
      } else if (action === "refund" && partial && !partial.auto) {
        await run(
          "UPDATE orders SET pending_refund_tickets=? WHERE id=?",
          JSON.stringify(partial.ticketIds),
          o.id,
        );
      }
      // R4-4: rejecting a partial request unfreezes the tickets
      // (they were never voided) — clear the pending list; status
      // back to paid via the generic update above.
      if (action === "rejectRefund")
        await run(
          "UPDATE orders SET pending_refund_tickets='[]' WHERE id=?",
          o.id,
        );
      if (["cancelled", "refunded"].includes(to) && !bookingType(o))
        await run(
          "UPDATE resources SET stock=stock+? WHERE id=?",
          o.quantity,
          o.resource_id,
        );
      // R3-2 coupon release (same transaction as the status change):
      // a cancelled / refunded order gives its redemption back — the
      // redemption row is deleted, so quota and per-user count are
      // restored. refund_requested / disputed do NOT release (still
      // paid-derived); the order row keeps coupon_id / coupon_cents.
      if (["cancelled", "refunded"].includes(to))
        await releaseCouponRedemption(run, o.id);
      // R2-5 seat lifecycle (same transaction as the status change):
      // pay sells this order's held seats; cancel / a refund decision
      // releases its held seats back to available. Sold seats of a
      // refunded order stay sold (the design releases held seats only).
      if (to === "paid")
        await run(
          "UPDATE seats SET status='sold', held_until=NULL WHERE order_id=? AND status='held'",
          o.id,
        );
      // R4-1: pay issues one ticket per order.quantity, in the same
      // transaction, AFTER the stored-value deduction + the seat
      // sell above — seat tickets link 1:1 to the order's sold
      // seats (row, col ASC); non-seat orders get seat_id NULL.
      if (action === "pay") await issueTicketsForOrder(get, run, o, time);
      else if (["cancelled", "refunded"].includes(to))
        await run(
          "UPDATE seats SET status='available', order_id=NULL, held_until=NULL WHERE order_id=? AND status='held'",
          o.id,
        );
      // Wave 4 #13 (Q9): an admin decision notifies the order owner with
      // its own title (order code + result + reason); the money stays
      // simulated. Other transitions keep the old title.
      if (DECISIONS.includes(action)) {
        const result =
          action === "approveRefund"
            ? pendingPartial
              ? `部分退款申请已通过，已模拟退款 ¥${(refundCents / 100).toString()}（${pendingPartial.k} 张票）`
              : "退款申请已通过，已模拟退款"
            : action === "rejectRefund"
              ? "退款申请未通过"
              : action === "rejectDispute"
                ? "申诉已驳回"
                : "纠纷已调解完成，订单已结算";
        await notify(
          o.user_id,
          "订单售后处理结果",
          `${o.code} · ${o.resource_name}：${result}。${action === "approveRefund" ? (refundStored > 0 ? `其中 ¥${(refundStored / 100).toString()} 已返还文惠卡。` : "") : "原因：" + decision + "。"}该处理为模拟，未产生真实扣款/退款。`,
        );
      } else {
        await notify(
          o.user_id,
          "订单状态更新",
          `${o.code} · ${o.resource_name} → ${ORDER_STATUS_ZH[to]}。${action === "pay" ? (payStored && payStored.used > 0 ? `文惠卡已扣 ¥${(payStored.used / 100).toString()}，剩余 ¥${(payStored.remainder / 100).toString()}为模拟支付，未扣款。` : "这是模拟支付，未扣款。") : action === "refund" && partial?.auto ? `已自动退回 ${partial.k} 张票，退款 ¥${(partial.refundCents / 100).toString()}${refundStored > 0 ? `，其中 ¥${(refundStored / 100).toString()} 已返还文惠卡` : ""}。该处理为模拟，未产生真实扣款/退款。` : action === "refund" && partial ? `已提交部分退款申请（${partial.k} 张票），等待管理员审核。` : ""}`,
        );
      }
      // R4-4: a partial-refund request (auto or manual) audits as
      // "申请部分退款"; every other transition keeps the old text.
      await audit(
        u,
        action === "refund" && partial ? "申请部分退款" : `订单操作 ${action}`,
        o.code,
      );
      // R3-1: re-evaluate the order owner's stored main-shop tier when
      // spending can change — pay (up), complete (idempotent re-check),
      // approveRefund (down, the only way spending falls). Same
      // transaction as the status change, so the tier and the status
      // commit or roll back together.
      if (["pay", "complete", "approveRefund"].includes(action))
        await evaluateTier(get, all, run, o.user_id);
      // R3-4: synchronous auto-coupon evaluation (no worker, no
      // cron — same transaction as the status change). The after-tier
      // is resolved live now that spending includes this order; for a
      // complete it equals the before-tier, so no tier gift re-fires
      // and the (rule, user, trigger) guard is the backstop.
      if (["pay", "complete"].includes(action)) {
        const afterTier = await resolveTier(get, all, o.user_id, orderShopId);
        await evaluateAutoCoupons(
          { get, all, run, notify },
          {
            userId: o.user_id,
            orderId: o.id,
            shopId: orderShopId,
            amountCents: o.amount,
            beforeTier,
            afterTier,
          },
        );
      }
    });
    // A status change moves revenue between buckets (paid/completed) and
    // cancel/refund restores stock — same bust as order creation.
    if (cache) {
      await cache.bustAdmin();
      await cache.bustResources();
    }
    send({
      ok: true,
      status: to,
      ...(action === "pay"
        ? {
            simulated: true,
            note: "模拟支付，未扣款",
            stored_value_cents: payStored?.used ?? 0,
            remainder_cents: payStored?.remainder ?? o.amount,
          }
        : {}),
      // R4-4: approveRefund carries the refunded amounts
      // (refund_cents + refunded_to_card_cents) for BOTH the partial
      // and the full case; the automatic partial refund answers with
      // the same amounts plus the new cumulative counters; a manual
      // partial request answers with the frozen ticket ids.
      ...(action === "approveRefund"
        ? {
            refund_cents: refundCents,
            refunded_to_card_cents: refundStored,
          }
        : {}),
      ...(action === "refund" && partial?.auto
        ? {
            refund_cents: partial.refundCents,
            refunded_to_card_cents: refundStored,
            refund_quantity: (o.refund_quantity || 0) + partial.k,
            refunded_cents: (o.refunded_cents || 0) + partial.refundCents,
          }
        : {}),
      ...(action === "refund" && partial && !partial.auto
        ? { pending_refund_tickets: partial.ticketIds }
        : {}),
    });
    return true;
  }
  return false;
}

// Wave 4 #15 — simulated service/licence agreement per order (具体功能 #12,
// port of zhou guiyan-demo/server/index.mjs:910-928). Content is generated
// on the fly from the order + resource meta: nothing is written to the DB
// and no column is added. Login required; owner or admin only. Missing
// order -> 404; another user's order -> 403.
export async function getOrderContract(ctx) {
  const { p, req, send, needUser, get } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/contract$/);
  if (m && req.method === "GET") {
    const u = needUser();
    const o = await get(
      "SELECT o.*,r.name AS resource_name,r.meta AS resource_meta FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
      Number(m[1]),
    );
    assert(o, "订单不存在", 404);
    assert(o.user_id === u.id || u.role === "admin", "无权查看此订单", 403);
    let meta = {};
    try {
      meta = JSON.parse(o.resource_meta || "{}") || {};
    } catch {
      meta = {};
    }
    const yuan2 = (cents) =>
      ((typeof cents === "number" ? cents : 0) / 100).toFixed(2);
    send({
      title: "模拟服务与授权协议",
      content: [
        "【毕业实习演示文件，无真实合同效力】",
        `订单：${o.code}`,
        `资源：${o.resource_name}`,
        `日期：${o.booking_date}`,
        `金额：${yuan2(o.amount)}元（模拟）`,
        `授权范围：${meta.scope || "订单约定的资源服务"}`,
        `期限：${meta.term || "预约日期当日"}`,
        `区域：${meta.territory || "订单约定地点"}`,
        `设备押金：${yuan2(meta.deposit || 0)}元（仅展示，不收取）`,
        "服务流程：预约→审核→模拟支付→服务完成→模拟结算。",
        "纠纷可通过订单申诉提交，资金状态仅为本地模拟。",
      ].join("\n"),
    });
    return true;
  }
  return false;
}
