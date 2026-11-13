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

### #14 搜索 + 通知（search + notifications）

- 搜索：新文件 `web/assets/js/search.js`（纯 JS，无 JSX，可被 node:test 直接 import，
  仿照 `wave3.test.mjs` import `data.js` 的先例），移植 zhou `src/search.js`（58 行，
  仅客户端）的 `matchesSearch()` + 6 组同义词（14 词，原样保留——广西文化词汇，与 Lam
  数据匹配）+ 13 词词库（逐词核对过 Lam 的数据：`织锦`/`抛绣球`/`民歌`/`非物质文化遗产`/
  `文化创意` 5 词在 Lam 数据中不存在，但仍保留——词库只用来切分 query，不编造数据）。
  规则：query 按空白/标点切分，**每个 token 都必须匹配**（`tokens.every`）；token 属于
  某同义词组时，该组任意一词出现即匹配；不匹配原文的 token 再用词库切分（长词优先）。
- 搜索范围（Q7 默认值）：`name + city + catZh(category) + 当前语言的 description + tags`；
  tags 通过 `APIRES[APIID2IDX[id]].tags` 查找（tuple `RES` 本身没有 tags）。仅离线 fallback
  目录的资源没有 tags，搜索时范围缺少 tags——可接受。
- `App.jsx` 的 `filtered()`（原 `:312-326` 的 `hay.indexOf(q)` 单子串匹配）改用
  `matchesSearch(...)`；原有 `cat`/`city` 过滤与排序不动。小程序预览（`App.jsx:879` 附近）
  原有重复的 `hay` 逻辑改用同一函数，不留两份搜索实现。服务端搜索（ILIKE）不动。
- 价格过滤：`data.js` 的 state 新增 `priceMin`/`priceMax`（元，空 = 不过滤）、
  `minRating`（0 = 不过滤）；目录搜索行旁加两个数字输入（最低价/最高价）+ 一个评分下拉框
  （全部 / 4分及以上 / 4.5分及以上，Q8 默认值）。价格比 `r[3]`（元）；min > max 时视为
  不过滤，不报错、不破坏页面。
- 评分过滤（Q8 默认值）：读 `APIRES[idx].rating`（服务端已有的 AVG）；`review_count === 0`
  的资源在已选评分过滤时**永不匹配**（0 表示"尚未评价"，不是"得了 0 分"）；离线 fallback
  目录（无 `APIRES`）时隐藏评分下拉框。
- 收件箱接口：新文件 `server/routes/messages.mjs`，在 `server/index.mjs` 按其他路由注册：
  `GET /api/messages`（需登录，只返回本人消息，最新在前，`?limit=` 默认 20、最大 50，
  返回 `{messages: [{id, title, content, is_read, created_at}], unread}`）；
  `PATCH /api/messages/:id/read`（标为已读，只限本人消息，否则 404）；
  `PATCH /api/messages/read-all`（全部标为已读，Q9 默认值：做，代码量小）。
  不做给其他用户发消息（只读系统消息）、不做用户间聊天。
- 收件箱 UI：`UserDashboard.jsx`，在"我的订单"旁新增收件箱区块：列出消息（标题 + 内容 +
  时间 + 未读圆点），点击一条即标为已读；收件箱按钮上有未读数徽标。#13 的 `notify()` 调用
  已写入售后决定消息（标题"订单售后处理结果"），本项只做读出。
- i18n：新增 8 个 key（价格占位 2 个 + 评分下拉 3 个 + 收件箱 3 个），中越英三语集合相等，
  共 271 key（测试 `wave3.test.mjs` 的计数同步更新）。
- 测试：`tests/wave4.test.mjs` 追加 8 个 `search.js` 单元测试（双向同义词、多 token AND、
  词库切分、无匹配、大小写不敏感、空 query、tags 参与匹配）+ 5 个收件箱 API 测试
  （未登录 401、看不到他人消息、unread 计数正确、mark-read + read-all、端到端：
  下单 → 退款 → 批准 → `GET /api/messages` 看到决定消息，复用 #13 的流程）。
  UI（过滤控件、收件箱列表与徽标）无 jsdom 测试架，只做 build + 浏览器 live 检查。

### 开放问题 Q7/Q8/Q9（plan §7，#14 适用默认值）

Q7 搜索范围含 tags（经 `APIRES[APIID2IDX[id]].tags` 查找；fallback 资源无 tags，可接受）。
Q8 评分阈值：全部 / 4分及以上 / 4.5分及以上；`review_count === 0` 在已选评分过滤时永不匹配；
min > max 视为不过滤，不报错；fallback 目录时隐藏评分下拉框。
Q9 做 `PATCH /api/messages/read-all`；未读徽标在用户端收件箱按钮上；#13 决定消息标题为
"订单售后处理结果"（订单号 + 结果 + 理由，写明模拟）。以上均为工作默认值，Lam 可在 commit 前推翻。

### 不属于 #14

评价/评论表单与接口（#24）、给其他用户发消息/用户间聊天、`POST /api/sync`（Q14 默认值：不做）、
改服务端搜索（ILIKE 保持原样）、改 `cat`/`city` 过滤与排序逻辑。

### #16 / #22 管理端资源管理（admin 资源管理；本项原为 gate，Lam 已批准在 Wave 4 内做）

- **批准：** Q13 已决 2026-11-12 ~12:49 +08，Lam："sửa resource"，选 (a) 在 Wave 4 内做，
  在 #12–#15 之后。**本项原为 gate（需 Lam 另行批准，见本章路线图表第 6 行），现已批准，
  不再是 gate。** 默认值：新建资源 `status = published`；路由放在新文件
  `server/routes/admin-resources.mjs`（`admin.mjs` 只有 92 行 4 个 GET 接口，保持干净，不往里加写接口）。
- **权限变化（Wave 4 中最大的一次）：** 管理端此前按设计只读（`server/index.mjs:1`：
  "Admin dashboard added 2026-11-10, read-only"；`admin.mjs` 只有 4 个 GET 接口；
  资源视图 `AdminDashboard.jsx:711-731` 是只读表，0 个按钮）。做 #16 即管理端从只读变为
  可管理资源；四个接口一律只允许 admin（`assert(session?.role === "admin", ...)`，
  与 `admin.mjs:12` 同一写法），非 admin 一律 403。
- 接口（新文件 `server/routes/admin-resources.mjs`，在 `server/index.mjs` 按其他路由注册）：
  `POST /api/admin/resources`（新建；必填 `name/category/city/price/unit`，
  `price` 为整数分 ≥ 0，按 Lam 的金额约定；`category` 须属于 `CATS` 的 10 个 id；
  `meta` 若提供须为 JSON 对象，拒绝字符串；`status` 只接受 `published/draft`，
  新建默认 `published`；写审计，沿用标签规则 PATCH 的审计先例 `更新标签规则`）；
  `PATCH /api/admin/resources/:id`（修改；只校验提供的字段；资源不存在 → 404）；
  `POST /api/admin/resources/:id/sync`（渠道同步；只允许 category `show`，与 zhou 一致，
  非 show → 400；**完全模拟**——只写 `meta.channels/lastSync/syncResult` + 审计，
  不发任何外部请求，响应文案须写"未发送外部请求"，`syncResult` 须标注"（模拟）"）；
  `GET /api/admin/resources`（管理端列表；只允许 admin，返回全部资源含 draft，
  按 id 倒序即最新在前，行结构与公开列表相同，不分页、不缓存）。
- UI（`AdminDashboard.jsx` 资源视图）：新增 添加资源（新建表单）/ 编辑（修改表单）/
  上架/下架（经 PATCH 改 `status`）/ 同步渠道（只对 show 资源，调 sync）。
  meta 里有 `lastSync`/`syncResult` 时显示 最近模拟同步 / 渠道同步结果。
  复用现有管理端模式（`reviewBusyId` 处理中禁用按钮；写操作审计留痕）。
  金额：界面输入元，调接口前换算为整数分（服务端只收分）。
- 不做：`POST /api/sync`（Q14 已决：不做——该接口会插入一单模拟已付款订单，
  污染真实统计数据）；图片上传（`image` 仍为静态路径字符串 `/images/...`，不在 #16 做上传）。
- 风险（Lam 已知悉后批准）：管理端写资源会改 `stock/capacity/meta`，直接影响
  档期余量（#12）、推荐（#11）与统计；除 admin-only 门禁外本项不另加代码约束，
  改价/改库存的权限即 admin 权限本身。另注意：公开接口 `GET /api/resources`
  只返回已发布资源，下架为 draft 的资源在列表刷新后不再出现、无法再从界面
  上架——因此管理端列表改取 `GET /api/admin/resources`（只允许 admin，返回
  全部资源含 draft，按 id 倒序），draft 在刷新后仍可见、可重新上架；写操作
  后仍用响应更新本地行，免一次重拉。
- i18n：新增 20 个 key（资源表单与操作文案），中越英三语集合相等，共 291 key
  （测试 `wave3.test.mjs` 的计数同步更新）。
- 测试：`tests/wave4.test.mjs` 追加 8 个 API 测试：新建缺/错字段 → 400；
  新建 + 修改 happy path（admin，含 meta 对象）；非 admin 调三个接口均 → 403；
  sync 非 show 资源 → 400；sync show 资源写 `meta.channels/lastSync/syncResult` + 审计，
  且不发外部请求；上架/下架切换 `published/draft` 正常；管理端列表返回 draft
  资源（新建→下架→列表仍含该 draft，且公开列表不含它）；非 admin 调管理端列表 → 403。
  UI（表单、按钮、同步结果显示）无 jsdom 测试架，只做 build + 浏览器 live 检查。

### 开放问题 Q13/Q14（plan §7，#16 已决）

Q13 (a) 在 Wave 4 内做，排在 #14 之后；新建默认 `status = published`；
路由在新文件 `server/routes/admin-resources.mjs`。Q14 不做 `POST /api/sync`
（插入模拟已付款订单会污染真实统计）。以上均为 Lam 已批准的决定，非工作默认值。

### 不属于 #16

图片上传、批量导入资源、改档期/推荐/统计的计算逻辑、改公开 `GET /api/resources` 的过滤规则、真实渠道对接
（同步永远是模拟，标注"（模拟）"与"未发送外部请求"）。

## Account tabs — 我的账户 chia tab（2026-11-12，plan đã duyệt）

Trang 我的账户（H5 web, `user.html` → `web/assets/js/UserDashboard.jsx`）chia thành
8 tab, mỗi tab một commit riêng, theo plan `guiyan-account-tabs-plan.md`
(Lam duyệt 2026-11-12). Thứ tự: khung tab + bảng đơn → 账户信息 + avatar →
修改密码 → 修改邮箱 → 社交账号。

- **8 tab:** 账户信息（form sửa thông tin + avatar + portrait + 推荐，read-only
  bên dưới）、修改密码、修改邮箱、社交账号、我的订单（bảng kiểu Shopee — chỉ
  FORMAT, màu/font/ngôn ngữ giữ brand Guiyan）、我的收藏、我的需求、收件箱
  （badge chưa đọc chuyển lên nút tab）。
- **Điều hướng:** in-page `useState` + deep link `?tab=`（vd `user.html?tab=orders`，
  giá trị sai → `info`）；header menu 我的订单 mở thẳng tab đơn. Không tạo
  URL/file HTML mới.
- **Bảng đơn:** tái dùng `.db-table` + `.db-scroll` đã có; cột 资源（thumbnail 48px
  + tên + city · category）、订单号、预订日期、数量、金额、状态、操作
  （`usrActs` + nút 协议 giữ nguyên logic, chỉ đổi chỗ hiển thị）；filter tabs
  全部 + 8 trạng thái kèm số đếm (client-side)；sort 订单号/金额/预订日期 theo
  pattern admin (copy `SortButton.jsx` + `sortUtils.js` sang web)；search box
  lọc theo mã đơn/tên resource. Thêm 2 rule CSS `.pill.refund_requested`
  (gold-soft) / `.pill.disputed` (red-soft) — trước đây 2 trạng thái này không
  có nền.
- **Endpoint mới:** `PATCH /api/account/profile` (name/city/age/gender; bỏ qua
  username/role/channel/preference/verified nếu client gửi), `POST
  /api/account/avatar`, `PATCH /api/account/email`, `PATCH
  /api/account/social` (file mới `server/routes/account.mjs`) +
  `POST /api/auth/change-password` (trong `server/routes/auth.mjs`).
  Tất cả đều `needUser()` + chỉ sửa row của chính mình (`session.id`).
- **Avatar:** cột mới `users.avatar TEXT` (schema + `ALTER TABLE ... ADD
  COLUMN IF NOT EXISTS`); upload thật qua storage (kiểm `GET
  /api/storage/health` trên live trước khi code: 200, bucket `uploads` —
  làm upload, không cần fallback preset). Server tự sinh key
  `avatars/{id}/{timestamp}-{random}.{jpg|png|webp}`, chỉ nhận `image/*`
  (JPG/PNG/WebP), decode ≤200KB; xóa key cũ khi thay mới; client downscale
  bằng canvas trước khi gửi. Hiển thị qua presigned URL (`GET
  /api/storage/url?key=`), không có avatar thì giữ vòng tròn chữ cái đầu.
- **Mật khẩu:** bắt buộc nhập đúng mật khẩu hiện tại (scrypt +
  `timingSafeEqual`, như login); mới ≥6, ≤100 ký tự, khác mật khẩu cũ
  (so bằng scrypt verify); **không đá session khác** (Q4 đã quyết).
- **Email:** trim + lowercase (mới — register hiện chỉ trim); kiểm `EMAIL_RE`
  + ≤100 ký tự; kiểm trùng bằng SELECT → 409 (không thêm UNIQUE index đợt
  này); không cho xóa email qua endpoint; **từ 2026-11-12: đổi email bắt
  buộc nhập mã OTP mô phỏng — xem mục OTP bên dưới** (trước đó không xác
  minh, email mới có hiệu lực ngay); `verified` không đổi.
- **Social:** 1 cột JSON `users.social_links TEXT DEFAULT '{}'`, keys cố định
  抖音 / 微信 / 小红书（微博 = 0 kết quả toàn repo, không gồm）; value ≤100
  ký tự, chuỗi rỗng = xóa link; key lạ/token/code → 400. Chỉ lưu + hiển thị
  text, link chỉ khi giá trị là URL `https://` đầy đủ; ghi rõ
  "仅展示，不验证归属". Không OAuth (tính năng riêng, đã hoãn).
- **Audit:** "修改资料" / "更换头像" / "修改密码" / "修改邮箱" / "更新社交账号".
- **Rủi ro đã biết, không giấu:** chưa có rate limit (Wave 5 #29 mới làm);
  đổi mật khẩu/email/avatar chỉ được bảo vệ bằng mật khẩu hiện tại + audit.
- **Không làm:** OAuth/xác minh sở hữu, gửi email/SMS xác minh thật (chỉ có
  OTP mô phỏng — xem mục OTP bên dưới), xử lý ảnh phía server, mini-program,
  Wave 5, đổi logic Wave 4, đổi admin, UNIQUE index cho email, phân trang
  server cho `GET /api/orders`.

## Đổi email / số điện thoại bằng mã OTP mô phỏng（2026-11-12，Lam ra lệnh 18:37）

Đổi email trước đây lưu ngay không cần xác minh; đổi số điện thoại chưa có
chỗ nào. Lam yêu cầu cả hai đều nhận OTP trước khi đổi. Gộp chung vào 1
commit duy nhất với toàn bộ account-tabs (Lam duyệt gộp 1 commit 2026-11-12).

- **Không có provider:** dự án không có nhà cung cấp email/SMS, không ngân
  sách mua (phase 7 hoãn vì tiền) → OTP **MÔ PHỎNG**: server sinh mã và trả
  về ngay trong response của `POST /api/account/send-otp`; UI hiển thị mã
  demo, ghi rõ `模拟，未真实发送`. Không thêm provider/SDK/key nào; không
  bao giờ ghi "đã gửi email/SMS thật". Đăng ký tài khoản (`POST
  /api/auth/register`) vẫn không xác minh — OTP chỉ áp dụng cho đổi email /
  số điện thoại của tài khoản đã đăng nhập.
- **Bảng mới `verification_codes`** (pattern `CREATE TABLE IF NOT EXISTS`
  trong `server/schema.mjs`, không migration): `id`, `user_id` (FK users),
  `channel` (`email` | `phone`), `target` (email đã lowercase / số điện
  thoại đã chuẩn hóa), `code` (6 chữ số, TEXT), `expires_at`, `attempts`
  (mặc định 0), `used_at` (NULL = chưa dùng), `verified_at` (NULL = chưa
  xác minh — verify-otp ghi khi mã đúng), `created_at` (ISO string,
  như sessions). Index `(user_id, channel, target)`.
- **Quy tắc mã (đã quyết, không hỏi lại):** 6 chữ số ngẫu nhiên
  (`crypto.randomInt`); hiệu lực **5 phút**; **dùng 1 lần** (`used_at` ghi
  khi PATCH thành công); tối đa **5 lần thử sai** cho mỗi mã (lần đúng thứ 6
  cũng 400); gửi lại cách nhau **60 giây** cho mỗi (user, channel, target);
  tối đa **5 lần gửi / giờ** cho mỗi target; gửi mã mới vô hiệu hóa mã cũ
  chưa dùng của cùng (user, channel, target) — chỉ mã mới nhất còn hiệu
  lực. Mã sai định dạng (không phải 6 chữ số) → 400, không tính lượt thử.
  **Luồng xác minh 2 bước (bắt buộc vì transaction — xem dưới):** mã đúng
  được xác minh trước qua `POST /api/account/verify-otp` (đánh dấu
  `verified_at`), rồi `PATCH` mới tiêu thụ mã (`used_at`) và đổi liên hệ.
  Mã chưa verified thì PATCH → 400.
- **Vì sao verify-otp luôn trả 200:** mọi request ghi trong codebase chạy
  trong MỘT transaction; response ≥400 hoặc throw đều ROLLBACK toàn bộ
  request (`createRequestHandler` trong `server/index.mjs` + `db.request`
  trong `server/postgres.mjs`: commit chỉ khi status < 400). Lần thử sai
  phải tăng cột `attempts` — mà tăng rồi trả 400 thì lần tăng bị rollback
  mất, nên 5 lần sai không bao giờ chết mã (đã phát hiện bằng test lỗi
  2026-11-12: 5 lần sai xong mã đúng vẫn đổi được). Vì vậy verify-otp
  LUÔN trả 200 kèm `{valid, error?, attempts_left}` để lần thử được
  commit; UI/PATCH chỉ đọc `valid`. Đây là quy tắc kiến trúc chung, không
  riêng OTP: **validate trước, write sau, không bao giờ throw sau khi đã
  write trong cùng request**.
- **Endpoint mới `POST /api/account/send-otp`** (`server/routes/account.mjs`,
  cần đăng nhập): body `{channel: "email"|"phone", target}`. Kiểm tra định
  dạng target (email: `EMAIL_RE` + ≤100; phone: bỏ khoảng trắng, `^\+?\d{9,15}$`);
  trùng với user khác → 409; gửi quá nhanh → 429; quá 5 lần/giờ → 429.
  Trả `{channel, target, code, expires_in_seconds: 300}` — mã trả về công
  khai vì là mô phỏng (ghi rõ trong comment code + UI). Audit `"发送验证码"`.
- **Endpoint mới `POST /api/account/verify-otp`:** body `{channel, target,
  code}`. Tìm mã chưa dùng mới nhất của (user, channel, target): không có
  → `{valid:false}`; đã verified → `{valid:true}`; hết hạn / hết lượt thử
  → `{valid:false}` + lý do; sai mã → `attempts` + 1 rồi trả `{valid:false,
  attempts_left}`; đúng mã → ghi `verified_at`, trả `{valid:true}`. Luôn
  trả 200 (lý do ở trên). Không audit (lần thử sai không phải thay đổi
  dữ liệu liên hệ; lần gửi mã đã audit `"发送验证码"`).
- **`PATCH /api/account/email` đổi thành bắt buộc `{email, code}`:**
  giữ mọi rule cũ (trim + lowercase, `EMAIL_RE`, ≤100, trùng → 409,
  không cho xóa, `verified` không đổi, audit `"修改邮箱"`); thêm bước tiêu
  thụ mã đã verified: mã phải đúng (user, channel `email`, target = email
  đã lowercase), đã có `verified_at`, chưa hết hạn, chưa dùng — sai → 400,
  hết hạn → 400, chưa verify → 400, dùng lại mã cũ → 400. Kiểm trùng (409)
  chạy TRƯỚC khi tiêu thụ mã để không đốt mã khi email đã bị người khác
  lấy. Tiêu thụ đúng thì ghi `used_at` rồi mới cập nhật email.
- **Số điện thoại (mới):** cột mới `users.phone TEXT` (schema + `ALTER TABLE
  ... ADD COLUMN IF NOT EXISTS` trong `server/postgres.mjs`, như avatar /
  social_links); endpoint mới `PATCH /api/account/phone {phone, code}`
  mirror email (chuẩn hóa bỏ khoảng trắng, `^\+?\d{9,15}$`, trùng →
  409, không cho xóa, mã phải đã verified, audit `"修改手机号"`); tab mới
  **修改手机号** (tab thứ 9, sau 修改邮箱）, form mirror tab email: số hiện
  tại / số mới / nút 获取验证码 + ô nhập 6 số + ghi chú mã demo.
- **UI:** tab email thêm nút 获取验证码 + ô nhập 验证码 (6 số) + dòng ghi chú
  mã demo `演示验证码：{code}（模拟，未真实发送）`; tab phone làm y hệt.
  Nút 保存 gọi verify-otp trước, mã đúng mới gọi PATCH (xem lý do ở trên);
  mã sai thì hiện lỗi verify ngay, không gọi PATCH. Sau khi gửi mã thành
  công thì hiện ghi chú; lưu thành công thì toast "已保存" như cũ và xóa
  form + mã demo. Lỗi server hiện nguyên văn (như các tab khác). i18n: 8 key
  mới × 3 ngôn ngữ (`tabPhone`, `phoneCurrent`,
  `phoneNew`, `phoneNone`, `otpSend`, `otpCode`, `otpCodePh`, `otpDemoNote`).
- **Audit:** `"发送验证码"` / `"修改邮箱"` / `"修改手机号"`.
- **Rủi ro đã biết, không giấu:** mã demo hiển thị ngay trên UI nên ai
  nhìn màn hình cũng thấy mã — chấp nhận được trong demo mô phỏng, KHÔNG
  dùng cho production thật (khi có provider thật, bỏ `code` khỏi response
  và gửi qua email/SMS thật). Chưa có rate limit toàn cục (Wave 5 #29 mới
  làm); gửi OTP chỉ giới hạn theo target như trên.
- **Không làm:** provider email/SMS thật, gửi mã qua email/SMS, xác minh
  email lúc đăng ký, UNIQUE index cho email/phone, đổi mật khẩu bằng OTP
  (mật khẩu vẫn đổi bằng mật khẩu hiện tại).
- **Test:** file mới `tests/account-otp.test.mjs` (send-otp trả mã 6 số;
  verify-otp sai mã → 200 `{valid:false}` + `attempts_left` giảm; hết hạn
  → `{valid:false}`; đúng mã đổi được + dùng lại → 400; 5 lần sai → mã
  chết (verify đúng mã cũng `{valid:false}`); trùng email/phone → 409;
  gửi lại trong 60s → 429; 5 lần gửi/giờ → lần 6 là 429; email/phone
  không có mã → 400; gửi mã mới vô hiệu hóa mã cũ); test step 4 cũ trong
  `tests/account-tabs.test.mjs` chuyển sang luồng OTP (gửi mã → verify →
  PATCH); test i18n `wave3.test.mjs` cập nhật 323 → 331 key.
- **Test:** file mới `tests/account-tabs.test.mjs` (~27 test API, DB dùng một
  lần); test i18n `wave3.test.mjs` cập nhật số key theo số key mới thêm.
  Kiểm live dùng tài khoản test mới đăng ký, không dùng demo/admin cho thao
  tác đổi mật khẩu/email/avatar.

## B-037 — user.html kẹt ở “请先登录”（2026-11-12，plan sửa — Lam chọn B-037 trước, 20:06）

- **Hiện tượng (mở từ kiểm live Wave 4, 2026-11-12):** mở `user.html` lần
  đầu hiện `请先登录` dù header đã đăng nhập; tab chỉ hiện sau đó. Tải lại
  bằng deep-link `?tab=...` có lần nán 15 giây+ (kiểm OTP 19:06–19:08);
  các lần khác tab tự hiện sau ~5–8 giây.
- **Cơ chế (Peter tự đọc code ở HEAD `060e02e`, đã kiểm chứng):**
  `UserDashboard.jsx:60` `gate` bắt đầu `true`; `usrLoad` (~160–188) chạy
  `Promise.all` 6 call — `/api/orders`, `/api/favorites`, `/api/demands`
  (KHÔNG có `.catch`) + `/api/profile`, `/api/recommendations?limit=5`,
  `/api/messages` (mỗi call có `.catch → null`) — và `setGate(false)` chỉ
  chạy trong `.then`, tức chỉ khi cả 6 resolve. Lỗi không phải 401 từ 1
  trong 3 call không `.catch` rơi vào `.catch` cuối, chỉ hiện toast
  `loadErr`, cửa KHÔNG bao giờ đóng.
- **Điểm mới so với suy luận ban đầu:** `apiClient.js` `apiFetch` abort mọi
  request sau **5000ms** (AbortController). Call nào chậm hơn 5s không chỉ
  làm chậm cửa — nó REJECT, `Promise.all` reject, cửa kẹt vĩnh viễn trong
  lần tải đó (không retry). Trong file KHÔNG có retry, focus/visibility
  listener hay interval; `usrLoad()` chỉ gọi từ: mount effect (`[]`, 1 lần),
  `changeLang`, `doLogin`/`doRegister`, `doLogout`; `userMain.jsx` không có
  StrictMode nên không double-effect ở production. Vì vậy “tự hiện sau
  5–15s” KHÔNG thể là call chậm resolve sau 5s — mà phải là (a) lần tải đầu
  resolve vừa kịp dưới 5s (function đã warm), hoặc (b) một lần mount /
  `usrLoad` thứ hai (điều hướng lại qua 我的账户 = reload trang; đổi ngôn
  ngữ = `changeLang`). Đây vẫn là suy luận từ báo cáo browser, chưa có log
  đo trực tiếp — plan Bước 0 sẽ đo để xác nhận/phủ định.
- **Hướng sửa (mặc định trong plan, chờ Lam duyệt):** tách cửa khỏi
  `Promise.all` — cửa đóng ngay khi token + user đã lưu còn hợp lệ
  (client-side), render khung tab ngay; mỗi tab tự tải dữ liệu riêng, có
  loading/error riêng (tab lỗi không chặn tab khác hay cửa); thêm `.catch`
  cho 3 call chưa có. Giữ nguyên: 401 → xóa token + cửa mở lại; avatar
  presigned-URL lỗi → chữ cái đầu; thứ tự 9 tab; không endpoint mới,
  không đổi DB, không đổi timeout 5s trong đợt này.
- **Không làm trong đợt này:** đổi timeout `apiFetch`, tối ưu backend/DB
  (trừ khi Bước 0 đo ra query chậm), B-038/039/040/041, Wave 5.
- **Kết quả Bước 0 (đo, 2026-11-12 ~20:11–20:30):** (0a) live curl
  testtabs1112: 6 endpoint 0,51–1,73s (cold + warm, kể cả song song) — không
  endpoint nào quá 5s, p50 < 3s → không có nghi phạm đơn lẻ; (0b) disposable
  DB: 6 endpoint 0,004–0,028s → không query chậm, không sửa backend; (0c)
  headless Chrome + logging build tạm (không commit): `usrLoad` chạy đúng 1
  lần/mount; với latency 6000ms, cả 6 call FAIL ở 5000–5001ms (AbortError) →
  `Promise.all` REJECT → cửa KẸT vĩnh viễn (tái hiện xác định); tắt latency
  + điều hướng lại → 6 call OK ~844–848ms, cửa mở ở t=984ms — giả thuyết H-B
  (lần tải thứ hai) được chứng minh là đường hồi phục. Không có kết quả ngoài
  H-A/H-B → làm Bước 1 theo plan.
- **Sửa (Bước 1, đã verify, chưa commit/deploy — chờ Peter deploy + kiểm
  live + duyệt commit):** module mới `web/assets/js/usrTabLoad.mjs` (loader
  thuần từng tab: `decideGateOpen`, `loadTabOrders/Favs/Demands/Info/Inbox`,
  `loadAllTabs` — loader không bao giờ reject; 401 → báo hết phiên; tab lỗi
  → lỗi riêng tab); `UserDashboard.jsx` mở cửa ngay khi token + user đã lưu
  hợp lệ (mount/login), mỗi tab có loading/error + nút thử lại riêng; 401 →
  xóa token + cửa mở lại; logout xóa dữ liệu tab cũ; avatar lỗi → chữ cái
  đầu; 9 tab giữ nguyên; không endpoint mới, không đổi DB, không đổi timeout
  5s. i18n +3 key (`tabLoading`, `tabLoadErr`, `retryBtn`) × 3 ngôn ngữ →
  334. Test mới `tests/b037-gate.test.mjs` (14 test). Verify trên GCP my-llm
  (EC2 bận IMSF P05-01 Step 3): build PASS 2,66s; `npm test` 163 test (151
  pass / 0 fail / 12 skip); smoke 30/0; kiểm headless bản fix: login → tab
  hiện sau 816ms; latency 6s + reload → tab VẪN hiện (bản cũ: kẹt vĩnh viễn),
  sau ~4,8s tab orders hiện lỗi riêng + nút thử lại, cửa vẫn mở; tắt latency
  → tab hiện 426ms, 6 dòng orders, không lỗi. Trial agent trên GCP không bị
  chạm (chromadb + agent-ai.service vẫn active).

## Wave 5 — 加固 + 小程序（已实现、验证、部署并提交）

计划：`~/workspace/_work/guiyan-wave5-plan.md`。顺序 Lam 已定（2026-11-12 20:06）：
B-037 先，Wave 5 后。B-037 已提交（`4f89fb4`）；Wave 5 在干净树上实现，
三项全部验证通过；已部署（`guiyan-platform-b0qzv2z8z`）并通过 live check；三项已提交。

- **#29 登录限流（新建，两边都没有）：** `POST /api/auth/login` 目前无任何限流
  （`auth.mjs` 的 `login` 无计数；全站 grep 限流只命中 OTP 的 429）。默认设计：
  键 = IP + 用户名，1 小时窗口内 5 次失败，超限返回 429
  `"登录尝试过多，请稍后再试"`；新表 `login_attempts`（`CREATE TABLE IF NOT
  EXISTS`）；IP 取 `x-forwarded-for` 首项（Vercel），本地 fallback
  `req.socket.remoteAddress`。**关键约束（OTP 的教训）：** 每写请求在同一事务
  内，响应 ≥400 会 ROLLBACK（`postgres.mjs:179`），登录失败返回 401 会抹掉
  同请求内的计数写入——因此计数写入必须用独立事务（`ctx` 新增
  `separateRequest`），登录成功清除计数；存储故障时 fail-open（允许登录）。
  仅审计锁定事件，不审计每次失败。i18n +1 key → 335。
- **#27 小程序上线：** `miniprogram/app.js:22` 的 `apiBase` 默认为 `''`（离线
  模式）；改 1 行 → `'https://guiyan-platform.vercel.app'`。`utils/api.js`
  用 `wx.request(base + path)`，健康检查失败自动回本地数据，无需改。
  小程序无任何硬编码 IP（仅注释举例 localhost）。6 个页面（index、category、
  demands、assistant、orders、detail），无我的账户页（不在本轮范围）。H5 不受
  影响（`apiClient.js` 默认同源 `/api`）。**Lam 的步骤（agent 不可代做）：**
  微信开发者工具打开（tourist AppID 可本地预览）检查 6 页 + 在线数据；真机
  测试需换真实 AppID（替换 `touristappid`）+ 在小程序管理后台把 Vercel 域名
  加入 request 合法域名。`project.config.json` 的 `appid` 仍为 `touristappid`。
- **#23 场馆剧目推荐 + 报告下载：** 后端已算好每场馆 Top-3 推荐
  （`admin-insights.mjs` 的 `buildAnalysis`：分数 = 共有类型关键词 ×10 +
  同城 3，类型为歌舞/音乐/话剧/民歌/舞蹈；理由保留“需核实”字样），但管理端
  场馆卡片（`AdminDashboard.jsx:1135–1149`）不显示（grep `recommendation` 为
  0 命中）——本轮只改管理端 UI，把推荐列在每张场馆卡下。报告文本已有
  （`report`，`"模拟经营分析报告"`），但没有下载按钮——默认加 .txt 下载
  （复用 `downloadText` 模式，文件名 `guiyan-analysis-<period>.txt`，不新增
  接口）；场馆 CSV 端点为可选项（Q6）。**venueId 数据不存在：** `linked`
  按 `meta.venueId` 过滤恒为空，`performances` / `seatOccupancy` / 票房恒为
  空并显示“暂无关联售票样本”——这是数据现状，不是缺陷，不得编造映射；
  是否由 Lam/小组提供 show→venue 映射见 Q7。需求匹配保持不变；面向用户
  的推荐（`GET /api/recommendations`）已有，不动。
- **顺序与提交：** #29 → #27 → #23，每项 1 个 commit（同 Wave 4），每项验证：
  build + `npm test` + smoke 30/0（新 DB）；基线 163 test（151/0/12）、
  i18n 334（+新 key）。不在本轮：B-038/039/040/041、phase 7 真实 AIGC（延期，
  无经费）、phase 8 Docker、82 模块路线图、OAuth（Lam 已延期）。
- **实施结果（2026-11-12，EC2 验证，3 项全部 PASS；三项已提交）：**
  - **#29：** 新表 `login_attempts` + `server/lib/rate-limit.mjs`（5 次/小时/
    IP+用户名，429 `"登录尝试过多，请稍后再试"`，独立事务计数 + fail-open，
    锁定写 1 条审计 `"登录受限"`）；`auth.mjs` 登录流程 + `context.mjs`
    `separateRequest`/`separateRead` + `postgres.mjs` `lock` 选项；
    i18n 335（+`loginLocked`）。测试 9 个（`tests/wave5.test.mjs`，含
    fail-open：DROP TABLE 后登录仍通）。验证：build PASS，172 test
    160/0/12，smoke 30/0。实施中发现并修复 2 个问题：计数读在原事务内会
    触发 Postgres 25P02（改走 `separateRead`）；test 自建表缺
    `GENERATED BY DEFAULT AS IDENTITY` 导致 INSERT 23502（test 缺陷，
    非产品缺陷）。
  - **#27：** 仅改 `miniprogram/app.js:22`（`apiBase: ''` →
    `'https://guiyan-platform.vercel.app'`）+ 更新注释；grep 确认小程序
    无硬编码 IP（仅 localhost 注释举例）。测试 2 个（apiBase 默认值 +
    grep `120.24.109.101` 为 0）。验证：build PASS，174 test 162/0/12，
    smoke 30/0。微信开发者工具编译测试仍是 **Lam 的步骤**（未做）。
  - **#23：** 仅改管理端 UI：`AdminDashboard.jsx` 场馆卡下渲染
    `v.recommendations`（Top-3，名称 + `reason` 原文，空时
    “暂无匹配剧目”）+ 完整报告区加按钮“下载报告”（`downloadReport`，
    复用 `downloadText`，下 `analysis.report` 原文——与屏上标题+正文
    逐字节一致，文件名 `guiyan-analysis-<period>.txt`，无新接口、无审
    计行）；后端 0 改动。**无 i18n key 新增**（管理端无 i18n 系统，文案
    硬编码中文，与管理端其余文案一致；i18n 仍为 335）。测试 2 个（analysis
    契约：`venues[].recommendations` 恒为数组、≤3、分数降序/id 升序 +
    静态检查 UI 接线）。验证：build PASS，176 test 164/0/12，smoke 30/0。
    验证中有 1 次全量运行出现 5 fail（wave3 #9 + wave4 #12，均为旧测试
    对共享 disposable DB 的状态假设），**同一代码、同一新 DB 重跑即全
    PASS，且 smoke 内嵌 run 也 PASS**——属旧测试偶发不稳定，非 Wave 5
    回归；另有 1 次运行因容器被 smoke 脚本删后未重建导致
    ECONNREFUSED（验证操作失误，已重建容器后重跑 PASS）。
- **待 Lam 决定的问题（Q1–Q8，见计划文件，均有默认值）：** Q1 限流范围（默认
  仅登录）；Q2 计数键（默认 IP+用户名）；Q3 数值 5 次/小时；Q4 存储（默认 DB
  表 + 独立事务）；Q5 小程序 URL（默认 Vercel 地址，保留离线回退）；Q6 报
  告下载（默认仅 .txt）；Q7 场馆映射（默认只按城市+类型）；Q8 提交分组
  （默认每项 1 commit）。

## 小程序重建 — 去 demo 标注 + tab 我 + 微信登录（2026-11-12，重建计划已批，已 commit `efb4073`、已部署 `hopt9lbqr`）

Plan：`~/workspace/_work/guiyan-miniprogram-rebuild-plan.md`（352 行）。Lam 批准 2026-11-12 23:53（Q1–Q8 全部默认）。在 Wave 5 三个 commit（`bb4e225` / `0e12ff8` / `6961c4a`）后的干净树上实施；**已 commit（6 commit A→F：`7480d12` / `18f8cf6` / `039df3f` / `8bf2d60` / `f6ac970` / `efb4073`）、已 push、已部署 `guiyan-platform-hopt9lbqr`**——真机检查是 Lam 的步骤。基线：176 test（164/0/12），smoke 30/0，i18n H5 335/335/335。最终：**184 test（172/0/12），smoke 30/0，H5 i18n 322/322/322，小程序 i18n 127/127/127**（两边 key 集相等；注：原记 131 是错的——核实 HEAD 实际 127，见 B-038 条）。

- **A — AppID：** 仅改 `miniprogram/project.config.json:6`：`"touristappid"` → `"wx5fb461d54128ba71"`（Lam 提供的真实 AppID）；`urlCheck: false`、`libVersion: "trial"` 不变；JSON 已校验。**仍待 Lam：** 在微信开发者工具里用真实 AppID 编译 + 真机预览；Vercel 域名需加入小程序后台 request 合法域名，否则真机仍走离线数据。
- **B — 视觉重建（最大项）：** 沿用现有桂演夜间剧场品牌（`design-systems/guiyan/`）：松绿 `#0b3d36`、朱砂 `#c8452c`（每屏最多 2 处）、金 `#c9a24b`、宣纸 `#f7f3ec`，扁平、无蓝、无渐变；只应用界面规则（语义 token、4/8 间距节奏、矢量图标、tab ≤ 5、安全区、固定栏内容留白、对比度 ≥ 4.5:1）。`miniprogram/app.wxss` 重写：硬编码颜色全部 token 化；`.btn` 圆角 999rpx → 24rpx（`.chip` 16rpx）；触摸目标 ≥ 88rpx；区块间距 48rpx；`.tag` 只剩 2 种（品类松绿 / 城市金，`.tag.red` 已删）；`.rescard.featured` 金色顶线；新增 `.field`、`.filterrow`、`.fav-ic`/`.favbtn`、`.merow`、`.me-avatar`。10 张栅格 tab PNG 已删，改 12 个 SVG（`miniprogram/assets/`，均 < 1KB，XML 良好；tabBar `color` `#8A94A6` → `#5D5344` 提高对比度）；新增共享顶栏组件 `miniprogram/components/topbar/`（4 文件，全局注册，6 个页面原先复制粘贴的顶栏块全部替换；组件自带语言选择器，`pageLifetimes.show` 刷新，发出 `langchange`）。首页：在线/离线行 + 登录表单已删（登录移到 我，见 C）；hero 只留标题 + 导语（kicker/统计已删）；推荐卡用 `.rescard.featured`。分类页：城市/排序选择器并入一行 `.filterrow`；详情页同。♡/♥ 文字符号全部换成矢量图标 + 文字（`/assets/icon-heart.svg` / `icon-heart-filled.svg`）。需求页：`＋ 发布需求` 进 i18n（`postDemand`，3 语言）；预算红色 tag 改纯文本；表单输入用 `.field`。i18n 删 8 个死 key（`heroKicker`、`heroStats`、`sRes`、`sShow`、`sVenue`、`sCity`、`sCat`、`sDem`）。**SVG tabBar 图标待 Lam 在开发者工具验证**：官方文档未明确确认 tabBar 支持 SVG（有实践文档称 tabBar 要求本地 PNG；另有真实项目用 SVG tab 图标，`<image>` 文档列 SVG 为 iOS+Android 支持）。若 DevTools 不认 SVG，回退方案是按同一矢量路径重生成 PNG，只改 `app.json` 一行。页内图标同样用 SVG `<image>`，一并验证。
- **C — 新 tab 我 + wx.login：** 微信 tabBar 上限 5 项，**tab 我的票券 → tab 我**；`pages/orders/orders` 仍为子页面（`wx.navigateTo`，不再是 tab）。新增 `miniprogram/pages/me/me.{js,wxml,json}` + `app.json` 注册：头部（头像——点按同意调 `wx.getUserProfile`，存 `guiyan-wx-profile`；显示名默认取已关联桂演账号）、微信一键登录 + 关联已有账号表单、我的订单/收藏的资源（→ orders 子页面）、我的需求（switchTab）、账户信息（读 + 改姓名/城市/年龄/性别，走现有 `PATCH /api/account/profile`）、设置（语言、退出、关于）。**小程序内不做改密码/改邮箱/改手机号**（留在 H5，用 OTP）。登录两层：第 1 层 `wx.login` → 新接口 `POST /api/auth/wechat-mini`（`server/routes/oauth.mjs`）：先验身份（Bearer 会话，否则用户名+密码按登录流程校验，密码错 → 401）→ `jscode2session` → openid → 关联（幂等；openid 已属他人 → 409）或查找 → 未关联返回 200 `{linked:false}`，已关联返回 7 天会话 `{token, user, linked:true}`；`WECHAT_MINI_APPID` / `WECHAT_MINI_APPSECRET` 只从环境变量读（不提交、不记日志），缺失 → 503 干净失败；fetch 8 秒超时 → 网络失败 503；微信 errcode → 401；unionid 不用（openid 是关联键）。**本轮唯一 DB 改动**：`server/schema.mjs` 新增表 `oauth_accounts`，`UNIQUE(provider, provider_user_id)` + `(user_id, provider)` 索引（`CREATE TABLE IF NOT EXISTS` 模式）。第 2 层：关联已有桂演账号（在 我 里输一次用户名+密码，之后按 `utils/api.js` 现有方式用存的 token 自动登录）。未关联 + 未登录：自由浏览；下单/收藏时打开 我 里的关联/登录表单（首页不再有登录表单）。新增 `tests/wechat-mini.test.mjs`（8 个测试；主服务 3107 端 + dummy 微信环境变量，第二服务 3108 端无微信环境变量测 503）。`utils/api.js` 新增 `wechatLogin(code)`、`linkWechat(code, username, password)`、`patch()`，导出 `saveUser`；`promptLogin()` 改为 switchTab 到 `/pages/me/me` 并置 `globalData.meShowLink`；在线 + 未登录时 `toggleFav()` 调 `promptLogin()` 且不改任何状态（离线仍本地切换）。`pages/detail/detail.js`：`goOrders` switchTab → `wx.navigateTo('/pages/orders/orders')`。小程序 i18n 新增 24 个 me key（3 语言）→ **127 key/语言**（原记 131 是错的）。**诚实说明**：`wx.login` 只证明“这台设备用微信账号 X 打开过”（openid）；无手机号/邮箱/实名，除非用户点按同意 `wx.getUserProfile`；显示名默认取已关联桂演账号。**仍待 Lam**：把真实 AppSecret 放进部署环境变量（代码已从 env 读、无 AppSecret 时 503）；真机上微信一键登录 + 关联账号流程。
- **D — 聊天发送按钮固定底部：** 小程序 `pages/assistant/assistant.wxml` 重组：输入框 + 发送按钮移出页面流，进固定底部 `.chatbar`（`position:fixed; bottom:0`，`padding-bottom: calc(16rpx + env(safe-area-inset-bottom))`，z-index 10）；快捷 chips 留在可滚动日志上方，随日志滚动；`.chatlog` 加 `padding-bottom: 200rpx`。聊天逻辑、`/api/assistant/chat` 代理 0 改动。H5 `AiChat.jsx` **仅验证**：表单已通过 flex 列固定在面板底部（头部、提示、`flex:1` 可滚动日志、chips、表单在最后），375px/560px 检查无缺陷——**H5 在 D 项 0 改动**。**仍待 Lam**：真机上确认发送栏固定在 tabBar/键盘上方、日志不被遮住。
- **E — 去 demo/免责标注（按计划 E1–E12 表，Q5 默认）：** 删 E1/E2（orders + detail 的 `simNote` 横幅）、E3（assistant 的 `simAi` 行）、E5（在线/离线行，B 项已删）；E7/E8（H5：`aiChatTrial` key 删 3 语言，`aiChatGreeting` 的试用版标记删，`aiChatNote` 缩短为只剩票价句“票价取自实时目录，请以页面价格为准。”，`AiChat.jsx:192` 的 `.ai-trial` span + `main.css` 的 `.ai-trial` 规则删）；E9（H5：删 `App.jsx` 整个 微 WeChat 假手机章节 + `wxBanner` div，换成 1 张小卡片链向真实小程序，锚点 `<section id="wechat">` 保留；新增 3 个 key `wxCardTitle`/`wxCardText`/`wxCardHint`（3 语言）；`WxBody` 函数删，`App.jsx` 现 918 行；`data.js` 的 `wxTab`/`wxQ`/`wxCat` 字段删；删 15 个 wx key；`main.css` 整个 `.wx-*` 块删（含 `.wx-hero` 线性渐变），新增 `.wx-mini-card`（扁平 `#0b3d36` 背景）；`navWechat` key 与 `#wechat` 头部/导航链接保留）。**保留**：E4 `模拟支付` 按钮文案（不改成 plain 支付——用户可能误以为真扣款；订单流返回的 `note: "模拟支付，未扣款"` 亦保留）、E6 `aiNote`（真实描述）、E10/E11（散落的 （模拟） 标签 + 管理端标签——真实描述）。`main.css:99` 的 `.hero-shade` 线性渐变是主 hero 图片遮罩，不是 `.wx-hero`，超出范围、保留。内部文档（docs/10、myown）**保留**模拟说明，不清理。**诚实说明**：去掉 demo 标注后，支付/AI/渠道同步在表层之下仍是模拟——用户界面不再声称，内部文档仍如实记录。
- **F — 默认语言中文：** 小程序 vi → zh，只改计划列出的 5 处：`app.js:13` `var lang = 'vi'` → `'zh'`；`app.js:23` `globalData.lang: 'vi'` → `'zh'`；`utils/i18n.js` fallback `return 'vi'` → `'zh'`；`langIndex()` fallback `1` → `0`；`pages/index/index.js:7` `langIdx: 1, langName: 'Tiếng Việt'` → `0, '中文'`。已保存的语言（`guiyan-lang`）仍受尊重（选过 vi/en 的用户保持原选择）。其余 5 个页面的初始 `langIdx: 1` 按任务字面范围未改——`applyLang()` 在首次绘制前已按 `langIndex()` 覆盖，无可见影响；topbar 组件初始值已是 `0`/`'中文'`。H5 0 改动（默认自 30c6737 已是中文）。小程序语言选择器保留（Q6 默认）。
- **验证（最终树，EC2，全新 disposable DB `guiyan_test`，0 表起步）：** `npm run build` PASS；`npm test` **184 test（172 pass / 0 fail / 12 skip）**（含新 `tests/wechat-mini.test.mjs` 8 个：缺 code → 400、假 code → 401（dummy 环境）、无环境变量 → 503、密码错 → 401；及 `tests/wave3.test.mjs` 的 i18n 断言 335 → 322）；smoke **30/0**（vite build + preview + API + 收藏门禁 + 订单流 confirm/pay/complete 全通）；miniprogram 全部 `.js` 经 `node --check`，全部 `.json` 校验通过；小程序 + H5 均无死 key（grep 0 命中：`simNote`/`simAi`/`onlineMode`/`offlineMode`/`aiChatTrial`/`wxBanner`/`wxTitle`/`wxSub`/`wxNote`/`wxCopy*`/`wxB1–B3`/`wxS1–S3`/`wxRepo`/`wxTabHome`/`wxFeatured`/`WxBody`/`touristappid`/`showLogin`）；线上 Vercel curl：`/api/health` 200、`/api/resources` 200、`/api/assistant?q=hi` 200。一次验证教训：脏 DB（`guiyan_test` 含两轮旧数据）曾让 17 个测试报重复 phone/user 失败——全新 DB 重跑即全 PASS，非代码回归；另有一次长 SSH 命令断管（exit 255），改走 nohup + 读日志。验证后 disposable 容器已由 smoke 脚本删除（`docker ps` 0 容器）。
- **仍待 Lam 的步骤（agent 做不了）：** ① 微信开发者工具编译 + 真机预览全部页面（重点：SVG tabBar 图标、固定聊天栏、我 tab、一键登录）；② AppSecret 进部署环境变量；③ 开发者工具编译测试仍是 Lam 的步骤（自 Wave 5 #27 起未做）。

## Sửa 7 bug P3（B-038、B-039、B-040、B-041、B-030、P3-1、P3-2）

Plan：`~/workspace/_work/guiyan-p3bugs-plan.md`（541 行）。Lam 批准 2026-11-13 10:13（Q1–Q8 全部默认）。7 bug P3 tồn từ kiểm live Wave 3/4，在 rebuild A–F（HEAD `6766f41`）后的干净树上实施；不改 DB、不加 endpoint、不改 API contract。仅改标签/显示 + 1 个 server-side 共用 map。

- **B-038 — 状态标签中文：**(a) 收件箱 server-side：新建共用 map `server/lib/status-labels.mjs`（`ORDER_STATUS_ZH`，8 个状态，用词与 `admin/assets/js/adminApi.js:96` 的 `STATUS` 及 H5 `st*` key 一致），`server/routes/orders.mjs:194` 改为 `${ORDER_STATUS_ZH[to]}`；售后决定分支（:186-191）本来已用中文，不动；DB 中旧消息不 backfill，只新消息用中文标签。(b) 用户需求表：H5 加 3 个 i18n key `dmPending/dmApproved/dmRejected`（待审核/已通过/已拒绝，与管理端表格用词一致），`web/assets/js/apiClient.js` 加 `demandStatusKey`，`web/assets/js/UserDashboard.jsx:851` 改为 `t(demandStatusKey(d.status))`；H5 i18n 322 → **325**。(c) 小程序：加 2 个 key `stRefundRequested/stDisputed`（3 语言）并补 `STATUS_KEY`（`miniprogram/pages/orders/orders.js` 与 `pages/detail/detail.js`，两页共用同一 map，2 个新状态在两页都曾显示空白）到 8 个状态；小程序 i18n 127 → **129**（注：plan 写 131 是错的——两法核实 HEAD 实际 127）。
- **B-039 — 品类名中文界面只出现一次：**`web/assets/js/data.js` 加 helper `catBoth`（中文只返回 1 个名，vi/en 保持“中文 · 本地语”双语显示）；`web/assets/js/App.jsx:531/550/768` 改用 `catBoth`（:531 仅中文时隐藏第二个 span；:602/:804 是“品类 · 城市”，两个不同字段，不改）。
- **B-040 — 管理端徽章始终写真实权限：**徽章“仅查看 · 只读”是错的一方——admin 确有写权限（全部管理端路由都校验 admin 角色，4 个售后决定仅 admin 可做，管理端 web 没有 viewer 角色）；`admin/assets/js/AdminDashboard.jsx:747` 改为固定“管理操作 · 审计留痕”，删 `canWrite`（:683，仅 :747 用）；:758 注释（用户表无修改操作）正确，保留。以后若加 viewer 角色，徽章须改回按角色判断（不按 view）。
- **B-041 — 座位图改真网格：**`web/assets/css/main.css:404` `.seatgrid` 由 `display:flex;flex-wrap:wrap` 改 `display:grid`；`web/assets/js/App.jsx:852` 加动态列数 `gridTemplateColumns: "repeat(" + seatCols + ", 8px)"`，按各场馆真实 `seatCols`（20×20 / 11×20 / 10×18，绝不 hard-code 20）；圆点 8px + 间距 3px 不变。
- **B-030 — 3 个管理端表格标题用已筛选数字：**沿用 B-029 在 `:745` 的模式扩展到 orders/resources/demands，用已有已筛选数组 `filteredOrders/filteredResources/filteredDemands`；未筛选时数字与旧总数相同，标题不变。
- **P3-1 — deposit 标签“分”改“元”：**仅改 `web/assets/js/data.js` 的 `metaDeposit`（3 语言：押金（元，模拟）/ Tiền đặt cọc (¥, mô phỏng) / Deposit (¥, simulated)，vi/en 用 ¥ 符号，按 `admResPrice` 惯例）；值本来已是 yuan（`/100`），不动；保留（模拟）标记；小程序不渲染 deposit，不改。
- **P3-2 — 助手 `myRefund` 归组 2 个新状态：**`server/routes/assistant.mjs:112-132` 的 groups 加 `refund_requested`（已申请退款，等待管理员处理）与 `disputed`（申诉处理中，等待管理员处理）；`myOrders` 分支（:147-160）的 `${o.status}` 改为 `${ORDER_STATUS_ZH[o.status] || o.status}`（用 B-038 的共用 map）。
- **测试：** 新 `tests/p3bugs.test.mjs`（B-038a 新消息含“已支付”且无“→ paid”、售后决定消息回归、P3-2 两组新状态现身且回答无英文状态码；i18n key 集断言 H5 325 / 小程序 129；读文件断言 B-040/B-041/P3-1）；`tests/wave3.test.mjs` i18n 断言 322 → 325。
- **验证：** 逐项验证（build + npm test + smoke 30/0，全新 disposable DB）+ 部署 1 次 + kiểm live；最终：196 test（184 pass / 0 fail / 12 skip），smoke 30/0，部署 guiyan-platform-bs40vgigf，kiểm live 8/8 PASS。

## Lộ trình 82 module — Sóng R1 店铺平台（多店铺）

Plan：`~/workspace/_work/guiyan-roadmap82-plan.md`（471 行）。Lam 批准 2026-11-13 14:39（Q1–Q8 全部默认）。在 HEAD `fc08189` 的干净树上实施；R1 只含 xlsx 第 1、3、4 行（3 item，每项 1 commit）；不做 R2–R9，不做第 79/82 行（新渠道——仅提案）。基线：199 test（187/0/12），smoke 30/0，H5 i18n 325 / 小程序 129，14 表，seed DB（一次性）users 139 / orders 310 / resources 62 / demands **34**（3 demo + 6 catalog + 25 新增；旧记 28 是错的）。

- **R1-1 — 多店铺组织 + 分权（第 1 行）：** 新表 `shops`（`CREATE TABLE IF NOT EXISTS`，`schema.mjs`）：`id`、`parent_id`（NULL = 总店）、`name`、`owner_id`（REFERENCES users，须为 admin）、`status`（`active`/`disabled`，默认 `active`）、`created_at`；`users.shop_id` 与 `resources.shop_id` 用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（`postgres.mjs`，与 email/avatar 同模式）。Backfill 在 setup 内、按 guard-key 模式（如 tagRules）：总店“桂演平台总店”id 1（`parent_id` NULL，`owner_id` = admin id 1，`active`）；全部现有资源 `shop_id` → 1；全部现有用户 `shop_id` 保持 NULL。**权限规则：** 仅 role=admin 可进 `/api/admin/*`；`shop_id` NULL = 平台管理员（全部店铺）；`shop_id` = N 只可见/可改本店资源——列表按 shop 过滤、新建强制归属本店、改/同步他店资源 → 403；店铺的创建/修改仅平台管理员；总店（id 1）不可停用。**接口（新文件 `server/routes/shops.mjs`）：** `GET /api/admin/shops`（列表，含店主名 + 资源数）、`POST /api/admin/shops`（建子店：`{name, owner_id?, parent_id?}`，默认 parent = 1；建店同时把店主的 `shop_id` 置为新店 id）、`PATCH /api/admin/shops/:id`（改名/店主/状态；换店主时旧店主 `shop_id` → NULL，新店主 → 该店 id）；审计分别为“新增店铺”/“修改店铺”。`admin-resources.mjs` 接入分权：列表过滤、创建强制 shop、改/同步校验归属。**管理端 UI：** 侧栏主组新增“店铺”视图（店铺表 + 创建/修改表单）；资源表加店铺列 + 按店铺筛选（仅平台管理员可见筛选）。**验证：** 建 2 个子店，A 店看不到/改不了 B 店资源（403）；新测试 `tests/r1-shops.test.mjs`。
- **R1-2 — 管理员信息管理（第 3 行）：** `PATCH /api/admin/profile`（改自己的姓名/邮箱；邮箱格式 + 去重 SELECT → 409，沿用 account.mjs 的 email 规则）；`PATCH /api/admin/users/:id/status`（`{status: "active"|"disabled"}`；不可停用自己 → 400，目标不存在 → 404；审计“管理账号”）；`POST /api/admin/change-password`（`{newPassword, code}`；OTP 发到管理员**当前邮箱**，复用现有 `POST /api/account/send-otp` + `POST /api/account/verify-otp` + `consumeVerifiedCode`（account.mjs 导出复用）；未设邮箱的管理员须先在 profile 里设邮箱；新密码 ≥6 ≤100 且与旧密码不同；审计“修改密码”）。登录拒绝已停用账号 → 401（不计入登录失败次数）；会话查询排除 disabled，用户被停用后 token 立即失效。**管理端 UI：** 用户视图加状态列 + 启用/停用按钮（除自己外）；侧栏主组新增“账号”视图（本人资料 + OTP 改密码表单）。**验证：** 停用 → 登录 401，重新启用 → 200；审计有记录。
- **R1-3 — 店铺装修（第 4 行）：** `shops.theme TEXT`（JSON，`postgres.mjs` 用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`）；`GET /api/shops/:id/theme`（公开，合并默认值返回；店铺不存在 → 404）+ `PATCH /api/admin/shops/:id/theme`（admin；子店管理员仅可装修本店，平台管理员全部；theme 须为对象、未知字段 → 400，banner ≤200 字，主色须在桂演 7 色内，栏目为 7 个标准栏目的无重复子集，否则 400；部分 PATCH 合并后保存；审计“修改店铺装修”；损坏的存储 JSON 按字段回退默认值）。**H5：** `?shop=`（默认 1），fire-and-forget 拉取 theme；横幅（`.shop-banner`）+ 主色（CSS 变量 `--shop-primary`，仅首页搜索按钮与精选按钮，无 theme 时回退品牌红）；栏目顺序用 flex-column `.shop-sections` 包裹 + `secStyle`（未列出的栏目隐藏）。**小程序：** 首页 best-effort 拉取 `/api/shops/1/theme`，横幅 + 主色。**管理端 UI：** 店铺表每行“装修”按钮（平台管理员任意店，子店管理员仅本店）+ 装修表单（横幅、主色下拉、栏目复选框按标准顺序；仅配置表单，不做拖拽）。**验证：** 新测试 `tests/r1-theme.test.mjs`（3 test）；smoke 检查 31（theme 200，默认主色）+ 33（未知店铺 404）。
- **通用规则：** 迁移沿用现有模式；金额整数分（不动）；先校验、后写入，同一请求内写入后不 throw（OTP 的教训）；管理端无 i18n，文案硬编码中文；H5 新增面向客户的文案须补 3 语言 i18n key。**每项验证：** build + `npm test`（0 fail）+ smoke 30/0（GCP 一次性 DB/容器，`down -v` 清理）；**不 redeploy**（Q8 默认）。

## Lộ trình 82 module — Sóng R2 票务核心（演出 + 票价 + 座位）

Plan：`~/workspace/_work/guiyan-roadmap82-plan.md`（471 行）§3.2。Lam 批准 2026-11-13 14:39（Q1–Q8 全部默认）；R1 已做完（3 commit，HEAD `dc54009`），Lam 2026-11-13 17:42 说“commit xong thì tiếp tục”——R2 从此开始。在 HEAD `dc54009` 的干净树上实施；R2 只含 xlsx 第 5–13 行（5 item，每项 1 commit）；不做 R3–R9，不做第 79/82 行（新渠道——仅提案）。基线：217 test（205/0/12），smoke 34/0，H5 i18n 325 / 小程序 129，15 表，seed DB（一次性）users 139 / orders 310 / resources 62 / demands **34**（3 demo + 6 catalog + 25 新增）。

- **R2-1 — 登 show + buổi diễn（第 5、6 行）：** 新表 `shows`（`CREATE TABLE IF NOT EXISTS`，`schema.mjs`）：`id`、`shop_id`（REFERENCES shops）、`resource_id`（REFERENCES resources，须为 `show` 类、归属同店）、`title`、`description`（默认 ''）、`status`（`pending`/`approved`/`rejected`，默认 `pending`）、`created_by`（REFERENCES users）、`created_at`；新表 `performances`：`id`、`show_id`（REFERENCES shows）、`start_at`（ISO 日期时间，日期部分 ≥ 演示基准日 2026-11-09）、`price_cents`（整数分，基础价）、`status`（`scheduled`/`on_sale`/`cancelled`，默认 `scheduled`）、`created_at`。**接口（新文件 `server/routes/shows.mjs`）：** `POST /api/shows`（admin；子店管理员仅本店，平台管理员可传 `shop_id` 否则默认 1；resource 不存在/非 show 类/非同店 → 400/404；建完 `pending`）；`GET /api/shows`（公开：仅 `approved`，含 performances，可按 `?shop=`/`?resource_id=` 过滤）+ `GET /api/shows/:id`（公开仅 approved，admin 看全部）；`GET /api/admin/shows`（admin；子店管理员仅本店，可按 `?status=` 过滤）；`PATCH /api/admin/shows/:id`（admin；子店管理员仅本店；`{status: approved|rejected}`；审计“审核演出”）；`POST /api/shows/:id/performances`（admin；本店；show 须已 `approved` 否则 400；`{start_at, price_cents}`）；`PATCH /api/admin/performances/:id`（admin；本店；改状态 `on_sale`/`cancelled` + `start_at`/`price_cents`；`scheduled` → `on_sale`，任意 → `cancelled`）。**权限：** 跨店一律 403（沿用 R1-1 的 shop 分权）；非 admin → 403。**availability 扩展：** `GET /api/resources/:id/availability` 增加 `performances` 数组（已通过 show 的在售 buổi diễn：`{id, start_at, status, price_cents}`），旧字段不动。**管理端 UI：** 侧栏新增“演出”视图（show 表 + 创建表单 + 通过/拒绝按钮 + 每 show 的 buổi diễn管理：创建 + 上架/取消）。**H5：** 资源详情浮层加 buổi diễn区（仅已通过 show）。**小程序：** 详情页加 buổi diễn列表（只读）。**验证：** 新测试 `tests/r2-shows.test.mjs`（8+ test）：建 show → pending；非 admin → 403；跨店建 show → 403；通过 → 公开可见、可建 buổi diễn；拒绝 → 公开不可见、不可建 buổi diễn；pending show 建 buổi diễn → 400；上架 buổi diễn → 出现在 availability；跨店改 buổi diễn → 403。Smoke 检查 34（`GET /api/shows` 200，空列表），teardown 改号 35。
- **R2-2 —  hạng giá（第 7 行）：** 新表 `ticket_types`：`id`、`performance_id`（REFERENCES performances）、`name`（如 普通/早鸟/套票）、`price_cents`（整数分）、`quota`（整数，票数上限）、`sale_until`（ISO 日期时间，可空；早鸟仅在截止前可卖）、`created_at`。**接口（新文件 `server/routes/ticket-types.mjs`）：** `POST /api/performances/:id/ticket-types`（admin；本店；`{name, price_cents, quota, sale_until?}`）、`PATCH /api/admin/ticket-types/:id`（admin；本店；改价/数量/截止）、`GET /api/performances/:id/ticket-types`（公开，仅在售 buổi diễn）。**订单接入：** `orders` 加列 `performance_id`、`ticket_type_id`（`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`）；`POST /api/orders` 接受 `{performance_id, ticket_type_id}`：校验 buổi diễn `on_sale` + show 已通过 + hạng thuộc buổi diễn + 截止（`sale_until` 为空或当前时间 ≤ 截止，否则 400）+ 余量（已售 `SUM(quantity)`，状态不在 `cancelled`/`refunded`，售满 → 409）；金额 = hạng价 × 数量（服务端算，忽略客户端金额）；`booking_date` 由服务端取 buổi diễn日期；hạng票订单不扣 `resources.stock`（余量由 quota 控制）。不带 hạng 的订单走旧流程不变（资源价 + `booking_date`）。**availability 扩展：** 每个 performance 增加 `ticket_types: [{id, name, price_cents, quota, sold, available, sale_until}]`。**UI：** H5 详情浮层选 buổi diễn → 选 hạng → 数量；小程序同流程；管理端在 buổi diễn管理内加 hạng CRUD。**验证：** 新测试 `tests/r2-tiers.test.mjs`（8 test）：早鸟过截止 → 400；套票算总价正确；售满 → 409；hạng不属于 buổi diễn → 400；旧流程订单金额仍按资源价；availability 返回 hạng + 已售数。Smoke 检查 35（availability 含 ticket_types），teardown 改号 36。
- **R2-3 —  Điểm lấy vé + mẫu vé（第 8、9 行）：** 新表 `pickup_points`：`id`、`show_id`（REFERENCES shows）、`name`、`address`、`created_at`；新表 `ticket_templates`：`id`、`shop_id`（REFERENCES shops）、`name`、`color`（须在桂演配色内，复用 R1-3 的 7 色）、`layout`（JSON 文本，对象，可选字符串字段，有长度上限）、`is_default`（整数，默认 0）、`created_at`。**接口（新文件 `server/routes/pickup.mjs`）：** `POST /api/shows/:id/pickup-points`（admin；本店）、`GET /api/shows/:id/pickup-points`（公开）、`DELETE /api/admin/pickup-points/:id`（admin；本店）；`GET /api/admin/ticket-templates`（admin；本店）、`POST /api/admin/ticket-templates`（admin；本店；设默认时清除同店旧默认）、`PATCH /api/admin/ticket-templates/:id`（admin；本店）、`GET /api/shops/:id/ticket-template`（公开：返回默认模板，无默认 → 返回内置默认）。**订单接入：** `orders` 加列 `pickup_point_id`（REFERENCES pickup_points）；`POST /api/orders`：若 buổi diễn的 show 已配置 ≥1 取票点，则 `pickup_point_id` 必填（缺 → 400），且须属于该 show（否则 400）；无 buổi diễn的旧流程订单传 `pickup_point_id` → 400（该资源无需选点）；订单返回含取票点 + 店铺默认模板。**UI：** 管理端 show 管理内加取票点区；店铺视图旁加模板管理（模板按店）；H5 下单流程在需取票时显示取票点选择；我的票券显示模板色 + 取票点；小程序下单流程同 H5。**验证：** 新测试 `tests/r2-pickup.test.mjs`（6 test）：需取票而不选 → 400；选别 show 的点 → 400；选点下单 → 200 且存库；默认模板公开返回 200；设新默认 → 旧默认清除；跨店改模板 → 403。Smoke 检查 36（`GET /api/shops/1/ticket-template` 200 默认模板），teardown 改号 37。
- **R2-4 —  实体场馆 + 座位模板（第 10、11 行）：** 新表 `venues`：`id`、`shop_id`（REFERENCES shops）、`name`、`address`、`capacity`（整数）、`floor_plan`（文本描述，默认 ''）、`created_at`；新表 `seat_templates`：`id`、`venue_id`（REFERENCES venues）、`name`、`zones`（JSON 数组 `[{name, rows, cols}]`，每区行列均为正整数）、`created_at`。**接口（新文件 `server/routes/venues.mjs`）：** `GET /api/venues`（公开列表）+ `GET /api/venues/:id`（公开，含座位模板列表 + `has_seats` 布尔）；`POST /api/admin/venues`（admin；本店）、`PATCH /api/admin/venues/:id`（admin；本店）；`POST /api/venues/:id/seat-templates`（admin；venue 归属本店）、`GET /api/venues/:id/seat-templates`（公开）、`PATCH /api/admin/seat-templates/:id`（admin；本店）。**资源接入：** `resources` 加列 `venue_id`（REFERENCES venues）；管理端创建/编辑资源接受 `venue_id`（须存在 + 同店，否则 400/403）；资源详情返回 `venue: {id, name, address}`（有则）。**Backfill（`postgres.mjs` setup 内，guard 模式）：** 对已有 `meta.seatRows/seatCols` 且 `venue_id` 为 NULL 的 venue 类资源建 venue（名 = 资源名，`capacity` = `seatRows`×`seatCols`，`address` 取 `meta.address`），同店同名 venue 已存在则复用；仅处理 `venue_id` 仍为 NULL 的行。Seed 现状：2 个 demo venue（广西文化艺术中心 20×20、南宁小剧场 11×20）+ 4 个 catalog venue（10×18：邕江艺术空间·黑匣子剧场、漓江畔·山水露天舞台、柳江青年艺术剧场、海风文化客厅·多功能厅）→ 新 DB 建 6 个 venue。（原记 3 是错的，实为 6 — 2 demo + 4 catalog；Lam 2026-11-13 决定选 (a)：backfill 规则原样不动，只改数字。）`meta.seatRows/seatCols` 保留不动（R2-5 之前旧座位图显示仍用它作回退）。**无座位场馆：** `GET /api/venues/:id` 返回 `seat_templates: []` + `has_seats: false`；管理端显示“未配置座位模板”提示。**UI：** 管理端侧栏新增“场馆”视图（场馆表 + 创建/编辑 + 每馆座位模板编辑）；资源表单加场馆下拉；H5 详情有 venue 时显示场馆名/地址块；小程序详情同。**验证：** 新测试 `tests/r2-venues.test.mjs`（6 test）：建场馆 → 200；资源挂 `venue_id` → 200 且详情含 venue；跨店挂 venue → 403；无模板场馆 → `has_seats: false`；建座位模板 → zones 存库；新 DB backfill 出 6 个 venue 且对应资源已挂 `venue_id`。Smoke 检查 37（`GET /api/venues` 200，6 个），teardown 改号 38。
- **R2-5 —  选座 + 场馆经营分析（第 12、13 行）：** 新表 `seats`：`id`、`performance_id`（REFERENCES performances）、`row`、`col`、`zone`（默认 ''）、`status`（`available`/`held`/`sold`，默认 `available`）、`order_id`（REFERENCES orders，可空）、`held_until`（ISO 时间，可空）、`created_at`；`UNIQUE(performance_id, row, col)`。**接口（新文件 `server/routes/seats.mjs`）：** `POST /api/admin/performances/:id/seats/generate`（admin；本店；按 venue 座位模板逐区生成座位；无模板 → 400“该场馆未配置座位模板”；已存在座位跳过，幂等）；`GET /api/performances/:id/seats`（公开，仅在售 buổi diễn；过期 hold 读时视为可用）；`POST /api/orders/:id/seats`（订单本人；订单须为 `pending`；`{seat_ids}`：座位须属于该订单的 buổi diễn、全部可用（或已被本单 hold），否则 409；成功则 hold 10 分钟：`status='held'`，`order_id`，`held_until=now+10min`）。**防重原理：** 写请求全程持全局 advisory lock（`postgres.mjs` 的 `request()`，写即串行），hold 的“查后改”在同一事务内完成，第二个并发请求看到的已是 held 状态——race 用事务 + 锁解决，不另加锁。**座位生命周期：** 订单 `pay` → 本单 held 座位变 `sold`（在 `transitionOrder` 的 pay 分支内同事务改）；订单 `cancel`/`refunded` → held 座位释放回 `available`。**无后台任务：** hold 过期不设定时清理，读时视为可用、写时顺手释放（lazy 过期），文档中写明，不谎称有定时任务。**选座 UI：** H5 详情浮层在已选 buổi diễn且有座位时显示可点座位格（替换 B-041 的仅显示格；无座位时保留旧显示格）；小程序选座格点选。**场馆分析改写：** `admin-insights.mjs` 的 venues 段改用 `venues` 表：每馆 performances = 经 `shows`→`resources.venue_id` 关联的 buổi diễn；`seatOccupancy` = 已售座位 / 座位总数（`seats` 表；无座位 → null）；`averageRevenue` = 票款 / buổi diễn数；`occupancy`/`idleRate` 仍按订单日期算；无数据时保留“暂无关联售票样本”（诚实状态，不是 bug）；响应结构不变（`venues[].recommendations` 等），管理端 UI 不动。**验证：** 新测试 `tests/r2-seats.test.mjs`（8 test）：generate → 座位数与模板一致；选座 → held；第 2 单选同一座 → 409；pay → sold；cancel → 释放；过期 hold（测试内直接改 `held_until`）可再选；analysis 数字与真实订单一致；无模板场馆 generate → 400。Smoke 检查 38（`GET /api/performances/99999/seats` 404），teardown 改号 39。
- **通用规则：** 迁移沿用现有模式；金额整数分（不动）；先校验、后写入，同一请求内写入后不 throw（OTP 的教训）；shop 分权：管理端写操作跨店 → 403，买票的客户不分店（任何用户可买任意店的票）；管理端无 i18n，文案硬编码中文；H5/小程序新增面向客户的文案须补 3 语言 i18n key（双向 key 数断言，如 `p3bugs.test.mjs`）；新文件创建后检查 `find . -perm 660`（Docker api 以 `node` 用户运行，660 会 EACCES）；测试文件共用一个 DB、按 `package.json` 顺序跑，改动共享 seed 状态的测试须在结尾恢复；**每项验证：** build + `npm test`（0 fail）+ smoke（GCP 一次性 DB/容器，`down -v` 清理）；**不 redeploy**（Q8 默认）；不 commit/push（Peter 另行处理）。

## Lộ trình 82 module — Sóng R3 会员 + 营销 + 文惠卡

Plan：`~/workspace/_work/guiyan-roadmap82-plan.md`（471 行）§3.3。Lam 批准 2026-11-13 14:39（Q1–Q8 全部默认）；R2 已做完（5 commit，HEAD `1a98ce1`），R3 从此开始。在 HEAD `1a98ce1` 的干净树上实施；R3 只含 xlsx 第 14–18、24–28、77 行（6 item，每项 1 commit）；本项只做 R3-1，不做 R3-2–R3-6，不做 R4–R9，不做第 79/82 行（新渠道——仅提案）。基线：256 test（244/0/12），smoke 39/0，H5 i18n 339 / 小程序 143，23 表，seed DB（一次性）users 139 / orders 310 / resources 62 / demands **34**（3 demo + 6 catalog + 25 新增），venues 6。

- **R3-1 — 会员等级 + 按等级折扣（第 24、14 行）：** 新表 `member_tiers`：`id`、`shop_id`（REFERENCES shops，等级属于一家店）、`name`、`min_spend_cents`（整数分，升级门槛）、`discount_pct`（整数 0–100，折扣百分比）、`benefits`（文本，默认 ''）、`created_at`；`users` 加列 `tier_id`（REFERENCES member_tiers，可空）；`orders` 加列 `discount_cents`（整数分，默认 0，本单实际减了多少钱）与 `tier_id`（REFERENCES member_tiers，可空，本单按哪个等级打折的快照）。**默认等级（`postgres.mjs` setup 内 guard 模式 backfill，总店 shop 1，无等级时才插）：** 普通会员（门槛 0，0%）、银卡会员（门槛 100000 分 = ¥1000，5%）、金卡会员（门槛 500000 分 = ¥5000，10%）、钻石会员（门槛 1000000 分 = ¥10000，15%）。**消费额定义（写死，不含糊）：** `SUM(amount)`，订单状态在 `PAID_STATUSES`（`lib/profiles.mjs` 已有：`paid`/`completed`/`disputed`/`refund_requested`——已付过款的单；`pending`/`confirmed` 未付款不算，`cancelled`/`refunded` 不算）；按店算（订单经 `resources.shop_id` 归属店铺）。**等级判定：** 某店内 `min_spend_cents ≤ 消费额` 的最高等级；同门槛并列时折扣高者胜，再按 id 升序（`ORDER BY min_spend_cents DESC, discount_pct DESC, id ASC LIMIT 1`）。**`users.tier_id` 的含义（写死）：** 只存**总店（shop 1）**的等级——总店是默认店，`GET /api/account/tier` 返回的就是它；其他店没有存储列，下单时按该店实时算。**升降级触发点（写死）：** 只在消费额变化的订单动作后重算——`pay`（消费额增加）、`complete`（消费额不变，仍重算一次，幂等）、`approveRefund`（消费额减少，可能降级）；`cancel`/`refund`（申请）/`dispute` 等不触发。**降级规则（写死）：** 只有消费额跌回门槛以下才降级（实际只有退款批准能让消费额减少）；没有时间过期、没有按日降级；改等级门槛本身不追溯重算已有用户（下次触发时才按新门槛算）。**折扣计算（服务端算，忽略客户端金额）：** 先按 R2 规则算底价（票种价 × 数量，或资源价 × 数量），再按订单店铺的有效等级打折：`discount_cents = floor(底价 × discount_pct / 100)`，`amount = 底价 − discount_cents`；总店用已存的 `users.tier_id`，其他店实时按该店消费额算；折扣与 R2 票种价叠加（先票种价，后会员折扣）。**接口（新文件 `server/routes/member-tiers.mjs`）：** `GET /api/shops/:id/member-tiers`（公开，按门槛升序；店铺不存在 → 404）；`GET /api/admin/member-tiers`（admin；子店管理员仅本店，可按 `?shop=` 过滤）；`POST /api/admin/member-tiers`（admin；本店；`{name, min_spend_cents ≥ 0, discount_pct 0–100, benefits? ≤500}`；审计“新增会员等级”）；`PATCH /api/admin/member-tiers/:id`（admin；本店；只改提供的字段；审计“修改会员等级”）；`GET /api/account/tier`（须登录；返回总店的 `{tier, spending_cents, next_tier, remaining_cents, discount_pct}`；无等级（新库无 backfill 时）→ `tier: null`，消费额仍返回；匿名 → 401）。**权限：** 跨店一律 403（沿用 R1-1 的 shop 分权）；非 admin → 403；买票的客户不分店（任何用户可买任意店的票，折扣按订单店铺算）。**模拟诚实：** 支付仍是模拟，折扣只是模拟金额上的算术；内部文档写明，不在用户界面加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）。**UI：** 管理端侧栏新增“会员等级”视图（等级表 + 创建/修改表单）；H5 用户面板信息 tab 加“我的会员”块（当前等级、折扣、累计消费、下一等级与还差多少）；小程序 我页加会员行（等级名 + 折扣）。**i18n：** 新增 5 个 key（`memberTierTitle` / `memberTierCurrent` / `memberTierNext` / `memberTierSpendMore` / `memberTierDiscount`），中越英三语集合相等，共 344 key（小程序 148）。**验证：** 新测试 `tests/r3-tiers.test.mjs`（8 test）：新 DB 默认 4 个总店等级；消费满 ¥1000 → 升银卡（`GET /api/account/tier` + 库里 `tier_id` 都对）；银卡下单 ¥28000 → 减 ¥1400、实付 ¥26600、`discount_cents`/`tier_id` 存库；退款批准后消费额跌回门槛下 → 降回普通；跨店建/改等级 → 403；`discount_pct` > 100 / 门槛为负 → 400；匿名查 tier → 401；别店资源下单无总店折扣（全价）。Smoke 检查 39（`GET /api/shops/1/member-tiers` 200，4 个等级），teardown 改号 40。
- **R3-2 — 优惠券（第 15 行）：** 新表 `coupons`：`id`、`shop_id`（REFERENCES shops，券属于一家店）、`code`（券码，见下格式）、`kind`（`fixed` 减固定金额 / `pct` 按比例）、`value_cents`（整数分，`fixed` 的减额；`pct` 时为 NULL）、`discount_pct`（整数 1–100，`pct` 的比例；`fixed` 时为 NULL）、`min_spend_cents`（整数分，默认 0）、`valid_from` / `valid_until`（ISO 文本，可空 = 不限起/止）、`quota`（整数，可空 = 不限总次数）、`per_user_limit`（整数，默认 1，每人最多用几次）、`status`（`active`/`disabled`，默认 `active`）、`created_at`；`UNIQUE(shop_id, code)`。新表 `coupon_redemptions`：`id`、`coupon_id`（REFERENCES coupons）、`user_id`（REFERENCES users）、`order_id`（REFERENCES orders）、`amount_cents`（整数分，本单券实际减了多少）、`created_at`；`UNIQUE(coupon_id, order_id)`。`orders` 加列 `coupon_id`（REFERENCES coupons，可空，本单用了哪张券的快照）与 `coupon_cents`（整数分，默认 0，本单券实际减了多少）。**叠加顺序（写死）：** 底价（R2 票种价 × 数量，或资源价 × 数量）→ 会员折扣（R3-1，`discount_cents`）→ 券在**折后余款**上算：`fixed` 减 `min(value_cents, 余款)`，`pct` 减 `floor(余款 × discount_pct / 100)`；`amount = 余款 − coupon_cents`，永不为负；全部整数分，服务端算，忽略客户端金额。**下单时校验（写死，全部 400，除注明外）：** 券码先规范化（去首尾空格 + 转大写）再按**订单店铺**查券——只在别店存在的码在本店视同不存在（400“优惠券不存在或不适用”）；`status` 须为 `active`；当前时间须在 `[valid_from, valid_until]` 内（空端不限）；最低消费按**折后余款**算（`余款 ≥ min_spend_cents`，否则 400）；总名额 `quota` 未满（实时 `COUNT(*)` 核销数 < quota，`quota` 为空 = 不限）；每人限额未满（实时 `COUNT(*)` 该用户核销数 < `per_user_limit`）；一单只能用一张券（只接受一个 `coupon_code`）。**核销与释放（写死）：** 核销行与订单行写在**同一事务**内（先校验、后写入，同一请求内写入后不 throw——OTP 的教训）；名额/每人计数是实时 `COUNT(*)`，写请求持全局 advisory lock 串行（与 R2-5 座位 hold 同理），事务内复核一次名额/限额防 race。订单进终态 `cancelled` 或 `refunded` 时在**同一事务内删除**该单核销行——名额与每人计数自动恢复；`refund_requested`/`disputed` 不释放（仍是已付派生态）；订单行的 `coupon_id`/`coupon_cents` 快照保留，历史可查。券减额计入实付 `amount`，故也减少会员消费额 `SUM(amount)`（券后实付才算消费）。**券码格式（写死）：** 规范化后须匹配 `^[A-Z0-9]{4,20}$`（大写字母+数字，4–20 位），否则 400；同店重码 → 409（创建前显式 SELECT 预查 + `UNIQUE(shop_id, code)` 兜底）。**字段校验（写死）：** `kind=fixed` 须 `value_cents` 为 1–100000000 的整数，`discount_pct` 不传；`kind=pct` 须 `discount_pct` 为 1–100 的整数，`value_cents` 不传；`min_spend_cents ≥ 0`；`quota` 为空或 ≥1 的整数；`per_user_limit ≥ 1`；`valid_from`/`valid_until` 同时给时须 `valid_from ≤ valid_until`，否则 400。**接口（新文件 `server/routes/coupons.mjs`）：** `GET /api/admin/coupons`（admin；子店管理员仅本店，可按 `?shop=` 过滤；每行含实时 `redemption_count` 与 `total_discount_cents`）；`POST /api/admin/coupons`（admin；本店；平台管理员默认 shop 1、可传 `shop_id`，子店管理员传别店 `shop_id` → 403；审计“新增优惠券”）；`PATCH /api/admin/coupons/:id`（admin；本店；只改提供的字段，`code`/`shop_id` 建后不可改；已核销的金额快照不变，新单按新值算；审计“修改优惠券”）；`GET /api/admin/coupons/:id`（admin；本店；券 + `redemption_count`/`total_discount_cents` + 最近 50 条核销）。**不设公开列表**（券码公开可查等于公开可领）。**订单接入：** `POST /api/orders` 接受可选 `coupon_code`（字符串；空串视同未传）；响应加 `coupon_id`、`coupon_cents`；`GET /api/orders/:id` 返回的行自带这两列。**权限：** admin 写操作跨店 → 403（沿用 R3-1 的显式 403，不用 admin-resources 的静默重定向）；匿名/非 admin 的 admin 接口 → 403；买票的客户不分店（任何用户可买任意店的票，券按订单店铺算）。**模拟诚实：** 支付仍是模拟，券只是模拟金额上的算术；内部文档写明，不在用户界面加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）。**UI：** 管理端侧栏新增“优惠券”视图（券表 + 创建/修改表单，含核销数/已减总额）；H5 详情浮层加券码输入（选填，随单提交；订单抽屉有券减额时显示抵扣行）；小程序详情页同流程。**i18n：** 新增 3 个 key（`couponCode` / `couponCodePh` / `couponSaved`），中越英三语集合相等，共 347 key（小程序 151）。**验证：** 新测试 `tests/r3-coupons.test.mjs`（9 test）：建券 → 200（`fixed` ¥5000 券 + `pct` 10% 券）；过期券 → 400；最低消费按折后余款算（银卡折后不足门槛 → 400）；一券一次：同一用户第二单用同一张 `per_user_limit=1` 的券 → 400；名额耗尽（`quota=1` 用掉后）→ 400；核销统计数正确（列表 `redemption_count`/`total_discount_cents` 与库一致）；银卡 5% + 10% 券叠加数学精确（¥28000 → 会员减 ¥1400 → 余 ¥26600 → 券减 ¥2660 → 实付 ¥23940）；跨店建/改券 → 403；同店重码 → 409；取消订单释放核销（名额/每人计数恢复，可再用）。Smoke 检查 40（`GET /api/admin/coupons` 200，空列表），teardown 改号 41。
- **R3-3 — 限时抢购（第 16 行）：** 新表 `flash_sales`：`id`、`shop_id`（REFERENCES shops，抢购属于一家店）、`performance_id`（REFERENCES performances，一场抢购只对一个场次）、`name`、`kind`（`fixed` 每张减固定金额 / `pct` 按比例）、`value_cents`（整数分，`fixed` 的每张减额；`pct` 时为 NULL）、`discount_pct`（整数 1–100，`pct` 的比例；`fixed` 时为 NULL）、`start_at` / `end_at`（ISO 文本，必填，须 `start_at < end_at`）、`quota`（整数，可空 = 不限总张数）、`status`（`active`/`disabled`，默认 `active`）、`created_at`。`orders` 加列 `flash_sale_id`（REFERENCES flash_sales，可空，本单按哪场抢购打折的快照）与 `flash_cents`（整数分，默认 0，本单抢购实际减了多少）。**目标范围（定死）：** 只对单个场次——R2 的价格本来就长在场次/票种上；整店抢购是后续扩展，本项不做。**折扣含义（定死）：** 按张算：`fixed` 时抢购单价 = `max(0, 票种价 − value_cents)`；`pct` 时抢购单价 = `floor(票种价 × (100 − discount_pct) / 100)`；`flash_cents = (票种价 − 抢购单价) × 数量`。**叠加顺序（定死）：** 抢购先算——抢购单价 × 数量 = 底价 → 会员折扣（R3-1，`discount_cents = floor(底价 × discount_pct / 100)`）→ 券（R3-2）在折后余款上算；`amount = 余款 − coupon_cents`，永不为负；全部整数分，服务端算。**生效窗口（定死）：** 下单时按服务端当前时间判定——“进行中” ⟺ `status = active` 且 `start_at ≤ now ≤ end_at` 且名额未满；窗口外下单按原价走单，不报错、不打折；窗口内下的单快照 `flash_sale_id`/`flash_cents`，之后付款仍按快照价（即使窗口已过）。**名额（定死）：** 每场抢购的总张数上限：`SUM(quantity)`，订单状态不在 `cancelled`/`refunded` 的才计（取消/退款自动释放名额，与票种 quota 同理）；名额耗尽时下单仍成功、按原价走单（抢购是优惠、不是拦单的门，永不 409）；名额在事务内复核（写请求持全局 advisory lock 串行，与 R2-5 座位 hold 同理）；下单前预检与事务内复核不一致时以事务内为准（抢购丢了就回落原价重算会员折扣与券；回落只会抬高余款，券的最低消费不会因此不通过）。**防重叠（定死）：** 同一场次同一时间只能有一场 `active` 的抢购——建/改时若与另一场 `active` 抢购的窗口重叠 → 409；`disabled` 的不占位置。**倒计时字段（定死）：** availability 里每个票种带 `flash_sale: null | {sale_id, name, kind, value_cents, discount_pct, sale_price_cents, ends_at, remaining_seconds, quota_remaining}`——`sale_price_cents` 是该票种的抢购单价，`ends_at` 是抢购结束时间，`remaining_seconds = max(0, floor((end_at − now) / 1000))`，`quota_remaining = quota − 已售`（`quota` 为空时为 null）；无进行中抢购时为 null。**接口（新文件 `server/routes/flash-sales.mjs`）：** `GET /api/admin/flash-sales`（admin；子店管理员仅本店，可按 `?shop=` 过滤；每行含实时 `sold_count` 与 `quota_remaining`）；`POST /api/admin/flash-sales`（admin；本店；平台管理员默认 shop 1、可传 `shop_id`，子店管理员传别店 `shop_id` → 403；场次须存在且属于该店，否则 400；审计“新增限时抢购”）；`PATCH /api/admin/flash-sales/:id`（admin；本店；只改提供的字段，`performance_id`/`shop_id` 建后不可改；改窗口/状态时重查重叠；审计“修改限时抢购”）；`GET /api/admin/flash-sales/:id`（admin；本店；抢购 + `sold_count`/`quota_remaining` + 最近 50 单）。**不设公开列表**（进行中的抢购随 availability 返回，够 C 端倒计时用；不另设可枚举的列表）。**订单接入：** `POST /api/orders` 不新增参数——场次订单自动按进行中的抢购计价（旧流程订单永不打抢购价）；响应加 `flash_sale_id`、`flash_cents`；`GET /api/orders/:id` 返回的行自带这两列。**权限：** admin 写操作跨店 → 403（沿用 R3-1/R3-2 的显式 403）；匿名/非 admin 的 admin 接口 → 403；买票的客户不分店（任何用户可买任意店的票，抢购按订单场次算）。**模拟诚实：** 支付仍是模拟，抢购只是模拟金额上的算术；内部文档写明，不在用户界面加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）。**UI：** 管理端侧栏新增“限时抢购”视图（抢购表 + 创建/修改表单，含已售数/剩余名额，场次下拉取自已加载的演出列表）；H5 详情浮层在已选票种有进行中抢购时显示抢购价（原价划线）+ 倒计时（每秒一跳）+ 订单抽屉的抢购减额行；小程序详情页同流程。**i18n：** 新增 3 个 key（`flashSale` / `flashSaleLeft` / `flashSaleSaved`），中越英三语集合相等，共 350 key（小程序 154）。**验证：** 新测试 `tests/r3-flash-sales.test.mjs`（8 test）：建抢购 → 200（`fixed` + `pct`）；窗口外（未开始/已结束）→ 原价；窗口内 → 抢购价 + availability 含倒计时字段（`sale_price_cents`、`ends_at`、`remaining_seconds > 0`）；`disabled` → 原价；叠加数学精确（票种 ¥28000 → 抢购 8 折 ¥22400 → 银卡 5% 减 ¥1120 → 余 ¥21280 → 10% 券减 ¥2128 → 实付 ¥19152）；名额耗尽 → 原价走单（200，不 409），取消订单释放名额后可再享抢购价；窗口内下的单在窗口结束后付款仍按快照价；重叠的 `active` 抢购 → 409；跨店建/改抢购 → 403；旧流程订单永不打抢购价。Smoke 检查 41（`GET /api/admin/flash-sales` 200，空列表），teardown 改号 42。
- **R3-4 — 自动赠券（第 17 行）：** 新表 `coupon_rules`：`id`、`shop_id`（REFERENCES shops，规则属于一家店）、`name`、`trigger`（`first_purchase` 首次购买 / `tier_upgraded` 升级，二选一，见下）、`coupon_id`（REFERENCES coupons，赠哪张券）、`conditions`（TEXT，JSON 对象，默认 `'{}'`，见下形状）、`status`（`active`/`disabled`，默认 `active`）、`created_at`。新表 `coupon_gifts`：`id`、`rule_id`（REFERENCES coupon_rules）、`coupon_id`（REFERENCES coupons）、`user_id`（REFERENCES users）、`trigger_ref`（TEXT，触发实例标识，见下）、`status`（`gifted` 已赠送 / `redeemed` 已使用，默认 `gifted`）、`redeemed_order_id`（REFERENCES orders，可空，哪个订单用了这张赠券）、`created_at`；`UNIQUE(rule_id, user_id, trigger_ref)`（幂等兜底）。**触发机制（定死）：** 没有后台 worker、没有 cron/定时任务——本波不建调度器；Plan §3.3 写的“worker 跟随 `events`”不做。赠券在**订单状态变更的同一事务内同步判定**：`transitionOrder` 的 `pay`/`complete` 在改状态前后各算一次该店实时等级、改完状态后调 `evaluateAutoCoupons`；每赠一张券同时写一条 `events` 行（`type='coupon_gift'`，`detail` 为 JSON：rule/coupon/code/trigger/trigger_ref，仅作审计轨迹——画像只读 `type='view'`、预警只读 `type LIKE 'alert.%'`，新类型不污染两者）。**触发种类（定死）：** 本波只支持两种。`first_purchase`：该用户在该店当前处于已付状态（`PAID_STATUSES`，与 R3-1 消费额同一定义）的订单数为 1 且就是本单——即首次购买；之前买过但已整单退款（状态 `refunded`，不在已付集合里）的不算首次。`tier_upgraded`：本单支付前后该店实时等级（`resolveTier`，任意店都现场算，不只总店）严格上升——支付前消费额不含本单、支付后含本单，`after.min_spend_cents > (before?.min_spend_cents ?? -1)` 才算升级；`complete` 时前后等级相同（单已付过），不重复触发，幂等守卫是兜底。**生日 OUT：** 本波不支持生日触发——`users` 只有 `age`，没有任何生日字段，无法判定生日；生日触发是后续扩展，不在本波假装支持。**条件 JSON 形状（定死）：** `conditions` 须为 JSON 对象；本波唯一已知键是 `min_spend_cents`（整数分 ≥ 0，仅 `first_purchase` 用：触发单的实付 `amount` 须 ≥ 它，默认 0）；未知键 → 400；`tier_upgraded` 规则传 `min_spend_cents` → 400（该触发无此含义）；非对象/解析失败 → 400。**赠送时券校验（定死）：** 券须存在且 `status='active'`，否则静默跳过（不赠、不报错，订单照常支付）；**不查**有效期窗口与名额——窗口由下单时 `validateCoupon` 执行，名额见下。**投递（定死）：** 赠券行（`status='gifted'`）+ 站内信（现有 `notify()`，标题“优惠券到账”，内容含券码 + 减额 + 有效期）；券本身与管理员发的券**完全一样**——用户下单时输券码，走同一条 `validateCoupon` 路径。**名额/每人限额（定死）：** 赠券**计入**同一套限额——在**核销时**按 `coupon_redemptions` 实时计数，与所有券共用一个计数规则（`quota`/`per_user_limit` 都算）；赠送本身**不预占**名额（否则未用过的赠券会烧掉名额，且先到先得的核销才公平：别人先用完名额，赠券就用不了，下单时按正常 400 报错）。**赠券状态流转（定死）：** 下单核销时把该用户该券最早一条 `gifted` 的赠券行翻为 `redeemed`（记 `redeemed_order_id`）；该单取消/退款批准、核销被释放时，赠券行翻回 `gifted`（`redeemed_order_id` 清空），可再用。**无追溯：** 规则只对创建之后的触发行为生效，不给已发生的首购/升级补发。**接口（新文件 `server/routes/auto-coupons.mjs`）：** `GET /api/admin/coupon-rules`（admin；子店管理员仅本店，可按 `?shop=` 过滤；每行含实时 `gift_count`）；`POST /api/admin/coupon-rules`（admin；本店；`{name, trigger, coupon_id, conditions?, status?}`；券须存在且属于同店，否则 400；审计“新增自动发券规则”）；`PATCH /api/admin/coupon-rules/:id`（admin；本店；只改提供的字段，`trigger`/`coupon_id`/`shop_id` 建后不可改，传了 → 400；审计“修改自动发券规则”）；`GET /api/admin/coupon-rules/:id`（admin；本店；规则 + `gift_count` + 最近 50 条赠券）；`GET /api/account/coupon-gifts`（须登录；只看自己的赠券，含券码/种类/减额/状态；匿名 → 401）。**权限：** admin 写操作跨店 → 403（沿用 R3-1/R3-2/R3-3 的显式 403）；匿名/非 admin 的 admin 接口 → 403。**模拟诚实：** 支付仍是模拟，赠券只是模拟金额上的算术；内部文档写明，不在用户界面加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）。**UI：** 管理端侧栏新增“自动发券”视图（规则表 + 创建/修改表单，含赠送数）；H5 用户面板加“我的优惠券”块（赠券列表：券码 + 减额 + 已用/未用）；小程序 我页加赠券区（同内容）。**i18n：** 新增 3 个 key（`giftCouponTitle` / `giftCouponEmpty` / `giftCouponUsed`），中越英三语集合相等，共 353 key（小程序 157）。**验证：** 新测试 `tests/r3-auto-coupons.test.mjs`（9 test）：建规则 → 200（两种触发各一）；校验 400（触发种类非法、条件 JSON 非对象/未知键、`tier_upgraded` 带 `min_spend_cents`、券属于别店）；首购 → 赠券行 + 站内信含券码 + `GET /api/account/coupon-gifts` 有它；不买 → 无赠券；第二单不再赠（同一规则赠送数仍为 1）；升级 → 赠（第 4 单付满 ¥1000 升银卡时赠）；规则停用 → 不赠；跨店建/改规则 → 403；同一单 `pay` 后再 `complete` 仍只赠 1 张（幂等守卫）；赠券下单可用（与普通券同一路径，计入每人限额，再用 → 400），取消用券单后赠券恢复 `gifted` 可再用。Smoke 检查 42（`GET /api/admin/coupon-rules` 200，空列表），teardown 改号 43。
- **R3-5 — 短信群发 + 关联账号（第 18、25 行）：** 新表 `sms_tasks`：`id`、`shop_id`（REFERENCES shops，任务属于一家店）、`name`、`template`（短信模板文本，见下）、`audience`（TEXT，JSON 对象，受众规则快照，见下）、`audience_count`（整数，建任务时算好的人数快照）、`status`（见下状态机，默认 `draft`）、`created_at`。共 30 张表。**状态机（定死）：** `draft` 草稿 → `queued` 已排队 → `waiting_provider` 未发送 — 等待服务商（本波终态）；`queued` 可回 `draft`；**不存在 `sent` 状态**——本波没有任何发送动作，也就没有“已发送”；任何写 `sent` 的请求（建任务时传 `status: "sent"`、PATCH 改成 `sent`、或任何其他非法状态）→ 400；`waiting_provider` 是终态，之后任何 PATCH 改状态或改内容 → 400。**内容编辑（定死）：** `name`/`template`/`audience` 只在 `draft` 时可改；`queued`/`waiting_provider` 时改内容 → 400；改受众时重算 `audience_count`。**受众（定死）：** 规则 JSON 只认两种——`{type: "all"}` 全部用户、`{type: "tier", tier_id}` 持有某等级的用户；未知 `type`/未知键/`tier` 缺 `tier_id` → 400；`tier_id` 须存在且属于任务的店，否则 400。人数在**建任务时算好并存下来**（`all` = `SELECT COUNT(*) FROM users`；`tier` = `SELECT COUNT(*) FROM users WHERE tier_id=?`，`users.tier_id` 只存总店等级，见 R3-1——分店等级受众在本波数出来是 0，文档写明，不假装有数据）；发送时不重查（本波根本不发送）。**标签受众本波不做：** 没有任何按用户存的标签（画像标签是算出来的，R7-5 的 `user_tags` 表不存在），标签受众是后续扩展。**不收手机号：** 受众绝不用手机号圈人——任务上不存任何手机号列表，只存规则 + 人数；电话只用账号上已有的那一个。**模板（定死）：** 管理员自填文本，1–500 字；占位符只认 `{{name}}`（收件人姓名）与 `{{code}}`（券码占位）；其他 `{{...}}` 或花括号不成对 → 400；没有服务商侧模板 ID；模板就是内容本身——**不另设渲染后内容列**，本波不渲染、不发送。**关联账号（定死，要小心）：** `PATCH /api/account/social` 的 `SOCIAL_KEYS` 加 `maoyan`（猫眼）；关联在这里的意思是**存一个用户手填的账号名并展示出来**（现有 social-links 模式：字符串，展示时标“仅展示，不验证归属”），**不是**真正的 OAuth 验证流程（无服务商、无 token 交换）；微信的真关联已存在（`POST /api/auth/wechat-mini` 写 `oauth_accounts`），本项不动它。`maoyan` 只是资料字段——**不是**新渠道接入，绝不包装成已接入的登录/支付（甲方渠道约束：只用客户现有渠道 Damai/微信支付/北京银行；抖音/猫眼在这里只作资料里的账号名 + 画像里的渠道来源）。坏 key → 400（现有行为）。**接口（新文件 `server/routes/sms-tasks.mjs`）：** `GET /api/admin/sms-tasks`（admin；子店管理员仅本店，可按 `?shop=` 过滤）；`POST /api/admin/sms-tasks`（admin；本店；`{name, template, audience}`；建任务永远是 `draft`，传了别的 `status` → 400；审计“新增短信任务”）；`PATCH /api/admin/sms-tasks/:id`（admin；本店；只改提供的字段，`shop_id` 建后不可改，传了 → 400；审计“修改短信任务”）；`GET /api/admin/sms-tasks/:id`（admin；本店；任务 + 受众规则）。**`postgres.mjs` 的 `RETURNING id` 表名列表须加 `sms_tasks`**（建任务要回写 id，与 R2-1–R3-4 每波的做法相同——漏加会导致 `lastInsertRowid` 为空、查 id 时报 22P02 而 500）。**不设公开列表**（短信是管理员营销工具，客户侧没有任务列表）。**权限：** admin 写操作跨店 → 403（沿用 R3-1/R3-2/R3-3/R3-4 的显式 403，不用 admin-resources 的静默重定向）；匿名/非 admin 的 admin 接口 → 403。**无服务商（定死，Q5 默认 (a)）：** 本波不注册任何短信服务商、不花钱、不发一条真短信；没有发送接口，`waiting_provider` 就是任务能走到的最远处；接服务商是留给 Lam 决定的开放项。**模拟诚实：** 任务、界面、文档三处都明写“未发送 — 等待服务商”，绝不宣称发过短信；用户端不加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）——“未发送”是功能性状态文案，不是演示横幅。**UI：** 管理端侧栏新增“短信群发”视图（任务表 + 创建/修改表单，状态列显示 草稿/已排队/未发送 — 等待服务商，顶部说明“尚未接入短信服务商，本波不发送短信”）；H5 社交 tab 加猫眼号输入行 + 已存账号的猫眼标签；小程序没有社交账号界面（现有的 `soc*` key 全是 H5 才有），猫眼沿用同一模式——小程序不动，不加死 key。**i18n：** 新增 1 个 key（`socMaoyan`：猫眼号 / ID Maoyan / Maoyan ID），H5 353 → 354，小程序仍 157。**验证：** 新测试 `tests/r3-sms-link.test.mjs`（7 test）：建任务 → 200（`draft`，`audience_count` 与库里用户数一致）；模板校验 400（未知占位符 `{{foo}}`、花括号不成对、超 500 字、空模板）；受众校验 400（未知 `type`、未知键、`tier` 缺 `tier_id`、别店的等级）；受众人数算对（`all` = 库里用户数，`tier` = 库里该等级人数）；状态流 `draft` → `queued` → `waiting_provider`，终态后任何 PATCH → 400，`sent` 永远到不了（建任务传 `sent` → 400，PATCH 成 `sent` → 400）；`queued` 后改内容 → 400，`draft` 时改受众重算人数；跨店建/改/读 → 403；`maoyan` 存下并返回、坏 key → 400、空串删除；i18n H5 354 / 小程序 157。Smoke 检查 43（`GET /api/admin/sms-tasks` 200，空列表），teardown 改号 44。
- **R3-6 — 文惠卡储值（第 26、27、28、77 行）：** 新表 `stored_value_accounts`：`id`、`user_id`（REFERENCES users）、`shop_id`（REFERENCES shops，账户属于一家店）、`balance_cents`（整数分，默认 0，当前余额）、`created_at`；`UNIQUE(user_id, shop_id)`（一人一店一个账户）。新表 `stored_value_ledger`：`id`、`account_id`（REFERENCES stored_value_accounts）、`kind`（`topup` 充值 / `spend` 消费 / `refund` 退款返还 / `bonus` 赠送）、`amount_cents`（整数分，**有符号**：充值/赠送/退款为正，消费为负）、`order_id`（REFERENCES orders，可空，消费/退款关联的订单）、`note`（文本，默认 ''）、`created_at`。新表 `stored_value_plans`：`id`、`shop_id`（REFERENCES shops，套餐属于一家店）、`amount_cents`（整数分，充多少钱）、`bonus_cents`（整数分，送多少钱，默认 0）、`status`（`active`/`disabled`，默认 `active`）、`created_at`。共 33 张表。**默认套餐（`postgres.mjs` setup 内 guard 模式 backfill，总店 shop 1，无套餐时才插）：** 充 ¥100 送 ¥10（10000/1000）、充 ¥200 送 ¥30（20000/3000）、充 ¥500 送 ¥100（50000/10000）。**余额上限（定死）：** 每账户 ¥5000（500000 分）；充值或补贴使余额超过上限 → 400（“储值余额上限为 ¥5000”）；上限按账户算（分店账户各有自己的上限）。**充值（定死）：** `POST /api/account/topup` 只接受 `{plan_id}`——用户选套餐，不直接输金额（任意金额充值是后续扩展）；套餐须存在且 `status='active'` 且属于该套餐的店，否则 400（未知套餐 404）；充值本身是**模拟支付**（Q3 默认 (a)，无真实资金流动，内部文档写明）；同一事务内：账户不存在则创建（余额 0），余额 += `amount_cents + bonus_cents`，同时写两行流水——`topup`（+`amount_cents`）与 `bonus`（+`bonus_cents`，`bonus_cents` 为 0 时不写赠送行）；响应含 `simulated: true`。**消费抵扣（定死）：** 文惠卡在 `pay` 时抵扣（订单创建时不扣——`pending`/`confirmed` 未付款，取消不涉及储值）；抵扣额 `stored_value_cents = min(余额, amount)`（`amount` 是 flash → 会员 → 券之后的最终实付，储值不改变 `amount`，只改变**支付方式**，故会员消费额 `SUM(amount)` 不受影响）；同一 `pay` 事务内：余额 −= 抵扣额，写 `spend` 流水（−抵扣额，关联订单），订单行写 `stored_value_cents` 快照；余款 `remainder_cents = amount − stored_value_cents` 走原模拟支付路径；`pay` 响应加 `stored_value_cents` 与 `remainder_cents`；余额为 0 时抵扣 0，流程不变；**本波无“不用文惠卡”开关**——有余额就默认抵扣（开关是后续扩展）；储值永不把金额算成负数（`min(余额, amount)` 保证）。**退款优先（定死）：** `approveRefund` 时退款先回文惠卡——本波只有整单退款（部分退款是 R4-4），故返还额 = 该单 `stored_value_cents`（即当初从卡里扣的全部）；同一事务内：余额 += 返还额，写 `refund` 流水（+返还额，关联订单），订单行的 `stored_value_cents` 快照保留（历史可查）；`cancel`（未付款）与 `refund_requested`/`disputed`（未批准）不产生储值流水；`pay` 的通知文案带上卡扣额（“文惠卡已扣 ¥X，剩余 ¥Y 为模拟支付”），无卡扣时沿用旧文案。**第 77 行（定死，分两件，不造第二套卡）：** （a）平台满减券 = `coupons` 表的一行，`kind='fixed'` + `min_spend_cents`，`shop_id=NULL` 表示**平台级、全店通用**——复用现有券表，只扩展它：`findCoupon`/`validateCoupon` 先查订单店铺的券，查不到再查 `shop_id IS NULL` 的平台券（同码店券优先）；建平台券须显式传 `shop_id: null`（不传 = 默认总店 1，旧行为不变；子店管理员传 null → 403）；重码预查分开处理 NULL 店（`UNIQUE(shop_id, code)` 在 Postgres 里把 NULL 视作互不相同，预查是防重码的真正防线）；列表：子店管理员看到本店券 + 平台券，平台管理员看到全部；改平台券只有平台管理员能改（现有 `assertCouponAccess` 对 `shop_id NULL` 已是 403）；（b）“专属补贴卡”**不是第二套卡**——它就是文惠卡账户里由平台/管理员发放的补贴余额：`POST /api/admin/stored-value/grant`（admin；`{user_id, shop_id?, amount_cents 1–500000, note?}`；平台管理员默认 shop 1、可传 `shop_id`，子店管理员传别店 → 403；同一事务内账户不存在则创建、余额 += 金额、写 `bonus` 流水（note 默认为“平台补贴”）；上限同样适用，超限 → 400；审计“发放储值补贴”）。**流水导出（定死）：** CSV 带 BOM，与 Wave 5 管理端 CSV 同一模式：`GET /api/account/stored-value?format=csv`（本人）与 `GET /api/admin/stored-value/:userId?format=csv`（admin；子店管理员仅本店账户）；列：流水号、时间、类型、金额(元)、订单号、备注；类型中文映射（充值/消费/退款返还/赠送）。**画像诚实（定死）：** `GET /api/profile` 的 `spending.balance` 从此是**真实**总店余额（整数分，无账户时为 0），`storedValue` 由“尚未接入”改为“已接入”——Wave 3 #11 的 TBD 正式终结；`profiles.mjs` 里用总店 id 字面量 `1`（与 `member-tiers.mjs` 的 `MAIN_SHOP_ID` 同值，字面量是为避开 `profiles.mjs` ↔ `member-tiers.mjs` 的循环引用，注释写明）。**接口（新文件 `server/routes/stored-value.mjs`）：** `GET /api/shops/:id/stored-value-plans`（公开，按金额升序，只返回 `active`；店铺不存在 → 404）；`GET /api/admin/stored-value-plans`（admin；子店管理员仅本店，可按 `?shop=` 过滤）；`POST /api/admin/stored-value-plans`（admin；本店；`{amount_cents ≥ 1, bonus_cents ≥ 0, status?}`；审计“新增储值套餐”）；`PATCH /api/admin/stored-value-plans/:id`（admin；本店；只改提供的字段，`shop_id` 建后不可改；审计“修改储值套餐”）；`POST /api/account/topup`（须登录；`{plan_id}`；匿名 → 401）；`GET /api/account/stored-value`（须登录；`?shop=` 默认 1；返回 `{account, plans, ledger, total}`，`ledger` 分页 `?limit=` 默认 50、上限 200、`?offset=` 默认 0；`?format=csv` 走导出；匿名 → 401）；`GET /api/admin/stored-value/:userId`（admin；`?shop=` 默认 1；账户 + 流水分页，同上；`?format=csv` 走导出；用户不存在 → 404）；`POST /api/admin/stored-value/grant`（admin；见上）。**`orders` 加列 `stored_value_cents`（整数分，默认 0，本单实际从卡里扣了多少，快照）。**`postgres.mjs` 的 `RETURNING id` 表名列表须加 `stored_value_accounts`、`stored_value_ledger`、`stored_value_plans`（R3-5 的 `sms_tasks` 教训——漏加会导致 `lastInsertRowid` 为空、查 id 时报 22P02 而 500）。**订单接入：** `POST /api/orders` 不新增参数（储值在 `pay` 时算）；创建响应加 `stored_value_cents: 0`；`GET /api/orders/:id` 返回的行自带该列。**权限：** admin 写操作跨店 → 403（沿用 R3-1–R3-5 的显式 403）；匿名/非 admin 的 admin 接口 → 403；买票的客户不分店（任何用户可充任意店的套餐、可买任意店的票，抵扣按订单店铺的账户算）。**模拟诚实：** 充值与支付仍是模拟，无真实资金流动；内部文档写明，不在用户界面加演示标签（Lam 的重建决定已去掉用户端演示标签，不加回）。**UI：** 管理端侧栏新增“文惠卡”视图（套餐表 + 创建/修改表单 + 补贴发放表单 + 按用户查账户/流水）；H5 用户面板信息 tab 加“文惠卡”块（余额 + 套餐充值按钮 + 最近流水 + 导出链接，数据随 info tab 的 `loadTabInfo` 一起取，失败时该块隐藏）；小程序 我页加储值区（同内容，余额 + 套餐 + 流水行）。**i18n：** 新增 6 个 key（`storedValueTitle` / `storedValueBalance` / `storedValueTopup` / `storedValuePlan` / `storedValueEmpty` / `storedValueUsed`），中越英三语集合相等，共 360 key（小程序 163）。**验证：** 新测试 `tests/r3-stored-value.test.mjs`（10 test）：默认 3 个总店套餐（公开列表）；充值 100 送 10 → 余额 110、流水 2 行（`topup` +10000、`bonus` +1000）；买 ¥120 的单 → `pay` 后 `stored_value_cents` 11000、余款 1000、余额 0、流水 `spend` −11000；退款批准 → 余额回 11000、`refund` 流水 +11000；超上限充值 → 400（充 ¥500 套餐 8 次余额 ¥4800，第 9 次 → 400，余额不动）；未知/停用套餐 → 400；流水分页 + CSV 导出（BOM + 6 列 + 行数对）；行 77：平台满减券（`shop_id NULL`）在别店订单上生效（券减额对），店券优先于平台券（同码时用店券）；补贴发放 → 余额 +`bonus` 流水、超限 → 400、跨店发放 → 403；跨店建/改套餐 → 403；匿名充值/查储值 → 401、非 admin 的 admin 接口 → 403。Smoke 检查 44（`GET /api/admin/stored-value-plans` 200，3 个默认套餐），teardown 改号 45。
- **通用规则：** 迁移沿用现有模式；金额整数分（不动）；先校验、后写入，同一请求内写入后不 throw（OTP 的教训）；管理端无 i18n，文案硬编码中文；H5/小程序新增面向客户的文案须补 3 语言 i18n key（双向 key 数断言，如 `p3bugs.test.mjs`）；新文件创建后检查 `find . -perm 660`（Docker api 以 `node` 用户运行，660 会 EACCES）；测试文件共用一个 DB、按 `package.json` 顺序跑，改动共享 seed 状态的测试须在结尾恢复；**每项验证：** build + `npm test`（0 fail）+ smoke（GCP 一次性 DB/容器，`down -v` 清理）；**不 redeploy**（Q8 默认）；不 commit/push（Peter 另行处理）。

## Lộ trình 82 module — Sóng R4 现场服务（扫票 + 打印 + PDA + 部分退款）

Plan：`~/workspace/_work/guiyan-roadmap82-plan.md`（471 行）§3.4。Lam 批准 2026-11-13 14:39（Q1–Q8 全部默认）；R3 已做完（6 commit，HEAD `0de37df`），R4 从此开始。在 HEAD `0de37df` 的干净树上实施；R4 只含 xlsx 第 20、22、29–31、35、78 行（4 item，每项 1 commit，不 commit/push/deploy——Peter 事后处理）。基线：307 test（295/0/12），smoke 45/0，H5 i18n 360 / mini-program 163，33 表，fresh-DB seed users 139 / orders 310 / resources 62 / demands 34，venues 6。

- **R4-1 — 扫票入场（第 20、30 行）：** 每张票有独立票码（QR 文本）。新表 `tickets`：`id`、`order_id`（REFERENCES orders）、`seat_id`（REFERENCES seats，可空）、`code`（TEXT UNIQUE）、`status`（`issued`/`used`/`void`，默认 `issued`）、`printed_at`（TEXT，可空）、`verified_at`（TEXT，可空）、`verified_by`（REFERENCES users，可空）、`created_at`。新表 `verify_logs`：`id`、`ticket_id`（REFERENCES tickets，可空）、`code`、`result`（`used`/`already_used`/`not_found`/`void`/`refund_pending`）、`verified_by`（REFERENCES users，可空）、`created_at`——每次核销尝试（成功 + 失败）都记一条，供管理端查“谁、何时、核销了哪张票”。**票码格式（固定）：** `GY` + 8 位大写字母数字（`crypto.randomBytes` 生成，如 `GY7K2Q9X4M`），可手输；UNIQUE 约束，23505 时重试，最多 5 次后 500。**发票时机（固定）：** 只在 `pay` 时发——`transitionOrder` 的 pay 分支内，同一事务，在储值抵扣 + 座位变 `sold` 之后，按订单 `quantity` 生成 N 张票；有座订单按座位（row, col 升序）一一挂 `seat_id`，无座订单 `seat_id` 为 NULL。**回填（setup 内 guard 模式，R2-4 场馆回填同款）：** 状态为 paid/completed/disputed/refund_requested 且一张票都没有的订单，补发 `quantity` 张票（`seat_id` NULL——种子订单都是旧流程，无座位）；cancelled/refunded 的订单不补（已作废）。**接口（新文件 `server/routes/tickets.mjs`）：** `POST /api/verify/:code`（仅 admin——本系统没有独立的“员工”角色，员工 = admin 角色，特此注明；票码先 trim + 大写）；`GET /api/orders/:id/tickets`（本人或 admin）；`GET /api/admin/tickets`（admin，按店过滤，`?order_id=&status=&code=`）。**核销规则（固定）：** 未知码 → 404 + 记 `not_found`；已作废 → 400“票已作废”+ 记 `void`；已核销 → 400“票已核销”+ 记 `already_used`（响应仍带票 + 订单信息，方便门口查看）；在退款审核冻结中的票（见 R4-4）→ 400“票正在退款审核中”+ 记 `refund_pending`；`issued` → `used`（写 `verified_at`/`verified_by`）+ 记 `used`，同一事务内先查后改（写请求持全局 advisory lock 串行，与 R2-5 座位 hold 同一道理）。**不查日期/场次（固定）：** 本波核销只查票状态，不校验演出日期——已过期场次的票仍可核销，特此注明，不谎称已校验。**全额退款联动：** `approveRefund` 走旧全额路径时，同一事务内把该订单所有 `issued` 票置 `void`；`cancel`（付款前）本来就没有票；`dispute`/`resolve` 不动票。**UI：** 管理端侧栏新增“核销”视图（输码 + 结果卡 + 最近核销记录）；H5 订单详情“我的票”块（票码 + 状态）；小程序订单详情票码。**验证：** 新测试 `tests/r4-tickets.test.mjs`（8 test）：付款发 N 张票（票码唯一、座位一一对应）；扫一次 → used；扫第二次 → 400 已核销；未知码 → 404；作废票 → 400；非 admin → 403；匿名 → 401；全额退款后票变 void。Smoke 检查 46（`GET /api/admin/tickets` 200），teardown 改号 47。
- **R4-2 — 打印纸质票（第 29 行）：** 新表 `print_logs`：`id`、`ticket_id`（REFERENCES tickets）、`printed_by`（REFERENCES users）、`printed_at`（TEXT）、`created_at`。**接口（同 `server/routes/tickets.mjs`）：** `POST /api/admin/tickets/print`（admin；`{order_id}` 或 `{ticket_ids}`；按店过滤——票经订单 → 资源 `shop_id`，平台 admin 全店，子店 admin 只管本店，跨店 → 403）；`GET /api/admin/print-logs`（admin，按店过滤，`?ticket_id=&order_id=`）。**打印规则（固定）：** 只有 `issued` 票可打印；used/void → 400；冻结中（R4-4 退款审核中）→ 400；已打印过的 `issued` 票可重打（新 log 行，更新 `printed_at`——卡纸重打的场景）。**诚实边界：** 该接口只记录打印事件；真正的纸张输出是浏览器的票面打印（`window.print` + 票面打印样式），不接任何实体打印机、不谎称已连打印机。**UI：** 管理端“核销”视图每单打印按钮（调接口 + 打开票面打印）；H5 订单详情“打印票”按钮。**验证：** 新测试 `tests/r4-print.test.mjs`（7 test）：打印 → log 有行 + `printed_at` 有值；重打 → 再添一行；used/void/冻结票 → 400；跨店 → 403；非 admin → 403；log 列表按票/单过滤。Smoke 检查 47（`GET /api/admin/print-logs` 200，空列表），teardown 改号 48。 **已验证 2026-11-14（GCP my-llm，一次性 DB，无 commit/push/deploy）：** build PASS（本地 3.03s，GCP 2.87s）；**npm test 322（310/0/12）**——r4-print 7/7；**seed-integrity 4/4**（users 139 / orders 310 / resources 62 / demands 34，venues 6）；**smoke 47/0**（检查 47 `GET /api/admin/print-logs` 200 空列表 PASS，teardown 48 PASS，0 残留）；H5 i18n **367** / 小程序 **169**（新增 1 个 `printTicket` key 两边）；表 35 → **36**；测试后 DB：print_logs 3 行。**与原定设计的差别：** 冻结票（pending partial refund）的 400 只在代码层——复用 R4-1 的 information_schema 探针，`pending_refund_tickets` 列不存在时视作无冻结；该用例未写测试（列要到 R4-4 才有，无冻结票可测），R4-4 补测。H5 客户打印是浏览器打印（不记 print_logs，记日志的接口只对 admin 开放）；管理端打印先调接口记日志，再开票面打印。
- **R4-3 — PDA + 手机扫票（第 31、78 行）：** **接口：** `POST /api/verify/batch`（admin；`{codes: [...]}`，最多 50 个码；空数组 → 400；超 50 → 400；一个事务内逐码处理，单个坏码不 throw——整批继续；返回每码结果 `{code, result, ticket?, order?}`；幂等：重发同一批，已核销的返回 `already_used`，不重复核销；每次尝试都写 `verify_logs`）。**离线队列（固定）：** 小程序把离线扫到的码存本地（`guiyan-verify-queue`），有网时自动同步 + 手动“同步”按钮调 batch 接口；H5 管理端“核销”视图同样用 localStorage 存离线队列 + 批量粘贴多码。**震动 + 语音（固定，诚实边界）：** 小程序用 `wx.vibrateShort`（成功）/`wx.vibrateLong`（失败）+ 大字结果；小程序没有原生 TTS，语音播报只在 H5 用 Web Speech API（`speechSynthesis`）+ `navigator.vibrate`，小程序不用语音——特此注明，不谎称小程序会说话；也不接任何第三方语音插件。**小程序新页：** `pages/verify/verify.{js,wxml,json}`（核销页，用 `wx.scanCode` 扫码 + 手输；子页 `wx.navigateTo` 进入，tabBar 仍是 5 个，不加 tab；仅已关联的 admin 账号可用）。**验证：** 新测试 `tests/r4-batch.test.mjs`（8 test）：混合一批（成功/已核销/未知/作废各有结果）；重发幂等；超 50 → 400；空 → 400；同一批内重复码（第一张 used，第二张 already_used）；匿名/非 admin → 403。Smoke 检查 48（`POST /api/verify/batch` 一个假码 → 200，结果 `not_found`，无副作用），teardown 改号 49。**已验证 2026-11-14（GCP my-llm，一次性 DB，无 commit/push/deploy）：**build PASS（本地 3.32s，GCP 2.87s）；**npm test 330（318/0/12）**——r4-batch 8/8；**seed-integrity 4/4**（users 139 / orders 310 / resources 62 / demands 34，venues 6）；**smoke 48/0**（检查 48 `POST /api/verify/batch` 假码 → 200 not_found PASS，teardown 49 PASS，0 残留）；H5 i18n **367** / 小程序 **176**（新增 7 个 batch key 仅小程序——管理端批量核销标签按管理端规则写死中文）；表保持 **36**；测试后 DB：tickets 262、verify_logs 16、print_logs 3。**与原定设计的差别：**batch 路由在 index.mjs 里先于单码核销分发（单码 matcher 会把 "batch" 当票码吃掉）；冻结票的 400 只在代码层（同 R4-1 探针，无测试，列到 R4-4 才有）；扫码按钮多加 1 个 i18n key `verifyScan`（批量核销标题做按钮文案会误导）。
- **R4-4 — 自助取票 + 部分退款（第 35、22 行）：** **自助取票（固定）：** 本系统的自助取票流 = 客户凭单看票 + 打印——`GET /api/orders/:id/tickets`（R4-1）+ H5 订单详情票面打印（`window.print`）+ 小程序票码展示；实体自助取票机是场馆硬件，不在本系统内，特此注明，不谎称已接机器。**部分退款（固定）：** 扩展现有退款 transition（`POST /api/orders/:id/refund`，可选 `{quantity: k, reason}`），不另开退款表。新增订单列（ALTER 模式）：`refund_quantity INTEGER NOT NULL DEFAULT 0`（累计已退票数）、`refunded_cents INTEGER NOT NULL DEFAULT 0`（累计已退金额）、`pending_refund_tickets TEXT DEFAULT '[]'`（当前人工审核中的部分退款所选票 id 的 JSON 数组；`[]` = 无待审部分退款 / 全额申请）。**单张退款额（固定）：** `perTicket = floor(amount / quantity)`；`cardPerTicket = floor(stored_value_cents / quantity)`；退 k 张 = `perTicket × k`，其中文惠卡先返 `cardPerTicket × k`（复用 `refundStoredValue`，传部分金额），其余为模拟退款；floor 余下的零头留在商家，特此注明。**选票规则（固定）：** 先选未打印的 `issued` 票（id 升序），不够再选已打印的。**自动 vs 人工（固定，plan 原句）：** 所选 k 张全未打印 → 自动，同一请求内立即执行；其中有已打印的 → 人工：把所选票 id 存入 `pending_refund_tickets`，状态 → `refund_requested`，`refund_decision` 清空（B-035 规则），等 admin 决定。**自动执行（固定）：** 所选票置 `void`，其座位释放回 `available`（`order_id` 清空，仅限本单已售座位），退钱（卡先返 + 模拟），`refund_quantity += k`，`refunded_cents += 退款额`，状态保持 `paid`，notify + audit。**人工决定（固定）：** `approveRefund` 有待审票时按存下的票 id 执行部分退款（任一存下票已非 `issued` → 400“票状态已变，请重新申请”——请求后票被冻结，核销/打印都会 400 拒绝，见 R4-1/R4-2，因此该 400 只在极端竞态下出现）；`refund_decision` 写“审核通过，已模拟退款（部分退款）”，状态回 `paid`；`rejectRefund` 清空待审票，回 `paid`，decision 写拒绝原因（现有行为）。**全额退款（k = 剩余张数，或不传 quantity）：** 走旧全额路径——状态 `refund_requested`，`approveRefund` 退精确余款（`amount − refunded_cents`；卡返 `stored_value_cents − cardPerTicket × refund_quantity`，无部分退款史时等于旧值），作废全部剩余 `issued` 票，已售座位保持 `sold`（R2-5 规则不变）。**注意：** 部分退款不重算 coupon/tier/flash（券已用不恢复，特此注明）；`refund_requested`/`disputed` 不写储值流水（R3-6 规则不变）；`cancel` 不动票（付款前无票）。**UI：** H5 订单详情“申请部分退款”（数量选择 + 已退票数/已退金额显示）；管理端售后决定时显示待审票数与金额。**验证：** 新测试 `tests/r4-partial-refund.test.mjs`（9 test）：未打印票部分退 → 自动、票 void、座位释放、卡先返、订单仍 paid；已打印票部分退 → 人工（refund_requested + 待审票）；批准部分退 → 回 paid、金额按 floor 公式；拒绝 → 回 paid、无退款；冻结票核销/打印 → 400；全额余款退款精确；k 超剩余 → 400；k=0 → 400；非本人 → 403。Smoke 检查 49（`POST /api/orders/999999/refund` → 404，路由存在、无副作用），teardown 改号 50。**已验证 2026-11-14（GCP my-llm，一次性 DB，无 commit/push/deploy）：** build PASS（本地 3.57s，GCP 2.88s）；**npm test 339（327/0/12）**——r4-partial-refund 9/9；**seed-integrity 4/4**（users 139 / orders 310 / resources 62 / demands 34，venues 6）；**smoke 49/0**（检查 49 `POST /api/orders/999999/refund` 404 PASS，teardown 50 PASS，0 残留）；H5 i18n **372** / 小程序 **181**（新增 5 个 key 两边：pickupNote / partialRefundQty / partialRefundBtn / partialRefundDone / partialRefundPrintedNote）；表保持 **36**；测试后 DB：tickets 278、verify_logs 19、print_logs 12。**与原定设计的差别（设计不变，补充两点）：**（a）全额退款路径同样结清累计计数（refund_quantity = quantity、refunded_cents = amount）——两列的定义就是“累计”，只结清余款不结清计数会让已全退的订单仍显示部分退款额；（b）小程序的数量选择器本波只做 H5——小程序退款仍走原 modal 整单退，picker 两个 key 只为与 H5 的 i18n 对齐；小程序订单页显示自助取票说明 + 已退票数/金额 + 已打印票人工审核提示。**验证事故（勿重犯）：**（1）i18n 计数断言散在 15 个以上测试文件里（wave3、r2-*、r3-*、r4-*、p3bugs），只改 p3bugs/r2-pickup/r4-tickets 会漏——首次 GCP 运行只因此挂 1 个（wave3 i18n），`&&` 链断在第一批，R4 文件根本没跑；（2）新测试文件用户名含 `-`（r4pr-seat 等）——注册规则只允许 `[A-Za-z0-9_]`，9 个测试全在 register 400；已改无连字符名；教训：测试用户名一律沿用 r4-tickets 的无连字符风格。
- **通用规则：** 迁移沿用现有模式（`CREATE TABLE IF NOT EXISTS` in `schema.mjs` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `postgres.mjs` + guard-key 回填 in setup，不建 migration 目录）；新表必须进 `postgres.mjs` 的 `RETURNING id` 白名单（`tickets`、`verify_logs`、`print_logs`——否则 `lastInsertRowid` 为空，查 id 时 22P02 → 500，R3-5 的教训）；金额整数分（不动）；先校验、后写入，同一请求内写入后不 throw（OTP 的教训）；GET 跑在 `REPEATABLE READ READ ONLY`——核销/打印/批量接口都是 POST 写事务，不用 `csvExportPath` 式 carve-out；管理端写操作按店过滤（跨店 → 403），买家可买任意店的票；管理端无 i18n，文案硬编码中文；客户可见文案加 3 语言 i18n 键，H5 + 小程序两边（key 数断言两边，像 `p3bugs.test.mjs`，每项更新该文件的 360/163 断言）；每项新文件跑容器前查 `find . -perm 660`（Docker api 以 `node` 用户跑——660 文件导致 EACCES）；test 文件共用一个 DB，按 `package.json` 顺序跑——改动共享种子状态的测试必须恢复；每项在 GCP 上验证（fresh 一次性 DB，`down -v` 收尾）；**不 redeploy**（Q8 默认），**不 commit/push**（Peter 事后处理）。
