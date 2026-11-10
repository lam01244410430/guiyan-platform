import { assert } from "../lib/http.mjs";

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


export async function assistant(ctx) {
  const { p, req, url, send, all, yuan, ANSWERS } = ctx;
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
    return true;
  }
  return false;
}
