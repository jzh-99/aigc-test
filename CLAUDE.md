# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AIGC 创作平台 —— 基于 AI 的图片/视频生成、画布编辑、数字人制作的全栈 SaaS 应用。

**包管理器**: pnpm 10（必须用 pnpm，不要用 npm/yarn）  
**构建编排**: Turborepo  
**Node 版本**: >= 20.0.0

---

## 常用命令

### 开发

```bash
# 启动所有服务（并行）
pnpm dev

# 单独启动某个应用
pnpm --filter @aigc/web dev       # 前端 :6006
pnpm --filter @aigc/api dev       # API  :7001
pnpm --filter @aigc/worker dev    # Worker

# 启动本地基础设施（PostgreSQL / Redis / MinIO）
docker-compose up -d

docker-compose up -d --build --force-recreate
```

### 构建 & Lint

```bash
pnpm build          # 全量构建
pnpm lint           # 全量 lint
pnpm --filter @aigc/web build     # 单独构建前端

pnpm --filter @aigc/types build # 单独构建types 包
```

### 数据库

```bash
pnpm db:migrate     # 执行迁移
pnpm db:seed        # 填充种子数据
```

### E2E 测试（前端）

```bash
pnpm --filter @aigc/web test:e2e        # 无头运行
pnpm --filter @aigc/web test:e2e:ui     # 带 UI 运行
```

---

## Monorepo 架构

```
apps/
  api/      — Fastify 4 REST API（端口 7001）
  web/      — Next.js 14 App Router 前端（端口 6006）
  worker/   — BullMQ 后台任务处理
  docs/     — Nextra 文档站
packages/
  db/       — Kysely schema、迁移脚本、种子数据
  types/    — 跨应用共享 TypeScript 类型
```

---

## 各应用职责

### `apps/api`

- **框架**: Fastify 4 + TypeScript（ESM）
- **认证**: JWT（`plugins/` 中的守卫插件）
- **路由**: `routes/` 下按业务模块拆分（auth、generate、canvas、video-studio、payment 等 20+ 模块）
- **业务逻辑**: `services/`（积分、提示词过滤、合并导出）
- **工具库**: `lib/`（storage、queue、credits、sanitize）
- **队列**: BullMQ + Redis，任务投递给 worker

### `apps/web`

- **框架**: Next.js 14 App Router
- **路由组**:
  - `(auth)/` — 登录、SSO、邀请
  - `(dashboard)/` — 主功能区（generation、canvas、video-studio、assets、history、admin、team、credits、settings）
  - `payment/` — 支付回调
- **状态管理**: Zustand 5（`stores/`），画布支持 undo/redo（Zundo）
- **数据请求**: SWR
- **API 代理**: Next.js rewrites 将 `/api/*` 转发到 `INTERNAL_API_URL`（默认 `http://localhost:7001`）

### `apps/worker`

- **消费者**: `workers/`（BullMQ）
- **定时任务**: `jobs/`（purge、timeout-guardian）
- **处理管线**: `pipelines/`
- **外部服务适配器**: `adapters/`（火山引擎、Gemini 等）

### `packages/db`

- Kysely + pg，PostgreSQL 15
- 所有 schema 变更通过迁移脚本管理，不直接修改 schema 文件

### `packages/types`

- 跨应用共享类型：adapter、api、db、queue
- 修改此包后需重新构建依赖它的应用

---

## 技术栈关键点

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js 14 App Router + React 18 |
| 样式 | Tailwind CSS 3 + tailwindcss-animate |
| UI 组件 | Radix UI |
| 画布 | ReactFlow |
| 动画 | Framer Motion |
| 后端框架 | Fastify 4 |
| ORM/查询 | Kysely（类型安全，无 ORM 魔法） |
| 队列 | BullMQ + Redis |
| 对象存储 | MinIO（本地）/ AWS S3 兼容接口 |
| 图片处理 | Sharp |
| 视频处理 | fluent-ffmpeg |
| AI 提供商 | 火山引擎（图片/视频/数字人）、Gemini、Nano Banana |

---

## 环境变量

复制 `.env.example` 为 `.env`，复制 `prompts.env.example` 为 `prompts.env`。  
关键变量：`DATABASE_URL`、`REDIS_URL`、`S3_*`、`JWT_SECRET`、`VOLC_*`（火山引擎）。

---

## 注意事项

- **Kysely 查询**：不使用 ORM，直接写类型安全的 SQL 构建器，修改 schema 必须同步更新 `packages/types` 中的 DB 类型。
- **积分系统**：生成操作会扣减用户积分，`api/lib/credits.ts` 是核心，修改生成流程时注意积分扣减逻辑。
- **队列任务**：API 只负责投递任务，实际 AI 调用在 worker 中执行，调试生成问题需同时看 api 和 worker 日志。
- **视频工作室**：有独立的状态追踪（`e3d3599`），生成任务有超时守卫（`timeout-guardian` job）。
- **PM2 部署**：生产环境通过 `ecosystem.config.cjs` 管理三个进程（api、worker、web）。

---

## Docker 部署

### 架构

四台独立服务器，各自运行独立的 `docker-compose.yml`：

| 服务器 | 内容 | 关键端口 |
|--------|------|----------|
| 基础设施服务器 | PostgreSQL + Redis + MinIO | 5432 / 6379 / 9000 |
| API 服务器 | `aigc-api` 容器 | 7001 |
| Web 服务器 | `aigc-web` 容器 | 6006 |
| Worker 服务器 | `aigc-worker` 容器（BullMQ 消费者，无 HTTP 端口） | — |

各服务器的 compose 配置在 `deploy/<service>/` 目录。部署在内网环境通过跳板机进行，本机只负责构建镜像，传输和启动全部在服务器侧手动完成。

### 本机操作：构建镜像

在 monorepo 根目录执行，构建上下文是整个仓库：
```bash
bash deploy/build-images.sh all
# 产物输出到 deploy/dist/
#   aigc-api.tar.gz
#   aigc-web.tar.gz
#   aigc-worker.tar.gz
```

单独构建某个服务：
```bash
bash deploy/build-images.sh api
bash deploy/build-images.sh web
bash deploy/build-images.sh worker
```

### 服务器侧操作（通过跳板机手动执行，按顺序：infra → api → worker → web）

将 `deploy/dist/aigc-<service>.tar.gz` 和 `deploy/<service>/` 目录下的文件传到对应服务器后：

```bash
# ---- 基础设施服务器（只用官方镜像，无需 docker load）----
cp .env.example .env
vi .env                              # 填写数据库密码、MinIO 密钥
docker compose up -d

# ---- api / worker / web 服务器（以 api 为例）----
docker load < aigc-web.tar.gz
cp .env.example .env
cp docker-compose.yml docker-compose.yml
vi .env                              # 填写 INFRA_HOST 及各项密钥
docker compose up -d

# 每次重新构建容器
docker load < aigc-web.tar.gz
docker-compose up -d --force-recreate # 强制重新构建容器
docker logs aigc-web --tail 30 # 查看容器日志
```

**数据库迁移（首次部署，在能访问基础设施服务器的机器上执行）**
```bash
DATABASE_URL=postgresql://aigc:<password>@<INFRA_IP>:5432/aigc_dev pnpm db:migrate
```

### 注意事项

- **防火墙**：基础设施服务器的 5432/6379/9000 端口只对 API/Worker 服务器 IP 开放，不要暴露公网。
- **`NEXT_PUBLIC_STORAGE_HOST`**：该值会被打包进客户端 bundle，必须填写浏览器可访问的公网 IP 或域名，不能用内网地址。
- **`sharp` 原生模块**：Windows 本机编译的二进制无法在 Linux 容器运行，Dockerfile 已在 Alpine 环境重新安装，无需手动处理。
- **`output: 'standalone'`**：`apps/web/next.config.mjs` 已开启，web Dockerfile 依赖此配置生成 `server.js`，不可移除。
- **worker 无 HTTP 端口**：healthcheck 通过 `pgrep` 检查进程存活，不是 HTTP 探针。

### superpowers 执行复杂长任务、长思考重构时，严格遵守以下规则
- 不要一次性全部思考完再动手，必须【分步思考、分步落地】
- 每完成一轮长考、需求拆解、方案设计、技术选型，立刻把完整思考过程、推理逻辑、取舍- 理由 追加写入 .claude/task-log.md
- 拆分出的子任务、执行步骤实时更新到 .claude/task-plan.md，用待完成/进行中/已完成标记
- 每做完一个子步骤，先写日志、更新计划，再进入下一步，不累积超长上下文
- 任何时候如果会话中断、重启，优先读取 .claude/task-log.md 和 .claude/task-plan.md，从上次中断的思考节点继续，禁止从头重新长考
- 大代码修改必须拆分成小文件、小模块分步做，每步写完记录存档
