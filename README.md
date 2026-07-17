# AIGC 创作平台

> 基于 AI 的图片/视频生成、画布编辑、音乐创作、数字人制作的全栈 SaaS 应用。

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 技术栈总览](#2-技术栈总览)
- [3. Monorepo 目录结构](#3-monorepo-目录结构)
- [4. 应用模块详解](#4-应用模块详解)
- [5. 接口文档](#5-接口文档api-routes)
- [6. 运行逻辑与数据流](#6-运行逻辑与数据流)
- [7. 业务流程详解](#7-业务流程详解)
- [8. 本地开发指南](#8-本地开发指南)
- [9. 部署文档](#9-部署文档)
- [10. 安全与运维](#10-安全与运维)
- [11. 技术决策与约束](#11-技术决策与约束)

---

## 1. 项目概述

| 字段 | 值 |
|------|-----|
| 项目名称 | aigc-platform |
| 版本 | 0.0.1 |
| 类型 | 私有 Monorepo |
| 包管理器 | pnpm 10.31.0 |
| 构建编排 | Turborepo ^2.0.0 |
| Node 版本 | >= 20.0.0 |

核心能力：
- AI 图片生成（多模型、多风格）
- AI 视频生成（文生视频、图生视频）
- 画布编辑器（节点化工作流、AI Agent 辅助）
- AI 音乐创作（歌曲/纯音乐、音色克隆）
- AI 短剧制作（剧本→分镜→视频→合成导出）
- AI 绘本制作
- 数字人/头像生成
- 动作模仿
- 团队协作、积分计费、素材管理

---

## 2. 技术栈总览

| 层级 | 技术 | 版本 |
|------|------|------|
| **前端框架** | Next.js (App Router) | ^14.2.0 |
| **UI 框架** | React | ^18.3.0 |
| **样式** | Tailwind CSS + tailwindcss-animate | ^3.4.19 |
| **UI 组件** | Radix UI | 多包 |
| **状态管理** | Zustand + Zundo（撤销/重做） | ^5.0.11 |
| **数据请求** | SWR | ^2.4.1 |
| **画布引擎** | ReactFlow | ^11.11.4 |
| **动画** | Framer Motion | ^12.34.4 |
| **后端框架** | Fastify | ^4.26.0 |
| **数据库** | PostgreSQL | 16 (Alpine) |
| **ORM/查询** | Kysely（类型安全 SQL 构建器） | ^0.27.0 |
| **任务队列** | BullMQ + Redis | ^5.0.0 |
| **缓存/Pub-Sub** | Redis | 7 (Alpine) |
| **对象存储** | 火山引擎 TOS + @aws-sdk/client-s3 | ^2.9.1 / ^3.1047.0 |
| **图片处理** | Sharp | ^0.34.5 |
| **视频处理** | fluent-ffmpeg | ^2.1.3 |
| **认证** | JWT（jsonwebtoken + bcryptjs） | ^9.0.3 |
| **日志** | Pino + pino-roll | ^8.0.0 |
| **AI 提供商** | 火山引擎、Gemini、Nano Banana、天翼云 Edge、Mureka | — |
| **E2E 测试** | Playwright | ^1.55.0 |
| **进程管理** | PM2（ecosystem.config.cjs） | — |
| **容器化** | Docker + docker-compose | — |
| **文档** | MDX（内置使用文档） | — |

---

## 3. Monorepo 目录结构

```
aigc-platform/
├── apps/
│   ├── api/                 — Fastify 4 REST API（端口 7001）
│   │   └── src/
│   │       ├── routes/          — 路由（按业务模块目录划分，173+ 个路由文件）
│   │       ├── plugins/         — Fastify 插件（JWT 认证、权限守卫）
│   │       ├── services/        — 业务逻辑层
│   │       ├── lib/             — 工具库（storage、queue、credits、pricing 等）
│   │       ├── cli/             — CLI 工具脚本
│   │       ├── __tests__/       — 单元测试
│   │       ├── app.ts           — Fastify 应用构建入口
│   │       ├── index.ts         — 启动入口
│   │       └── logger.ts        — 日志配置（app 日志 + access 日志分离）
│   │
│   ├── web/                 — Next.js 14 App Router 前端（端口 6006）
│   │   └── src/
│   │       ├── app/             — 页面路由（App Router）
│   │       │   ├── (auth)/          — 登录、SSO、邀请
│   │       │   ├── (dashboard)/     — 主功能区
│   │       │   ├── payment/         — 支付回调
│   │       │   └── docs/            — 内置使用文档（MDX）
│   │       ├── components/      — UI 组件
│   │       ├── stores/          — Zustand 状态仓库
│   │       ├── hooks/           — 自定义 Hooks
│   │       ├── lib/             — 工具函数
│   │       ├── context/         — React Context
│   │       └── config/          — 前端配置
│   │
│   └── worker/              — BullMQ 后台任务处理（无 HTTP 端口）
│       └── src/
│           ├── workers/         — 队列消费者
│           ├── adapters/        — 外部 AI 服务适配器
│           ├── pipelines/       — 处理管线（完成/失败）
│           ├── jobs/            — 定时任务
│           ├── pollers/         — 轮询任务
│           ├── providers/       — AI 提供商封装
│           ├── lib/             — 工具库
│           ├── scripts/         — 运维脚本
│           ├── bootstrap.ts     — 启动引导
│           └── index.ts         — 入口
│
├── packages/
│   ├── db/                  — 数据库层
│   │   ├── migrations/          — Kysely 迁移脚本（001 ~ 070）
│   │   ├── scripts/             — 数据库运维脚本（migrate.ts、seed.ts）
│   │   └── src/                 — Schema 定义
│   │
│   ├── types/               — 跨应用共享 TypeScript 类型
│   │   └── src/
│   │       ├── db.ts            — 数据库表类型
│   │       ├── api.ts           — API 请求/响应类型
│   │       ├── queue.ts         — 队列任务数据结构
│   │       ├── adapter.ts       — AI 适配器接口
│   │       ├── music.ts         — 音乐模块类型
│   │       ├── picture-book.ts  — 绘本模块类型
│   │       └── short-drama.ts   — 短剧模块类型
│   │
│   └── nacos-config/        — Nacos 配置管理
│
├── deploy/                  — Docker 部署配置
│   ├── api/                     — API 容器 docker-compose + .env
│   ├── web/                     — Web 容器配置
│   ├── worker/                  — Worker 容器配置
│   ├── infra/                   — 基础设施（PostgreSQL + Redis）
│   ├── nacos/                   — Nacos 配置
│   └── build-images.sh          — 镜像构建脚本
│
├── docker-compose.yml           — 本地开发用（仅 PostgreSQL + Redis）
├── ecosystem.config.cjs         — PM2 进程管理配置
├── pnpm-workspace.yaml          — pnpm 工作区配置
└── pnpm-lock.yaml
```

---

## 4. 应用模块详解

### 4.1 apps/api — 后端 API 服务

**框架**：Fastify 4 + TypeScript（ESM 模式）  
**端口**：7001  
**路由前缀**：`/api/v1/`  
**API 文档**：开发环境 Swagger UI `http://localhost:7001/docs`

#### 核心架构

- `@fastify/autoload` 自动加载 `routes/` 目录路由
- 文件命名约定：`{method}-{path-segments}.ts`（如 `get-canvas-id.ts`）
- 全局限流：1200 req/min/user（基于 JWT token 前缀 + IP 组合键）
- 关键路由（登录/生成）有独立更严限流
- Swagger 自动生成中文 tag 和 summary

#### 插件体系

| 文件 | 职责 |
|------|------|
| `plugins/jwt-auth.ts` | JWT 认证插件，解析 Bearer token |
| `plugins/guards.ts` | 权限守卫（管理员、团队成员等） |

#### 工具库（lib/）

| 文件 | 职责 |
|------|------|
| `credits.ts` | 积分扣减/冻结/释放/查询核心逻辑 |
| `pricing.ts` | 模型定价计算 |
| `storage.ts` | 火山引擎 TOS 对象存储封装 |
| `queue.ts` | BullMQ 队列管理（创建/关闭） |
| `auth-tokens.ts` | Token 生成/验证 |
| `distributed-lock.ts` | Redis 分布式锁 |
| `sanitize.ts` | 输入清洗 |
| `batch-source.ts` | 批次来源追踪 |
| `batch-snapshot.ts` | 批次快照 |
| `model-json.ts` | 模型配置序列化 |
| `provider-api-audit.ts` | 外部 API 调用审计记录 |
| `volcengine-visual-sign.ts` | 火山引擎请求签名 |
| `topup-packages.ts` | 充值套餐定义 |
| `project-purge.ts` | 项目清理逻辑 |
| `life-service.ts` | 生命周期服务 |

#### 中间件与安全

- `@fastify/cors`：可配置跨域源（CORS_ORIGIN 环境变量）
- `@fastify/helmet`：安全响应头
- `@fastify/rate-limit`：Redis 驱动的分布式限流
- `@fastify/cookie`：Cookie 解析
- `@fastify/multipart`：文件上传（100MB 限制）
- 请求体限制：100MB（支持 10 张参考图 base64）

---

### 4.2 apps/web — 前端应用

**框架**：Next.js 14 App Router + Turbopack（开发模式）  
**端口**：6006  
**主题**：深色模式（默认 dark）  
**输出模式**：`standalone`（生产环境容器化）

#### 页面路由总览

| 路由组 | 页面 | 功能 |
|--------|------|------|
| `(auth)/` | login | 手机号/密码登录 |
| | sso-test | SSO 测试 |
| | accept-invite | 团队邀请接受 |
| `(dashboard)/` | generation | AI 图片生成 |
| | canvas | 画布列表 |
| | canvas/editor/[id] | 画布详情编辑 |
| | canvas/gallery | 画布画廊 |
| | video-studio | 视频工作室 |
| | video-studio/new | 新建视频项目 |
| | video-studio/wizard | 视频创建向导 |
| | music | 音乐创作 |
| | music/[id] | 音乐详情 |
| | toby-studio/ | Toby 工作室入口 |
| | toby-studio/picture-book | 绘本创作 |
| | toby-studio/short-drama | 短剧制作 |
| | toby-studio/music | 音乐创作 |
| | assets | 素材管理 |
| | history | 生成历史 |
| | team | 团队管理 |
| | credits | 积分中心 |
| | settings | 个人设置 |
| | admin | 管理后台 |
| `payment/` | callback | 支付回调 |
| `docs/` | user-guide, canvas, image-generation, video-generation, music, picture-book, short-drama, assets, ai-assistant, toby-studio | 内置使用文档 |

#### 状态管理

| Store 文件 | 职责 |
|------------|------|
| `auth-store.ts` | 用户认证状态 |
| `generation-store.ts` | 图片生成参数/结果 |
| `navigation-store.ts` | 导航状态 |
| `layout-store.ts` | 布局状态 |
| `home-scroll-store.ts` | 首页滚动位置 |

#### API 代理

`next.config.mjs` 通过 rewrites 将 `/api/*` 透明转发到 `INTERNAL_API_URL`（默认 `http://localhost:7001`）：

```javascript
async rewrites() {
  return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]
}
```

---

### 4.3 apps/worker — 后台任务处理

**消费模式**：BullMQ Worker  
**无 HTTP 端口**：健康检查通过 `pgrep` 检测进程存活

#### 队列消费者（workers/）

| Worker 文件 | 职责 |
|-------------|------|
| `video-submit.ts` | 视频生成任务提交到 AI 提供商 |
| `storyboard.ts` | 分镜头脚本生成 |
| `transfer.ts` | 资源文件转存（外部 URL → TOS） |
| `music.ts` | 音乐生成（歌曲/纯音乐） |
| `music-voice-clone.ts` | 音色克隆 |
| `short-drama-export.ts` | 短剧导出/合成 |
| `cron-worker.ts` | 定时任务调度 |

#### AI 适配器（adapters/）

| 适配器文件 | 对接服务 |
|------------|----------|
| `volcengine-image.ts` | 火山引擎图片生成 |
| `nano-banana.ts` | Nano Banana AI |
| `ctyun-edge-image.ts` | 天翼云 Edge 图片生成 |
| `base.ts` | 适配器基类/接口 |
| `factory.ts` | 适配器工厂（根据 provider 字段选择） |

#### 定时任务（jobs/）

| Job 文件 | 职责 |
|----------|------|
| `timeout-guardian.ts` | 超时任务守卫（自动标记超时失败） |
| `purge-old-records.ts` | 清理过期记录 |
| `purge-deleted-assets.ts` | 清理已软删除素材 |
| `purge-deleted-projects.ts` | 清理已软删除项目 |

#### 处理管线（pipelines/）

| Pipeline 文件 | 职责 |
|---------------|------|
| `complete.ts` | 任务完成管线（结算积分、更新状态、通知前端） |
| `fail.ts` | 任务失败管线（释放冻结积分、记录错误、通知前端） |

---

### 4.4 packages/db — 数据库层

**数据库**：PostgreSQL 16  
**查询构建器**：Kysely（类型安全，无 ORM 魔法）  
**迁移管理**：Kysely migrations（70 个脚本）

#### 核心数据表（按迁移顺序）

| 编号 | 表/功能 | 说明 |
|------|---------|------|
| 001 | users | 用户表 |
| 002 | subscription_plans | 订阅计划 |
| 003 | auth_tables | 认证相关表 |
| 004 | teams | 团队 |
| 005 | credits | 积分系统（credit_accounts、credits_ledger） |
| 006 | tasks | 生成任务（tasks、task_batches） |
| 007 | security | 安全相关 |
| 008 | providers | AI 提供商（provider_models） |
| 009 | workspace_members | 工作区成员 |
| 021 | canvas | 画布 |
| 025 | payment | 支付 |
| 026-030 | video_studio | 视频工作室项目 |
| 031-032 | canvas_agent_sessions | 画布 AI 助手会话 |
| 041-042 | provider_system_voices | 系统音色 |
| 044-045 | music | 音乐模块（music_tracks、music_voice_clones） |
| 050 | picture_book | 绘本 |
| 052-057 | short_drama | 短剧（projects、segments） |
| 067-070 | ctyun_edge | 天翼云 Edge 提供商 |

---

### 4.5 packages/types — 共享类型

#### 队列任务类型定义

```typescript
// 图片生成任务
interface GenerationJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  canvasId?: string
  canvasNodeId?: string
}

// 视频提交任务
interface VideoSubmitJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  videoCategory?: 'multimodal' | 'frames'
}

// 任务完成通知
interface CompletionJobData {
  taskId: string
  result: {
    success: boolean
    outputUrl?: string
    actualCredits?: number
    providerCostRaw?: Record<string, unknown>
    errorMessage?: string
  }
}

// 资源转存任务
interface TransferJobData {
  taskId: string
  batchId: string
  assetId: string
  originalUrl: string
  assetType?: 'image' | 'video'
}

// 分镜头任务
interface StoryboardJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  estimatedCredits: number
  canvasId: string
  canvasNodeId: string
  script: string
  shotCount: number
}
```

---

## 5. 接口文档（API Routes）

### 5.1 访问方式

- **Swagger UI**（仅开发环境）：`http://localhost:7001/docs`
- **接口前缀**：`/api/v1/`
- **认证方式**：`Authorization: Bearer <JWT>`
- **全局限流**：1200 req/min

### 5.2 接口模块分类

| 模块 | 前缀 | 核心接口 |
|------|------|----------|
| **auth** | `/api/v1/auth/` | 登出 |
| **users** | `/api/v1/users/` | 获取当前用户 `GET /me`、修改个人信息 `PATCH /me`、修改密码 `POST /password`、绑定手机 `POST /phone`、发送验证码 `POST /phone-code`、生成默认设置 `GET/PATCH /generation-defaults` |
| **teams** | `/api/v1/teams/` | 获取团队工作区批次 |
| **workspaces** | `/api/v1/workspaces/` | 创建 `POST /`、查询 `GET /:id`、删除 `DELETE /:id`、成员管理 `GET /members`、回收站 `GET /trash`、批次 `GET /batches` |
| **generate** | `/api/v1/generate/` | 提交图片生成任务 |
| **batches** | `/api/v1/batches/` | 列表 `GET /`、详情 `GET /:id`、统计 `GET /stats`、隐藏 `PATCH /hide`、显示 `PATCH /unhide`、来源筛选 |
| **assets** | `/api/v1/assets/` | 列表 `GET /`、缩略图 `GET /thumbnail`、删除 `DELETE /:id`、回收站、恢复 |
| **canvas** | `/api/v1/canvas/` | CRUD、节点输出 CRUD、历史记录、上传、活跃任务、素材管理 |
| **canvas-agent** | `/api/v1/canvas-agent/` | 会话 CRUD（GET/PUT/DELETE sessions） |
| **ai-assistant** | `/api/v1/ai-assistant/` | 文件上传 |
| **video-studio** | `/api/v1/video-studio/` | 项目 CRUD、剧本生成 `POST /script-write`、系列大纲 `POST /series-outline`、分镜拆分 `POST /storyboard-split`、资产提示词 `POST /asset-prompts`、系列剧集 `POST /series-episodes` |
| **videos** | `/api/v1/videos/` | 视频上传 |
| **avatar** | `/api/v1/avatar/` | 头像上传 |
| **action-imitation** | `/api/v1/action-imitation/` | 动作模仿上传 |
| **music** | `/api/v1/music/` | 生成 `POST /generate`、曲目详情 `GET /tracks/:id`、事件流 `GET /tracks/:id/events`、相邻曲目 `GET /tracks/:id/adjacent`、克隆音色列表 `GET /voice-clones`、克隆事件 `GET /voice-clones/:id/events` |
| **picture-book** | `/api/v1/picture-book/` | 项目 CRUD、同步批次 `POST /sync-batches`、分镜提示词 `POST /storyboard-prompts`、资产提示词 `POST /asset-prompts` |
| **short-drama** | `/api/v1/short-drama/` | 项目管理、图片上传、剧本上传、文本来源更新、分集梗概、资产提示词、片段视频生成、导出 |
| **payment** | `/api/v1/payment/` | 套餐列表 `GET /packages` |
| **admin** | `/api/v1/admin/` | 用户管理、团队 CRUD、工作区查看、批次查看、错误查看、成本配置 `GET/PATCH /cost-configs`、回收站 |
| **healthz** | `/api/v1/healthz/` | 健康检查 `GET /` |
| **client-errors** | `/api/v1/client-errors/` | 前端错误上报 `POST /` |

---

## 6. 运行逻辑与数据流

### 6.1 整体架构图

```
┌──────────────────┐     API Proxy      ┌──────────────────┐
│   Next.js Web    │ ──────/api/*──────> │   Fastify API    │
│   (Port 6006)    │ <────────────────── │   (Port 7001)    │
└──────────────────┘                     └────────┬─────────┘
                                                  │
                               BullMQ Job Dispatch│
                                                  ▼
                                         ┌──────────────────┐
                                         │   BullMQ Worker   │
                                         └────────┬─────────┘
                                                  │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                    │  火山引擎 AI  │     │ Nano Banana  │     │ 天翼云 Edge  │
                    └──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │   火山引擎 TOS    │
                                         │   (对象存储)      │
                                         └──────────────────┘
                                                  │
                              ┌────────────────────┴────────────────────┐
                              ▼                                         ▼
                    ┌──────────────────┐                       ┌──────────────────┐
                    │   PostgreSQL 16   │                       │     Redis 7       │
                    │  (业务数据持久化)  │                       │ (缓存/队列/限流/  │
                    │                   │                       │  Pub-Sub/SSE)     │
                    └──────────────────┘                       └──────────────────┘
```

### 6.2 图片/视频生成流程

```
1. 用户在前端提交生成请求
2. Next.js rewrites 代理转发到 Fastify API
3. API 服务处理：
   a. JWT 认证 → 权限守卫
   b. 参数校验 + 幂等键检查
   c. 解析模型定价，预扣积分（estimatedCredits 冻结）
   d. 事务内创建 task_batches + tasks 记录
   e. 投递 Job 到 BullMQ 队列
   f. 立即返回 taskId/batchId 给前端
4. Worker 消费队列：
   a. 更新 task 状态为 processing
   b. 通过 AdapterFactory 选择对应 AI 适配器
   c. 调用外部 AI API（火山引擎/Nano Banana/天翼云）
   d. 生成结果上传到火山引擎 TOS
   e. 进入 complete/fail pipeline
5. Complete Pipeline：
   a. 更新 task/batch 状态为 completed
   b. 结算实际积分（退还冻结差额）
   c. 写入 credits_ledger 流水
   d. 通过 Redis Pub/Sub 发布 SSE 事件
6. 前端通过 SSE 或轮询获取结果并展示
```

### 6.3 积分系统

- 核心逻辑在 `apps/api/src/lib/credits.ts`
- **预扣机制**：提交任务时先冻结估算积分，完成后按实际消耗结算差值
- **失败退还**：任务失败时释放冻结积分，写入 refund 流水
- **分布式锁**：Redis 分布式锁防止并发扣减竞态
- **流水审计**：所有积分变动写入 `credits_ledger` 表

### 6.4 画布系统

- 基于 ReactFlow 实现节点化工作流编辑
- 支持 Undo/Redo（Zustand + Zundo）
- 画布 AI Agent 辅助生成（独立会话管理）
- 节点输出管理、历史版本追踪
- 素材关联与资源上传

### 6.5 SSE 实时推送

- API 通过 Redis Pub/Sub 订阅任务状态变更
- 前端通过 `GET /api/v1/{module}/{id}/events` 建立 SSE 连接
- Worker 每次状态变化都发布事件到 Redis channel
- 若用户打开页面时任务已完成，SSE 立即发送当前快照并关闭

---

## 7. 业务流程详解

### 7.1 AI 短剧生成链路

#### 7.1.1 项目创建与剧本摘要

用户在短剧首页点击「立即生成」后：

1. `POST /short-drama/projects` — 创建项目，保存原始创意/风格/比例/集数/模型设置
2. `POST /short-drama/projects/:id/script-summary` — 调用文本模型生成剧本摘要（流式返回，按输出字符计费）

#### 7.1.2 生成分集梗概

```
POST /short-drama/projects/:id/episode-outlines

余额预检查 → 调用文本模型 → 一次性生成 episodeCount 条分集梗概
→ 写入 state.script.episodeOutlines → 初始化 state.episodes
→ 状态更新为 outline_ready
```

每集梗概包含：集数、标题、一句话看点、剧情梗概、主要角色、主要场景、结尾钩子、分镜生成状态。

#### 7.1.3 全剧资产提示词与图片

**生成资产提示词**：
```
POST /short-drama/projects/:id/asset-prompts
```
输出全剧资产分类：character（角色）、scene（场景）、prop（道具）、material（素材）。

**生成资产图片**：
```
POST /short-drama/projects/:id/assets/generate
```
复用现有图片生成链路，支持批量/单个/重试/替换。资产沉淀到资产库并标记来源。

#### 7.1.4 单集分镜生成

```
POST /short-drama/projects/:id/episodes/:episodeId/segments
```
输出 `ShortDramaSegment[]`：画面提示词、推荐引用资产、默认时长、镜头说明、动作/情绪、对白提示。

#### 7.1.5 片段视频生成

```
POST /short-drama/projects/:id/episodes/:episodeId/segments/:segmentId/generate-video
```
流程：校验 → 获取引用资产图片 URL → 余额预检查 → 调用视频生成队列 → 任务完成后同步 videoUrl。

#### 7.1.6 任务同步

```
POST /short-drama/projects/:id/sync-batches
```
前端策略：pending/processing 时每 10s 同步；单个生成后立即刷新；失焦降频或停止。

#### 7.1.7 单集合成导出

```
POST /short-drama/projects/:id/episodes/:episodeId/export
```
Worker 合成逻辑：下载片段视频 → 校验编码/分辨率/帧率 → 必要时转码 → ffmpeg concat → 上传 TOS → 更新状态。

导出费用读取后台配置，批量导出按集数累计。

#### 7.1.8 计费策略

| 阶段 | 计费方式 |
|------|----------|
| 剧本摘要 | 按实际输出字符数 |
| 分集梗概 | 按集数估算字符 |
| 资产图片 | 资产数量 × 模型单价 |
| 片段视频 | 模型 × 时长 × 比例 × 数量 |
| 导出合成 | 后台配置固定费用 × 集数 |

所有生成前检查余额，不足时不提交任务。批量任务采用「全部余额足够才开始」策略。

---

### 7.2 音乐生成流程

#### 7.2.1 生成模式

| 模式 | 输入 | 支持类型 |
|------|------|----------|
| 灵感模式 | 灵感提示词 | 歌曲 + 纯音乐 |
| 自定义模式 | 标题 + 歌词 + 风格 | 仅歌曲 |

可选参数：model（mureka-9/mureka-8）、voice_gender、voice_clone_id、styles。

#### 7.2.2 API 创建任务

入口：`apps/api/src/routes/music/post-generate.ts`

处理流程：
1. 参数校验（模式规则、克隆音色状态）
2. 幂等键检查（重复请求直接返回已有结果）
3. 解析模型价格，冻结积分
4. 事务内创建 task_batches + tasks + music_tracks
5. 投递到 `music-queue`

#### 7.2.3 Worker 处理

入口：`apps/worker/src/workers/music.ts`

**灵感模式歌曲**：
```
lyrics_generating → 调用 Mureka POST /v1/lyrics/generate
→ 歌词写入 music_tracks → SSE lyrics_delta
→ song_generating → 调用 Mureka POST /v1/song/generate
```

**自定义模式歌曲**：
```
song_generating → 直接调用 Mureka POST /v1/song/generate（带用户歌词/标题/风格）
```

**纯音乐**：
```
song_generating → 调用 Mureka POST /v1/instrumental/generate
```

#### 7.2.4 Mureka 结果轮询

若 Mureka 返回 `task_id` 而非直接结果，Worker 轮询 `GET /v1/song/query/:task_id`，超时 15 分钟。

#### 7.2.5 后处理

1. 封面生成（火山引擎图片，失败不阻塞）
2. 媒体转存到 TOS（audio、flac、wav、cover）
3. 确认积分扣除
4. 发布 SSE completed 事件

#### 7.2.6 SSE 事件流

前端订阅：`GET /api/v1/music/tracks/:id/events`  
Redis channel：`sse:music_track:<trackId>`

支持事件：`status`、`lyrics_delta`、`stream_url`、`completed`、`failed`

---

## 8. 本地开发指南

### 8.1 环境要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0（推荐 10.31.0）
- Docker（用于本地 PostgreSQL + Redis）

### 8.2 快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动基础设施（PostgreSQL + Redis）
docker-compose up -d

# 3. 配置环境变量
cp .env.example .env
cp prompts.env.example prompts.env
# 编辑 .env 填入必要配置（DATABASE_URL、REDIS_URL、TOS_*、JWT_SECRET、VOLC_*）

# 4. 执行数据库迁移
pnpm db:migrate

# 5. 填充种子数据（可选）
pnpm db:seed

# 6. 构建共享类型包
pnpm --filter @aigc/types build

# 7. 启动所有服务（Turborepo 并行）
pnpm dev
```

### 8.3 单独启动

```bash
pnpm --filter @aigc/web dev       # 前端 :6006（Turbopack）
pnpm --filter @aigc/api dev       # API  :7001（tsx watch 热重载）
pnpm --filter @aigc/worker dev    # Worker
```

### 8.4 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动所有服务 |
| `pnpm build` | 全量构建 |
| `pnpm lint` | 全量 lint |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:seed` | 填充种子数据 |
| `pnpm queue:clean` | 清理 BullMQ 缓存 |
| `pnpm queue:clean -- --dry-run` | 预览清理（不实际执行） |
| `pnpm queue:clean -- --queue image-queue --state failed` | 清理指定队列失败任务 |
| `pnpm --filter @aigc/web test:e2e` | E2E 测试（无头） |
| `pnpm --filter @aigc/web test:e2e:ui` | E2E 测试（带 UI） |
| `pnpm --filter @aigc/types build` | 构建共享类型包 |
| `pnpm --filter @aigc/web build` | 单独构建前端 |

---

## 9. 部署文档

### 9.1 部署架构（4 台独立服务器）

```
┌─────────────────────────────────────────────────────────────────────┐
│                          内网环境                                     │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │ API 服务器    │   │ Worker 服务器 │   │ Web 服务器    │             │
│  │ aigc-api:7001│   │ aigc-worker  │   │ aigc-web:6006│             │
│  └──────┬───────┘   └──────┬───────┘   └──────────────┘             │
│         │                   │                                         │
│         └───────────┬───────┘                                         │
│                     ▼                                                 │
│          ┌──────────────────────┐                                     │
│          │  基础设施服务器        │                                     │
│          │  PostgreSQL :5432     │                                     │
│          │  Redis :6379          │                                     │
│          └──────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 容器配置

| 服务 | 镜像 | 端口 | 健康检查 | compose 文件 |
|------|------|------|----------|-------------|
| PostgreSQL | postgres:16-alpine | 5432 | pg_isready | deploy/infra/ |
| Redis | redis:7-alpine | 6379 | redis-cli ping | deploy/infra/ |
| API | aigc-api:latest | 7001 | wget /healthz | deploy/api/ |
| Web | aigc-web:latest | 6006 | — | deploy/web/ |
| Worker | aigc-worker:latest | 无 | pgrep 进程检测 | deploy/worker/ |

### 9.3 构建镜像（本机）

```bash
# 全量构建（monorepo 根目录执行，上下文为整个仓库）
bash deploy/build-images.sh all
# 产物输出到 deploy/dist/：aigc-api.tar.gz、aigc-web.tar.gz、aigc-worker.tar.gz

# 单独构建
bash deploy/build-images.sh api
bash deploy/build-images.sh web
bash deploy/build-images.sh worker
bash deploy/build-images.sh infra   # 拉取官方镜像打包（离线环境）
```

### 9.4 服务器部署（按顺序：infra → api → worker → web）

#### 基础设施服务器

```bash
# 仅首次：创建 swap 防止 PG OOM
sudo bash setup-host.sh

# 加载镜像（离线环境）
docker load < postgres.tar.gz
docker load < redis.tar.gz

# 配置并启动
cp .env.example .env
vi .env    # 填写 POSTGRES_PASSWORD、REDIS_PASSWORD、PG_* 内存参数
docker compose up -d
```

#### API / Worker / Web 服务器

```bash
# 加载镜像
docker load < aigc-api.tar.gz

# 配置环境
cp .env.example .env
vi .env    # 填写 INFRA_HOST、数据库密码、TOS 密钥等

# 启动
docker compose up -d

# 更新部署（重新构建后）
docker load < aigc-api.tar.gz
docker-compose up -d --force-recreate

# 查看日志
docker logs aigc-api --tail 30
```

### 9.5 数据库迁移（Docker 环境）

API 容器运行时，在 API 服务器执行：

```bash
# 结构迁移
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/migrate.ts'

# 数据迁移（seed）
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/seed.ts'
```

### 9.6 PM2 部署（非 Docker 环境）

`ecosystem.config.cjs` 定义三个进程：

| 进程名 | 启动脚本 | 日志 |
|--------|----------|------|
| aigc-test-api | start-api.sh | logs/api-err.log, logs/api-out.log |
| aigc-test-worker | start-worker.sh | logs/worker-err.log, logs/worker-out.log |
| aigc-test-web | start-web.sh | logs/web-err.log, logs/web-out.log |

### 9.7 关键环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://aigc:pass@host:5432/aigc_dev` |
| `REDIS_URL` | Redis 连接串 | `redis://:pass@host:6379` |
| `JWT_SECRET` | JWT 签名密钥 | — |
| `TOS_ACCESS_KEY_ID` | 火山引擎 TOS AK | — |
| `TOS_SECRET_ACCESS_KEY` | 火山引擎 TOS SK | — |
| `TOS_REGION` | TOS 区域 | `cn-shanghai` |
| `TOS_ENDPOINT` | TOS 端点 | `https://tos-cn-shanghai.volces.com` |
| `TOS_BUCKET` | TOS 桶名 | `toby-ai-prod` |
| `TOS_PUBLIC_URL` | TOS 公网访问地址 | — |
| `VOLC_*` | 火山引擎 AI 服务配置 | — |
| `INTERNAL_API_URL` | Web → API 内网地址 | `http://api-server:7001` |
| `NEXT_PUBLIC_STORAGE_HOST` | 客户端存储公网地址（打入 bundle） | — |
| `CORS_ORIGIN` | 允许的跨域源（逗号分隔） | `https://app.example.com` |
| `API_PORT` | API 监听端口 | `7001` |
| `API_HOST` | API 监听地址 | `0.0.0.0` |
| `NODE_ENV` | 运行环境 | `production` |
| `LOG_DIR` | 日志输出目录 | `/app/logs/api` |

### 9.8 PostgreSQL 内存调优

| 参数 | 默认值（8GB 服务器） | 说明 |
|------|---------------------|------|
| `PG_SHARED_BUFFERS` | 1GB | ≈ 物理内存 1/4 |
| `PG_WORK_MEM` | 16MB | 排序/哈希操作内存 |
| `PG_MAINTENANCE_WORK_MEM` | 256MB | VACUUM/CREATE INDEX |
| `PG_EFFECTIVE_CACHE_SIZE` | 3GB | 查询规划器参考值 |
| `PG_MAX_CONNECTIONS` | 80 | ≥ 所有应用 pool_max × 1.5 |

修改后需 `docker compose up -d --force-recreate`。

---

## 10. 安全与运维

### 10.1 安全措施

| 措施 | 说明 |
|------|------|
| JWT 认证 | 所有 API 需 Bearer token |
| 权限守卫 | 插件级别的角色/团队/工作区权限 |
| 全局限流 | 1200 req/min + 关键路由独立限流 |
| 安全头 | Helmet + X-Frame-Options: SAMEORIGIN |
| 分布式锁 | Redis 防并发扣减竞态 |
| 预扣机制 | 积分冻结防止超额消费 |
| 输入清洗 | sanitize 模块处理用户输入 |
| 防火墙 | 基础设施端口仅对应用 IP 开放 |

### 10.2 运维机制

| 机制 | 说明 |
|------|------|
| 超时守卫 | Worker 定时扫描超时任务自动标记失败 |
| 僵尸恢复 | API 启动时自动扫描并重置僵死任务 |
| 软删除清理 | 定时任务清理过期的已删除资源 |
| Swap 保护 | `setup-host.sh` 创建 2GB swap + swappiness=10 |
| 日志分离 | app 日志与 access 日志独立文件，Docker 卷持久化 |
| 健康检查 | 各容器内置 healthcheck |
| API 审计 | `provider-api-audit` 记录外部 AI 调用详情 |

### 10.3 注意事项

- `NEXT_PUBLIC_STORAGE_HOST` 打入客户端 bundle，必须填公网可访问地址
- `sharp` 原生模块：Dockerfile 已在 Alpine 环境重新安装，无需手动处理
- `output: 'standalone'`：web Dockerfile 依赖此配置，不可移除
- TOS Key 编码：key → URL 用 `encodeURI`、URL → key 用 `decodeURIComponent`
- 修改 `packages/types` 后需重新构建依赖应用
- 修改 schema 必须同步更新 `packages/types` 中的 DB 类型

---

## 11. 技术决策与约束

| 决策 | 原因 |
|------|------|
| Kysely 而非 ORM | 类型安全 SQL 构建器，无隐式行为，适合复杂查询和精确控制 |
| BullMQ + Redis | AI 生成任务耗时数秒到数分钟，异步队列解耦 API 和处理逻辑 |
| standalone output | Web 容器体积最小化，生产环境依赖自包含 |
| pnpm Monorepo + Turborepo | 共享类型包、统一版本管理、磁盘高效、并行构建 |
| Fastify autoload | 路由文件即接口，自动注册减少样板代码，支持 autoHooks |
| Zustand + Zundo | 轻量状态管理 + 画布撤销/重做支持 |
| Dark 模式默认 | 创作类工具用户偏好深色界面，减少视觉疲劳 |
| SSE + Redis Pub/Sub | 轻量实时推送，无需 WebSocket 基础设施 |
| 适配器工厂模式 | 多 AI 提供商统一接口，易于扩展新模型 |
| 预扣积分机制 | 异步任务无法同步扣费，冻结→结算保证资金安全 |

---

## CodeGraph 索引

本项目已配置 CodeGraph MCP 工具，提供基于 AST 的代码符号索引。

```bash
# 初始化索引
codegraph init -i

# 查看状态
codegraph status

# 同步更新
codegraph sync

# 符号搜索
codegraph query "UserService"
```

参考：https://blog.csdn.net/chendongqi2007/article/details/161292757
