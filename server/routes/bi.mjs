// BI dashboard + report export (Roadmap 82 Wave R5-3, 2026-11-14)
// — xlsx rows 39, 60.
//
// GET /api/admin/bi (admin) returns
//   {kpis: {users, orders, revenue_cents, resources, demands,
//           today_orders, today_revenue_cents, paid_rate},
//    top_shows: [{show_id, title, orders, revenue_cents}],
//    top_venues: [{venue_id, name, orders, revenue_cents}],
//    series: [{date, orders, revenue_cents}]} — 30 days, daily.
//
// "Paid" scope (fixed, same as GET /api/admin/stats): status IN
// ('paid','completed') — NOT lib/profiles.mjs PAID_STATUSES (which
// also counts disputed/refund_requested for member spending). The
// five cumulative KPIs come from the SAME query text as adminStats
// (adminStatsTotals() in routes/admin.mjs, shared, never copied) so
// the two endpoints cannot drift apart; the test asserts equality.
// paid_rate = paid orders / ALL orders (0..1, 4 decimals; 0 when
// there are no orders at all). today_* and the 30-day series count
// paid orders only, grouped by Beijing date (orders.created_at,
// same convention as admin-insights seriesFor); days with no paid
// order are filled with 0, so the series always has 30 rows ending
// today (Beijing).
//
// GET /api/admin/bi/export?format=xlsx|csv (admin; default csv).
// CSV follows the Wave 5 BOM pattern (adminOrdersCsv). XLSX is a
// HAND-BUILT real .xlsx — ZIP with STORED (uncompressed) entries +
// minimal OOXML ([Content_Types].xml, _rels/.rels, xl/workbook.xml,
// xl/_rels/workbook.xml.rels, xl/worksheets/sheet1.xml,
// xl/sharedStrings.xml). NO new dependency (no xlsx/pdf library in
// server/package.json — do NOT add one). One sheet "BI": KPI rows
// (label + value) + top_shows rows. Content-Type is the real xlsx
// MIME type; Content-Disposition is an attachment named
// bi-YYYY-MM-DD.xlsx (Beijing date).
//
// PDF honesty boundary (fixed): the server does NOT generate PDF
// files in this wave — there is no CJK font dependency, and a
// hand-rolled PDF cannot reliably render Chinese. PDF goes via
// browser print: the admin BI view has a "打印/导出 PDF" button
// calling window.print() + a print stylesheet (R4-2 paper-ticket
// precedent), labelled honestly "浏览器打印另存为 PDF". There is
// deliberately NO ?format=pdf endpoint (a fake one returning HTML
// would lie about the file type).
//
// Anonymous -> 401, non-admin -> 403 (member-insights pattern, NOT
// the admin.mjs bare-403 assert). Exports audit "导出报表" like
// adminOrdersCsv, so /api/admin/bi/export needs a write transaction
// (see server/index.mjs createRequestHandler).
import { assert } from "../lib/http.mjs";
import { adminStatsTotals } from "./admin.mjs";

const PAID_SQL = "('paid','completed')";

// Beijing "today", same +8h shift as admin-insights todayBeijing().
const todayBeijing = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const shiftDay = (d, n) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

function assertAdminSession(session) {
  assert(session, "请先登录", 401);
  assert(session?.role === "admin", "无权访问管理后台", 403);
}

async function loadBi(ctx) {
  const { get, all } = ctx;
  const today = todayBeijing();
  const start = shiftDay(today, -29);
  // The five cumulative KPIs: the exact adminStatsTotals() query —
  // shared with GET /api/admin/stats, never a second definition.
  const totals = await adminStatsTotals(get);
  const paidRow = await get(
    `SELECT COUNT(*) AS paid_count FROM orders WHERE status IN ${PAID_SQL}`,
  );
  const paidCount = Number(paidRow?.paid_count || 0);
  const todayRow = await get(
    `SELECT COUNT(*) AS today_orders,
            COALESCE(SUM(amount),0) AS today_revenue_cents
     FROM orders WHERE status IN ${PAID_SQL}
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date = ?::date`,
    today,
  );
  const topShows = await all(
    `SELECT s.id AS show_id, s.title AS title, COUNT(*) AS orders,
            COALESCE(SUM(o.amount),0) AS revenue_cents
     FROM shows s JOIN orders o ON o.resource_id=s.resource_id
     WHERE o.status IN ${PAID_SQL}
     GROUP BY s.id, s.title
     ORDER BY revenue_cents DESC, orders DESC LIMIT 10`,
  );
  const topVenues = await all(
    `SELECT v.id AS venue_id, v.name AS name, COUNT(*) AS orders,
            COALESCE(SUM(o.amount),0) AS revenue_cents
     FROM venues v
     JOIN resources r ON r.venue_id=v.id
     JOIN orders o ON o.resource_id=r.id
     WHERE o.status IN ${PAID_SQL}
     GROUP BY v.id, v.name
     ORDER BY revenue_cents DESC, orders DESC LIMIT 10`,
  );
  // 30-day daily series (paid orders only — same scope as the
  // 趋势统计 series in admin-insights); zero-fill every day.
  const dayRows = await all(
    `SELECT (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS date,
            COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue_cents
     FROM orders WHERE status IN ${PAID_SQL}
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date >= ?::date
       AND (created_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date <= ?::date
     GROUP BY 1 ORDER BY 1`,
    start,
    today,
  );
  const byDate = new Map(
    dayRows.map((r) => [
      String(r.date).slice(0, 10),
      { orders: Number(r.orders), revenue_cents: Number(r.revenue_cents) },
    ]),
  );
  const series = [];
  for (let i = 0; i < 30; i++) {
    const date = shiftDay(start, i);
    const found = byDate.get(date);
    series.push({
      date,
      orders: found ? found.orders : 0,
      revenue_cents: found ? found.revenue_cents : 0,
    });
  }
  const orders = Number(totals.orders);
  return {
    kpis: {
      users: Number(totals.users),
      orders,
      revenue_cents: Number(totals.revenue_cents),
      resources: Number(totals.resources),
      demands: Number(totals.demands),
      today_orders: Number(todayRow?.today_orders || 0),
      today_revenue_cents: Number(todayRow?.today_revenue_cents || 0),
      paid_rate: orders === 0 ? 0 : Math.round((paidCount / orders) * 10000) / 10000,
    },
    top_shows: topShows.map((r) => ({
      show_id: r.show_id,
      title: r.title,
      orders: Number(r.orders),
      revenue_cents: Number(r.revenue_cents),
    })),
    top_venues: topVenues.map((r) => ({
      venue_id: r.venue_id,
      name: r.name,
      orders: Number(r.orders),
      revenue_cents: Number(r.revenue_cents),
    })),
    series,
  };
}

export async function getBi(ctx) {
  const { req, p, send, session } = ctx;
  if (p !== "/api/admin/bi" || req.method !== "GET") return false;
  assertAdminSession(session);
  send(await loadBi(ctx));
  return true;
}

// --- CSV export (Wave 5 BOM pattern) ---------------------------------

const csvCell = (v) =>
  `"${String(v ?? "")
    .replace(/"/g, '""')
    .replace(/^[=+@-]/, "'$&")}"`;

function buildBiCsv(bi) {
  const k = bi.kpis;
  const rows = [
    ["指标", "数值"],
    ["用户数", k.users],
    ["订单数", k.orders],
    ["收入（分）", k.revenue_cents],
    ["资源数", k.resources],
    ["需求数", k.demands],
    ["今日订单", k.today_orders],
    ["今日收入（分）", k.today_revenue_cents],
    ["已付订单占比", k.paid_rate],
    [],
    ["热门演出", "订单数", "收入（分）"],
    ...bi.top_shows.map((s) => [s.title, s.orders, s.revenue_cents]),
    [],
    ["热门场馆", "订单数", "收入（分）"],
    ...bi.top_venues.map((v) => [v.name, v.orders, v.revenue_cents]),
  ];
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// --- XLSX export (hand-built, ZIP STORED + minimal OOXML) -------------

// CRC-32 (IEEE 802.3), the same table every zip tool uses.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Minimal zip writer: STORED entries only (method 0), so a reader
// never needs inflate — the test unzips with node:zlib/node:fs only.
function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: STORED
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: STORED
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // central disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([...locals, ...centrals, end]);
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// One sheet "BI": KPI rows (label + value) + top_shows rows. Labels
// go through sharedStrings.xml (the OOXML way); numbers are inline
// numeric cells. Rows are arrays of {s: string} | {n: number} |
// null (empty row).
function buildBiXlsx(bi) {
  const k = bi.kpis;
  const strings = [];
  const stringIdx = new Map();
  const str = (s) => {
    if (!stringIdx.has(s)) {
      stringIdx.set(s, strings.length);
      strings.push(s);
    }
    return stringIdx.get(s);
  };
  const rows = [
    [{ s: "指标" }, { s: "数值" }],
    [{ s: "用户数" }, { n: k.users }],
    [{ s: "订单数" }, { n: k.orders }],
    [{ s: "收入（分）" }, { n: k.revenue_cents }],
    [{ s: "资源数" }, { n: k.resources }],
    [{ s: "需求数" }, { n: k.demands }],
    [{ s: "今日订单" }, { n: k.today_orders }],
    [{ s: "今日收入（分）" }, { n: k.today_revenue_cents }],
    [{ s: "已付订单占比" }, { n: k.paid_rate }],
    [],
    [{ s: "热门演出" }, { s: "订单数" }, { s: "收入（分）" }],
    ...bi.top_shows.map((s) => [{ s: s.title }, { n: s.orders }, { n: s.revenue_cents }]),
  ];
  const sheetRows = rows
    .map((cells, i) => {
      const inner = cells
        .map((c, j) => {
          const ref = colLetter(j + 1) + (i + 1);
          if (c.s !== undefined)
            return `<c r="${ref}" t="s"><v>${str(c.s)}</v></c>`;
          return `<c r="${ref}"><v>${c.n}</v></c>`;
        })
        .join("");
      return `<row r="${i + 1}">${inner}</row>`;
    })
    .join("");
  const lastCol = colLetter(3);
  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${rows.length}"/>` +
    `<cols><col min="1" max="1" width="18"/><col min="2" max="2" width="16"/><col min="3" max="3" width="18"/></cols>` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;
  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join("") +
    `</sst>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="BI" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedXml, "utf8") },
  ]);
}

export async function exportBi(ctx) {
  const { req, p, session, url, audit, res } = ctx;
  if (p !== "/api/admin/bi/export" || req.method !== "GET") return false;
  assertAdminSession(session);
  const format = url.searchParams.get("format") || "csv";
  assert(
    format === "xlsx" || format === "csv",
    "导出格式错误（xlsx 或 csv）",
    400,
  );
  const bi = await loadBi(ctx);
  const date = todayBeijing();
  await audit(session, "导出报表", `BI ${format}`);
  if (format === "xlsx") {
    const buf = buildBiXlsx(bi);
    res.writeHead(200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bi-${date}.xlsx"`,
      "Content-Length": buf.length,
    });
    res.end(buf);
  } else {
    const content = buildBiCsv(bi);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bi-${date}.csv"`,
    });
    res.end(content);
  }
  return true;
}
