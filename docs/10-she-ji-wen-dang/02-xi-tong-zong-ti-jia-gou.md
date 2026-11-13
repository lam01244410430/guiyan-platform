# 2. 系统总体架构

> 本章写"已建成的架构是什么"，不是目标架构。目标演进见 `03-xiang-mu-jie-duan.md`。
> 详细架构见 `05-kien-truc/web.md`、`06-kien-truc/server.md`、`07-kien-truc/miniprogram.md`、
> `08-kien-truc/admin.md`；API 见 `02-ky-thuat/api.md`；数据库见 `02-ky-thuat/database.md`。

## 2.1 现状总览（main `90171d3`，已验证）

```
                    ┌─────────────────────┐
                    │  Vercel (sin1)      │
                    │  React 19 + Vite    │  web/ + admin/ (MPA, 4 入口)
                    │  dist/ + api/index  │
                    └──────┬──────────────┘
                           │ HTTPS /api
              ┌────────────┴────────────┐
              │  Neon Postgres (Singapore)│  11 张表 · 62 资源
              │  + Object Storage       │  bucket uploads
              └─────────────────────────┘
   WeChat 小程序 ──→ 同一套 /api（在线时）；离线用本地数据
```

- **前端：** React 19 + Vite 6 MPA。客户站 `web/`（`/`、`/user.html`）与管理站
  `admin/`（`/admin/`、`/admin/dashboard.html`）完全分离，各自登录与会话键。
  i18n 中/越/英 177 键，默认中文。设计系统：夜间剧场主题（深松绿 + 朱砂红 + 金），
  见 skill"Main interface design system"。
- **后端：** Node（plain node:http，无框架）+ PostgreSQL，`server/index.mjs` 分发，
  `server/routes/` 按域拆分；钱一律整数分；所有写操作走事务与参数化查询。
- **缓存：** Redis（`server/lib/cache.mjs`），fail-open：缓存坏了只读 Postgres，
  绝不影响请求。键命名空间 `guiyan:*`，资源列表/热门 300s，管理统计/分析 60s，
  响应带 `X-Cache: HIT/MISS`。生产用 Upstash REST（待 Lam 建账号），开发/测试用 docker redis。
- **部署：** Vercel（生产，`guiyan-platform.vercel.app`）+ Neon Postgres。
  本地开发/测试在 EC2（t3.micro，免费套餐）上用一次性 Postgres 16 容器。
- **数据：** 62 资源（22 演示 + 40 目录），10 分类，9 需求；用户 139 / 订单 310
  （演示 39/130 + 新种子 100/180，全外键关联；演示数据暂保留作 fallback）。
  注册：`POST /api/auth/register`，scrypt，角色固定 user，自动登录，无邮件验证（无邮件服务商）。

## 2.2 三阶段演进（与 `03-xiang-mu-jie-duan.md` 一致）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 第一阶段 | 基础票务业务系统：发现、购票、我的票、需求大厅、规则客服（模拟）、管理只读查看 | **已建**（main `90171d3`；管理高级能力是阶段 5） |
| 第二阶段 | AI 中台 + "文小惠"数字人：智能客服先行，再扩展行程规划、语音购票 | 未建；技术方向见 `07-...` 与下节 |
| 第三阶段 | 运营数据滚动迭代 + 全区场馆与剧目资源整合；小版本 CI/CD 快速发布与回滚 | 未建；扩展业务视评估结果独立部署 |

## 2.3 第二阶段 AI 技术方向（方向，不是已定选型）

来源：设计文档第 2 章（`07-...`）+ AI Agent 装备表（Lam 发来的图片）。

- 短期：**不私有部署**。用 DeepSeek 等主流大模型的 API 调用方式，由平台统一通过
  **智能体路由层**调度；高频轻量请求导向低成本模型（如 DeepSeek-V4-Flash）。
- 装备表给出的能力栈：Python（主力语言）、LLM API 调用、Prompt / Context Engineering、
  RAG（检索增强生成，读私有文档）、Tool calling（查天气、发邮件、操作数据库）、
  LangChain / LangGraph（主流 Agent 开发框架）、向量库、Docker / K8s、MCP（模型连接外部工具的新标准）。
- **未定事项（第二阶段再定，不写成结论）：** 智能体路由层是用 Python 独立服务
  （与装备表一致），还是 Node 层调用 DeepSeek API（与现有后端一致）；
  RAG 知识库的来源与校验流程；MCP 接哪些外部工具。现有后端是 Node，这一点不因装备表而改变。
- 原则不变：**AI + 规则混合**——支付、库存、核销等关键流程由确定性系统保障，
  AI 只辅助与增强；AI 能力未接入前一律标注模拟。
