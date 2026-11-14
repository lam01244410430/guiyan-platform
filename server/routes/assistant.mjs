import { assert, resourceRow } from "../lib/http.mjs";
import { CACHE_KEYS, CACHE_TTLS } from "../lib/cache.mjs";
import { ORDER_STATUS_ZH } from "../lib/status-labels.mjs";
import { buildAnalysis } from "./admin-insights.mjs";
import { recommendationsFor } from "../lib/profiles.mjs";
import { graphAnswer } from "../lib/kg.mjs";
import { resolveTier, MAIN_SHOP_ID } from "./member-tiers.mjs";

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

// R7-4: proactive recommendation — preferences live ONLY in this
// in-memory map, keyed by the logged-in user id, never in the DB (no
// session table is intentional this wave). A completed recommendation
// or a switch to another intent deletes the entry, so nothing about
// the conversation survives past the session.
const prefSessions = new Map();

// Starts (or continues) the 3-turn preference flow: genre/category ->
// city -> budget. A bare genre/category/city/budget answer only counts
// while a session is open; a fresh recommendation request starts one.
const RECOMMEND_TRIGGER = /推荐|想看|帮我选|recommend/i;
// A message that clearly asks something else while a preference
// session is open ends the session instead of being parsed as a
// preference answer (the caller's other branches answer it below).
const OTHER_INTENT =
  /退款|退票|改签|订单|会员|文惠卡|储值|非遗|预订|预约|订票|热门|今晚|你好|您好|hello/i;

// Next step per Wave 4 #13 after-sales state (read-only: the
// assistant never moves an order, it only reports where it is).
const REFUND_NEXT = {
  paid: "已支付，可在「我的票券」申请退款；管理员通过后变为「已退款」。",
  refund_requested: "已申请退款，等待管理员处理；通过后变为「已退款」，驳回则回到「已支付」。",
  disputed: "申诉处理中，等待管理员处理；处理后变为「已完成」或回到「已支付」。",
  refunded: "已退款，款项按原路返回（模拟）。",
  completed: "已完成，不支持在线退款。",
  cancelled: "已取消，不涉及退款。",
  pending: "待确认，可直接取消，无需走退款流程。",
  confirmed: "待支付，可直接取消，无需走退款流程。",
};

// Budget from a turn-3 answer, in integer cents: "100到300元" ->
// [10000, 30000]; "200元以下" -> [0, 20000]; "500元以上" -> [50000,
// Infinity]; a bare "300元" reads as an upper bound. Returns null
// when the message carries no budget.
function parseBudget(q) {
  const range = q.match(/(\d+)\s*(?:-|—|~|～|到)\s*(\d+)\s*元/);
  if (range) {
    const a = Number(range[1]) * 100;
    const b = Number(range[2]) * 100;
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }
  const below = q.match(/(\d+)\s*元?\s*(?:以下|以内)/);
  if (below) return { min: 0, max: Number(below[1]) * 100 };
  const above = q.match(/(\d+)\s*元?\s*(?:以上|起|起步)/);
  if (above) return { min: Number(above[1]) * 100, max: Infinity };
  const single = q.match(/(\d+)\s*元/);
  if (single) return { min: 0, max: Number(single[1]) * 100 };
  return null;
}

function fmtBudget(b) {
  if (b.max === Infinity) return `${b.min / 100}元以上`;
  if (b.min === 0) return `${b.max / 100}元以下`;
  return `${b.min / 100}–${b.max / 100}元`;
}

// Stated preferences found in one message, matched against REAL
// catalog values only (distinct meta.genre / category names / cities
// from the published resources) — never a guessed genre or city.
function matchPrefs(q, resources, categories) {
  const found = {};
  for (const g of [
    ...new Set(resources.map((r) => r.meta?.genre).filter(Boolean)),
  ]) {
    if (q.includes(g)) {
      found.genre = g;
      break;
    }
  }
  for (const c of categories) {
    if (q.includes(c.name) || q.includes(c.id)) {
      found.category = c.id;
      found.categoryName = c.name;
      break;
    }
  }
  for (const c of [
    ...new Set(resources.map((r) => r.city).filter(Boolean)),
  ]) {
    if (q.includes(c)) {
      found.city = c;
      break;
    }
  }
  const budget = parseBudget(q);
  if (budget) found.budget = budget;
  return found;
}

// R7-4 proactive recommendation. Returns null when the message is
// not part of the flow, so the caller falls through to the generic
// branches. Asks at most 3 questions (genre/category -> city ->
// budget); once all three are stated, calls the existing
// recommendationsFor() with the stated preferences and clears the
// session. Anonymous callers get the first question only — without a
// login there is no session to keep the answers in.
async function recommendFlow(ctx, q) {
  const { all, get, categories, yuan } = ctx;
  const userId = ctx.session?.id;
  const stored = userId ? prefSessions.get(userId) : null;
  if (!stored && !RECOMMEND_TRIGGER.test(q)) return null;
  if (stored && OTHER_INTENT.test(q) && !RECOMMEND_TRIGGER.test(q)) {
    prefSessions.delete(userId);
    return null;
  }
  const resources = (
    await all("SELECT * FROM resources WHERE status='published'")
  ).map(resourceRow);
  const prefs = { ...(stored || {}), ...matchPrefs(q, resources, categories) };
  if (userId) prefSessions.set(userId, prefs);
  const head = "【本地规则推荐，未接入大模型】\n";
  if (!prefs.genre && !prefs.category) {
    const genres = [
      ...new Set(resources.map((r) => r.meta?.genre).filter(Boolean)),
    ];
    return {
      kind: "recommend",
      answer:
        head +
        `想看什么体裁？比如${genres.slice(0, 3).join("、") || "民族歌舞"}；也可以直接说演出类型，比如${categories
          .slice(0, 4)
          .map((c) => c.name)
          .join("、")}。` +
        (userId ? "" : "\n登录后我会按你说的体裁、城市和预算一路推荐。"),
    };
  }
  if (!prefs.city) {
    const cities = [
      ...new Set(resources.map((r) => r.city).filter(Boolean)),
    ];
    return {
      kind: "recommend",
      answer: head + `想在哪个城市看？比如${cities.slice(0, 5).join("、")}。`,
    };
  }
  if (!prefs.budget) {
    return {
      kind: "recommend",
      answer: head + "预算大概多少？比如 100到300元，或 200元以下。",
    };
  }
  // All three stated: recommend from real data, then forget the
  // preferences — they were session-only by design.
  if (userId) prefSessions.delete(userId);
  const user = await get("SELECT * FROM users WHERE id=?", userId);
  if (!user)
    return { kind: "recommend", answer: "请先登录，再按偏好为你推荐。" };
  const stated = {
    ...user,
    preference: prefs.category ?? user.preference,
    city: prefs.city,
  };
  const recs = await recommendationsFor(stated, resources, ctx);
  const byId = new Map(resources.map((r) => [r.id, r]));
  const matched = recs
    .filter((r) => {
      const full = byId.get(r.resourceId);
      if (!full) return false;
      if (prefs.genre && full.meta?.genre !== prefs.genre) return false;
      if (full.city !== prefs.city) return false;
      if (full.price < prefs.budget.min || full.price > prefs.budget.max)
        return false;
      return true;
    })
    .slice(0, 3);
  const prefText = `体裁：${prefs.genre || prefs.categoryName}；城市：${prefs.city}；预算：${fmtBudget(prefs.budget)}`;
  if (!matched.length)
    return {
      kind: "recommend",
      answer:
        head +
        `按你说的偏好（${prefText}）暂时没有匹配的演出，换个城市或放宽预算试试。`,
    };
  const items = matched.map((r) => ({
    name: r.resource.name,
    city: r.resource.city,
    price: r.resource.price,
    unit: r.resource.unit,
  }));
  const list = matched
    .map(
      (r) =>
        `• ${r.resource.name} — ${r.resource.city} · ${yuan(r.resource.price)}/${r.resource.unit}` +
        (r.reason ? `（${r.reason}）` : ""),
    )
    .join("\n");
  return {
    kind: "recommend",
    answer: head + `按你说的偏好为你推荐（${prefText}）：\n${list}`,
    items,
  };
}

// Shared rule engine: the kind/answer/items chain behind GET
// /api/assistant. Also the fail-open fallback for POST /api/assistant/chat
// when the trial AI backend is unreachable or returns nothing usable.
// q must already be trimmed. Returns {kind, answer, items?}.
export async function answerRules(ctx, q) {
  const { all, get, yuan, ANSWERS, cache, res } = ctx;
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
      // R7-4: a specific order code in the question answers THAT order
      // (read-only over the Wave 4 #13 state machine); without a code
      // the grouped summary below still reads the real orders.
      prefSessions.delete(ctx.session.id);
      // Codes are GY + digits + hex: live codes are GY + Date.now()
      // + 4 hex chars (orders.mjs), seeded codes are GY2026 + 6
      // digits. Match the whole alphanumeric run — a digits-only
      // match truncates at the first hex letter (a-f).
      const codeMatch = s.match(/gy[0-9a-z]+/);
      if (codeMatch) {
        const code = codeMatch[0].toUpperCase();
        const one = orders.find((o) => o.code.toUpperCase() === code);
        if (!one)
          return {
            kind: "myRefund",
            answer:
              "【本地规则客服，未接入大模型】\n没有找到你的订单 " +
              code +
              "，请核对订单号后再问。",
          };
        return {
          kind: "myRefund",
          answer:
            "【本地规则客服，未接入大模型】\n订单 " +
            `${one.code} · ${one.resource_name} · ${ORDER_STATUS_ZH[one.status] || one.status} · ${yuan(one.amount)}：` +
            (REFUND_NEXT[one.status] || "状态未知，请联系客服。"),
        };
      }
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
      // R7-4: status / amount / performance (booking_date) all come
      // from the caller's real orders table rows — never invented.
      prefSessions.delete(ctx.session.id);
      items = orders.slice(0, 5).map((o) => ({
        code: o.code,
        resource_name: o.resource_name,
        status: o.status,
        amount: o.amount,
        booking_date: o.booking_date || null,
      }));
      const list = orders
        .slice(0, 5)
        .map(
          (o) =>
            `${o.code} · ${o.resource_name} · ${ORDER_STATUS_ZH[o.status] || o.status} · ${yuan(o.amount)}` +
            (o.booking_date ? ` · 场次日期 ${String(o.booking_date).slice(0, 10)}` : ""),
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
    // R7-4: real membership, not the old stub — tier per the R3-1
    // definition (live resolution from main-shop spending) and the
    // R3-6 real stored-value balance. A message that is really a
    // recommendation request ("文小惠帮我推荐") goes to the flow
    // below instead of this branch.
    if (/会员|文惠|消费卡|储值/.test(s) && !RECOMMEND_TRIGGER.test(s)) {
      prefSessions.delete(ctx.session.id);
      const resolved = await resolveTier(
        get,
        all,
        ctx.session.id,
        MAIN_SHOP_ID,
      );
      const balRow = await get(
        "SELECT balance_cents FROM stored_value_accounts WHERE user_id=? AND shop_id=1",
        ctx.session.id,
      );
      const tier = resolved.tier;
      const balance = balRow?.balance_cents || 0;
      const next = resolved.next_tier
        ? `下一级${resolved.next_tier.name}还差${yuan(resolved.remaining_cents)}消费`
        : "已是最高等级";
      return {
        kind: "member",
        answer:
          "【本地规则客服，未接入大模型】\n会员信息（主店，实时计算）：\n" +
          `等级：${tier ? tier.name : "普通会员"}（${tier?.benefits || "注册即享"}）\n` +
          `累计消费：${yuan(resolved.spending_cents)}\n` +
          `文惠卡余额：${yuan(balance)}\n` +
          `${next}。`,
      };
    }
  } else if (/我的订单|订单/.test(s)) {
    // Anonymous: never return an empty order list that looks like "no
    // orders" — ask the user to log in first (kind stays myOrders).
    return { kind: "myOrders", answer: "请先登录，再查询你的订单。" };
  } else if (/会员|文惠卡|储值|消费卡/.test(s)) {
    // Anonymous membership / stored-value questions need a login too
    // (the balance and tier belong to one user); the public refund
    // rules below stay anonymous.
    return { kind: "member", answer: "请先登录，再查看你的会员信息。" };
  } else if (/我的退款|我的退换|退换货/.test(s)) {
    return { kind: "myRefund", answer: "请先登录，再查询你的退换货状态。" };
  }
  // R7-4: proactive recommendation (3-turn preference flow). Runs
  // after the logged-in intents above, so a mid-flow "我的订单"
  // still wins and clears the session; before the generic branches,
  // so "帮我推荐" does not fall into the hot list.
  const rec = await recommendFlow(ctx, q);
  if (rec) return rec;
  // R7-3: knowledge graph before the rule fallback — a question
  // naming a show and asking about its performers / other shows /
  // venue is answered from the graph with its sources; anything the
  // graph cannot answer falls through to the generic branches below.
  const kg = await graphAnswer(ctx, q);
  if (kg) return kg;
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
