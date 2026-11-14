// Guiyan seed data — adapted from the original group demo
// (guiyan-demo/server/demo-data.mjs): same users, resources (22), orders
// (130), demands, comments, messages and settings; same categories and
// scrypt password hashing. Two changes: (1) demo account passwords are
// parameters from the environment, never literals in this repo;
// (2) only the statement-capture form is kept (PostgreSQL path).
// Money is integer cents; times are ISO text. All data is fictional.

import { randomBytes, scryptSync } from "node:crypto";
import { defaultTagRules } from "./lib/profiles.mjs";
import { DEFAULT_MEMBER_INSIGHT_RULES } from "./routes/member-insights.mjs";

export const categories = [
  ["show", "演出剧目"],
  ["venue", "演出场馆"],
  ["artist", "艺人团队"],
  ["equipment", "设备租赁"],
  ["copyright", "版权与IP"],
  ["heritage", "非遗体验"],
  ["creative", "文创衍生"],
  ["digital", "数字演出"],
  ["tourism", "文旅套餐"],
  ["service", "配套服务"],
  ["show-license", "剧目授权"],
].map(([id, name]) => ({ id, name }));
export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function seed(db, passwords) {
  const now = "2026-11-09T08:00:00.000Z";
  const user = db.prepare(
    "INSERT INTO users(username,password,name,role,city,age,gender,channel,preference,verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  user.run(
    "admin",
    hashPassword(passwords.admin),
    "平台管理员",
    "admin",
    "南宁",
    28,
    "未设置",
    "后台",
    "show",
    1,
    now,
  );
  user.run(
    "demo",
    hashPassword(passwords.demo),
    "林同学",
    "user",
    "南宁",
    23,
    "女",
    "H5",
    "show",
    1,
    now,
  );
  user.run(
    "supplier",
    hashPassword(passwords.demo),
    "八桂演艺工作室",
    "supplier",
    "南宁",
    30,
    "未设置",
    "微信小程序",
    "venue",
    1,
    now,
  );
  const names = [
    "陈晓",
    "李文",
    "黄悦",
    "周宁",
    "王璐",
    "韦星",
    "罗清",
    "刘予",
    "陆言",
    "覃可",
    "梁禾",
    "赵欣",
  ];
  const commonHash = hashPassword(passwords.demo);
  for (let i = 0; i < 36; i++)
    user.run(
      `visitor${i + 1}`,
      commonHash,
      `${names[i % 12]}`,
      "user",
      ["南宁", "柳州", "桂林", "北海"][i % 4],
      20 + (i % 35),
      ["女", "男"][i % 2],
      ["H5", "微信小程序", "猫眼", "抖音"][i % 4],
      ["show", "venue", "heritage", "creative"][i % 4],
      i % 3 !== 0 ? 1 : 0,
      now,
    );
  const rows = [
    [
      "广西文化艺术中心",
      "venue",
      "南宁",
      1200000,
      "天",
      "现代化多功能剧场，配备专业灯光音响、后台化妆间与观众服务空间，适合歌舞演出、发布会和艺术交流。",
      1600,
      ["大型剧场", "可视化档期"],
      {
        address: "南宁市良庆区（演示地址）",
        facilities: ["专业音响", "舞台灯光", "化妆间"],
        schedule: ["2026-11-16", "2026-11-20"],
        seatRows: 20,
        seatCols: 20,
      },
    ],
    [
      "民族歌舞剧《刘三姐》",
      "show",
      "南宁",
      28000,
      "张",
      "以广西山歌与壮族文化为灵感的舞台演出示例，适合家庭观演、团体活动及文旅合作。",
      800,
      ["歌舞剧", "民族文化"],
      {
        duration: 90,
        team: "八桂青年歌舞团",
        genre: "民族歌舞",
        channels: ["抖音", "小红书", "大麦"],
      },
    ],
    [
      "壮乡情·民族歌舞专场",
      "show",
      "柳州",
      19800,
      "张",
      "融合壮族铜鼓、山歌对唱与群舞表演，提供剧目采购与巡演合作方案。",
      600,
      ["巡演合作", "文旅演艺"],
      { duration: 75, team: "壮乡艺术团", genre: "民族歌舞" },
    ],
    [
      "南宁小剧场",
      "venue",
      "南宁",
      600000,
      "天",
      "灵活的黑匣子空间，适合话剧、脱口秀、沙龙与小型音乐会。",
      220,
      ["小剧场", "灵活空间"],
      {
        address: "南宁市青秀区（演示地址）",
        facilities: ["可移动座椅", "基础灯光", "投影"],
        schedule: [],
        seatRows: 11,
        seatCols: 20,
      },
    ],
    [
      "青年山歌演唱组合",
      "artist",
      "桂林",
      360000,
      "场",
      "四人演唱组合，擅长山歌对唱、民族音乐改编；可提供主持及定制节目。",
      0,
      ["民族音乐", "可定制"],
      {
        experience: "校园艺术节、城市文化周演出（模拟履历）",
        agency: "八桂演艺工作室",
        process: "沟通需求→确认档期→签订演示协议",
      },
    ],
    [
      "专业舞台灯光组合",
      "equipment",
      "南宁",
      150000,
      "天",
      "含摇头灯、染色灯与控台的灯光租赁方案，可调整灯位与色彩查看舞台布置模拟。",
      0,
      ["灯光设备", "含技术服务"],
      {
        model: "GY-LIGHT-12",
        deposit: 500000,
        usage: "室内舞台，12组灯具",
        preview: true,
      },
    ],
    [
      "移动音响与无线话筒套装",
      "equipment",
      "北海",
      80000,
      "天",
      "适合小型户外演出和活动，包含音响、调音台、无线话筒及安装服务。",
      0,
      ["音响设备", "户外活动"],
      { model: "GY-AUDIO-4", deposit: 200000, usage: "4组音箱、4支话筒" },
    ],
    [
      "刘三姐主题IP授权",
      "copyright",
      "南宁",
      800000,
      "次",
      "原创演艺视觉示例的商业使用授权流程演示，明确地域、期限和使用范围。",
      0,
      ["IP授权", "电子协议"],
      {
        scope: "活动宣传、线下展示",
        term: "1年",
        territory: "广西",
        rights: "本条为模拟版权资源，无真实授权效力",
        certificate: "DEMO-IP-2026-001",
      },
    ],
    [
      "花山岩画主题舞美设计",
      "copyright",
      "崇左",
      360000,
      "次",
      "以地方文化为灵感的舞美设计资源，支持授权申请、合同查看与权益交付演示。",
      0,
      ["舞美设计", "本土文化"],
      {
        scope: "单场舞台演出",
        term: "6个月",
        territory: "国内",
        rights: "模拟资源，无真实授权效力",
        certificate: "DEMO-IP-2026-002",
      },
    ],
    [
      "壮锦手作与山歌体验",
      "heritage",
      "南宁",
      16800,
      "人",
      "体验壮锦纹样创作与山歌互动，适合亲子、研学和团队文化活动。",
      30,
      ["非遗体验", "亲子研学"],
      { duration: 120, process: "预约→到场体验→作品带走" },
    ],
    [
      "咸水歌文化体验",
      "heritage",
      "北海",
      12800,
      "人",
      "聆听地方歌谣，参与互动演唱，了解沿海地区民俗文化。",
      20,
      ["地方特色", "民俗演出"],
      { duration: 90 },
    ],
    [
      "壮锦纹样帆布袋",
      "creative",
      "南宁",
      6800,
      "件",
      "采用广西传统纹样灵感的文创示例，可查看规格、库存与模拟物流。",
      0,
      ["实体文创", "礼物"],
      { specification: "米白色 35×40cm", shipping: "模拟快递，不产生实际物流" },
    ],
    [
      "AIGC山歌纪念海报定制",
      "creative",
      "桂林",
      2900,
      "份",
      "选择姓名和祝福主题生成文字排版海报方案；内容为本地模板组合，不调用生成模型。",
      0,
      ["数字文创", "定制"],
      { specification: "电子版排版方案", delivery: "站内消息" },
    ],
    [
      "云演播·壮乡舞台精选",
      "digital",
      "全区",
      3900,
      "次",
      "数字剧目的点播权益演示，模拟播放进度与权益领取，不提供真实版权视频。",
      0,
      ["云演播", "单次点播"],
      {
        duration: 45,
        rights: "演示点播权限，附线下观演优惠券（模拟）",
        playback: "仅模拟进度，无真实视频流",
      },
    ],
    [
      "VR山歌剧场体验",
      "digital",
      "桂林",
      5900,
      "次",
      "交互式舞台视角预览与预约权益演示，不包含真实VR影片。",
      0,
      ["沉浸式", "权益绑定"],
      { duration: 30, rights: "模拟VR体验券" },
    ],
    [
      "演艺＋漓江文旅套餐",
      "tourism",
      "桂林",
      39800,
      "人",
      "包含示例演出观演与景区体验的组合套餐，支持定制需求和模拟下单。",
      80,
      ["演出＋景区", "组合套餐"],
      { includes: ["演出票", "景区体验券"], partner: "一键游渠道（模拟）" },
    ],
    [
      "滨海音乐会与酒店套餐",
      "tourism",
      "北海",
      56800,
      "人",
      "观演与住宿的组合产品示例，适合周末短途出游。",
      40,
      ["音乐会", "酒店套餐"],
      { includes: ["音乐会门票", "酒店1晚"] },
    ],
    [
      "演出报批咨询对接",
      "service",
      "南宁",
      50000,
      "次",
      "收集演出类型、场次和主体资料，演示服务机构咨询与材料提交流程。",
      0,
      ["报批咨询", "机构对接"],
      { kind: "演出报批", process: "咨询→材料清单→机构反馈（模拟）" },
    ],
    [
      "东盟演艺合作咨询",
      "service",
      "南宁",
      80000,
      "次",
      "演示跨境演艺合作需求登记、资源匹配与服务机构对接。",
      0,
      ["东盟合作", "跨境服务"],
      { kind: "跨境合作", process: "意向登记→匹配机构→沟通（模拟）" },
    ],
    [
      "文旅活动保险咨询",
      "service",
      "柳州",
      10000,
      "次",
      "演示活动保险需求提交与机构对接，不提供真实承保或保险交易。",
      0,
      ["保险咨询", "服务对接"],
      { kind: "保险咨询" },
    ],
    [
      "演艺市场趋势报告",
      "service",
      "全区",
      9900,
      "份",
      "基于本平台模拟交易数据整理的演艺市场分析报告示例。",
      0,
      ["数据产品", "趋势分析"],
      { kind: "市场报告" },
    ],
    [
      "舞台技术人才与课程",
      "service",
      "南宁",
      19900,
      "人",
      "演示行业人才展示、招聘意向与灯光基础课程预约，不提供实际资质认证。",
      30,
      ["人才服务", "在线课程"],
      { kind: "人才课程" },
    ],
  ];
  const insert = db.prepare(
    "INSERT INTO resources(name,category,city,price,unit,description,image,capacity,stock,tags,meta,owner_id,views,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  rows.forEach(
    (
      [name, category, city, price, unit, description, capacity, tags, meta],
      i,
    ) =>
      insert.run(
        name,
        category,
        city,
        price,
        unit,
        description,
        category === "venue" ? "/images/venue.png" : "/images/performance.png",
        capacity,
        i === 11 ? 2 : 100,
        JSON.stringify(tags),
        JSON.stringify(meta),
        3,
        120 + i * 37,
        now,
      ),
  );
  const order = db.prepare(
    "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,escrow,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 130; i++) {
    const r = rows[i % rows.length],
      status = [
        "completed",
        "completed",
        "paid",
        "pending",
        "confirmed",
        "cancelled",
      ][i % 6];
    const date = new Date(
      Date.UTC(2026, 9, 11 + (i % 30), 8 + (i % 9), i % 60),
    ).toISOString();
    order.run(
      `GY2026${String(i + 1).padStart(6, "0")}`,
      i < 6 ? 2 : 4 + (i % 36),
      (i % rows.length) + 1,
      1,
      r[3],
      `2026-12-${String(1 + Math.floor(i / rows.length)).padStart(2, "0")}`,
      status,
      ["H5", "微信小程序", "H5", "猫眼", "抖音"][i % 5],
      "演示订单",
      ["completed"].includes(status)
        ? "已结算"
        : status === "paid"
          ? "模拟托管中"
          : "未支付",
      date,
    );
  }
  const demand = db.prepare(
    "INSERT INTO demands(user_id,title,category,budget,city,description,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  demand.run(
    3,
    "寻民族歌舞团队，合作城市文化周",
    "artist",
    2000000,
    "南宁",
    "计划在12月举办城市文化周，寻求30—45分钟民族歌舞节目，欢迎演艺团队沟通。",
    "approved",
    now,
  );
  demand.run(
    2,
    "亲子研学活动，寻找非遗体验资源",
    "heritage",
    500000,
    "桂林",
    "约30名参与者，希望安排半天的手作和民俗体验，需提供讲解服务。",
    "approved",
    now,
  );
  demand.run(
    3,
    "小剧场巡演合作意向",
    "venue",
    1500000,
    "柳州",
    "寻找容纳200人以上的小剧场，档期和合作方式可协商。",
    "pending",
    now,
  );
  db.prepare(
    "INSERT INTO comments(user_id,resource_id,rating,content,status,created_at) VALUES(?,?,?,?,?,?)",
  ).run(2, 2, 5, "舞台很有广西特色，期待更多巡演场次。", "approved", now);
  db.prepare(
    "INSERT INTO comments(user_id,resource_id,rating,content,status,created_at) VALUES(?,?,?,?,?,?)",
  ).run(4, 1, 4, "场馆设施齐全，希望增加周末档期。", "pending", now);
  db.prepare(
    "INSERT INTO messages(user_id,sender_id,title,content,created_at) VALUES(?,?,?,?,?)",
  ).run(
    2,
    1,
    "欢迎来到桂演",
    "这是毕业实习演示平台，所有订单、支付、AI输出和对接结果均为模拟。",
    now,
  );
  // ---- Phase 2 — additive seed (2026-11-11) ----
  // Adds 100 extra users + their linked orders/comments/favorites/
  // demands/messages BESIDE the demo data above. Nothing above is
  // changed: admin, demo, supplier and the 36 visitors stay as the
  // fallback demo set, and the 22 resources above (+40 catalog rows)
  // are untouched. All new users share ONE public demo password
  // (same class as demo123/admin123): "guiyan2026" — demo-only,
  // never a real credential.
  // NOTE: the users table has no email/phone column yet (registration
  // in Phase 3 owns that), so each new user's email is the derived
  // address <username>@example.com (fictional, documented here and
  // asserted in tests/seed-integrity.test.mjs); no phone number is
  // invented or stored. All names are fictional Guangxi audience
  // names; dates spread 2026-08-15..2026-11-08, never in the future
  // relative to the seed "now" (2026-11-09). New orders only use the
  // 22 resources above, whose prices are known here, so
  // amount = quantity * resource price always holds.
  const SEED_USER_PASSWORD = "guiyan2026";
  const seedSurnames = [
    ["李", "li"], ["王", "wang"], ["陈", "chen"], ["黄", "huang"],
    ["刘", "liu"], ["韦", "wei"], ["陆", "lu"], ["罗", "luo"],
    ["覃", "qin"], ["梁", "liang"], ["赵", "zhao"], ["周", "zhou"],
    ["吴", "wu"], ["莫", "mo"], ["农", "nong"], ["蒙", "meng"],
    ["岑", "cen"], ["甘", "gan"], ["潘", "pan"], ["何", "he"],
  ];
  const seedGivenFirst = [
    ["晓", "xiao"], ["文", "wen"], ["悦", "yue"], ["宁", "ning"],
    ["璐", "lu"], ["星", "xing"], ["清", "qing"], ["予", "yu"],
    ["言", "yan"], ["可", "ke"], ["禾", "he"], ["欣", "xin"],
    ["伟", "wei"], ["敏", "min"], ["杰", "jie"], ["静", "jing"],
    ["强", "qiang"], ["丽", "li"], ["军", "jun"], ["芳", "fang"],
  ];
  const seedGivenSecond = [
    ["明", "ming"], ["华", "hua"], ["峰", "feng"], ["雪", "xue"], ["阳", "yang"],
  ];
  const seedCities = ["南宁", "柳州", "桂林", "北海", "梧州", "玉林", "百色", "钦州", "贵港", "崇左"];
  const seedUserHash = hashPassword(SEED_USER_PASSWORD);
  const seedUserCreated = (i) => {
    const base = Date.UTC(2026, 7, 15, 8, 0, 0) + Math.floor((i * 85) / 99) * 86400000 + (i % 9) * 3600000;
    return new Date(base).toISOString();
  };
  for (let i = 0; i < 100; i++) {
    const [surname, surnamePy] = seedSurnames[i % 20];
    const [given1, given1Py] = seedGivenFirst[i % 20];
    const [given2, given2Py] = seedGivenSecond[Math.floor(i / 20)];
    const username = `${surnamePy}${given1Py}${given2Py}${String(i + 1).padStart(2, "0")}`;
    user.run(
      username,
      seedUserHash,
      `${surname}${given1}${given2}`,
      "user",
      seedCities[i % 10],
      19 + ((i * 7) % 42),
      i % 2 ? "男" : "女",
      ["H5", "微信小程序", "猫眼", "抖音"][i % 4],
      categories[i % 10].id,
      i % 3 !== 0 ? 1 : 0,
      seedUserCreated(i),
    );
    // New users occupy ids 40..139 (demo users are 1..39, insert order).
  }
  // Orders: 0 for every 10th new user, else 1–3 (resources 1..22 only).
  const seedOrder = db.prepare(
    "INSERT INTO orders(code,user_id,resource_id,quantity,amount,booking_date,status,channel,note,escrow,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  let seedOrderN = 0;
  for (let i = 0; i < 100; i++) {
    if (i % 10 === 9) continue;
    const count = 1 + (i % 3);
    for (let k = 0; k < count; k++) {
      const n = seedOrderN++;
      const resourceId = (n * 7 % 22) + 1;
      const quantity = n % 4 === 0 ? 2 : 1;
      const price = rows[resourceId - 1][3];
      const status = ["completed", "completed", "paid", "pending", "confirmed", "cancelled"][n % 6];
      const created = new Date(
        Math.min(
          Date.parse(seedUserCreated(i)) + (1 + (n % 10)) * 86400000,
          Date.UTC(2026, 10, 9, 8, 0, 0),
        ),
      );
      const booking = new Date(created.getTime() + (7 + (n % 20)) * 86400000);
      seedOrder.run(
        `GY2026${String(200001 + n).padStart(6, "0")}`,
        40 + i,
        resourceId,
        quantity,
        quantity * price,
        booking.toISOString().slice(0, 10),
        status,
        ["H5", "微信小程序", "H5", "猫眼", "抖音"][n % 5],
        "新增种子用户订单",
        status === "completed" ? "已结算" : status === "paid" ? "模拟托管中" : "未支付",
        created.toISOString(),
      );
    }
  }
  // Favorites: 0 for every 5th new user (i%5==4), else 1–2.
  // Resources 1..22 only: FK is checked per statement and the
  // catalog resources 23..62 are inserted AFTER seed, so a favorite
  // pointing at 23..62 would fail first boot.
  const seedFavorite = db.prepare(
    "INSERT INTO favorites(user_id,resource_id) VALUES(?,?)",
  );
  for (let i = 0; i < 100; i++) {
    if (i % 5 === 4) continue;
    const count = 1 + (i % 2);
    for (let k = 0; k < count; k++)
      seedFavorite.run(40 + i, ((i * 7 + k * 13) % 22) + 1);
  }
  // Comments: 1 for i%5<2, plus a 2nd for i%10==0.
  const seedCommentTexts = [
    "演出很有广西特色，舞美和音乐都很用心，值得二刷。",
    "场馆交通方便，座位视野不错，期待更多周末场次。",
    "第一次带孩子来看，互动环节很适合亲子，体验很好。",
    "票价合理，线上选座很方便，入场核验也很顺畅。",
    "节目编排紧凑，民族元素融合得自然，推荐给朋友了。",
    "音响效果比预想的好，就是散场时人流稍挤。",
    "文创产品设计很用心，已经买了帆布袋当伴手礼。",
    "线上点播画质清晰，在家也能感受剧场氛围。",
    "希望增加桂林、柳州的巡演场次，不用总跑南宁。",
    "整体体验不错，客服回复及时，下次还会再来。",
  ];
  const seedComment = db.prepare(
    "INSERT INTO comments(user_id,resource_id,rating,content,status,created_at) VALUES(?,?,?,?,?,?)",
  );
  for (let i = 0; i < 100; i++) {
    if (i % 5 >= 2) continue;
    const count = i % 10 === 0 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const created = new Date(
        Math.min(
          Date.parse(seedUserCreated(i)) + (2 + ((i + k) % 20)) * 86400000,
          Date.UTC(2026, 10, 9, 8, 0, 0),
        ),
      );
      seedComment.run(
        40 + i,
        ((i * 11 + k * 17) % 22) + 1, // resources 1..22 only (see favorites note on FK timing)
        [5, 4, 5, 3, 4, 2, 5, 4, 3, 5][i % 10],
        seedCommentTexts[(i + k) % 10],
        i % 4 === 0 ? "pending" : "approved",
        created.toISOString(),
      );
    }
  }
  // Demands: 1 for i%4==0.
  const seedDemandTitles = [
    ["寻民族歌舞团队，合作社区文化活动", "artist", 600000, "希望30分钟左右的民族歌舞节目，适合社区广场演出。"],
    ["小剧场档期咨询，计划举办青年戏剧展", "venue", 900000, "需要容纳150—250人的小剧场，档期在12月，周末优先。"],
    ["非遗手作体验课，研学团定制", "heritage", 300000, "约40名学生，半天手作体验，需要讲解与材料包。"],
    ["文创伴手礼批量采购", "creative", 120000, "企业年会伴手礼，200份左右，带广西纹样元素。"],
  ];
  for (let i = 0; i < 100; i++) {
    if (i % 4 !== 0) continue;
    const [title, category, budget, description] = seedDemandTitles[(i / 4) % 4];
    demand.run(
      40 + i,
      title,
      category,
      budget,
      seedCities[i % 10],
      description,
      i % 8 === 0 ? "approved" : "pending",
      new Date(
        Math.min(
          Date.parse(seedUserCreated(i)) + (1 + (i % 12)) * 86400000,
          Date.UTC(2026, 10, 9, 8, 0, 0),
        ),
      ).toISOString(),
    );
  }
  // Messages: 1 for i%10<3; even i: admin -> user, odd i: user -> admin.
  const seedMessage = db.prepare(
    "INSERT INTO messages(user_id,sender_id,title,content,created_at) VALUES(?,?,?,?,?)",
  );
  const seedMessageTexts = [
    ["订单提醒", "您有一笔新增种子订单已生成，可在“我的订单”中查看详情（演示数据）。"],
    ["欢迎来到桂演", "欢迎加入桂演，这里汇集广西演出剧目、场馆与非遗体验，祝观演愉快。"],
    ["活动推荐", "本周末南宁有多场民族歌舞演出，热门场次余票不多，可提前选座。"],
  ];
  for (let i = 0; i < 100; i++) {
    if (i % 10 >= 3) continue;
    const [title, content] = seedMessageTexts[i % 3];
    const created = new Date(
      Math.min(
        Date.parse(seedUserCreated(i)) + (1 + (i % 7)) * 86400000,
        Date.UTC(2026, 10, 9, 8, 0, 0),
      ),
    ).toISOString();
    if (i % 2 === 0) seedMessage.run(40 + i, 1, title, content, created);
    else seedMessage.run(1, 40 + i, title, content, created);
  }
  for (const [k, v] of Object.entries({
    platformName: "桂演",
    alertThreshold: 5,
    reviewEnabled: true,
    privacyMode: true,
    // Wave 3 #9: default auto-tag rules (money in 分). Fresh databases get
    // them from the seed; existing ones get them from the postgres.mjs
    // boot backfill — both write the same JSON from lib/profiles.mjs.
    tagRules: defaultTagRules,
    // R5-2: default member-insight rules (same seed + backfill pair).
    memberInsightRules: DEFAULT_MEMBER_INSIGHT_RULES,
    // R7-1: 文小惠 IP config frame — empty = unset (no design has
    // arrived from Lam/Group; GET /api/ip returns {} until an admin
    // sets these — never invented values).
    ip_name: "",
    ip_avatar_url: "",
    ip_greeting: "",
  }))
    db.prepare("INSERT INTO settings VALUES(?,?)").run(k, JSON.stringify(v));
  db.prepare(
    "INSERT INTO audit_logs(user_id,action,detail,created_at) VALUES(?,?,?,?)",
  ).run(1, "初始化演示数据", "生成虚构用户、资源及订单", now);
}

// Capture the seed inserts as [sql, params] pairs (PostgreSQL path).
// Demo account passwords come ONLY from the environment (DEMO_PASSWORD /
// ADMIN_PASSWORD); they are never written into this repo. Seed only runs on
// first boot, so set the variables BEFORE the first boot.
export function seedStatements(passwords) {
  if (!passwords?.demo || !passwords?.admin)
    throw new Error(
      "DEMO_PASSWORD and ADMIN_PASSWORD are required to seed demo users (set them before first boot)",
    );
  const statements = [];
  seed(
    {
      prepare: (sql) => ({
        run: (...params) => statements.push([sql, params]),
      }),
    },
    passwords,
  );
  return statements;
}
