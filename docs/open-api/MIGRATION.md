# 开放接口迁移说明与部署检查

源项目（Python / FastAPI / Celery / MySQL / MinIO）的开放接口能力，已 TS 重写并合并到
aigc-test（Fastify / Kysely / PostgreSQL / BullMQ / 火山 TOS）。本文档汇总迁移范围、
部署检查清单、已知偏离与待决策项。

---

## 1. 迁移范围（7 种业务全部完成）

| 业务 | 链路类型 | 路由 | 实现 Phase | 测试 |
|---|---|---|---|---|
| 图片 | 异步（提交 + 转存回调） | `POST /images/generations` | Phase 1 | 端到端贯通 |
| 视频 | 异步（自调度轮询） | `POST /videos/generations` | Phase 2 | worker 接入 |
| 音乐 | 异步 | `POST /lyrics/generate` | Phase 3 | 字段映射 |
| 绘本 | 异步（两步：分镜 + 组图） | `POST /storybooks/generations` | Phase 4 | 核心逻辑 |
| 播客 | 异步（WebSocket TTS） | `POST /podcasts/generations` | Phase 5 | 62 测试（帧协议逐字节验证） |
| 资讯 | 异步（Ark /responses + 安全重试） | `POST /news/generations` | Phase 6 | 34 测试 |
| 文本润色 | **同步**（不走队列） | `POST /chat/completions` | Phase 7 | 17 测试 |

基础设施（Phase 0）：api_clients 表、task_batches / tasks 扩展、回调 HMAC 签名 worker、
API Key 认证、createOpenApiBatch 共用骨架、provisionCaller 调用方归属容器、dispatch 分发。

---

## 2. 部署前检查清单

### 2.1 数据库迁移

- [ ] 执行 `packages/db/migrations/071_open_api_tables.ts`
  - 新建 `api_clients` 表（api_key_hash / team_id / workspace_id / system_user_id）
  - `task_batches` 扩展：`business_id` / `callback_url` / `callback_attempts` /
    `callback_status` / `service_type` / `task_id` / `finished_at`
  - `tasks` 扩展：`external_status` / `last_polled_at`
  - `chk_tb_source` / `chk_tb_module` CHECK 约束扩展（含 open_api / news / storybook / podcast 等）

### 2.2 环境变量（.env）

详见 `.env.example` / `deploy/api/.env.example` / `deploy/worker/.env.example`。开放接口必需：

- [ ] `DOUBAO_API_KEY` / `DOUBAO_API_URL`（火山方舟，资讯 / 文本润色 / 绘本润色）
- [ ] `DOUBAO_NEWS_MODEL` / `DOUBAO_TEXT_MODEL` / `DOUBAO_STORYBOOK_POLISH_MODEL` /
      `DOUBAO_STORYBOOK_IMAGE_MODEL`（各业务独立模型）
- [ ] `VOLCENGINE_API_KEY`（图片 seedream / 视频 seedance）
- [ ] `MUREKA_API_KEY` / `MUREKA_API_URL`（音乐）
- [ ] `PODCAST_*`（播客 WebSocket TTS：WS_URL / APP_ID / ACCESS_KEY / RESOURCE_ID /
      APP_KEY / TIMEOUT_SECONDS）
- [ ] `CALLBACK_SIGNATURE_SECRET`（HMAC 回调签名，**必须配置**否则回调 worker 启动报错）
- [ ] `TOS_*`（对象存储，主线已有，产物统一转存 TOS）
- [ ] `DATABASE_URL` / `REDIS_URL`（主线已有）

### 2.3 Worker 进程

worker 启动自动监听全部业务队列（BullMQ 同名即同队列，api 投递 + worker 消费）：

`image-queue` / `video-queue` / `music-queue` / `storybook-queue` / `podcast-queue` /
`news-queue` / `open-api-callback-queue` / `transfer-queue`

> 开放接口各 worker 在 `apps/worker/src/index.ts` 注册（image / video / music /
> storybook / podcast / news / open-api-callback）。无需额外 `-Q` 配置（BullMQ 按队列名消费）。

### 2.4 调用方签发

- [ ] 通过 `provisionCaller`（或 CLI）签发调用方，获取明文 `aigc_xxx` key（仅返回一次）
- [ ] 与调用方约定 `CALLBACK_SIGNATURE_SECRET`（验签用）

---

## 3. 已知偏离源项目

| 维度 | 源项目（Python） | aigc-test（TS） | 说明 |
|---|---|---|---|
| 语言 / 框架 | FastAPI / Celery | Fastify / BullMQ | |
| 数据库 | MySQL（pymysql） | PostgreSQL | |
| 对象存储 | MinIO | 火山 TOS | 产物统一转存 TOS |
| 任务队列 | Celery + Redis | BullMQ + Redis | 回调重试 4 次 / 固定 10s 退避，等价源 RETRY_DELAYS |
| 多租户供应商 Key | 每个 ApiClient 持有 ark_key / mureka_key 等 | 平台级 env（DOUBAO_API_KEY 等） | 简化：调用方共用平台供应商 key |
| API Key 哈希 | passlib pbkdf2_sha256 | sha256 | **不互通**，迁移后需重新签发所有调用方 key |
| 输出安全检测 | SecurityCheckService 双供应商并行 | **暂未接入（跳过）** | 各 phase 保留重试结构，安全检测 mock 通过 |
| 输入安全改写 | security_rewrite | **暂未接入（跳过）** | 直接用原始 prompt |

### 关键契约保持不变（与源项目完全一致）

- 字段拼写：`bussiness_id`（多 s）、`promt`（少 p）、`task_id`
- 错误码值与对外文案（`ErrorCode` 枚举）
- 回调 meta 结构（image / song / video / news / storybook / podcast / text 七分支）
- HMAC-SHA256 回调签名（`sha256=`+hex，签名仅含 body 不含 timestamp，紧凑 JSON 不转义中文）
- HTTP 两段式状态码（业务错误 200 + body code / AUTH 401 / schema 422 / MODEL_CONFIG 400）

---

## 4. 未完成 / 待决策（Phase 8b，本次会话不做，另行安排）

> 经确认，本次会话仅交付**代码 + 文档 + 部署清单**；切换 / 压测由用户另行安排。

- [ ] **输出 / 输入安全检测接入**：aigc-test 暂无 SecurityCheckService，当前各 phase 跳过。
      文本润色为同步直返，尤需优先接入输出安全围栏。
- [ ] **压测验证**：真实环境跑性能压测（需 Redis / PG / Ark / TOS 凭据 + 调用方 key）。
- [ ] **生产切换**：废弃 Python 服务、流量切到 TS。**不可逆**，需制定回滚预案、灰度方案。
- [ ] **多租户 Key 隔离**（可选）：若需每调用方独立供应商 key，需扩展 `api_clients` 表
      增加 ark_key / mureka_key 等列，并改造 worker 从 client 取 key。
- [ ] **视频 / 音乐轮询间隔**：当前为 BullMQ 延迟重投，间隔需压测后调优（源项目 30s）。

---

## 5. 提交记录（feat/open-api-migration 分支）

| commit | 内容 |
|---|---|
| Phase 0 | 基础设施（表 / 认证 / 回调 / 分发 / 归属容器） |
| 51241b62 / 3a3b5dea / 13856422 | Phase 1 图片（createOpenApiBatch + 路由 + 参考图 + 端到端） |
| c6884670 | Phase 2 视频 |
| 8a461cdc | Phase 3 音乐 |
| 4383082e | Phase 4 绘本 |
| 893d1a83 | Phase 5 播客（WebSocket 帧协议） |
| ac8561e7 | Phase 6 资讯（Ark /responses + HTML + 安全重试） |
| c633bc3c | Phase 7 文本润色（同步链路） |
| 4cfe95e4 | Phase 8.1 Ark env 统一到 DOUBAO_* |
| d2d7f1ba | Phase 8.2 .env.example 补齐 |
| 本提交 | Phase 8.3 API 文档 + 8.4 迁移检查清单 |
