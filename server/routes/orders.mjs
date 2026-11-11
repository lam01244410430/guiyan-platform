import { randomBytes } from "node:crypto";
import { assert, text, int, date, bookingType } from "../lib/http.mjs";

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
  const { p, req, b, send, needUser, get, run, transaction, notify, audit, time, cache } = ctx;
  if (p === "/api/orders" && req.method === "POST") {
    const u = needUser(),
      rid = int(b.resourceId, "资源编号", 1),
      r = await get(
        "SELECT * FROM resources WHERE id=? AND status='published'",
        rid,
      );
    assert(r, "资源不存在或已下架", 404);
    const qty = int(b.quantity ?? 1, "数量", 1, 100),
      d = date(b.booking_date);
    assert(!bookingType(r) || qty === 1, "租赁类资源每单数量为1");
    // Amount is always computed server-side from the resource price;
    // any amount sent by the client is ignored.
    const id = await transaction(async () => {
      if (bookingType(r))
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
        "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        `GY${Date.now()}${randomBytes(2).toString("hex")}`,
        u.id,
        rid,
        qty,
        r.price * qty,
        d,
        "pending",
        ["H5", "电脑网页", "微信小程序"].includes(b.channel)
          ? b.channel
          : "H5",
        String(b.note || "").slice(0, 1000),
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
    send({
      ok: true,
      id,
      code: created.code,
      amount: created.amount,
      status: created.status,
    });
    return true;
  }
  return false;
}

export async function transitionOrder(ctx) {
  const { p, req, b, send, needUser, get, run, transaction, notify, audit, cache } = ctx;
  const m = p.match(/^\/api\/orders\/(\d+)\/(confirm|pay|complete|cancel|refund)$/);
  if (m && req.method === "POST") {
    const u = needUser(),
      [, id, action] = m,
      o = await get(
        "SELECT o.*,r.category,r.name resource_name FROM orders o JOIN resources r ON r.id=o.resource_id WHERE o.id=?",
        Number(id),
      );
    assert(o, "订单不存在", 404);
    assert(o.user_id === u.id, "无权操作此订单", 403);
    const transitions = {
      confirm: ["pending", "confirmed"],
      pay: ["confirmed", "paid"],
      complete: ["paid", "completed"],
      cancel: [["pending", "confirmed"], "cancelled"],
      refund: ["paid", "refunded"],
    };
    const [from, to] = transitions[action];
    assert(
      (Array.isArray(from) ? from : [from]).includes(o.status),
      "当前状态不允许该操作",
      400,
    );
    await transaction(async () => {
      await run(
        "UPDATE orders SET status=?,escrow=?,refund_reason=? WHERE id=?",
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
          : o.refund_reason,
        o.id,
      );
      if (["cancelled", "refunded"].includes(to) && !bookingType(o))
        await run(
          "UPDATE resources SET stock=stock+? WHERE id=?",
          o.quantity,
          o.resource_id,
        );
      await notify(
        o.user_id,
        "订单状态更新",
        `${o.code} · ${o.resource_name} → ${to}。${action === "pay" ? "这是模拟支付，未扣款。" : ""}`,
      );
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
