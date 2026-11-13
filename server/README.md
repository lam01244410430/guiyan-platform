# 桂演后端（PostgreSQL 真实数据库）

> Tóm tắt tiếng Việt ở cuối file.

桂演 premium redesign 的后端：纯 Node.js（`node:http`，无框架）+
PostgreSQL 16。顾客功能包括浏览资源、登录/注册、预订下单、
订单状态机、需求大厅、收藏、AI 助手（代理试用后端，失败回退规则）。
管理后台接口：管理员可查看统计、订单、用户与需求，并可审批需求、
创建/编辑资源、触发/处理预警（写操作均记审计日志）。

## 目录结构

```
server/
├── server.mjs           入口：校验 DATABASE_URL，启动 HTTP 服务
├── index.mjs            createApp、请求 ctx、顺序路由表、事务包装与 HTTP 服务
├── lib/
│   ├── http.mjs         校验、时间、金额与安全响应辅助函数
│   ├── context.mjs      createContext(database)：查询、审计、通知、事务与对象存储
│   ├── cache.mjs        Redis 缓存（fail-open，X-Cache）
│   ├── profiles.mjs     用户画像与标签规则（渠道映射等）
│   ├── rate-limit.mjs   登录限流（IP+用户名，5 次/小时）
│   └── status-labels.mjs 订单状态中文标签（服务端/助手共用）
├── routes/              每个路由函数接收一个 ctx；处理后返回 true，否则 false
│   ├── misc.mjs         健康检查、分类
│   ├── resources.mjs    资源列表、详情
│   ├── auth.mjs         注册、登录、注销、改密码、登录限流
│   ├── account.mjs      资料/头像/邮箱/手机/社交账号（邮箱、手机改 OTP 验证）
│   ├── oauth.mjs        微信小程序 wx.login 关联（jscode2session）
│   ├── orders.mjs       本人订单、下单、状态流转
│   ├── demands.mjs      需求列表、发布
│   ├── favorites.mjs    收藏列表、切换、删除
│   ├── messages.mjs     收件箱（未读、标已读）
│   ├── assistant.mjs    AI 助手代理 + 规则回退
│   ├── ai-copy.mjs      本地模板文案（小红书/公众号/短信）
│   ├── profile.mjs      用户画像与推荐
│   ├── tag-rules.mjs    管理员标签规则
│   ├── storage.mjs      对象存储 API（使用 server/storage.mjs）
│   ├── admin.mjs        管理员统计、订单、用户、需求（读）
│   ├── admin-insights.mjs 趋势/经营分析、预警、需求审批、审计日志、CSV 导出
│   └── admin-resources.mjs 管理员创建/编辑资源、渠道同步（模拟）
├── static.mjs           web/ 静态页面与 assets；路径越界、缺失文件返回 JSON 404
├── postgres.mjs         pg 连接池、建表、首次启动批量 seed
├── schema.mjs           14 张表（原 11 张 + verification_codes / login_attempts / oauth_accounts）
├── seed.mjs             演示数据：139 位用户、310 笔订单、22 项资源（另 40 项在 catalog-content.mjs）
├── catalog-content.mjs  另外 40 项资源 + 6 条需求（enrichCatalog）
├── storage.mjs          可选的 Neon S3 兼容对象存储客户端
├── docker-compose.yml   本地 PostgreSQL 16
├── .env.example         环境变量模板（不要提交 .env）
└── package.json         依赖：pg、AWS S3 SDK
```

数据库：14 张表 `users / sessions / resources / orders / demands /
comments / messages / favorites / events / audit_logs / settings /
verification_codes / login_attempts / oauth_accounts`（后 3 张为
OTP 验证码、登录限流、微信关联所加）。
金额一律整数分（`price`、`amount`、`budget` 均为分）；
密码为 scrypt 加盐哈希，永不明文存储；收藏是
`favorites(user_id, resource_id)` 联合主键；外键约束开启。

## 本地运行

```bash
cd server
docker compose up -d          # 启动 PostgreSQL 16（guiyan/guiyan/guiyan，仅本地开发）
cp .env.example .env          # 按需修改
npm ci
npm start                     # http://localhost:3001
```

首次启动自动建表并 seed：62 项资源（原 demo 22 项 + 目录 40 项）、
139 位用户（39 位演示用户 + 100 位新增用户）、310 笔订单（130 笔
演示订单 + 180 笔新增订单）、34 条需求（3 条演示 + 6 条目录 + 25 条
新增用户）、120 个收藏。`curl
http://localhost:3001/api/health` 应返回 `{"ok":true,"mode":"postgres",
"database":"postgres","today":"2026-11-09"}`（`today` 为订单日期下限
基线，非当天日期）；打开 `http://localhost:3001/` 即为新版 Web
（默认提供 `web/`、`admin/` 源码；要跑 React 构建版，先在仓库根
目录 `npm run build`，再在 `server/` 以 `STATIC_DIR=dist npm start`
启动，phase 8 Docker 镜像即用此模式）。

`DATABASE_URL` 必填，缺失时进程直接退出并提示用法。对象存储是可选的：
`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_ENDPOINT_URL_S3`、
`AWS_REGION` 四个变量缺一个，`/api/storage/*` 就返回 503
“对象存储未配置”，其余接口不受影响。这四个变量由 `neon deploy`
写入 `.env.local`（见根目录 `neon.ts`；bucket 为 `uploads`）。
演示账号在**首次启动前**由环境变量决定：

```bash
DEMO_PASSWORD=... ADMIN_PASSWORD=...
```

- `demo`：普通用户（林同学，已认证，可发布需求）
- `supplier`：资源方（八桂演艺工作室）
- `admin`：平台管理员（可读 `/api/admin/*`，并可审批需求、创建/编辑资源、触发/处理预警；写操作记审计日志）

密码原文不在仓库中；取值见原小组文档《08 运行与最终交付说明》
中的演示账号。`.env` 不要提交。

## API（JSON；错误为 `{error: "中文原因"}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查 |
| GET | /api/categories | 10 个资源分类 |
| GET | /api/resources?category=&city=&q=&sort= | 资源列表（sort: hot / price_asc / price_desc / newest） |
| GET | /api/resources/:id | 资源详情 |
| POST | /api/auth/login | `{username, password}` → `{token, user}`（7 天会话） |
| POST | /api/auth/register | 注册 `{username, password, name, email?}` → `{token, user}`（自动登录，7 天会话；无邮箱验证） |
| POST | /api/auth/change-password | 改密码（需当前密码；不使其他会话失效） |
| POST | /api/auth/logout | 注销当前会话 |
| GET | /api/orders | 本人订单（需登录） |
| POST | /api/orders | 下单 `{resourceId, quantity, booking_date, channel?, note?}`；金额由服务端按资源价计算，客户端传的金额会被忽略 |
| POST | /api/orders/:id/confirm | 待确认 → 已确认 |
| POST | /api/orders/:id/pay | 已确认 → 已支付（**模拟支付**，未扣款） |
| POST | /api/orders/:id/complete | 已支付 → 已完成 |
| POST | /api/orders/:id/cancel | 待确认/已确认 → 已取消 |
| POST | /api/orders/:id/refund | 已支付 → 已退款（模拟退款） |
| GET | /api/demands | 需求列表（已通过审核的 + 本人的） |
| POST | /api/demands | 发布需求（需登录且已认证） |
| GET | /api/favorites | 本人收藏（资源详情） |
| POST | /api/favorites | 收藏/取消收藏（切换） |
| DELETE | /api/favorites/:id | 取消收藏 |
| GET | /api/assistant?q= | AI 助手查询（代理试用后端；超时/失败回退本地规则，按实时库内数据计算） |
| POST | /api/assistant/chat | AI 助手代理 `{message, language}` → `{reply}`（上游失败回退规则） |
| GET | /api/storage/health | 对象存储健康检查（bucket `uploads`） |
| POST | /api/storage/upload | 上传文件（需登录）`{key, content_base64, content_type?}`，文件 ≤200KB |
| GET | /api/storage/url?key= | 取文件预签名下载链接（需登录，1 小时有效） |
| DELETE | /api/storage/:key | 删除文件（需登录） |
| GET | /api/admin/stats | 管理统计：`{users, orders, revenue_cents, resources, demands, orders_by_status}`；收入只汇总 paid/completed 订单的 amount（整数分），orders_by_status 为状态到订单数的映射 |
| GET | /api/admin/orders | `{orders}`：最新 200 笔订单，按 id 倒序，包含 user_name 与 resource_name |
| GET | /api/admin/users | `{users}`：用户列表，经 safeUser 过滤，绝不返回 password |
| GET | /api/admin/demands | `{demands}`：全部需求（含待审核），含 user_name 与 status |
| PATCH | /api/admin/demands/:id | 审批需求 `{status: approved\|rejected}`（仅待审核） |
| POST | /api/admin/resources | 创建资源（管理员） |
| PATCH | /api/admin/resources/:id | 编辑资源、上架/下架（管理员） |
| GET | /api/admin/analysis | 经营分析：KPI、渠道、排行、场馆推荐、报告文本 |
| GET | /api/admin/audit-logs | 审计日志（最新 60 条） |

管理接口仅允许会话用户 `role=admin`；未登录或非管理员统一返回
403 `{"error":"无权访问管理后台"}`。管理员写操作（需求审批、资源
创建/编辑、预警触发/处理）均记审计日志。顾客订单权限不变：确认仍只允许
订单本人操作；退款改为 `paid → refund_requested` 等管理员审批后才到 `refunded`
（Wave 4 #13），4 个售后决定仅管理员可做。

`index.mjs` 中的 if-chain 保持原路由检查顺序，新管理接口在原接口之后。
`createRequestHandler` 仍在成功提交事务后才发送响应，错误与 404 处理不变。

本地静态服务：`/` 与 `/index.html` 对应 `web/index.html`，另支持
`/user.html` 及 `/assets/*`（html/css/js/webp/png/json/svg/ico）。
管理后台是独立 web：`/admin/` 与 `/admin/dashboard.html` 及
`/admin/assets/*` 对应 `admin/` 下同名文件，与顾客站完全分离。
禁止路径越界；页面或资源缺失、未知非 API 路径均返回
404 `{"error":"页面不存在"}`。

订单状态机：`pending → confirmed → paid → completed`，非法流转返回
400；场馆/设备类按天预约，同一天不可重复预订；其余资源下单扣库存、
取消/退款返还库存。所有写操作在事务中执行，只用参数化查询。

## 客户端如何指向本服务

- Web（`web/index.html`，由本服务在 `/` 直接提供）：默认同源
  `/api`；也可用 `?api=http://localhost:3001` 或
  `window.GUIYAN_API_BASE` 指定。API 不可达时自动回落到页面内置
  的离线演示数据。
- 小程序（`miniprogram/`）：`app.js` 中 `globalData.apiBase` 默认
  指向线上地址 `https://guiyan-platform.vercel.app`；清空则回落
  离线本地数据。微信开发者工具预览需勾选“不校验合法域名”，正式
  发布需把域名加入 request 合法域名并使用 HTTPS。

## 模拟边界（与原小组规定一致）

支付、区块链确权、渠道同步均为**模拟**：`/pay` 只改
状态并标注 `simulated: true`；AI 助手代理到试用后端（DeepSeek，
见 `AI_CHAT_URL`），上游失败时回退本地规则，回答按库内真实数据
计算；不产生真实交易。

## 测试（真实 PostgreSQL，非 mock）

```bash
cd server
DATABASE_URL=postgres://guiyan:guiyan@localhost:5433/guiyan_test \
DEMO_PASSWORD=... ADMIN_PASSWORD=... \
npm test
```

测试共 199 个（187 通过 / 0 失败 / 12 跳过；`tests/seed-integrity.test.mjs`
4 个另跑）：`api-pg`（健康检查、资源 62 项、筛选/搜索、下单→确认→
模拟支付→完成全流程、非法流转 400、客户端金额篡改被忽略、收藏往返、
需求发布、助手代理与回退、缓存）与 `wave3/wave4/wave5/p3bugs/wechat-mini/
b037-gate/account-tabs/account-otp/static-dist/storage/cache` 各专项文件。
12 个跳过均为有意的外部依赖缺失（Redis 缓存、对象存储）。
`DATABASE_URL` 必须指向一次性空库（测试前先建 `guiyan` 与 `guiyan_test`
两个库），禁止指向共享库或生产库。

## 部署到 Vercel（静态网页 + API 函数 + Neon PostgreSQL）

部署前请先有 Vercel 账号；线上已部署：https://guiyan-platform.vercel.app
（Vercel，新加坡 sin1）。下述为部署配置说明。

```bash
vercel link            # 关联一个 Vercel 项目（或在控制台 Import 本仓库）
```

**项目设置**（Vercel 控制台 → Settings）：

- Root Directory：仓库根目录（默认）。
- Framework Preset：Vite。
- Build Command：`npm run build`（Vite 构建 + `scripts/flatten-dist.mjs`）；Output Directory：`dist`。
- Node.js 版本：22（与 `package.json` 的 `engines` 一致）。
- Environment Variables：`DATABASE_URL`（Neon PostgreSQL 连接串，
  在 Vercel 控制台设置；**永远不要提交到仓库**）。同时设置
  `DEMO_PASSWORD` 与 `ADMIN_PASSWORD`（首次启动前，决定演示账号
  的密码；取值见原小组文档《08 运行与最终交付说明》）。AI 聊天代理
  另需 `AI_CHAT_URL`（上游试用后端地址，默认
  `http://34.96.190.102/api/chat`）与 `AI_CHAT_TIMEOUT_MS`（上游超
  时毫秒数，默认 `25000`）。对象存储
  也需要四个变量：`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、
  `AWS_ENDPOINT_URL_S3`、`AWS_REGION`（`neon deploy` 写入本地
  `.env.local` 的同名变量；线上要在 Vercel 控制台再填一份，否则
  `/api/storage/*` 返回 503）。

**工作原理**（见根目录 `vercel.json` 与 `api/index.js`）：

- 静态网页：React 构建产物 `dist/`（`npm run build` 生成），`/` 与
  `/user.html`、`/admin/` 均为构建后的页面；SPA 回退到 `/index.html`。
- `/api/*` 路由到同一个 Node 函数 `api/index.js`，它复用
  `server/index.mjs` 与 `server/postgres.mjs`，与本地
  `node server.mjs` 是同一套代码、同一套接口与订单状态机。
- 区域固定为新加坡 `sin1`（与原小组的 Vercel/Neon 配置一致，
  离广西用户最近）。
- 函数是无状态的：不要把数据写在函数内存里；所有业务数据都在
  Neon 数据库中。

**数据库（Neon）**：用 Vercel Marketplace 的 Neon Free 计划
（新加坡区域）或自己在 Neon 控制台建库，把连接串填进
`DATABASE_URL`（建议用带 `?sslmode=require` 的连接串）。
首次连接时自动建表并 seed 62 项资源、139 位用户与 310 笔订单；**已有数据的
库不会被重新填充或清空**，重新部署、函数休眠与重启都不会重置
业务记录。本地 `server/` 的 SQLite 已取消——本地与线上共用
PostgreSQL 这一套，数据库地址不同而已，数据不自动互相同步。

**发布后检查**（每次部署都要做）：打开线上地址 → `/api/health`
应返回 `{"ok":true,"mode":"postgres","database":"postgres","today":"2026-11-09"}` → 用演示账号登录 →
下一单 → 确认 → 模拟支付 → 完成；小程序 `app.js` 的 `apiBase`
默认即线上地址，正式发布仍需按微信要求配置 request 合法域名与 HTTPS。

**小程序不能部署到 Vercel**：`miniprogram/` 是微信原生小程序，
只能在微信开发者工具里编译、在微信里运行，仍保留在仓库中。

---

## Tóm tắt tiếng Việt

Backend thật cho bản Guiyan mới: Node.js thuần + PostgreSQL 16, có
chức năng khách hàng (xem tài nguyên, đăng nhập/đăng ký, đặt vé, đơn hàng,
nhu cầu, yêu thích, trợ lý AI qua proxy + fallback theo quy tắc) và API admin
đọc + ghi (`/api/admin/stats`, `/api/admin/orders`, `/api/admin/users`,
`/api/admin/demands`, duyệt nhu cầu, tạo/sửa tài nguyên, cảnh báo; role=admin).
Backend tách thành lib/, routes/ và static.mjs; giữ thứ tự routing,
SQL và giao dịch. Trang quản trị là web riêng (admin/, đăng nhập +
dashboard), trang user dùng chung mẫu web chính (user.html). Chạy local bằng
`docker compose up -d` rồi `npm ci && npm start`; lần đầu chạy sẽ tự
tạo 14 bảng và seed 62 tài nguyên + 139 người dùng + 310 đơn hàng + tài khoản demo.
Tài khoản demo lấy mật khẩu từ biến môi trường `DEMO_PASSWORD` / `ADMIN_PASSWORD` (đặt
trước lần chạy đầu; không ghi mật khẩu trong repo). Thanh toán vẫn là mô phỏng;
AI chạy qua backend thử nghiệm, lỗi thì fallback về quy tắc. Test chạy với PostgreSQL thật
(199 test: 187 pass / 0 fail / 12 skip), xem `tests/`. Docker phase 8: root
`Dockerfile` + `docker-compose.yml` (api + db + redis), `STATIC_DIR=dist`
phục vụ bản build; production vẫn ở Vercel + Neon.
