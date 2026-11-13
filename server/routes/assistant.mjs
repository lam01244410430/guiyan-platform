import { assert } from "../lib/http.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";
import { ORDER_STATUS_ZH } from "../lib/status-labels.mjs";
import { buildAnalysis } from "./admin-insights.mjs";

// Canonical Chinese assistant copy — the same wording as the web prototype
// (web/index.html I18N zh: ansRefund/ansResched/ansHeritage/ansBook/
// ansHot/ansHello/ansFallback).
export const ANSWERS = {
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

// Shared rule engine: the kind/answer/items chain behind GET
// /api/assistant. Also the fail-open fallback for POST /api/assistant/chat
// when the trial AI backend is unreachable or returns nothing usable.
// q must already be trimmed. Returns {kind, answer, items?}.
export async function answerRules(ctx, q) {
  const { all, yuan, ANSWERS, cache, res } = ctx;
  const s = q.toLowerCase();
  let kind, answer, items;
  // Wave 3 #8, operator intents — port of zhou assistants.mjs
  // operatorAnswer(), reading the REAL analysis payload via buildAnalysis()
  // (same numbers as GET /api/admin/analysis). Checked FIRST: keywords
  // overlap the public branches (e.g. 热门 matches both hot and 热销TOP5).
  // Only runs when ctx.operator === true, which only the admin-only
  // POST /api/assistant/chat {kind:"operator"} path sets — the public GET
  // can never reach it (Q2).
  if (ctx.operator) {
    const a = await buildAnalysis(ctx, "day");
    if (/报告|总结|日报|周报|运营分析/.test(q))
      return {
        kind: "operator",
        answer: "【本地规则分析，未接入大模型】\n" + a.report,
      };
    const parts = [];
    if (/销量|交易|订单|总额|卖了|客单/.test(q))
      parts.push(
        `交易概览：有效交易额${yuan(a.kpis.revenue)}，历史订单${a.kpis.orders}笔，有效付费订单${a.kpis.paidOrders}笔，付费客单价${yuan(a.kpis.paidOrders ? Math.round(a.kpis.revenue / a.kpis.paidOrders) : 0)}。`,
      );
    if (/用户|增长|活跃|新用户|会员|分群|沉默/.test(q))
      parts.push(
        `用户情况：注册档案${a.userSummary.total}人，近30天新增${a.userSummary.newUsers}人，近30天下单活跃${a.kpis.users}人；高价值${a.userSummary.highValue}人、潜力会员${a.userSummary.potential}人、沉默用户${a.userSummary.silent}人。标签按后台已启用规则计算。`,
      );
    if (/场馆|场地|档期|占用|上座/.test(q))
      parts.push(
        "场馆表现：\n" +
          a.venues
            .map(
              (v) =>
                `${v.name}：未来30天档期占用${v.occupancy}%，闲置${v.idleRate}%，租赁交易额${yuan(v.revenue)}，关联售票上座率${v.seatOccupancy === null ? "暂无关联剧目样本" : v.seatOccupancy + "%"}。`,
            )
            .join("\n"),
      );
    if (/渠道|来源/.test(q)) {
      const total = a.kpis.revenue;
      parts.push(
        "渠道分析：\n" +
          a.channels
            .map(
              (c) =>
                `${c.name}：${yuan(c.amount)}，占比${total ? ((c.amount / total) * 100).toFixed(1) : 0}%。`,
            )
            .join("\n"),
      );
    }
    if (/库存|异常|预警|紧张|超卖/.test(q))
      parts.push(
        "预警提醒：\n" +
          (a.alerts.map((v) => v.title + "；" + v.detail).join("\n") ||
            "当前没有待处理预警。"),
      );
    if (/热销|排行|排名|卖得好/.test(q))
      parts.push(
        "热销TOP5：\n" +
          a.ranking
            .slice(0, 5)
            .map(
              (r, i) =>
                `${i + 1}. ${r.name}：${r.sales}笔、${r.quantity}份，${yuan(r.revenue)}`,
            )
            .join("\n"),
      );
    if (/推荐|建议|活动|应该|冷门|定价|营销|复盘/.test(q))
      parts.push("运营建议：\n" + a.insights.join("\n"));
    if (!parts.length)
      parts.push(
        "可以查询交易、用户增长与分群、场馆、渠道、热销、预警，或输入“生成经营报告”。当前问题未命中支持范围，请补充你想看的维度。",
      );
    return {
      kind: "operator",
      answer: "【本地规则分析，未接入大模型】\n" + parts.join("\n\n"),
    };
  }
  // Wave 3 #8, logged-in support intents — port of zhou assistants.mjs
  // supportAnswer(), reading the caller's OWN orders via ctx.orderRows.
  // Checked BEFORE the generic refund/book branches below. P3-2 grouped
  // refund_requested/disputed here (Wave 4 #13 states), so an order in
  // either state is visible to this answer.
  if (ctx.session) {
    const orders = await ctx.orderRows(ctx.session);
    if (/退款|退票|退订|退钱|cancel|refund|能退|怎么退|改签/.test(s)) {
      const groups = [
        ["pending", "待确认，可直接取消"],
        ["confirmed", "待支付，可直接取消"],
        ["paid", "已支付，可申请退款"],
        ["completed", "已完成，不支持在线退款"],
        ["cancelled", "已取消"],
        ["refunded", "已退款"],
        ["refund_requested", "已申请退款，等待管理员处理"],
        ["disputed", "申诉处理中，等待管理员处理"],
      ];
      const lines = groups
        .map(([status, label]) => {
          const rows = orders.filter((o) => o.status === status);
          return rows.length
            ? `${rows.length}笔${label}：${rows
                .slice(0, 3)
                .map((o) => o.code)
                .join("、")}`
            : null;
        })
        .filter(Boolean);
      return {
        kind: "myRefund",
        answer:
          "【本地规则客服，未接入大模型】\n退订与售后：\n" +
          (lines.join("\n") || "你当前没有可退款的订单。") +
          "\n改签需先联系资源方确认档期，再取消重订；不承诺未配置的24小时退票规则。",
      };
    }
    if (/订单|预约|支付|付款/.test(s)) {
      items = orders.slice(0, 5).map((o) => ({
        code: o.code,
        resource_name: o.resource_name,
        status: o.status,
        amount: o.amount,
      }));
      const list = orders
        .slice(0, 5)
        .map(
          (o) =>
            `${o.code} · ${o.resource_name} · ${ORDER_STATUS_ZH[o.status] || o.status} · ${yuan(o.amount)}`,
        )
        .join("\n");
      return {
        kind: "myOrders",
        answer:
          `【本地规则客服，未接入大模型】\n你的订单：共${orders.length}笔。\n` +
          list +
          "\n在“我的订单”查看详情；待确认→后台确认→模拟支付，不扣真实资金。",
        items,
      };
    }
    if (/会员|文惠|消费卡|储值/.test(s)) {
      return {
        kind: "member",
        answer:
          "【本地规则客服，未接入大模型】\n会员与权益：演示支持兴趣偏好、收藏和模拟订单。文惠卡、消费卡、储值与真实优惠券尚未接入，不产生扣款或真实权益。",
      };
    }
  } else if (/我的订单|订单/.test(s)) {
    // Anonymous: never return an empty order list that looks like "no
    // orders" — ask the user to log in first (kind stays myOrders).
    return { kind: "myOrders", answer: "请先登录，再查询你的订单。" };
  }
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
      unit: r.unit,
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
    let rows = null;
    if (cache?.enabled) {
      rows = await cache.get(CACHE_KEYS.resourcesHot);
      if (rows) res.setHeader("X-Cache", "HIT");
    }
    if (!rows) {
      rows = await all(
        "SELECT name,city,price,unit FROM resources WHERE status='published' ORDER BY views DESC LIMIT 3",
      );
      if (cache?.enabled) {
        res.setHeader("X-Cache", "MISS");
        await cache.set(
          CACHE_KEYS.resourcesHot,
          rows,
          CACHE_TTLS.resourcesHot,
        );
      }
    }
    items = rows.map((r) => ({
      name: r.name,
      city: r.city,
      price: r.price,
      unit: r.unit,
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
  return { kind, answer, ...(items ? { items } : {}) };
}

// Language instruction prepended to the forwarded message so the trial
// backend answers in the site's current language. The backend now honors a
// `language` field too (agent update 2026-11-11: per-request system prompt),
// so the proxy sends it as well; the prepended instruction stays as a
// backstop for older/direct callers. Invalid/missing language defaults to zh.
const LANG_INSTRUCTIONS = {
  zh: "请用中文回答以下问题：",
  vi: "Hãy trả lời bằng tiếng Việt cho câu hỏi sau:",
  en: "Please answer in English to the following question:",
};

export async function assistant(ctx) {
  const { p, req, url, send } = ctx;
  if (p === "/api/assistant" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    assert(q.length > 0 && q.length <= 1000, "问题不能为空且不能超过1000字");
    const { kind, answer, items } = await answerRules(ctx, q);
    send({ kind, answer, mock: true, ...(items ? { items } : {}) });
    return true;
  }
  if (p === "/api/assistant/chat" && req.method === "POST") {
    const b = ctx.b || {};
    assert(
      typeof b.message === "string" &&
        b.message.trim().length > 0 &&
        b.message.trim().length <= 1000,
      "问题不能为空且不能超过1000字",
    );
    const q = b.message.trim();
    const lang =
      typeof b.language === "string" && LANG_INSTRUCTIONS[b.language]
        ? b.language
        : "zh";
    // Wave 3 #8: kind=operator is admin-only (anonymous and non-admin ->
    // 403, like every other admin endpoint) and bypasses the trial
    // backend entirely: the answer comes from the rule engine over the
    // real analysis payload. The audit records the action only — never
    // the message content (same no-logging rule as the chat itself).
    if (b.kind === "operator") {
      assert(ctx.session?.role === "admin", "无权访问管理后台", 403);
      const { kind, answer, items } = await answerRules(
        { ...ctx, operator: true },
        q,
      );
      await ctx.audit(ctx.session, "AI模拟 operator", "本地规则分析");
      send({
        reply: answer,
        source: "rules",
        kind,
        mock: true,
        ...(items ? { items } : {}),
      });
      return true;
    }
    const forwarded = LANG_INSTRUCTIONS[lang] + "\n" + q;
    // Env is read at request time, not module load, so tests can point a
    // spawned server at a stub and Vercel env changes apply without rebuild.
    // AI_CHAT_TIMEOUT_MS exists only so the timeout path is testable
    // without waiting 25 s. Never log the message or AI_CHAT_URL.
    const upstreamUrl =
      process.env.AI_CHAT_URL || "http://34.96.190.102/api/chat";
    const timeoutRaw = Number(process.env.AI_CHAT_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 25000;
    let reply = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const up = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: forwarded, language: lang }),
          signal: ctrl.signal,
        });
        if (!up.ok)
          throw Object.assign(new Error("upstream status"), {
            code: `UPSTREAM_${up.status}`,
          });
        const data = await up.json();
        const r =
          typeof data?.reply === "string" && data.reply.trim()
            ? data.reply
            : typeof data?.detail === "string" && data.detail.trim()
              ? data.detail
              : null;
        if (!r) throw new Error("empty upstream reply");
        reply = r;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const code =
        e?.code ||
        (e?.name === "AbortError" ? "TIMEOUT" : e?.name || "UPSTREAM_FAILED");
      console.error("AI chat upstream failed", { code });
      const { kind, answer, items } = await answerRules(ctx, q);
      send({
        reply: answer,
        source: "rules",
        fallback: true,
        kind,
        ...(items ? { items } : {}),
      });
      return true;
    }
    send({ reply, source: "ai" });
    return true;
  }
  return false;
}
