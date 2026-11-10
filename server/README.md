# 桂演后端（PostgreSQL 真实数据库）

> Tóm tắt tiếng Việt ở cuối file.

桂演 premium redesign 的后端：纯 Node.js（`node:http`，无框架）+
PostgreSQL 16。顾客功能包括浏览资源、登录、预订下单、
订单状态机、需求大厅、收藏、规则助手。2026-11-10 新增只读管理后台
接口：管理员可查看统计、订单与用户，不提供修改、删除或审批操作。

## 目录结构

```
server/
├── server.mjs           入口：校验 DATABASE_URL，启动 HTTP 服务
├── index.mjs            createApp、请求 ctx、顺序路由表、事务包装与 HTTP 服务
├── lib/
│   ├── http.mjs         校验、时间、金额与安全响应辅助函数
│   └── context.mjs      createContext(database)：查询、审计、通知、事务与对象存储
├── routes/              每个路由函数接收一个 ctx；处理后返回 true，否则 false
│   ├── misc.mjs         健康检查、分类
│   ├── resources.mjs    资源列表、详情
│   ├── auth.mjs         登录、注销
│   ├── orders.mjs       本人订单、下单、状态流转
│   ├── demands.mjs      需求列表、发布
│   ├── favorites.mjs    收藏列表、切换、删除
│   ├── assistant.mjs    规则助手与中文 ANSWERS
│   ├── storage.mjs      对象存储 API（使用 server/storage.mjs）
│   └── admin.mjs        管理员只读统计、订单、用户
├── static.mjs           web/ 静态页面与 assets；路径越界、缺失文件返回 JSON 404
├── postgres.mjs         pg 连接池、建表、首次启动批量 seed
├── schema.mjs           11 张表（与原小组设计 03 一致）
├── seed.mjs             演示数据：用户、22 项资源、130 笔订单……
├── catalog-content.mjs  另外 40 项资源 + 6 条需求（enrichCatalog）
├── storage.mjs          可选的 Neon S3 兼容对象存储客户端
├── docker-compose.yml   本地 PostgreSQL 16
├── .env.example         环境变量模板（不要提交 .env）
└── package.json         依赖：pg、AWS S3 SDK
```

数据库：11 张表 `users / sessions / resources / orders / demands /
comments / messages / favorites / events / audit_logs / settings`。
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
演示用户、130 笔演示订单、需求与评论。`curl
http://localhost:3001/api/health` 应返回 `{"ok":true,
"database":"postgres"}`；打开 `http://localhost:3001/` 即为新版 Web。

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
- `admin`：平台管理员（仅可读取 `/api/admin/*`，不能修改业务数据）

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
| GET | /api/assistant?q= | 规则助手（refund / reschedule / heritage / book / hot / hello / fallback，按实时库内数据计算） |
| GET | /api/storage/health | 对象存储健康检查（bucket `uploads`） |
| POST | /api/storage/upload | 上传文件（需登录）`{key, content_base64, content_type?}`，文件 ≤200KB |
| GET | /api/storage/url?key= | 取文件预签名下载链接（需登录，1 小时有效） |
| DELETE | /api/storage/:key | 删除文件（需登录） |
| GET | /api/admin/stats | 管理统计：`{users, orders, revenue_cents, resources, demands, orders_by_status}`；收入只汇总 paid/completed 订单的 amount（整数分），orders_by_status 为状态到订单数的映射 |
| GET | /api/admin/orders | `{orders}`：最新 200 笔订单，按 id 倒序，包含 user_name 与 resource_name |
| GET | /api/admin/users | `{users}`：用户列表，经 safeUser 过滤，绝不返回 password |

三个管理接口仅允许会话用户 `role=admin`；未登录或非管理员统一返回
403 `{"error":"无权访问管理后台"}`。顾客订单权限不变：确认仍只允许
订单本人操作；退款仍为 `paid → refunded`，没有新增管理员审批。

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
  为空（离线本地数据）；填入服务地址后启用在线模式。微信开发者
  工具预览需勾选“不校验合法域名”，正式发布需把域名加入 request
  合法域名并使用 HTTPS。

## 模拟边界（与原小组规定一致）

支付、AI、大模型、区块链确权、渠道同步均为**模拟**：`/pay` 只改
状态并标注 `simulated: true`；助手是本地规则（未接入大模型），
回答按库内真实数据计算；不产生真实交易。

## 测试（真实 PostgreSQL，非 mock）

```bash
DATABASE_URL=postgres://guiyan:guiyan@localhost:5433/guiyan_test \
DEMO_PASSWORD=... ADMIN_PASSWORD=... \
npm --prefix server test
```

`tests/api-pg.test.mjs` 会自动拉起服务并覆盖：健康检查、资源
62 项、筛选/搜索、下单→确认→模拟支付→完成全流程、非法流转
400、客户端金额篡改被忽略、收藏往返、需求发布、助手规则。
`DATABASE_URL` 必须指向一次性空库，禁止指向共享库或生产库。

## 部署到 Vercel（静态网页 + API 函数 + Neon PostgreSQL）

部署前请先有 Vercel 账号；本次只准备配置，**尚未部署**。

```bash
vercel link            # 关联一个 Vercel 项目（或在控制台 Import 本仓库）
```

**项目设置**（Vercel 控制台 → Settings）：

- Root Directory：仓库根目录（默认）。
- Framework Preset：Other（无框架、无构建步骤，网页是静态单文件）。
- Build Command：留空（不要填）；Output Directory：留空。
- Node.js 版本：22（与 `package.json` 的 `engines` 一致）。
- Environment Variables：`DATABASE_URL`（Neon PostgreSQL 连接串，
  在 Vercel 控制台设置；**永远不要提交到仓库**）。同时设置
  `DEMO_PASSWORD` 与 `ADMIN_PASSWORD`（首次启动前，决定演示账号
  的密码；取值见原小组文档《08 运行与最终交付说明》）。对象存储
  也需要四个变量：`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、
  `AWS_ENDPOINT_URL_S3`、`AWS_REGION`（`neon deploy` 写入本地
  `.env.local` 的同名变量；线上要在 Vercel 控制台再填一份，否则
  `/api/storage/*` 返回 503）。

**工作原理**（见根目录 `vercel.json` 与 `api/index.js`）：

- 静态网页：`web/index.html` 在 `/` 直接提供（`vercel.json` 的
  rewrite），无构建、无框架。
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
首次连接时自动建表并 seed 62 项资源与演示账号；**已有数据的
库不会被重新填充或清空**，重新部署、函数休眠与重启都不会重置
业务记录。本地 `server/` 的 SQLite 已取消——本地与线上共用
PostgreSQL 这一套，数据库地址不同而已，数据不自动互相同步。

**发布后检查**（每次部署都要做）：打开线上地址 → `/api/health`
应返回 `{"ok":true,"database":"postgres"}` → 用演示账号登录 →
下一单 → 确认 → 模拟支付 → 完成；再看小程序 `app.js` 的
`apiBase`，如需小程序联调，把它填成线上地址并按微信要求配置
合法域名与 HTTPS。

**小程序不能部署到 Vercel**：`miniprogram/` 是微信原生小程序，
只能在微信开发者工具里编译、在微信里运行，仍保留在仓库中。

---

## Tóm tắt tiếng Việt

Backend thật cho bản Guiyan mới: Node.js thuần + PostgreSQL 16, có
chức năng khách hàng (xem tài nguyên, đăng nhập, đặt vé, đơn hàng,
nhu cầu, yêu thích, trợ lý theo quy tắc) và 3 API admin chỉ đọc
(`/api/admin/stats`, `/api/admin/orders`, `/api/admin/users`, role=admin).
Backend tách thành lib/, routes/ và static.mjs; giữ thứ tự routing,
SQL và giao dịch. Trang quản trị là web riêng (admin/, đăng nhập +
dashboard), trang user dùng chung mẫu web chính (user.html). Chạy local bằng
`docker compose up -d` rồi `npm ci && npm start`; lần đầu chạy sẽ tự
tạo 11 bảng và seed 62 tài nguyên + tài khoản demo. Tài khoản demo lấy
mật khẩu từ biến môi trường `DEMO_PASSWORD` / `ADMIN_PASSWORD` (đặt
trước lần chạy đầu; không ghi mật khẩu trong repo). Thanh toán và AI
vẫn là mô phỏng. Test chạy với PostgreSQL thật, xem `tests/`.
