// AIGC copy template (Wave 3 #10) — port of zhou assistants.mjs
// copyAnswer() (134-215), verbatim logic. This is a LOCAL TEMPLATE, not
// real AIGC: no model is called, no paid API, no DeepSeek (poster image
// generation is phase 7, deferred for lack of funds).
//
// Hard rule (Q5): a missing date/price/place in the prompt becomes a
// [待确认...] placeholder — NEVER filled in from a database resource,
// even when the topic matches a real resource name. Template copy must
// never imply "these are the real facts of that show".
import { randomInt } from "node:crypto";
import { text } from "../lib/http.mjs";

// Genre templates (R7-8, rows 45/58): template-only copy by show genre.
// No model is called; the genre only picks the intro, audience and
// hashtag of the local template. Unknown genre -> 通用 (general).
// Family prompts keep the existing family intro (checked first).
const GENRE_TEMPLATES = [
  { id: "戏曲", re: /昆曲|京剧|粤剧|桂剧|戏曲|唱腔|梨园/, intro: "一板一眼皆是传承，唱念做打间品味百年戏韵", audience: "喜爱戏曲的观众", tag: "#戏曲" },
  { id: "音乐", re: /交响|音乐会|民乐|演奏|合唱|管弦/, intro: "让旋律漫过山水，在现场感受音乐的呼吸", audience: "喜爱现场音乐的观众", tag: "#音乐会" },
  { id: "歌舞", re: /歌舞|舞蹈|刘三姐|山歌|民族舞/, intro: "歌声起处山水动，舞步落时灯火明", audience: "喜爱歌舞的观众", tag: "#歌舞" },
  { id: "话剧", re: /话剧|舞台剧|音乐剧|儿童剧/, intro: "一幕起落间，走进另一个人生", audience: "喜爱舞台剧的观众", tag: "#话剧" },
  { id: "非遗", re: /非遗|壮锦|铜鼓|绣球|剪纸|手艺/, intro: "指尖上的千年手艺，值得亲眼看一看", audience: "想体验非遗手艺的朋友", tag: "#非遗" },
  { id: "文旅", re: /文旅|旅游|旅行|漓江|景区/, intro: "沿着山水与歌声，为旅途留下一段文化记忆", audience: "想边游边看的朋友", tag: "#文旅" },
];

export function copyAnswer(prompt) {
  const topic =
    prompt.match(/《([^》]+)》/)?.[1] ||
    [
      "昆曲",
      "京剧",
      "交响乐",
      "音乐会",
      "民族歌舞剧",
      "非遗亲子体验",
      "壮锦",
      "铜鼓",
      "山歌",
      "文旅",
      "话剧",
    ].find((t) => prompt.includes(t)) ||
    prompt
      .replace(
        /请|帮我|写一段|写|生成|设计|一段|推送|文案|标题|小红书|公众号|短信|为|给/g,
        "",
      )
      .trim()
      .slice(0, 30) ||
    "广西文化体验";
  const family = /亲子|儿童|家庭|小朋友/.test(prompt),
    classic = /昆曲|京剧|古典|交响|音乐会/.test(prompt),
    travel = /文旅|旅游|旅行|漓江/.test(prompt);
  // Genre template (R7-8): family first, then the genre match, then the
  // existing classic/travel/default intros (unchanged).
  const gtpl = family
    ? null
    : GENRE_TEMPLATES.find((g) => g.re.test(prompt)) || null;
  const genre = family ? "亲子" : gtpl ? gtpl.id : "通用";
  const intro = family
    ? "和孩子一起听、看、动手，让好奇心走近传统文化"
    : gtpl
      ? gtpl.intro
      : classic
        ? "在一段唱腔与一席乐声之间，细品舞台的韵味"
        : travel
          ? "沿着山水与歌声，为旅途留下一段文化记忆"
          : "把日常交给舞台，感受广西文化的鲜活与温度";
  const title = [
    `${topic}，周末见`,
    `相约${topic}，遇见好时光`,
    `把${topic}写进你的行程`,
  ][randomInt(3)];
  const givenDate = prompt.match(/20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?/)?.[0];
  const givenPrice = prompt.match(/(?:¥|￥)?\d+(?:\.\d{1,2})?元/)?.[0];
  const givenVenue = prompt.match(
    /(?:地点|场馆)[:：]\s*([^，。；\n]{2,30})/,
  )?.[1];
  const facts = `时间：${givenDate || "[待确认日期]"}；地点：${givenVenue || "[待确认场馆]"}；价格：${givenPrice || "[待确认价格]"}。`;
  const body = `${intro}。本次推荐${topic}，适合${family ? "家庭共同参与" : gtpl ? gtpl.audience : classic ? "喜爱舞台艺术的观众" : "想体验地方文化的朋友"}。${facts}查看资源详情与适用说明，再选择合适日期提交预约。`;
  const channels = [
    {
      name: "小红书版",
      content: `✨ ${title}\n${intro}！想体验${topic}的朋友可以先收藏。${facts}\n#广西文化 #${topic.replace(/\s/g, "")} ${family ? "#亲子活动" : ""}${gtpl ? " " + gtpl.tag : ""}`,
    },
    {
      name: "公众号版",
      content: `${title}\n${body}\n预约方式：桂演资源详情页；场次、价格及授权以发布前确认结果为准。`,
    },
    {
      name: "短信版",
      content: `【桂演】${topic.slice(0, 18)}活动待上线，场次和价格确认后可在桂演查看预约。[预约入口]`,
    },
  ];
  const sections = {
    title,
    body,
    channels,
    notes: [
      "发布前核实日期、场馆、价格、适用人群及授权。",
      "本地模板草稿，不保证演出事实或生成真实营销权益。",
    ],
  };
  return {
    // `topic` is extra vs zhou (whose copyAnswer returned only
    // {sections, answer}); the handler exposes it so clients need not
    // re-parse the title.
    topic,
    genre,
    sections,
    answer:
      "【本地多渠道模板草稿，未接入大模型】\n活动标题：" +
      title +
      "\n推送文案：" +
      body +
      "\n" +
      channels.map((c) => c.name + "：" + c.content).join("\n") +
      "\n注意事项：" +
      sections.notes.join("；"),
  };
}

export async function aiCopy(ctx) {
  const { p, req, send, session, audit } = ctx;
  if (p !== "/api/ai/copy" || req.method !== "POST") return false;
  // Any logged-in user, like zhou (needUser, not admin-only — Q3):
  // copy drafting touches no sensitive data.
  ctx.needUser();
  const prompt = text(ctx.b?.prompt, "主题", 1000);
  const { topic, genre, sections, answer } = copyAnswer(prompt);
  await audit(session, "AI模拟 copy", prompt.slice(0, 100));
  send({
    topic,
    genre,
    title: sections.title,
    body: sections.body,
    channels: sections.channels,
    notes: sections.notes,
    label: "本地模板",
    mock: true,
    answer,
    sections,
  });
  return true;
}
