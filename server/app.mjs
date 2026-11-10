// Guiyan API — customer-facing only.
//
// A focused subset of the original group demo API (guiyan-demo/server/
// index.mjs): no admin dashboard, no analytics, no roadmap, no internal
// metrics endpoints. JSON only; Chinese canonical data (UI translation
// stays client-side); all money in INTEGER cents; parameterised queries
// only; every write runs inside a transaction (see createRequestHandler).
//
// Differences from the original, deliberate for this customer-facing
// backend (also noted in server/README.md):
// - Order confirm is done by the order owner (demo simplification: there
//   is no operator UI in this redesign; in production confirm/reject is
//   the operator's job).
// - Refund goes paid -> refunded directly (simulated refund completes at
//   once, escrow "已模拟退款"); the original had an intermediate
//   refund_requested state approved by an operator, which has no UI here.
// - No registration endpoint: demo accounts are seeded (see seed.mjs).

import http from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { categories } from "./seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webIndex = path.join(root, "web", "index.html");
// Demo baseline date, same as the original group demo: bookings cannot be
// earlier than this date (seed data lives around it).
const today = "2026-11-09";
const time = () => new Date().toISOString();
const yuan = (cents) => `¥${(cents / 100).toString()}`;

function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
function text(value, label, max = 1000) {
  assert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label}不能为空且不能超过${max}字`,
  );
  return value.trim();
}
function int(value, label, min = 0, max = 100000000) {
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${label}必须为${min}至${max}之间的整数`,
  );
  return value;
}
function date(value) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !isNaN(new Date(value).valueOf()) &&
      new Date(value).toISOString().slice(0, 10) === value &&
      value >= today,
    "请选择有效日期，且不能早于演示基准日",
  );
  return value;
}

const safeUser = ({ password, ...u }) => u;
const resourceRow = (r) => ({
  ...r,
  tags: JSON.parse(r.tags),
  meta: JSON.parse(r.meta),
});
const bookingType = (r) => ["venue", "equipment"].includes(r.category);

// Canonical Chinese assistant copy — the same wording as the web prototype
// (web/index.html I18N zh: ansRefund/ansResched/ansHeritage/ansBook/
// ansHot/ansHello/ansFallback).
const ANSWERS = {
  refund:
    "退票规则：订单在「已支付」状态时，可到右上角「我的票券」申请退款；确认后状态变为「已退款」，名额随即释放。试一试：预订一项资源，走完确认与支付，再点「申请退款」。",
  reschedule:
    "改签规则：场馆与设备按日期预订，同一天不可重复预订同一资源。请先在「我的票券」取消原订单，再选新日期重新预订。",
  heritage: (n, list) =>
    `平台共有 ${n} 项非遗体验：\n${list}\n在目录中选择「非遗体验」即可预订。`,
  book: "预订很简单：在目录中点开任意资源 → 选日期与数量 → 点「立即预订」。订单先进入「待确认」，在「我的票券」里继续完成确认、支付与完成。",
  hot: (list) => `按人气为你推荐：\n${list}`,
  hello: "您好！想看什么演出，或者需要我帮您查退改签规则？",
  fallback:
    "我可以帮你处理这些事：退票退款 · 改签换期 · 如何预订 · 非遗体验推荐 · 热门演出推荐。点下方快捷问题试试。",
};

// Commit before sending the response, so the next request sees saved changes.
function createRequestHandler(db, handle) {
  return async (req, res) => {
    const end = res.end;
    let pending;
    res.end = function (...args) {
      pending = args;
      return this;
    };
    try {
      await db.request(() => handle(req, res), {
        write: !["GET", "HEAD", "OPTIONS"].includes(req.method),
        success: () => res.statusCode < 400,
      });
      res.end = end;
      res.end(...(pending || []));
    } catch (error) {
      res.end = end;
      console.error("Request transaction failed", {
        code: error.code || "DATABASE_UNAVAILABLE",
      });
      if (!res.headersSent)
        res.writeHead(503, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
      res.end(JSON.stringify({ error: "数据库暂时不可用，请稍后重试" }));
    }
  };
}

export async function createApp({ database }) {
  const db = database;
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const audit = async (u, action, detail) =>
    await run(
      "INSERT INTO audit_logs(user_id,action,detail,created_at) VALUES(?,?,?,?)",
      u?.id || null,
      action,
      detail,
      time(),
    );
  const notify = async (uid, title, content, sender = 1) =>
    await run(
      "INSERT INTO messages(user_id,sender_id,title,content,created_at) VALUES(?,?,?,?,?)",
      uid,
      sender,
      title,
      content,
      time(),
    );
  function transaction(fn) {
    // Write requests already run atomically on one database connection.
    return fn();
  }

  const resourceSelect = `
    SELECT r.*,
      COALESCE((SELECT AVG(rating) FROM comments c WHERE c.resource_id=r.id AND c.status='approved'),0) rating,
      (SELECT COUNT(*) FROM comments c WHERE c.resource_id=r.id AND c.status='approved') review_count
    FROM resources r`;

  async function orderRows(user) {
    return await all(
      `SELECT o.*,r.name AS resource_name,r.image,r.category,r.unit FROM orders o
       JOIN resources r ON r.id=o.resource_id WHERE o.user_id=? ORDER BY o.id DESC`,
      user.id,
    );
  }

  const handleApi = async (req, res) => {
    const send = (value, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, "http://localhost"),
      p = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      });
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      let b = {};
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          assert(Buffer.byteLength(raw) < 300000, "请求内容过长", 413);
        }
        try {
          b = raw ? JSON.parse(raw) : {};
        } catch {
          assert(false, "请求数据格式错误");
        }
        assert(
          b && typeof b === "object" && !Array.isArray(b),
          "请求数据必须为对象",
        );
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const session = token
        ? await get(
            "SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE token=? AND expires_at>?",
            token,
            time(),
          )
        : null;
      const needUser = () => {
        assert(session, "请先登录", 401);
        return session;
      };

      if (p === "/api/health") {
        send({ ok: true, mode: "postgres", database: db.dialect, today });
        return;
      }

      if (p === "/api/categories") {
        send({ categories });
        return;
      }

      if (p === "/api/resources" && req.method === "GET") {
        const category = url.searchParams.get("category");
        const city = url.searchParams.get("city");
        const q = url.searchParams.get("q");
        const sort = url.searchParams.get("sort") || "hot";
        assert(
          ["hot", "price_asc", "price_desc", "newest"].includes(sort),
          "无效排序方式",
        );
        const where = ["r.status='published'"];
        const params = [];
        if (category && category !== "all") {
          // Accept both the category id ("show") and the Chinese name
          // ("演出剧目") — the mini-program sends the name.
          const byId = categories.some((c) => c.id === category);
          const byName = categories.find((c) => c.name === category);
          assert(byId || byName, "无效资源分类");
          const categoryId = byId ? category : byName.id;
          where.push("r.category=?");
          params.push(categoryId);
        }
        if (city && city !== "all") {
          where.push("r.city=?");
          params.push(city);
        }
        if (q) {
          where.push("(r.name ILIKE ? OR r.description ILIKE ? OR r.city ILIKE ?)");
          params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        const orderBy =
          sort === "price_asc"
            ? "r.price ASC"
            : sort === "price_desc"
              ? "r.price DESC"
              : sort === "newest"
                ? "r.id DESC"
                : "r.views DESC";
        const resources = (
          await all(
            `${resourceSelect} WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`,
            ...params,
          )
        ).map(resourceRow);
        send({ resources });
        return;
      }

      let m = p.match(/^\/api\/resources\/(\d+)$/);
      if (m && req.method === "GET") {
        const r = await get(
          `${resourceSelect} WHERE r.id=? AND r.status='published'`,
          Number(m[1]),
        );
        assert(r, "资源不存在", 404);
        send({ resource: resourceRow(r) });
        return;
      }

      if (p === "/api/auth/login" && req.method === "POST") {
        const u = await get(
          "SELECT * FROM users WHERE username=?",
          text(b.username, "账号", 40),
        );
        assert(u, "账号或密码不正确", 401);
        const [salt, expected] = u.password.split(":");
        const actual = scryptSync(text(b.password, "密码", 100), salt, 32);
        assert(
          timingSafeEqual(actual, Buffer.from(expected, "hex")),
          "账号或密码不正确",
          401,
        );
        const newToken = randomBytes(32).toString("hex");
        await run(
          "INSERT INTO sessions VALUES(?,?,?)",
          newToken,
          u.id,
          new Date(Date.now() + 86400000 * 7).toISOString(),
        );
        await audit(u, "登录", "演示账号登录");
        send({ token: newToken, user: safeUser(u) });
        return;
      }

      if (p === "/api/auth/logout" && req.method === "POST") {
        if (token) await run("DELETE FROM sessions WHERE token=?", token);
        send({ ok: true });
        return;
      }

      if (p === "/api/orders" && req.method === "GET") {
        const u = needUser();
        send({ orders: await orderRows(u) });
        return;
      }

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
        const created = await get("SELECT * FROM orders WHERE id=?", id);
        send({
          ok: true,
          id,
          code: created.code,
          amount: created.amount,
          status: created.status,
        });
        return;
      }

      m = p.match(/^\/api\/orders\/(\d+)\/(confirm|pay|complete|cancel|refund)$/);
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
        send({
          ok: true,
          status: to,
          ...(action === "pay"
            ? { simulated: true, note: "模拟支付，未扣款" }
            : {}),
        });
        return;
      }

      if (p === "/api/demands" && req.method === "GET") {
        const demands = await all(
          `SELECT d.*,u.name AS user_name FROM demands d JOIN users u ON u.id=d.user_id
           ${session ? "WHERE d.status='approved' OR d.user_id=?" : "WHERE d.status='approved'"}
           ORDER BY d.id DESC`,
          ...(session ? [session.id] : []),
        );
        send({ demands });
        return;
      }

      if (p === "/api/demands" && req.method === "POST") {
        const u = needUser();
        assert(u.verified, "发布需求前请先完成演示身份认证", 403);
        // Accept both the category id ("artist") and the Chinese name
        // ("艺人团队") — both clients send the name.
        const catParam = b.category;
        const catEntry =
          categories.find((c) => c.id === catParam) ||
          categories.find((c) => c.name === catParam);
        assert(catEntry, "请选择需求分类");
        const result = await run(
          "INSERT INTO demands(user_id,title,category,budget,city,description,created_at) VALUES(?,?,?,?,?,?,?)",
          u.id,
          text(b.title, "标题", 80),
          catEntry.id,
          int(b.budget, "预算"),
          text(b.city, "城市", 30),
          text(b.description, "需求说明", 2000),
          time(),
        );
        await audit(u, "发布需求", b.title);
        await notify(u.id, "需求已提交", `“${b.title}”已提交，等待审核。`);
        send({ ok: true, id: Number(result.lastInsertRowid) });
        return;
      }

      if (p === "/api/favorites" && req.method === "GET") {
        const u = needUser();
        const favorites = (
          await all(
            `${resourceSelect} JOIN favorites f ON f.resource_id=r.id WHERE f.user_id=? ORDER BY r.id`,
            u.id,
          )
        ).map(resourceRow);
        send({ favorites });
        return;
      }

      if (p === "/api/favorites" && req.method === "POST") {
        const u = needUser(),
          rid = int(b.resourceId, "资源编号", 1);
        assert(
          await get("SELECT id FROM resources WHERE id=?", rid),
          "资源不存在",
        );
        const exists = await get(
          "SELECT 1 FROM favorites WHERE user_id=? AND resource_id=?",
          u.id,
          rid,
        );
        if (exists)
          await run(
            "DELETE FROM favorites WHERE user_id=? AND resource_id=?",
            u.id,
            rid,
          );
        else await run("INSERT INTO favorites VALUES(?,?)", u.id, rid);
        send({ ok: true, favorite: !exists });
        return;
      }

      m = p.match(/^\/api\/favorites\/(\d+)$/);
      if (m && req.method === "DELETE") {
        const u = needUser();
        await run(
          "DELETE FROM favorites WHERE user_id=? AND resource_id=?",
          u.id,
          Number(m[1]),
        );
        send({ ok: true });
        return;
      }

      if (p === "/api/assistant" && req.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        assert(q.length > 0 && q.length <= 1000, "问题不能为空且不能超过1000字");
        const s = q.toLowerCase();
        let kind, answer, items;
        if (/退款|退票|refund|hoàn/.test(s)) {
          kind = "refund";
          answer = ANSWERS.refund;
        } else if (/改签|resched|đổi lịch|dời/.test(s)) {
          kind = "reschedule";
          answer = ANSWERS.reschedule;
        } else if (/非遗|heritage|di sản|壮锦|tráng cẩm/.test(s)) {
          kind = "heritage";
          const rows = await all(
            "SELECT name,city,price,unit FROM resources WHERE category='heritage' AND status='published' ORDER BY id",
          );
          items = rows.map((r) => ({
            name: r.name,
            city: r.city,
            price: r.price,
          }));
          const list = rows
            .map((r) => `• ${r.name} — ${r.city} · ${yuan(r.price)}/${r.unit}`)
            .join("\n");
          answer = ANSWERS.heritage(rows.length, list);
        } else if (/预订|预约|订票|book|đặt/.test(s)) {
          kind = "book";
          answer = ANSWERS.book;
        } else if (/今晚|热门|推荐|tonight|hot|popular|gợi ý|hôm nay|vở nào/.test(s)) {
          kind = "hot";
          const rows = await all(
            "SELECT name,city,price,unit FROM resources WHERE status='published' ORDER BY views DESC LIMIT 3",
          );
          items = rows.map((r) => ({
            name: r.name,
            city: r.city,
            price: r.price,
          }));
          const list = rows
            .map((r) => `• ${r.name} — ${r.city} · ${yuan(r.price)}/${r.unit}`)
            .join("\n");
          answer = ANSWERS.hot(list);
        } else if (/你好|您好|hello|chào|hi\b/.test(s)) {
          kind = "hello";
          answer = ANSWERS.hello;
        } else {
          kind = "fallback";
          answer = ANSWERS.fallback;
        }
        send({ kind, answer, mock: true, ...(items ? { items } : {}) });
        return;
      }

      send({ error: "接口不存在" }, 404);
    } catch (e) {
      if (e.code === "23505")
        Object.assign(e, { status: 409, message: "记录已存在，请刷新后重试" });
      if (!e.status)
        console.error("Business request failed", {
          code: e.code || "INTERNAL_ERROR",
        });
      send(
        { error: e.status ? e.message : "服务暂时无法处理请求" },
        e.status || 500,
      );
    }
  };

  const apiHandler = createRequestHandler(db, handleApi);
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        try {
          const data = await readFile(webIndex);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(data);
        } catch {
          res.writeHead(404, {
            "Content-Type": "application/json; charset=utf-8",
          });
          res.end(JSON.stringify({ error: "页面不存在" }));
        }
        return;
      }
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ error: "页面不存在" }));
      return;
    }
    return apiHandler(req, res);
  };

  const server = http.createServer(handler);
  server.handler = handler;
  server.on("close", () => db.close());
  return server;
}
