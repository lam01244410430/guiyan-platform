// Voice ticket purchase + elderly-friendly + dialect frame (Roadmap 82
// Wave R7-7, xlsx rows 56/57/44, 2026-11-14).
//
// Rule-based voice-command parser over plain text. The text normally
// comes from the R7-2 speech-to-text input (browser Web Speech on H5);
// this endpoint takes plain text, so it works on typed text too — that
// is how it is tested. No new paid model, no recognition service: the
// parser only reads what the caller already transcribed.
//
// POST /api/voice-order {text, dialect?, large_text?}
// -> parses quantity + show + date (+ optional time) and creates a
// DRAFT order (status pending, NOT paid). Payment happens only
// after the user manually confirms, through the existing
// simulated-payment flow (POST /api/orders/:id/confirm, then
// /pay — "模拟支付，未扣款"; no real money moves).
// -> parse failure / show not found / no on-sale performance that
// day / insufficient stock -> a clear 400/409, never a guessed
// performance. No order row is written on any of those paths
// (all validation runs before the order write, OTP lesson).
//
// GET /api/voice/dialects — the dialect FRAME (row 44): the list of
// dialect choices with a per-dialect placeholder prompt. There is
// no dialect voice data (plan §1.5/§6 R-5), so every entry carries
// recognition: false and the choice affects the placeholder text
// only; it connects to no recognition and promises no accuracy.
//
// Seats (R2-5): a voice order does NOT pick seats — guessing seats
// would be wrong. The draft holds no seats; the user picks them in the
// confirm step (POST /api/orders/:id/seats), inside the <=3-step
// elderly-friendly flow: pick show -> confirm -> payment confirmation.
//
// Large-text mode is a display preference only: the client stores it
// locally (H5 localStorage / mini-program storage key
// `guiyan-large-text`, default off) and the server accepts — and
// ignores — a `large_text` flag on this endpoint. It never affects
// parsing, pricing or stock.
import { assert, text} from "../lib/http.mjs";
import { createOrder} from "./orders.mjs";

// Dialect frame (row 44): placeholder text only, no recognition.
// `recognition: false` on every entry is the honesty boundary —
// do not flip one to true without a real dialect recogniser.
export const VOICE_DIALECTS = [
{
code: "putonghua",
name: "普通话",
recognition: false,
placeholder: "试试说：“买 2 张刘三姐今晚的票”",
},
{
code: "yue",
name: "粤语",
recognition: false,
placeholder:
"【粤语】试试说：“买 2 张刘三姐今晚的票”（方言识别未接入，请用普通话说出）",
},
{
code: "guangxi",
name: "广西白话",
recognition: false,
placeholder:
"【广西白话】试试说：“买 2 张刘三姐今晚的票”（方言识别未接入，请用普通话说出）",
},
{
code: "guiliu",
name: "桂柳话",
recognition: false,
placeholder:
"【桂柳话】试试说：“买 2 张刘三姐今晚的票”（方言识别未接入，请用普通话说出）",
},
];

const DIALECT_NOTE =
"方言识别未接入：方言选择只影响提示文案，不接任何识别服务，也不承诺识别准确率；请用普通话说出指令。";

const CN_DIGIT = {
一: 1,
二: 2,
三: 3,
四: 4,
五: 5,
六: 6,
七: 7,
八: 8,
九: 9,
两: 2,
};

// Chinese numeral -> integer, for 1-99 ("一".."九十九", "两", "十").
// Arabic digits are handled by the caller. Returns null when the
// string is not a recognisable numeral in range.
function cnNumber(s) {
if (/^\d+$/.test(s)) {
const n = parseInt(s, 10);
return Number.isSafeInteger(n)? n: null;
}
if (!/^[一二三四五六七八九十两]+$/.test(s)) return null;
if (s === "十") return 10;
if (s === "两") return 2;
const ten = s.indexOf("十");
if (ten === -1) {
// Single digit, or a run like "二二" (invalid).
return s.length === 1? CN_DIGIT[s]: null;
}
const before = s.slice(0, ten);
const after = s.slice(ten + 1);
const tens = before === ""? 1: CN_DIGIT[before];
const ones = after === ""? 0: CN_DIGIT[after];
if (tens === undefined || ones === undefined) return null;
if (before.length > 1 || after.length > 1) return null;
return tens * 10 + ones;
}

// UTC calendar day (same basis as the server's ISO timestamps):
// "今晚" means tonight on the server day, not a wall-clock guess.
function utcDay(offsetDays) {
const d = new Date(Date.now() + offsetDays * 86400000);
return d.toISOString().slice(0, 10);
}

function addDays(isoDate, n) {
const d = new Date(`${isoDate}T00:00:00Z`);
d.setUTCDate(d.getUTCDate() + n);
return d.toISOString().slice(0, 10);
}

function validDate(y, m, d) {
if (m < 1 || m > 12 || d < 1 || d > 31) return null;
const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso
? iso
: null;
}

// Genre prefixes / trailing words stripped when matching a show title
// against the spoken name: the speaker says "刘三姐", the show may be
// titled "民族歌舞剧《刘三姐》" or "刘三姐专场" — both mean the same
// show, and the match is on the stripped core, never on a guess.
const GENRE_PREFIXES = [
"民族歌舞剧",
"歌舞剧",
"音乐剧",
"话剧",
"舞剧",
"戏剧",
"歌剧",
"音乐会",
"演唱会",
"儿童剧",
];
const TITLE_SUFFIXES = ["专场", "演出", "音乐会", "演唱会"];

function showCores(title) {
const out = new Set();
let base = String(title || "")
.replace(/[《》「」『』]/g, "")
.trim();
if (base) out.add(base);
// Strip one genre prefix, then (independently) one trailing word.
let stripped = base;
for (const p of GENRE_PREFIXES) {
if (stripped.startsWith(p) && stripped.length > p.length) {
stripped = stripped.slice(p.length);
break;
}
}
if (stripped && stripped!== base) out.add(stripped);
for (const core of [...out]) {
for (const s of TITLE_SUFFIXES) {
if (core.endsWith(s) && core.length > s.length + 1)
out.add(core.slice(0, -s.length));
}
}
return [...out].filter((c) => c.length >= 2);
}

function normalize(raw) {
return String(raw)
.toLowerCase()
.replace(/[\s《》「」『』、，。！？；：·\-—_()（）\[\]"“”‘’]/g, "");
}

// Pure parse: text + the approved shows in the DB -> the intent.
// Throws (assert) on any failure; never returns a guessed show,
// performance or date.
export function parseVoiceCommand(rawText, shows) {
const raw = String(rawText || "");
// Explicit dates + clock times are read off the RAW text first
// (normalisation strips "-" and ":"), then the rest is matched on
// the normalised text.
let date = null;
let time = null; // {hour, minute|null}
const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
if (iso) date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
if (!date) {
const md = raw.match(/(\d{1,2})月(\d{1,2})[日号]/);
if (md)
date = validDate(
Number(new Date().toISOString().slice(0, 4)),
Number(md[1]),
Number(md[2]),
);
}
if (!date) {
const dash = raw.match(/(\d{1,2})-(\d{1,2})/);
if (dash)
date = validDate(
Number(new Date().toISOString().slice(0, 4)),
Number(dash[1]),
Number(dash[2]),
);
}
const clock = raw.match(/(\d{1,2})[:：](\d{2})/);
if (clock) {
time = { hour: Number(clock[1]), minute: Number(clock[2])};
} else {
const dot = raw.match(
/([0-9一二三四五六七八九十两]+)点(半|[0-9一二三四五六七八九十两]+分)?/,
);
if (dot) {
const hour = cnNumber(dot[1]);
if (hour!== null && hour >= 0 && hour <= 23) {
let minute = null;
if (dot[2] === "半") minute = 30;
else if (dot[2]) {
const m = cnNumber(dot[2].replace("分", ""));
if (m!== null && m >= 0 && m <= 59) minute = m;
}
time = { hour, minute};
}
}
}

const t = normalize(raw);
// Quantity: "2 张" / "两张" / "一张"; absent -> 1.
let quantity = 1;
const q = t.match(/([0-9一二三四五六七八九十两]+)[张票位]/);
if (q) {
const n = cnNumber(q[1]);
assert(n!== null && n >= 1, "票数须为 1–100 张", 400);
quantity = n;
}
assert(quantity >= 1 && quantity <= 100, "票数须为 1–100 张", 400);

// Date words (checked longest first: 大后天 before 后天).
if (!date) {
if (t.includes("大后天")) date = addDays(utcDay(0), 3);
else if (t.includes("后天")) date = addDays(utcDay(0), 2);
else if (
t.includes("明天") ||
t.includes("明晚") ||
t.includes("明日")
)
date = addDays(utcDay(0), 1);
else if (
t.includes("今天") ||
t.includes("今晚") ||
t.includes("今夜") ||
t.includes("今日")
)
date = utcDay(0);
}
assert(date, "请说明日期，如“今晚”或“明天”", 400);

// Show: the longest stripped core that appears in the text wins;
// a tie between two different shows -> 400 (never guess).
let best = null; // {show, len}
let tied = false;
for (const show of shows || []) {
let longest = 0;
for (const core of showCores(show.title)) {
if (t.includes(normalize(core)) && core.length > longest)
longest = core.length;
}
if (longest === 0) continue;
if (!best || longest > best.len) {
best = { show, len: longest};
tied = false;
} else if (longest === best.len && show.id!== best.show.id) {
tied = true;
}
}
assert(best, "未找到该演出，请说出演出名称", 400);
assert(!tied, "找到多个演出，请说得更具体", 400);
return { quantity, show: best.show, date, time};
}

export async function listVoiceDialects(ctx) {
const { p, req, send} = ctx;
if (p === "/api/voice/dialects" && req.method === "GET") {
send({
dialects: VOICE_DIALECTS,
default: "putonghua",
note: DIALECT_NOTE,
});
return true;
}
return false;
}

export async function voiceOrder(ctx) {
const { p, req, b, send, needUser, all } = ctx;
if (p!== "/api/voice-order" || req.method!== "POST") return false;
const u = needUser();
const rawText = text(b.text, "语音指令", 500);
// Dialect (frame only): an unknown code -> 400; a known code only
// changes the placeholder echoed back, never the parse.
let dialect = VOICE_DIALECTS[0];
if (b.dialect!== undefined && b.dialect!== null && b.dialect!== "") {
const found = VOICE_DIALECTS.find((d) => d.code === b.dialect);
assert(found, "方言选择无效", 400);
dialect = found;
}
// large_text is a display preference only: accepted, ignored, and
// never allowed to change parsing, pricing or stock.
const shows = await all(
"SELECT * FROM shows WHERE status='approved' ORDER BY id ASC",
);
const parsed = parseVoiceCommand(rawText, shows);
const { show} = parsed;

// Performance: on-sale, on the parsed date. Several that day with
// no time given -> 400 (never guess which one); a given time
// narrows it to that hour (and minute, when given).
const perfs = await all(
"SELECT * FROM performances WHERE show_id=? AND status='on_sale' ORDER BY start_at ASC, id ASC",
show.id,
);
let dayPerfs = perfs.filter(
(pf) => String(pf.start_at).slice(0, 10) === parsed.date,
);
assert(dayPerfs.length > 0, `该演出${parsed.date}无在售场次`, 400);
if (parsed.time) {
dayPerfs = dayPerfs.filter((pf) => {
const hh = Number(String(pf.start_at).slice(11, 13));
const mm = Number(String(pf.start_at).slice(14, 16));
return (
hh === parsed.time.hour &&
(parsed.time.minute === null || mm === parsed.time.minute)
);
});
assert(dayPerfs.length > 0, `该演出${parsed.date}无该时间的场次`, 400);
}
assert(
dayPerfs.length === 1,
`当日有多场演出，请说明具体时间（如 19:30）`,
400,
);
const perf = dayPerfs[0];

// Ticket type: the performance's first type is the voice default
// (disclosed in the response — the user can change it at confirm).
const tiers = await all(
"SELECT * FROM ticket_types WHERE performance_id=? ORDER BY id ASC",
perf.id,
);
assert(tiers.length > 0, "该场次暂无票种", 400);
const tier = tiers[0];

// Pickup point: a show with points needs one; the voice default is
// the first point (disclosed — changeable at confirm).
const points = await all(
"SELECT * FROM pickup_points WHERE show_id=? ORDER BY id ASC",
show.id,
);
const pickupPoint = points.length > 0? points[0]: null;

// Create the DRAFT order through the existing order flow, so
// pricing (member tier / flash / coupon — none applied here),
// quota (409 when sold out) and the pending status are exactly the
// same as a manual order. The order is pending and unpaid; only the
// user confirming + paying (existing simulated flow) moves money.
let captured = null;
const ok = await createOrder({
...ctx,
p: "/api/orders",
req: { method: "POST"},
b: {
resourceId: show.resource_id,
quantity: parsed.quantity,
booking_date: parsed.date,
performance_id: perf.id,
ticket_type_id: tier.id,
...(pickupPoint? { pickup_point_id: pickupPoint.id}: {}),
channel: "语音购票",
note: `语音指令：${rawText.slice(0, 200)}`,
},
send: (payload) => {
captured = payload;
},
});
assert(ok && captured && captured.ok, "语音下单失败", 400);
send({
ok: true,
source: "voice",
dialect: dialect.code,
placeholder: dialect.placeholder,
parsed: {
quantity: parsed.quantity,
show_id: show.id,
show_title: show.title,
date: parsed.date,
performance_id: perf.id,
start_at: perf.start_at,
ticket_type_id: tier.id,
ticket_type_name: tier.name,
unit_price_cents: tier.price_cents,
...(pickupPoint
? { pickup_point_id: pickupPoint.id, pickup_point_name: pickupPoint.name}
: {}),
},
order: {
id: captured.id,
code: captured.code,
amount: captured.amount,
status: captured.status,
channel: "语音购票",
},
note: "草稿订单已创建（待确认）。请确认后手动支付——模拟支付，未扣款。",
});
return true;
}
