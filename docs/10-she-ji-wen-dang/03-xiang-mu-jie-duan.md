# 项目阶段

> 分阶段部署策略原文见 `06-ce-shi-yu-bu-shu.md` §1.4。本章写"本项目的阶段划分与现状"。

## 三阶段建设规划（原文）

对应三阶段建设规划，系统部署采用分阶段推进策略。

**第一阶段部署：** 优先部署基础票务业务系统，打通核心业务流程，确保平台基础运营能力上线。采用灰度发布策略，先小范围验证再全量推广。

**第二阶段部署：** 在第一阶段稳定运行基础上，部署AI中台与"文小惠"数字人及相关AI能力。AI能力采用渐进式上线，先核心场景（如智能客服）再扩展场景（如行程规划、语音购票）。

**第三阶段部署：** 基于运营数据滚动迭代，采用持续集成/持续部署（CI/CD）方式，支持小版本快速发布与回滚。扩展业务（如全区资源整合）视评估结果独立部署。

**阶段间衔接：** 各阶段保持架构兼容与数据互通，新阶段能力基于前一阶段的数据与基础设施构建，确保平滑过渡。

## 本项目顺序路线图（Lam 定，2026-11-11）

一次只做一个阶段，做完并验证一个阶段再做下一个；每个阶段一个 commit。
详见 `myown/bao-gia-loi-di.md`（"Lộ trình tuần tự"）。

| 顺序 | 阶段 | 状态（2026-11-11） |
|---|---|---|
| 0 | Admin 改版 | 已做（设计系统与 tokens 已进 React 版） |
| 1 | React + Redis 迁移（parity） | 已做，已 commit `2777747` |
| 2 | 新种子（+100 用户 / +180 订单） | 已做，已 commit `a6b58d1` |
| 3 | 注册 | 已做，已 commit `f9909cd` |
| 4 | 架构文档 | 已做，已 commit `90171d3`（含本设计文档文件夹的初版，见下） |
| 5 | Premium admin dashboard（React） | **待 Lam 批准开始**（复用已保留的 `server/routes/admin-insights.mjs`；修 B-014..B-017） |
| 6 | 其余事项（按报价表 29 模块的优先级 waves） | 待阶段 5 之后；其中 #22（管理端资源管理，admin 从只读变可管理）需 Lam 另行批准 |

注：本设计文档文件夹（`10-she-ji-wen-dang/`）写于 2026-11-11，在阶段 4 的 docs commit（`90171d3`）
之后，未 commit——等 Lam 决定随下一批 commit 一起推，或单独 commit。

## Wave 3 — Thông minh（rule-based，不用 LLM，2026-11-12，未 commit）

来源：`~/workspace/_work/guiyan-wave3-plan.md`（384 行，含 §7 开放问题 Q1–Q13 与建议默认值）；
只抄 zhou（`guiyan-demo/`）的逻辑，不抄其 React/SQLite/种子数据/硬编码 IP。
顺序：#11a 记录真实浏览 → #9 标签规则 → #11b 画像与推荐 → #8 助手 → #10 文案模板。
全程不 commit、不 push、不部署、不动 Neon 生产数据。

### #11a 记录真实浏览（#11 的前置步骤）

- 新增 `POST /api/resources/:id/view`（`server/routes/resources.mjs`）：资源不存在或未上架 → 404；
  `UPDATE resources SET views=views+1`；往 `events` 写一行 `type='view'`，`detail` 为资源 id，
  `user_id` 为登录用户 id，未登录为 NULL。**不 bust 缓存**（Q7 默认值：列表缓存最长旧 300 秒；
  `GET /api/resources/:id` 读实时库，始终准确）。**本 wave 不做防刷**（Q8 默认值：rate limit 是 Wave 5 的 #29）。
- 客户站 `web/assets/js/App.jsx`：打开资源详情（`openDetail`）时 fire-and-forget 调一次
  （`apiPost(...).catch(()=>{})`，不阻塞界面、不弹提示）；每次打开记一次，同一浮层内切标签不再记。
  小程序本 wave 不改（小程序浏览暂未记录，Wave 5 再接）。

### #9 标签与分群（#6 自动标签与分群；分群 segments + notify 不做）

- 新共享模块 `server/lib/profiles.mjs`（#9、#11、#8 共用）：`ruleMatches()`、`defaultTagRules`（4 条，
  金额单位为**分**，与 zhou 一致：高价值 ≥1000000 分、潜力、沉默、非遗浏览未购）、`validateTagRules()`、
  `loadTagRules()`、`computeTags()`、`profileRows()`、`recommendationsFor()`。
- 存储：`settings` 表**已存在**（`server/schema.mjs:12`），无须 migration。`tagRules` 用 guard-key 模式
  backfill（`server/postgres.mjs` 启动时 `INSERT ... ON CONFLICT DO NOTHING`，与 `enrichCatalog` 同一模式），
  并写入 `server/seed.mjs` 的 settings 种子块（新库一开始就有）。
- `GET /api/admin/users` 增加 `tags[]`（读时计算，不存库）与 `?tag=` 服务端过滤；
  `GET /api/admin/tag-rules`、`PATCH /api/admin/tag-rules`（admin only；≤20 条规则、每条 1–6 个条件，
  校验照抄 zhou `index.mjs:1246-1309`；保存后 `bustAnalysis()` + 审计 `更新标签规则`）。
  `server/routes/admin-insights.mjs` 删除硬编码 `tagOf()`，`userSummary` 改按 `tags.includes(...)` 计数。
- Admin：用户表加**标签列** + 标签下拉过滤（客户端过滤，与搜索/排序组合）；新视图**标签规则**
  （表单增删改、启用开关、字段改则重置 op/value 默认值；表单下标注"金额单位为分，¥10,000 = 1000000 分"，
  因 zhou 的 UI 写"单位为元"但规则存分——抄 UI 原样会让管理员输错 100 倍，Q12 默认值： giữ 分 + ghi rõ đơn vị）。
  `view_category` 规则在 #11a 之前无数据可匹配（`view_count=0`），属正常行为，非缺陷。

### #11b 画像与推荐（#5 + #8；快照 snapshot 不做）

> **2026-11-12 09:54 甲方维度更新（Lam 转达，来源 `upload-2.xlsx` Sheet1 第 51 行，模块 50：
> “AI个性化推荐 / 用户精准画像：一人一档画像中心，覆盖基础属性/消费能力/观演偏好/行为偏好/渠道来源”）——
> portrait 按以下 5 组原样重做；旧版扁平字段（`pricePreference`/`priceBand`/`purchaseWindow`/`repeat`/
> `balance`/`payment`/`views`/`favorites` 平铺在 `portrait` 下）已删除，不保留双 shape（旧版未 commit、未部署，
> 无兼容义务）。`metrics`/`tags`/`suggestion` 与推荐评分公式不变。
>
> - **基础属性**：年龄（`users.age`）、性别（`users.gender`）、区域（**= `users.city`，Lam 无独立 region 列**，
>   代码注释 + UI 均注明“区域按城市统计”）、活跃城市（已付订单资源城市出现最多；无已付订单则取浏览/收藏最多城市；
>   最后 fallback `users.city`）。
> - **消费能力**：票价偏好（平均每笔已付订单金额，分）+ 票价区间（已付 show 订单最常见的 `priceBand` + 分布）、
>   消费频次（`{paidCount, orderCount}`，不推算“次/月”）、储值情况（**TBD：无储值/文惠卡系统，`balance: null` +
>   `storedValue: "尚未接入"`，不编造余额**）。
> - **观演偏好**：剧种（已付/浏览/收藏资源 `meta.genre` 出现最多；仅 22 个原始资源有 `meta.genre`，40 个目录资源无
>   genre、不参与；无样本 → `"暂无"`）、艺人（`meta.team` 出现最多；无 `meta.team` 时取互动最多的
>   category=`artist` 资源名（B-026 review fix：种子里唯一的艺人资源“青年山歌演唱组合”没有 `meta.team`）；无样本 → `"暂无"`）、场馆（互动最多的
>   category=`venue` 资源名；无 → `"暂无"`）、演出类型（已付 + 浏览 + 收藏中出现最多的 category；平局按用户注册时
>   `users.preference` 取舍）。
> - **行为偏好**：购票时段（最近一次已付订单 `created_at` 的北京时间 HH:MM，**是下单时间，不是演出时间**）、
>   支付方式（`"模拟支付"`）、分享行为（**TBD：无分享记录，`"暂无数据"`，不编造**）、复购情况（已付 ≥2 笔 → 有复购）。
> - **渠道来源**：`users.channel` 经单一映射函数 `mapChannelSource()`（`server/lib/profiles.mjs`，Q13 **提案未定**，
>   Lam 确认后只改这一处）：抖音 → 抖音；猫眼 → 猫眼；微信小程序 → 其他渠道；H5 → 自然流量；其他/空 → 其他渠道。
>
> Response shape：`portrait: {basic: {age, gender, region, activeCity}, spending: {pricePreference, priceBand,
> priceDistribution, frequency, storedValue, balance: null}, showPref: {genre, artist, venue, showType},
> behavior: {purchaseWindow, payment, sharing, repeat}, channel: {source}}`；每个 TBD 字段都有明确占位值
> （`"暂无"` / `"暂无数据"` / `"尚未接入"` / `null`），不留空、不编造。
- `GET /api/profile`（登录本人）：`profileRows()` 取 portrait——票价偏好（平均每笔已付订单金额，分）、
  票价区间（已付 show 订单最常见的 `priceBand` + 分布）、购票时段（最近一次已付订单 `created_at` 的北京时间 HH:MM，
  **是下单时间，不是演出时间**）、复购（已付 ≥2 笔）、`balance: null`（无储值）、
  `payment: "模拟支付"`、建议文案按标签。`days_since_payment` 按 `created_at` 计（无 `paid_at` 字段，定义中已注明）。
- `GET /api/recommendations`（登录；`?userId=` 他人须 admin）：评分照抄 zhou——浏览 +2、收藏 +5、购买 +8
  （仅 `paid/completed/disputed/refund_requested` 的订单）、同类信号封顶 35、偏好 +20、同城 +6；
  按分数降序、id 升序；默认 10 条（`?limit=` 最多 20）；Q9 默认值：除 `{resourceId, score, reason}` 外
  另嵌资源摘要 `{id, name, city, price, unit, category, image}`，免得客户端再请求一次。
  **评分不变，只改 reason 文本**，按画像维度点名：偏好/category 匹配 → “符合你的兴趣偏好（演出类型/观演偏好）”；
  同城 → “与你的所在城市相同（活跃城市/区域）”；同 `meta.genre` → “同剧种‘…’”；同 `meta.team` → “同艺人‘…’”。
- 客户用户面板 `UserDashboard.jsx` 增加**我的画像**（5 组分块，组标题原样：基础属性/消费能力/观演偏好/行为偏好/
  渠道来源；TBD 占位 暂无/暂无数据/尚未接入 原样显示，不隐藏；区域行附注“区域按城市统计”）
  与**为你推荐**（前 5 条，含理由；点卡片打开详情——卡片链接 `index.html?detail=<资源 id>`，
  `App.jsx` 启动、目录合并后按 `APIID2IDX` 打开详情浮层并记一次浏览）。i18n 新 key 须 đủ 3 语言（185 → 213，
  共 28 个新 key：组标题/总标题 7 个 + 字段 key 21 个，`wave3.test.mjs` 断言 213 key × 3 语言）。

### #8 助手：运营 + 客服（#9 + #10 具体功能；不加 LLM）

- `server/routes/admin-insights.mjs` 抽出可导出的 `buildAnalysis(ctx, period)`（返回与 `GET /api/admin/analysis`
  相同的 payload；`adminAnalysis` 仍做 admin 校验 + 缓存 + 发送）。运营分支直接调函数，不走内部 HTTP，不重算。
- 扩展 `answerRules(ctx, q)`（`server/routes/assistant.mjs`），按顺序：① operator（仅 `ctx.operator===true`）——
  报告/销量/用户/场馆/渠道/库存/热销/建议 8 个方向，读 `buildAnalysis` 的真实数，前缀
  `【本地规则分析，未接入大模型】`；② 已登录客服分支——退订按 Lam **真实状态**分组
  （pending 待确认可直接取消、confirmed 待支付可直接取消、paid 已支付可申请退款、completed 已完成不支持在线退款、
  cancelled 已取消、refunded 已退款；**去掉 zhou 的 `refund_requested`/`disputed`**，Lam 没有这两个状态，
  每组最多列 3 个订单号 + 改签提示句）、我的订单（总数 + 最多 5 笔）、会员/文惠卡（明确"尚未接入"）；
  未登录问"我的订单" → 提示先登录（`kind: "myOrders"`，无 `items`）；③ 旧分支（refund/reschedule/heritage/book/hot/hello/fallback）原样保留。
- `POST /api/assistant/chat` 增加 `{kind: "operator"}`：须 admin，否则 **403**（匿名与非 admin 同）；通过后跳过
  trial 后端，直接用规则回答（`source: "rules"`、`mock: true`）并审计 `AI模拟 operator`（审计详情不含用户消息原文）。
  `GET /api/assistant?q=` 保持公开，**不接受** `kind=operator`（Q2 默认值，避免公开端点泄露运营数据）。
- Admin：在**经营分析**视图加"运营助手"卡片（输入框 + 发送，调 `POST /api/assistant/chat`，回答按 `pre-wrap` 显示）。
  客户 widget `AiChat.jsx` 不改逻辑，只在快捷问题 `quicks` 中加"查我的订单"（3 语言）。

### #10 AIGC 文案模板（#11；不是真 AIGC，不调模型、不花钱）

- 新文件 `server/routes/ai-copy.mjs`：`POST /api/ai/copy`（须登录，Q3 默认值：照 zhou，任何已登录用户可用，
  不限 admin）；`copyAnswer(prompt)` 原样移植 zhou `assistants.mjs:134-215`（主题提取 → 3 种开场 → 标题随机 3 选 1，
  Q6 默认值：保留 `randomInt(3)`，测试按集合断言；事实用正则从 prompt 提取）。
- **硬规则**（Q5 默认值）：缺日期/价格/地点 → 占位符 `[待确认日期]` / `[待确认场馆]` / `[待确认价格]`，
  **绝不**从数据库资源里自动补真实日期/价格（模板文案不得冒充真实场次信息）。
- 响应：`{topic, title, body, channels: [小红书版/公众号版/短信版], notes, label: "本地模板", mock: true, answer, sections}`；
  审计 `AI模拟 copy`（prompt 截前 100 字）。Admin 新视图**文案生成**（Q4 默认值）：输入主题 → 3 个渠道卡片
  + 标题 + 正文 + 注意事项，每卡可复制；表单顶部标注"本地模板 · 未接入大模型"。

### 开放问题 Q1–Q12（plan §7）

实现时一律用 plan 的建议默认值（仅为工作默认值，未 commit，Lam 仍可在 commit 前推翻任一默认值）：
Q1 运营助手卡片放在经营分析视图；Q2 GET 不接受 operator；Q3 文案接口面向所有已登录用户；
Q4 文案表单放在 admin；Q5 文案不从 DB 取事实；Q6 标题保留随机；Q7 浏览不 bust 缓存；Q8 本 wave 不做防刷；
Q9 推荐嵌资源摘要；Q10 不做 admin 查看他人画像的接口；Q11 不 commit（本题无意义）；
Q12 规则金额 giữ 分，UI 注明单位 + 示例。

### 不属于 Wave 3

Segments + notify、分群站内通知、画像快照（`profile_snapshots` 表）、#22 管理资源、#25 退款/申诉审批流
（`refund_requested`/`disputed` 状态）、LLM/DeepSeek 真调用、AIGC 真生图（阶段 7，暂缓缺钱）、rate limit（Wave 5）、
小程序改动、数据大屏、真实选座/支付/区块链/KYC。

## Wave 4 — Catalog + giao dịch（2026-11-12）

顺序：#12 → #15 → #13 → #14 → #16/#22（已 duyệt 2026-11-12，做 luôn sau #14）。每 mục một commit riêng，
mỗi commit cần Lam duyệt riêng trước khi đẩy；不改 Neon production，不改 demo data。

### #12 场馆档期 + 座位布局示意（venue availability + seat-map）

- 新接口 `GET /api/resources/:id/availability?date=`（`server/routes/resources.mjs`，按 Lam 的 REST 风格，
  不照抄 zhou 的 `/api/availability?resourceId=`）。公开：已发布资源无需登录；未发布资源仅 admin 可查，
  非 admin 返回 404（不泄露是否存在，与 `GET /api/resources/:id` 只返回已发布行一致）。
- `date` 不传 → 默认当天（北京时间）；格式错误或早于演示基准日（`lib/http.mjs` 的 `date()`，基准 2026-11-09）
  → 400。返回 `{id, date, mode, available, capacity, dates}`。
- `mode`：venue/equipment → `rental`；service → `none`；show/heritage/tourism/digital/artist → `date`；
  其余（copyright/creative）→ `global`。
- `available`：`rental` → 0/1（当天有未取消/未退款的订单则 0，否则 1）；`date` → `stock − 当天已订数量`
  （订单 `status NOT IN ('cancelled','refunded')`，复用 `orders.mjs:33` 的查询模式；Lam 没有 `daily_capacity` 列，
  Q1 默认值：用 `stock` 当日容量，`capacity` 是总容量，不作日容量）；`none` → `null`；`global` → `stock`（忽略日期）。
  `capacity` 返回 `stock`，供前端显示" còn X / Y"。`dates` 列出该资源未取消/未退款订单的
  `{booking_date, status}`，按日期排序，供前端渲染已预约日期。
- 不改表、不做 migration；不缓存（Q16 默认值：新订单必须立即反映在余量里，接口只有两次轻查询）。
- 共享改动（与 #15 共用，做一次）：`web/assets/js/apiClient.js` 合并资源时保留 `meta`
  （`APIRES[idx] = {..., meta: a.meta || {}}`）；之前 API 虽返回 meta，但合并时丢掉了，详情页拿不到。
- 座位布局示意：仅 category `venue`，在详情浮层按 meta 的 `seatRows × seatCols` 渲染圆点
  （广西文化艺术中心 20×20=400、南宁小剧场 11×20=220、目录场馆 10×18=180）；不点击、不选座、
  不显示单座状态。标题 `座位布局示意` + 说明"示意图用于场地介绍，本项目按场地整体预约"。
  meta 没有 `seatRows/seatCols` 的场馆不渲染网格（不编造座位数）。
- 档期显示：在日期选择器下方，mode `date`/`global` 显示" còn X / Y"；mode `rental` 显示
  "ngày này đã có đặt trước / còn trống"；rental 另渲染已预约日期 chips；换日期时重新请求接口。
- i18n：新增 7 个 key（`availLeft` / `availBooked` / `availFree` / `availService` / `seatTitle` / `seatNote` /
  `bookedDates`），中越英三语集合相等，共 221 key（测试 `wave3.test.mjs` 的计数同步更新）。
  接口请求失败时不显示错误（沿用全站离线静默规则，详情页只隐藏档期行）。
- 测试：新文件 `tests/wave4.test.mjs`（node:test，真 PostgreSQL 一次性库，不 mock），#12 共 8 个 API 测试：
  rental 0/1、date 余量 = stock − 已订、service `null`、global = stock、日期错误/过去 → 400、
  未发布 + 非 admin → 404（admin → 200）、`dates` 不含 cancelled/refunded、多单累计。
  UI（座位圆点数、换日期刷新余量）无 jsdom 测试架，只做 build + 浏览器 live 检查。

### 开放问题 Q1/Q15/Q16（plan §7，#12 适用默认值）

Q1 日容量用 `stock`（无 `daily_capacity` 列）；Q15 路由用 Lam 风格 `/api/resources/:id/availability`；
Q16 不缓存。以上均为工作默认值，Lam 可在 commit 前推翻。

### 不属于 #12

真实选座（指定座位、占座、单座状态）、改订单创建逻辑、改 `stock` 扣减规则、前端评价/筛选（#14）、
meta 字段渲染（#15）、缓存档期结果。

### #15 资源 meta 渲染 + 灯位示意 / 数字点播模拟 / 按单查看模拟协议

- meta 渲染：详情浮层（`App.jsx`，views/价格块下方）。meta 已由共享改动带入客户端
  （`apiClient.js` 的 `APIRES[idx].meta`，#12 做一次）；无 meta（离线 fallback 目录）时整个 meta 块隐藏，
  不显示"暂无"。
- 标签表（自 zhou `Resources.jsx:515-544` 移植，按 Lam 真实 key 调整）：duration→时长（分钟）、
  team→演出团队、genre→剧种、experience→演出经历、agency→经纪机构、process→服务流程、address→地址、
  facilities→设施（短列表）、model→型号、deposit→押金（分，模拟）（值按分÷100 显示为元）、
  usage→使用说明、scope→授权范围、term→期限、territory→地域、rights→权益说明、certificate→证书编号、
  specification→规格、shipping/delivery→配送/交付、playback→播放方式、includes→包含内容、partner→合作方、
  kind→服务类型、channels→同步渠道（按普通 meta 列表显示）、serviceNote→说明。
  只渲染 meta 里有值的 key；缺失的 key 隐藏，不编造、不显示"暂无"。不显示：`seatRows`/`seatCols`
  （#12 座位图用）、`schedule`（#12 档期用）、`preview`（布尔标记）。不在标签表里的 key 也不渲染。
- 灯位示意：只 category `equipment`，**全部**设备都显示（Q11 默认值；`preview` 只是一行数据上的标记，
  不是功能开关）。移植 zhou `EquipmentPreview`（`Resources.jsx:280-322`）：旋转按钮（每次 +30°）+
  颜色选择器改舞台颜色 + 6 个固定圆点。标题`舞台灯位示意（模拟数字孪生）`+
  说明"仅演示灯位与颜色变化，不进行真实设备仿真。"——纯前端演示，不调用真实设备。
- 数字点播模拟：只 category `digital`，移植 zhou `DigitalPreview`（`Resources.jsx:323-346`）：封面图 +
  开始模拟点播/暂停模拟播放按钮 + 进度条（每 500ms +1%，100→0），**无 `<video>` 标签**。
  标注"模拟播放进度与点播权益，无真实视频流。"
- 按单查看模拟协议（具体功能 #12，不是 Wave 4 #12）：新接口 `GET /api/orders/:id/contract`
  （`server/routes/orders.mjs`，与 #13 共用文件，改动独立划界）。需登录；仅订单主人或 admin；
  订单不存在 → 404。内容当场由订单 + meta 生成，不写库、不加列（移植 zhou `index.mjs:910-928`）：
  首行"【毕业实习演示文件，无真实合同效力】"；订单号、资源名、预约日期、金额（元 + 模拟）、
  授权范围（`meta.scope` 或"订单约定的资源服务"）、期限（`meta.term` 或"预约日期当日"）、
  区域（`meta.territory` 或"订单约定地点"）、设备押金（`meta.deposit` 或 0，按分÷100 显示为元，
  "仅展示，不收取"）、服务流程（预约→审核→模拟支付→服务完成→模拟结算），
  末行"纠纷可通过订单申诉提交，资金状态仅为本地模拟。"
- UI：用户端订单卡（`UserDashboard.jsx`）与 admin 订单表（`AdminDashboard.jsx`）每单一个"协议 / 权益"按钮，
  打开 modal `<pre>` 显示协议内容 + "下载模拟协议"按钮，下载文件名为 `<order-code>-模拟协议.txt`。
- i18n：新增 34 个 key（meta 标签 24 个 + meta 区块标题 1 个 + 灯位示意 4 个 + 数字点播 3 个 + 协议 2 个），
  中越英三语集合相等，共 255 key（测试 `wave3.test.mjs` 的计数同步更新）。
- 测试：`tests/wave4.test.mjs` 追加 5 个 API 测试：主人 200（含模拟首行 + 授权范围/期限行）、他人 403、
  admin 200、订单不存在 404、`GET /api/resources/:id` 返回 meta。UI（meta 行数、灯位旋转/变色、进度条、
  协议 modal + 下载）无 jsdom 测试架，只做 build + 浏览器 live 检查。

### 开放问题 Q10/Q11/Q12（plan §7，#15 适用默认值）

Q10 缺失字段隐藏（不显示暂无）；channels 按普通 meta 列表显示。Q11 灯位示意对全部 equipment 显示。
Q12 协议按钮用户端 + admin 订单表都有；下载文件 `<order-code>-模拟协议.txt`。以上均为工作默认值，
Lam 可在 commit 前推翻。

### 不属于 #15

真实视频流、真实设备仿真/数字孪生 3D、协议文件落库、选座（#12 只做示意）、退款/申诉审批流（#13）、
搜索/通知（#14）。

### #13 退款/申诉审批流（refund/dispute flow）

- **行为变化（Q2 默认值，本项的目的）：** `refund` 不再 `paid → refunded` 直接完成，改为
  `paid → refund_requested` 等待管理员审批；只有管理员批准后订单才变为 `refunded`。旧测试中
  没有断言 `refund → refunded` 的，因此无需改写旧测试；新流程由新增的 Wave 4 #13 测试覆盖，
  其余断言不变。
- 状态机（`server/routes/orders.mjs` 的 `transitions` 表，保留原有 5 项，新增 6 项，方法仍为 POST，
  不改 zhou 的 PATCH）：`refund: ["paid", "refund_requested"]`；
  `approveRefund: [["refund_requested", "disputed"], "refunded"]`；
  `rejectRefund: ["refund_requested", "paid"]`；`dispute: ["paid", "disputed"]`；
  `rejectDispute: ["disputed", "paid"]`；`resolve: ["disputed", "completed"]`。路由正则同步新增
  5 个动作（`refund` 已有）。
- 权限两层（替换原来只允许订单主人的 `:103` 断言；旧动作不放宽）：
  层 1——订单主人或 admin 才能调用，否则 403；层 2——4 个决定（`approveRefund`/`resolve`/
  `rejectRefund`/`rejectDispute`）仅 admin；`refund`/`dispute` 由主人（或 admin）调用。
  Admin 调用旧动作（`confirm`/`pay`/`complete`/`cancel`）处理他人订单时仍 403，与改动前一致。
- 新列 `refund_decision`：`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_decision TEXT DEFAULT ''`
  （`server/postgres.mjs`，沿用已有列的追加模式；无 migration 目录）。不加 `paid_at`/`refunded_at`
  （Q4 默认值）；`created_at` + 状态已够用。
- 更新语句：批准时 `refund_decision` 为"审核通过，已模拟退款"；拒绝时把管理员填写的 `reason`
  存入 `refund_decision`，`refund_reason` 仍保留用户申请退款的理由。`rejectRefund`/`rejectDispute`
  缺 `reason` → 400（Q6 默认值）。托管（escrow）沿用 Lam 现有映射：`refunded` →"已模拟退款"，
  `completed`（经 `resolve`）→"已结算"；其余状态保持原 escrow。
- 库存（Q3 默认值）：`refund_requested`/`disputed` 是中间状态，**不退库存**；只有最终状态
  `cancelled`/`refunded` 才退库存（沿用 `:134-137` 的原有判断，不动）。
- 通知：复用已有的 `notify()`；管理员决定后给订单主人发站内消息，标题"订单售后处理结果"，
  内容含订单号 + 处理结果 + 理由，并写明款项为模拟（未真实扣款/退款）。消息由 #14 的收件箱读出。
- Admin UI（`AdminDashboard.jsx` 订单表）：新增"售后"操作列；`refund_requested` 的订单显示
  同意退款 / 拒绝退款；`disputed` 的订单显示 驳回申诉 / 调解完成并结算。复用需求审核的
  `reviewBusyId` 模式（处理中禁用按钮）。订单行下方显示 售后原因 + 平台处理说明
  （`refund_reason` / `refund_decision`）。
- 用户 UI（`UserDashboard.jsx` 的 `usrActs()`）：`paid` 的订单显示 申请退款（调用 `refund`，
  附理由输入，复用下单时的理由输入模式）+ 申诉（调用 `dispute`）；`refund_requested`/`disputed`
  的订单显示等待状态 + 已提交的理由；`refunded` 的订单显示管理员的处理说明。状态中文：
  `refund_requested` 为"退款申请中"，`disputed` 为"纠纷处理中"，补入 `apiClient.js` 的状态表 + i18n。
- i18n：新增 8 个 key（状态 2 个 + 申诉按钮 1 个 + 理由输入占位 1 个 + 等待状态 2 个 +
  售后原因/处理说明标签 2 个），中越英三语集合相等，共 263 key（测试 `wave3.test.mjs` 的计数同步更新）。
- 测试：`tests/wave4.test.mjs` 追加 10 个 API 测试：6 个转移方向正确 + 方向错误 → 400；
  4 个决定仅 admin（主人调用 → 403）；admin 调用旧动作处理他人订单 → 仍 403；拒绝缺理由 → 400；
  `refund_decision`/`refund_reason` 已保存；库存只在最终状态退回；管理员决定后主人收到通知消息；
  旧订单测试仍通过。UI（admin 售后按钮、用户端理由输入与等待状态）无 jsdom 测试架，
  只做 build + 浏览器 live 检查。

### 开放问题 Q2/Q3/Q4/Q5/Q6/Q9（plan §7，#13 适用默认值）

Q2 `refund` 改为等审批（`paid → refund_requested`）；Q3 等待期间不退库存；
Q4 不加 `paid_at`/`refunded_at`，只加 `refund_decision`；Q5 `dispute` 由主人或 admin 调用；
Q6 拒绝必须填理由，缺理由 → 400，理由存入 `refund_decision`；
Q9 决定通知标题为"订单售后处理结果"（订单号 + 结果 + 理由，写明模拟）。以上均为工作默认值，
Lam 可在 commit 前推翻。

### 不属于 #13

真实退款/扣款（批准文案只写"已模拟退款"）、改 5 个旧转移的行为、改支付模拟、新增表、
migration、申诉以外的客服渠道、收件箱读取界面（#14 做）。

