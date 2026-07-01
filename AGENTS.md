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

## 常见问题与解决方案

> 本章节记录项目中反复出现的技术 / 环境 / 第三方集成问题及其解决办法。新增条目请遵循「[问题沉淀规则](#问题沉淀规则)」的四段式。

### 1. 业管平台 A 豆迁移反复返工（余额落本地 / fire-and-forget / toby_ 前缀）

- **问题现象**：A 豆余额、累计消费、累计获得被写进本地表；通知业管的接口在主事务后只做一次同步调用就返回；新增了 `toby_` 前缀的本地业管表。导致余额对账不一致、通知丢失、命名与项目内 Toby 业务模块混淆。
- **根本原因**：把业管的权威数据当成本地缓存维护；把"需要可靠投递的外部通知"当成普通 HTTP 调用；复用了与已有业务模块冲突的命名前缀。
- **解决办法**：
  1. **A 豆不落本地**：余额 / 累计消费 / 累计获得一律实时从业管按当前选中 `biz_mgmt_user_id` 查询；`MEMBER-1001` 返回的 `pointsNum/sumPointsNum/consumePointsNum` 不落库；本地只记 `biz_mgmt_a_bean_transactions` 扣减审计。
  2. **通知走 outbox**：所有"本地状态变化需通知业管"的动作，先在业务事务内写 `biz_mgmt_outbox_events(status='pending')`，事务提交后投 `biz-mgmt-notify-queue`，worker 消费按指数退避重试，超限标 `failed` 并保留记录，禁止 fire-and-forget。
  3. **命名前缀**：本地业管表统一用 `biz_mgmt_` 前缀，禁止 `toby_`（`toby` 仅保留在外部接口协议层封装）。
- **验证方式**：`grep -rni "credit_accounts\|credits_ledger" apps/api/src/routes apps/worker/src` 确认新生成链路不再写本地积分表；查 `biz_mgmt_outbox_events` 有 `succeeded`/`failed` 记录而非空表；`grep -rn "toby_" packages/db/migrations` 无新增 `toby_` 业管表。

### 2. PostgreSQL 流水表查询触发 53200 OOM

- **问题现象**：基础设施服务器上查询 `credits_ledger` 等大流水表时，PostgreSQL 报错 `ERROR: out of memory / SQLSTATE 53200`，连接中断，严重时 PG 进程被 OOM Killer 杀掉。
- **根本原因**：PG 默认 `shared_buffers=128MB / work_mem=4MB` 在大流水表上做大查询/排序/哈希聚合时，按连接数倍增的 work_mem 把内存撑爆；宿主机又没配 swap，内存峰值无缓冲。
- **解决办法**：
  1. `deploy/infra/docker-compose.yml` 已用 `command:` 覆盖内存参数，8GB 服务器默认档位：`shared_buffers=1GB / work_mem=16MB / effective_cache_size=3GB / max_connections=80`，经 `deploy/infra/.env` 的 `PG_*` 变量注入。改 `.env` 后必须 `docker compose up -d --force-recreate`。
  2. 宿主机首次执行 `deploy/infra/setup-host.sh` 创建 2GB swap + `vm.swappiness=10`（幂等，仅宿主机内核层，容器内不能做 swap）。
- **验证方式**：`docker exec <pg容器> psql -U aigc -d aigc_dev -c "SHOW shared_buffers; SHOW work_mem;"` 确认参数已生效；`free -h`（宿主机）确认 swap 存在；重跑触发过 OOM 的查询不再报 53200。

### 3. Sharp 原生模块 Windows 编译的二进制无法在 Linux 容器运行

- **问题现象**：Windows 本机 `pnpm install` 编译出的 `sharp` 原生二进制，打进 Docker（Alpine）镜像后启动报模块加载失败 / `node_modules/sharp` 平台不匹配。
- **根本原因**：Sharp 含平台相关的原生 `.node` 二进制，本机编译的目标平台与 Alpine/musl 容器环境不一致，无法跨平台复用。
- **解决办法**：Dockerfile 已在 Alpine 环境内重新安装 sharp（构建阶段 `pnpm rebuild sharp` 或重装），无需在本机手动处理。**不要**把 Windows 本机的 `node_modules/sharp` 原样拷进镜像。
- **验证方式**：`docker run --rm <aigc-web镜像> node -e "require('sharp')"` 不报错即说明镜像内 sharp 可用。

### 4. NEXT_PUBLIC_STORAGE_HOST 误填内网地址导致客户端图片 / 资源 404

- **问题现象**：浏览器端图片、视频、数字人资产加载失败（404 或连接超时），但服务端日志正常、对象存储里文件确实存在。
- **根本原因**：`NEXT_PUBLIC_STORAGE_HOST`（火山 TOS 公网域名）会被**打包进客户端 bundle**。若填成内网地址（如 `INFRA_HOST` 内网 IP），浏览器（用户网络）无法访问内网，于是 404；而服务端能访问是因为服务器在内网。
- **解决办法**：`.env` 中 `NEXT_PUBLIC_STORAGE_HOST` 必须填写**浏览器可访问的火山 TOS 公网域名**（如 `xxx.tos-cn-shanghai.volces.com`），不能用内网地址。**改后必须重新构建 web 镜像**（因为已打进 bundle）。
- **验证方式**：改 `.env` 后 `docker compose up -d --force-recreate` 重建 web 容器，浏览器开发者工具看图片请求 URL 指向公网域名且返回 200。

### 5. CLAUDE.md 被 .gitignore 忽略、不能作为团队约定入口

- **问题现象**：在根目录 `CLAUDE.md` 写了项目约定/规则并 `git add`，提示 `The following paths are ignored by one of your .gitignore files`，提交失败；同事 clone 仓库后看不到该文件，约定无法共享。
- **根本原因**：`.gitignore` 第 85-86 行明确忽略 `CLAUDE.md` 与 `**/CLAUDE.md`，且根目录 `CLAUDE.md` 从未进入版本库（`git ls-files --error-unmatch CLAUDE.md` 报未跟踪）。它是**本地私有文件**，各人本地内容可不同，不能作为团队入口。
- **解决办法**：项目约定、规则、常见问题**只写在 `AGENTS.md`**（唯一权威源 + 唯一团队入口，所有 Agent 工具通用）。`CLAUDE.md` 若需保留，仅作本机 Claude Code 的本地引导（指向 AGENTS.md），不 commit。需要把本地修改强制入库时再单独评估，不要默认它能被团队读到。
- **验证方式**：`git check-ignore -v CLAUDE.md` 若有输出则确认被忽略；`git ls-files CLAUDE.md` 无输出则确认未跟踪；团队约定一律以 `git ls-files AGENTS.md` 能列出的 AGENTS.md 为准。

### 6. 两步式登录：建本地 user 的责任在 check-biz-mgmt，不在 login

- **问题现象**：手机号登录时，业管明明返回了会员信息、前端也进了密码输入步，但 `users` 表一直是空的；新用户进密码步时也拿不到初始密码，无法完成首次登录。
- **根本原因**：两步式登录职责错位。`/auth/check-biz-mgmt`（第一步「下一步」）只查业管判存亡，不建 user、不返密码；而建 user + 生成初始密码的逻辑放在了 `/auth/login`（第二步「登录」成功响应里）——初始密码出现在"登录成功之后"，新用户根本不知道密码，形成死循环。
- **解决办法**：建本地 user 的责任**只在 `/auth/check-biz-mgmt`**。手机号登录正确时序：
  1. `check-biz-mgmt`：业管有会员 → 查本地 `users.phone` → 无则 `ensureLocalUserForBizMgmtPhone` 建 user + 生成一次性初始密码 → 返回 `{exists:true, one_time_password}`；有则只返 `{exists:true}`。
  2. 前端密码步：展示初始密码黄色提示框，用户用该密码登录。
  3. `login`：**只做 bcrypt 密码校验**，不再建 user、不再返初始密码；本地无 user（说明跳过了 check）→ 返回 `BIZ_MGMT_NOT_FOUND` 拒绝。
  - 不要把建 user 逻辑放回 login；不要在 login 内重复查业管建 user（会与 check 结果不一致导致登录失败）。
- **验证方式**：`grep -n "ensureLocalUserForBizMgmtPhone" apps/api/src/routes/auth/post-login.ts` 应无输出（login 不再建 user）；该函数只应出现在 `post-check-biz-mgmt.ts`；新用户走完「下一步」后 `users` 表即有该 phone 记录，不必等点「登录」。

### 7. worker/api 改了 src 但运行时仍报旧错误（重启没用）

- **问题现象**：改了 `apps/worker/src/`（或 `apps/api/src/`）的代码，重启进程后仍报旧的错误文案（如环境变量名从 `TOBY_BASE_URL` 改成 `TOBY_OUTBOUND_BASE_URL` 后，worker 日志/outbox 表 `last_error` 仍写 `TOBY_BASE_URL is required`）。
- **根本原因**：`apps/worker` / `apps/api` 的 `package.json` 启动脚本是 `start: node dist/index.js`（生产模式跑 `dist/` 编译产物），不是 `dev: tsx src/index.ts`（开发模式实时编译 src）。只改 `src/` 不重新 `build`，`dist/` 仍是旧版本；`pnpm start` 或 PM2 加载的是 `dist/`，所以 src 的修改根本没生效。`tsc --noEmit` 和 `tsx --test` 都不碰 `dist/`，无法发现这个问题。
- **解决办法**：改完 worker/api 的 src 后，**根据运行方式二选一**：
  1. 开发调试：用 `pnpm --filter @aigc/worker dev`（tsx 直接跑 src，免 build）。
  2. 生产 / PM2 / `pnpm start`：必须先 `pnpm --filter @aigc/worker build` 重编 `dist/`，再重启进程；服务器镜像部署同理（重新构建镜像 = 重建 dist）。
- **验证方式**：`grep -n "<旧错误文案>" apps/worker/dist/lib/<对应文件>.js` 应无输出（确认 dist 已更新）；对比 `apps/worker/src` 与 `apps/worker/dist` 对应文件的修改时间，dist 应新于 src；重启后观察 `biz_mgmt_outbox_events.last_error` 或 worker 日志不再出现旧错误文案。

### 8. Nacos 配置中心：AI 参数热更接入与 ESM 静态绑定陷阱

- **问题现象**：改了 Nacos 控制台的 AI 配置（如 `DOUBAO_API_KEY`），api/worker 日志显示「配置加载完成」，但实际 AI 调用仍用旧 key/旧 model，必须重启进程才换值。
- **根本原因**：ESM 的 `export const X = process.env...` 在**模块加载时静态求值一次**，此后即使把新值写进 `process.env`，已 `import { X }` 的代码拿到的仍是旧值——这是 JS 引擎层面的静态绑定，**无法绕过**。Nacos loader 把远程值写回 `process.env` 是对的，但下游若用 `export const` 一次性求值就读不到新值。此外 adapter factory 用单例缓存（`new XxxAdapter()` 只构造一次，env 在构造时读一次）也会锁死旧值。
- **解决办法**：
  1. **热更只能靠 getter / 函数内读取**：`packages/nacos-config/src/ai-config.ts` 导出的 `doubaoConfig` / `nanoBananaConfig` / `tokenbusConfig` 等 getter 门面，每个属性都是 `get xxx() { return process.env.XXX ?? '' }`，每次访问实时取最新值。新代码读 AI 配置一律用这些 getter，**禁止 `export const X = process.env...` 顶层求值**。
  2. **adapter factory 去缓存**：`apps/worker/src/adapters/factory.ts` 不再 `cache` 单例，`getAdapter()` 每次新建实例，让构造函数重新读 getter，热更即时生效（图片生成频率不高，new 开销可忽略）。
  3. **入口注入点**：`apps/api/src/index.ts` 的 `main()` 内、`apps/worker/src/index.ts` 单实例锁之后，调用 `await loadNacosConfig()`；loader 会先清理 AI 相关 env，再从 Nacos 写回。Nacos 是 **AI 配置强依赖**：未配置、连接失败或 DataID 拉取失败都会抛错阻止启动，不再使用 `.env` 兜底。具体供应商 key 是否为空由实际调用的 adapter/service 校验，避免未启用供应商（如播客）阻断整个 worker/api 启动。
  4. **配置归属**：AI key/endpoint/model → Nacos；模型价格 → DB（`provider_models`）；`DATABASE_URL`/`JWT_SECRET`/TOS AK/SK → 容器 env；`NEXT_PUBLIC_*` → 构建期（打进 bundle，Nacos 改不动）；`NACOS_SERVER_ADDR` 等 Nacos 自身变量 → 容器 env（鸡生蛋）。
- **验证方式**：`grep -rn "export const .* = process.env" apps/api/src apps/worker/src` 确认 AI 相关无新增顶层 const 求值；改 Nacos 配置后 `docker logs aigc-worker --tail 50 | grep nacos` 见「配置加载完成」且下一次 AI 请求即用新值；`packages/nacos-config` 跑 `pnpm test`（mock 测试，不连真 Nacos）全绿；生产部署后必 `build` 重打 api/worker 镜像（第 7 条同样适用，loader 才会进 dist）。部署/初始化/DataID 规划见 `deploy/nacos/README.md`；9 个提供商的配置模板与一键导入脚本在 `deploy/nacos/configs/`（改完真实值后 `bash import-to-nacos.sh` 批量发布）。
- **踩坑补充**：① Nacos v1 OpenAPI 的 dataId **不允许含 `/`**（报 `Param 'dataId' is illegal`），故本项目 dataId 用 `ai-providers-xxx.properties` 命名（`-` 连接），不能用 `ai-providers/xxx` 路径风格；② 默认 public namespace 在 OpenAPI 里的 tenant 参数必须传**空串**，传 `"public"` 字符串会把配置写进一个名为 "public" 的自定义命名空间，导致默认连 public 的应用订阅不到——`import-to-nacos.sh` 已处理此映射；③ **Windows 上 `NACOS_SERVER_ADDR=localhost:8848` 会让 nacos-sdk-nodejs 把 localhost 解析成 IPv6 `::1`，长轮询连接持续报 `EADDRINUSE`（误导性错误）并刷屏，偶发导致进程崩溃（worker `Exit status 3221226505`）**——`client.ts` 的 `normalizeServerAddr` 已自动把 localhost 归一化为 `127.0.0.1`；④ **nacos-sdk-nodejs 的 `client.subscribe` 长轮询与 worker Redis 单实例锁心跳在 Windows 下并存时，也会触发无 JS 异常的 `Exit status 3221226505` 原生退出**——本项目已禁用 SDK subscribe，改为 `getConfig` 轮询热更（默认 30 秒，`NACOS_POLL_INTERVAL_MS` 可调整）。
- **配置来源诊断**：启动时 `loadNacosConfig` 会打印一张对照表，标明每个 AI 配置来自哪里——`仅Nacos`（.env 未配此 key）、`Nacos覆盖`（.env 和 Nacos 都配，Nacos 的生效）、`一致`（两边相同）。敏感值（key 名以 `_KEY`/`_SECRET`/`_PASSWORD`/`_TOKEN` 结尾的凭证类变量）自动打码（只显示首尾各 4 字符），空值显示 `(空)`。⚠️ 打码用后缀匹配而非子串——否则会把 `TOKENBUS_IMAGE_TIMEOUT_MS`、`*_MAX_TOKENS` 等含 TOKEN/KEY 子串的【数字型配置】误打码。排查「为什么改了 Nacos 没生效 / 到底用的哪个值」看这张表即可。
- **系统级配置 vs 供应商配置（两类策略）**：① 供应商配置（`ai-providers-*.properties`，key/endpoint/model）严格无默认值，必须由 Nacos 提供（`loadNacosConfig` 会先清理本地 env 再由 Nacos 写回，`volcengineConfig.apiUrl` 等不带兜底）；② 系统级配置（`system.properties`，跨供应商的超时链/并发/max_tokens）宽容——有合理默认值（`envNumberOr`，对齐原硬编码），留空用代码默认，填了用填的值，热更价值在线上调优免重启。新增系统级参数时在 `systemConfig` 加 getter + 注册 `AI_CONFIG_ENV_KEYS` + 在 `system.properties` 补默认值。

### 9. provider_models 的 code（业务名）与 params_pricing.model（真实 API id）分工

- **问题现象**：新增/更换火山或天翼云模型时，必须在 adapter 里改 `MODEL_ID_MAP` 等硬编码映射表（业务名→真实 API id），改一次要发版；且映射表在 volcengine-image / storybook-core / video-submit-payload 多处重复维护，容易漂移。
- **根本原因**：早期 `provider_models.params_pricing[].model` 存的是业务友好名（如 `seedream-4.5`），与 `code` 相同；真实 API id（如 `doubao-seedream-4-5-251128`）只活在 adapter 的硬编码映射表里，没进 DB。
- **解决办法（方案 C）**：让两者分工——`code` 保持业务名（前端展示/路由查询/计费备注用，向后兼容），`params_pricing[].model` 改存**真实 API id**。利用现有 `resolveUnitPrice` 替换链路（图片 `post-image.ts:537`、视频 `post-generate.ts` 的 `actualModel = resolvedModel ?? model`）把真实 id 传给 adapter，adapter **直传不再查映射表**（参考 tokenbus 模式，其 code 本就是真实 id）。改造后：① adapter 删掉所有 `MODEL_ID_MAP`/`SEEDREAM_MODEL_ID_MAP`/`VOLCENGINE_MODEL_ID`/`CTYUN_EDGE_MODEL_ID`；② 换模型 id 只改 `models.json` 的 `paramsPricing[].model` + 迁移，零代码改动；③ 前端零改动（前端传业务名 code，被 resolveUnitPrice 替换成真实 id）。
- **验证方式**：`SELECT code, params_pricing->0->>'model' FROM provider_models WHERE code='seedream-4.5'` —— code 应是业务名 `seedream-4.5`，model 应是真实 id `doubao-seedream-4-5-251128`；`grep -rn "MODEL_ID_MAP\|SEEDREAM_MODEL_ID_MAP" apps/worker/src` 应无残留（映射表已删）；新增模型时只在 `models.json` 填真实 id，不要在 adapter 加映射表。

---

## Docker 部署

### 架构

四台独立服务器，各自运行独立的 `docker-compose.yml`：

| 服务器 | 内容 | 关键端口 |
|--------|------|----------|
| 基础设施服务器 | PostgreSQL + Redis | 5432 / 6379 |
| 配置服务器 | Nacos 配置中心（AI 参数热更） | 8848 / 9848 |
| API 服务器 | `aigc-api` 容器 | 7001 |
| Web 服务器 | `aigc-web` 容器 | 6006 |
| Worker 服务器 | `aigc-worker` 容器（BullMQ 消费者，无 HTTP 端口） | — |

> **配置服务器为 AI 能力必需组件**：api/worker 的 AI provider key、endpoint、model、timeout 全部来自 Nacos，不再使用 `.env` 兜底。详见 `deploy/nacos/README.md`。

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
