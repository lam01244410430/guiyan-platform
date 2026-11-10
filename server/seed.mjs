// Guiyan seed data — adapted from the original group demo
// (guiyan-demo/server/demo-data.mjs): same users, resources (22), orders
// (130), demands, comments, messages and settings; same categories and
// scrypt password hashing. Two changes: (1) demo account passwords are
// parameters from the environment, never literals in this repo;
// (2) only the statement-capture form is kept (PostgreSQL path).
// Money is integer cents; times are ISO text. All data is fictional.

import { randomBytes, scryptSync } from "node:crypto";

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
      `${names[i % 12]}${i >= 12 ? "·" + (i + 1) : ""}`,
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
  for (const [k, v] of Object.entries({
    platformName: "桂演",
    alertThreshold: 5,
    reviewEnabled: true,
    privacyMode: true,
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
