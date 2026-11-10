# 桂演 Guiyan — 广西演艺资源平台（Premium Redesign）

桂演是广西演艺资源一站式平台：剧目、场馆、艺人团队、非遗体验、版权与文创、数字演出、文旅套餐，在线浏览与预订。本仓库是**新版文化惠票务系统**的高级重设计（Premium Redesign），**只面向顾客**：没有管理后台、没有内部数据看板、没有路线图与设计对照——打开就能用。

> 演示数据全部为虚构；支付、AI 客服、版权确权均为**模拟**，不产生真实交易。

## 目录结构

```
guiyan-platform/
├── web/                  网页版（静态单文件，直接用浏览器打开）
│   └── index.html
├── server/               后端：Node.js + PostgreSQL 真实数据库（详见 server/README.md）
│   ├── server.mjs / app.mjs / postgres.mjs / schema.mjs / seed.mjs
│   ├── docker-compose.yml / .env.example
│   └── README.md
├── tests/                后端测试（真实 PostgreSQL）
│   └── api-pg.test.mjs
└── miniprogram/          微信小程序版（与网页版同一份数据、同一流程）
    ├── app.js / app.json / app.wxss
    ├── project.config.json / sitemap.json
    ├── assets/           底部导航图标
    ├── utils/            data.js（62 项资源）· i18n.js · store.js · api.js
    └── pages/            index（首页）· category（目录）· demands（需求大厅）
                          assistant（智能助理）· orders（我的票券）· detail（详情与预订）
```

## 后端：真实 PostgreSQL 数据库（可选）

网页版与小程序版默认离线运行（数据在本地，刷新/重装后订单会重置）。
如需订单、收藏、需求在多端共享、长期保存，可启动后端：

```bash
cd server
docker compose up -d   # PostgreSQL 16
cp .env.example .env   # 设置 DEMO_PASSWORD / ADMIN_PASSWORD（首次启动前）
npm ci && npm start    # http://localhost:3001，首次启动自动建表并 seed 62 项资源
```

- Web：由后端在 `/` 直接提供，默认走同源 `/api`；也可加
  `?api=http://localhost:3001` 指向其他服务；API 不可达时自动回落
  到离线演示数据。
- 小程序：`app.js` 中 `globalData.apiBase` 默认留空（离线）；填入
  服务地址后启用在线模式（开发者工具预览需勾选“不校验合法域名”）。
- API 只面向顾客：浏览、登录、预订、订单状态机、需求、收藏、规则
  助手；支付与 AI 均为模拟。详见 [server/README.md](server/README.md)，
  测试见 [tests/api-pg.test.mjs](tests/api-pg.test.mjs)（真实
  PostgreSQL，非 mock）。

## 部署到 Vercel（静态网页 + API 函数 + Neon PostgreSQL）

部署前请先有 Vercel 账号；本次只准备配置，**尚未部署**。完整说明见
[server/README.md](server/README.md#部署到-vercel静态网页--api-函数--neon-postgresql)。

- Vercel 项目设置：Root Directory 为仓库根目录；Framework 为 Other，
  Build Command 与 Output Directory 留空；Node.js 22。
- 环境变量（在 Vercel 控制台设置，**不要提交**）：`DATABASE_URL`
  （Neon PostgreSQL，新加坡区域）、`DEMO_PASSWORD`、`ADMIN_PASSWORD`
  （首次启动前设置）。
- `web/index.html` 在 `/` 直接提供；`/api/*` 由 `api/index.js`
  处理，复用 `server/` 的同一套代码与接口；区域 `sin1`。
- 首次连接自动建表并 seed 62 项资源；已有数据的库不会被清空，
  重新部署不会重置业务记录。
- 小程序不能部署到 Vercel，仍用微信开发者工具编译运行。

## 网页版怎么打开

不需要安装、构建或启动服务器：

1. 打开 `web/index.html`（双击，或在浏览器中选择“打开文件”）。
2. 在页面顶部切换语言：**中文 / Tiếng Việt / English**（下拉选择，以后加新语言只需扩展语言列表）。
3. 试一试完整流程：搜索或筛选资源 → 点开详情 → 选日期与数量 → 立即预订 → 在“我的票券”里依次完成确认 → 模拟支付 → 完成；也可取消或申请退款。

网页版是静态单文件：刷新后订单与收藏会重置（演示用途）。如需长期保存并多端共享，请启动 `server/` 后端（见上节）。

## 小程序版怎么运行

### 在微信开发者工具里打开

1. 打开微信开发者工具 → 导入项目 → 选择本仓库的 `miniprogram/` 目录。
2. `project.config.json` 已包含测试 AppID（`touristappid`），可直接编译预览；**不可用它发布上线**。
3. 点“编译”，即可在模拟器里体验：首页、目录、需求大厅、智能助理、我的票券、详情预订——与网页版同一份 62 项资源、同一套价格与订单流程。
4. 真机预览：点“预览”，用微信扫码即可在手机上打开。

### 在微信里使用（发布后）

将 `project.config.json` 中的 AppID 换成你自己的小程序 AppID 后提交审核；小程序默认完全离线运行（数据在本地），不需要配置服务器域名。如需接通真实后端，在 `app.js` 的 `globalData.apiBase` 中填入服务地址，并按微信要求配置合法域名与 HTTPS。

## 语言（i18n）

- 支持 **中文、Tiếng Việt、English**，默认越南语（与网页版一致）。
- 语言用下拉框（picker）选择，方便以后继续加语言；选择后整页立即重绘，订单与收藏不受影响。
- 小程序会记住你的选择（存在手机本地）；网页版在当前会话内有效。

## 顾客能做什么

| 功能 | 说明 |
|---|---|
| 浏览与搜索 | 62 项资源（22 项原始演示资源 + 40 项目录资源），按品类、城市、价格、人气筛选排序 |
| 预订 | 选日期与数量 → 预订 → 确认 → 模拟支付 → 完成，生成电子票券（票号如 `GY20261110xxxx`） |
| 取消与退款 | 待确认/已确认可取消；已支付可申请退款 |
| 收藏 | 收藏资源，在“我的票券”页查看 |
| 需求大厅 | 9 条合作需求，按同品类、预算内、同城优先智能匹配资源 |
| 智能助理 | 规则客服：退改签、预订方式、非遗推荐、热门演出（**模拟**，未接入大模型） |

## 模拟边界（请如实说明）

- **支付是模拟的**：点“支付”不会扣款、不产生真实交易。
- **AI 是模拟的**：助理按本地规则回答，使用平台真实资源数据，但没有接入大语言模型。
- **版权 / 区块链确权 / 物流 / 核销系统均未真实接入**，只展示流程与状态。
- 全部演出、场馆、价格、订单均为演示用的虚构数据；仓库里**没有任何账号与密码**。

## 技术说明

- 网页版：静态 HTML + 原生 JavaScript（无框架、无构建步骤）。
- 小程序版：微信原生小程序（WXML / WXSS / JS），数据在 `miniprogram/utils/data.js`；价格单位为人民币（¥），原始演示数据的价格以“分”为单位存储，导入时已换算为元。
- 设计语言：深松绿 `#0B3D36`、朱砂红 `#C8452C`、鎏金 `#C9A24B`、暖纸色 `#F7F4EE`，标题字体 Noto Serif SC。

---

## Tóm tắt tiếng Việt

桂演 (Guiyan) là nền tảng tài nguyên biểu diễn nghệ thuật Quảng Tây — xem và đặt vé kịch, thuê sân khấu, nghệ sĩ, trải nghiệm di sản, gói văn hóa–du lịch. Đây là bản thiết kế lại cao cấp, **chỉ dành cho khách hàng**: mở `web/index.html` là dùng được ngay; bản mini-program trong `miniprogram/` thì import vào WeChat DevTools là chạy. Hỗ trợ 3 ngôn ngữ (tiếng Trung, tiếng Việt, tiếng Anh) qua ô chọn thả xuống. Có 62 tài nguyên, đặt vé đủ quy trình (đặt → xác nhận → thanh toán mô phỏng → hoàn tất), sàn nhu cầu, trợ lý tư vấn và Vé của tôi. Thanh toán và AI đều là **mô phỏng**, không có giao dịch thật, không có tài khoản/mật khẩu trong repo. Đã chuẩn bị sẵn cấu hình deploy lên Vercel (web tĩnh + API function, database Neon Postgres ở Singapore, `DATABASE_URL` đặt trong biến môi trường của Vercel) — xem mục “部署到 Vercel”; mini-program không deploy lên Vercel được.

## English summary

Guiyan is a Guangxi performing-arts resource platform — shows, venues, artists, heritage experiences, copyright/creative products, digital shows and cultural-tourism packages in one place. This is the premium redesign, **customer-facing only**: open `web/index.html` in a browser to use the web version; import `miniprogram/` into WeChat DevTools to run the mini-program. Three languages (Chinese, Vietnamese, English) via a dropdown picker. 62 resources, full booking flow (book → confirm → simulated payment → complete), a request hall with smart matching, a rule-based assistant, and My Tickets. Payment and AI are **simulated**; all data is fictional and no accounts or passwords are stored in this repo.
