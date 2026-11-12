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
