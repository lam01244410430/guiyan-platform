import { randomBytes } from "node:crypto";
import { assert, text, int, date, bookingType } from "../lib/http.mjs";
import { ORDER_STATUS_ZH } from "../lib/status-labels.mjs";
import { enrichOrder } from "./pickup.mjs";

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
      amount = r.price * qty,
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
      amount = tier.price_cents * qty;
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
    // Amount is always computed server-side from the resource price (or
    // the tier price above); any amount sent by the client is ignored.
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
      const result = await run(
        "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,performance_id,ticket_type_id,pickup_point_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        `GY${Date.now()}${randomBytes(2).toString("hex")}`,
        u.id,
        rid,
        qty,
        amount,
        d,
        "pending",
        ["H5", "电脑网页", "微信小程序"].includes(b.channel)
          ? b.channel
          : "H5",
        String(b.note || "").slice(0, 1000),
        perf ? perf.id : null,
        tier ? tier.id : null,
        pickupPoint ? pickupPoint.id : null,
        time(),
      );
      await notify(
        u.id,
        "预约提交成功",
        `“${r.name}”${d}的预约已提交，等待确认。`,
      );
      await audit(u, "提交预约", r.name);
      return Number(result.lastInsertRowid);
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
  const { p, req, b, send, needUser, get, run, transaction, notify, audit, cache } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/(confirm|pay|complete|cancel|refund|approveRefund|rejectRefund|dispute|rejectDispute|resolve)$/);
  if (m && req.method === "POST") {
    const u = needUser(),
      [, id, action] = m,
      o = await get(
        "SELECT o.*,r.category,r.name resource_name FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
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
    const [from, to] = transitions[action];
    assert(
      (Array.isArray(from) ? from : [from]).includes(o.status),
      "当前状态不允许该操作",
      400,
    );
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
    else if (action === "approveRefund") decision = "审核通过，已模拟退款";
    else if (action === "rejectRefund" || action === "rejectDispute")
      decision = text(b.reason || "", "拒绝原因", 500);
    await transaction(async () => {
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
      if (["cancelled", "refunded"].includes(to) && !bookingType(o))
        await run(
          "UPDATE resources SET stock=stock+? WHERE id=?",
          o.quantity,
          o.resource_id,
        );
      // R2-5 seat lifecycle (same transaction as the status change):
      // pay sells this order's held seats; cancel / a refund decision
      // releases its held seats back to available. Sold seats of a
      // refunded order stay sold (the design releases held seats only).
      if (to === "paid")
        await run(
          "UPDATE seats SET status='sold', held_until=NULL WHERE order_id=? AND status='held'",
          o.id,
        );
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
            ? "退款申请已通过，已模拟退款"
            : action === "rejectRefund"
              ? "退款申请未通过"
              : action === "rejectDispute"
                ? "申诉已驳回"
                : "纠纷已调解完成，订单已结算";
        await notify(
          o.user_id,
          "订单售后处理结果",
          `${o.code} · ${o.resource_name}：${result}。${action === "approveRefund" ? "" : "原因：" + decision + "。"}该处理为模拟，未产生真实扣款/退款。`,
        );
      } else {
        await notify(
          o.user_id,
          "订单状态更新",
          `${o.code} · ${o.resource_name} → ${ORDER_STATUS_ZH[to]}。${action === "pay" ? "这是模拟支付，未扣款。" : ""}`,
        );
      }
      await audit(u, `订单操作 ${action}`, o.code);
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
        ? { simulated: true, note: "模拟支付，未扣款" }
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
