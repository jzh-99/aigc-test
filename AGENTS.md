# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 工作流程（非常重要）
首先需要加载项目内的约定文件 `AGENTS.md`（本项目所有约定、规则、常见问题以本文件为唯一权威源）。

> 说明：旧版本曾写「加载全局规则 `~/.claude/CLAUDE.md`」，但该文件是用户私有全局文件，新同事/新环境不存在，等同于空指向。已改为指向项目内权威源 `AGENTS.md`。

### 问题沉淀规则

同一个**技术性报错 / bug**、**环境 / 配置 / 部署问题**、**第三方集成踩坑**（火山、TOS、Redis、PostgreSQL、Kysely、业管平台等），在本项目内出现第 **2 次**时，必须把解决办法按四段式写入本文件「[常见问题与解决方案](#常见问题与解决方案)」章节：

- **问题现象**：可被搜索到的报错关键字或可观察症状（如错误码、报错文案片段）。
- **根本原因**：写"为什么发生"，根因而非表象。
- **解决办法**：关键命令 / 配置取值 / 代码改动方向，不贴大段代码。
- **验证方式**：可执行的确认手段（如 `docker logs`、某条 SQL、重启后观察指标）。

业务逻辑理解问题（计费规则、状态流转等）不进此章节，走业务说明文档（如 `A豆积分体系说明.md`）。每条控制在 8-15 行内。

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

# 启动本地基础设施（PostgreSQL + Redis）
# 对象存储使用火山 TOS，需在 .env 中配置 TOS_* 环境变量
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
| 对象存储 | 火山引擎 TOS |
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
- **数据库字段说明**：新增或修改表结构时，迁移脚本必须为表和每个字段添加 `COMMENT ON TABLE/COLUMN` 说明；字段说明必须写清业务含义、取值范围、单位、是否缓存/快照/权威来源、关联外部系统字段。复杂字段（尤其 `jsonb` / JSON 字符串 / 配置对象）不能一句话带过，必须按层级说明每个 key、嵌套对象、数组元素、枚举值、默认值和兼容策略。
- **复杂模块注释**：认证、权限、计费、队列、外部平台同步、模型配置、JSON 参数解析等复杂模块，代码必须在关键函数、状态流转和边界条件处写清中文注释；注释要解释业务意图、输入输出、失败/重试/幂等行为，禁止只写“更新数据”“处理逻辑”这类空泛说明。
- **积分系统**：生成操作会扣减用户积分，`api/lib/credits.ts` 是核心，修改生成流程时注意积分扣减逻辑。
- **队列任务**：API 只负责投递任务，实际 AI 调用在 worker 中执行，调试生成问题需同时看 api 和 worker 日志。
- **视频工作室**：有独立的状态追踪（`e3d3599`），生成任务有超时守卫（`timeout-guardian` job）。
- **PM2 部署**：生产环境通过 `ecosystem.config.cjs` 管理三个进程（api、worker、web）。
- **本地验证边界**：由于当前项目本地 dev server 在构建后可能出现缓存/模块解析问题，前端改动完成后即可结束反馈；不要继续执行构建、浏览器刷新、重启 `localhost:6006` 或其他后续预览验证动作。

---

## Docker 部署

### 架构

四台独立服务器，各自运行独立的 `docker-compose.yml`：

| 服务器 | 内容 | 关键端口 |
|--------|------|----------|
| 基础设施服务器 | PostgreSQL + Redis | 5432 / 6379 |
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
bash deploy/build-images.sh infra        # 拉取并打包基础服务官方镜像（离线环境）
```

### 服务器侧操作（通过跳板机手动执行，按顺序：infra → api → worker → web）

将 `deploy/dist/*.tar.gz` 和 `deploy/<service>/` 目录下的文件传到对应服务器后：

```bash
# ---- 基础设施服务器（离线环境，需 docker load 官方镜像）----
sudo bash setup-host.sh                 # 仅首次：创建 swap，防止 PG 内存峰值触发 OOM
docker load < postgres.tar.gz           # 加载 postgres:16-alpine
docker load < redis.tar.gz              # 加载 redis:7-alpine
cp .env.example .env
vi .env                                 # 填写数据库密码、Redis 密码、PG_* 内存参数
docker compose up -d

# ---- api / worker / web 服务器（以 api 为例）----
docker load < aigc-web.tar.gz
cp .env.example .env
cp docker-compose.yml docker-compose.yml
vi .env                                 # 填写 INFRA_HOST 及各项密钥
docker compose up -d

# 每次重新构建容器
docker load < aigc-web.tar.gz
docker-compose up -d --force-recreate   # 强制重新构建容器
docker logs aigc-web --tail 30          # 查看容器日志
```

**数据库迁移（首次部署，在能访问基础设施服务器的机器上执行）**
```bash
DATABASE_URL=postgresql://aigc:<password>@<INFRA_IP>:5432/aigc_dev pnpm db:migrate
```

### 注意事项

- **防火墙**：基础设施服务器的 5432/6379/9000 端口只对 API/Worker 服务器 IP 开放，不要暴露公网。
- **基础设施内存调优**：PostgreSQL 默认 `shared_buffers=128MB / work_mem=4MB` 在 `credits_ledger` 等流水表上会触发 53200 OOM。`deploy/infra/docker-compose.yml` 已通过 `command:` 覆盖，参数经 `deploy/infra/.env` 的 `PG_*` 变量注入（8GB 服务器默认档位：1GB / 16MB / 256MB / 3GB / 80 连接）。修改 `.env` 后需 `docker compose up -d --force-recreate`。
- **基础设施 swap**：`deploy/infra/setup-host.sh` 负责创建 2GB swap + `vm.swappiness=10` 并持久化，仅首次执行一次（幂等，重复执行无副作用）。swap 不能在容器内做，必须在宿主机内核层创建。
- **`NEXT_PUBLIC_STORAGE_HOST`**：该值会被打包进客户端 bundle，必须填写浏览器可访问的公网 IP 或域名，不能用内网地址。
- **`sharp` 原生模块**：Windows 本机编译的二进制无法在 Linux 容器运行，Dockerfile 已在 Alpine 环境重新安装，无需手动处理。
- **`output: 'standalone'`**：`apps/web/next.config.mjs` 已开启，web Dockerfile 依赖此配置生成 `server.js`，不可移除。
- **worker 无 HTTP 端口**：healthcheck 通过 `pgrep` 检查进程存活，不是 HTTP 探针。
