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

#### 2.2.1 环境变量详细说明

| 变量 | 进程 | 作用 | 缺失 / 配置错误影响 |
|---|---|---|---|
| `DOUBAO_API_URL` | api / worker | 火山方舟 Ark API 基址，默认 `https://ark.cn-beijing.volces.com/api/v3`；文本润色走 `/chat/completions`，资讯走 `/responses`，绘本润色走 `/chat/completions`。 | 指向错误会导致 Ark 文本类业务请求失败；通常无需改动默认值。 |
| `DOUBAO_API_KEY` | api / worker | 火山方舟访问密钥。api 用于同步文本润色；worker 用于资讯生成、绘本分镜润色等文本类调用。 | 文本润色会直接返回 `MODEL_CONFIG_ERROR`；资讯 / 绘本 worker 会生成失败并触发失败回调。 |
| `DOUBAO_MODEL` | api | 主线 AI 助手默认模型，非开放接口专属；保留用于现有主线能力。 | 不影响开放接口独立模型，但会影响主线依赖该变量的文本能力。 |
| `DOUBAO_NEWS_MODEL` | api / worker | 资讯生成模型。api 在提交时写入任务参数快照，worker 实际调用 Ark `/responses` 时读取。 | 未配置时使用代码默认值；模型名无效会导致资讯生成失败。 |
| `DOUBAO_TEXT_MODEL` | api | 文本润色同步接口模型，对应 `POST /chat/completions`。 | 未配置时使用代码默认值；模型名无效会导致文本润色失败。 |
| `DOUBAO_STORYBOOK_POLISH_MODEL` | worker | 绘本分镜 / 文案润色模型，对应 Ark `/chat/completions`。 | 未配置时使用代码默认值；模型名无效会导致绘本分镜润色失败。 |
| `DOUBAO_STORYBOOK_IMAGE_MODEL` | worker | 绘本图片生成模型，当前默认 `seedream-4.5`。 | 未配置时使用代码默认值；模型名无效会导致绘本图片生成失败。 |
| `VOLCENGINE_API_KEY` | worker | 火山视觉类 API Key，用于开放接口图片 `seedream`、视频 `seedance`、绘本图片生成等视觉调用。 | 图片 / 视频 / 绘本图片生成会失败。 |
| `VOLCENGINE_ACCESS_KEY` / `VOLCENGINE_SECRET_KEY` | api / worker | 火山视觉签名调用使用的 AK/SK，主线已有；开放接口迁移保留同一套火山账号配置。 | 依赖签名接口的视觉能力会失败。 |
| `MUREKA_API_KEY` | worker | Mureka 音乐生成访问密钥。 | 音乐生成 worker 会失败并触发失败回调。 |
| `MUREKA_API_URL` | worker | Mureka API 基址，例如 `https://api.mureka.cn`。 | 音乐生成无法提交到供应商。 |
| `PODCAST_WS_URL` | worker | 播客 TTS WebSocket 服务地址。 | 播客 worker 启动任务后会因 provider 配置缺失失败。 |
| `PODCAST_APP_ID` | worker | 播客 TTS 应用 ID，写入 WebSocket 会话初始化 payload。 | 播客 TTS 鉴权 / 建连失败。 |
| `PODCAST_ACCESS_KEY` | worker | 播客 TTS 访问密钥，写入 WebSocket 鉴权头或初始化参数。 | 播客 TTS 鉴权失败。 |
| `PODCAST_RESOURCE_ID` | worker | 播客 TTS 资源 ID，用于指定供应商侧语音 / 服务资源。 | 播客 TTS 可能无法选择正确资源或直接失败。 |
| `PODCAST_APP_KEY` | worker | 播客 TTS 应用密钥，随会话参数传递给供应商。 | 播客 TTS 鉴权 / 会话创建失败。 |
| `PODCAST_TIMEOUT_SECONDS` | worker | 播客 WebSocket 单次生成超时时间，默认 `120` 秒。 | 值过小会误判长音频生成超时；值过大则失败任务释放较慢。 |
| `CALLBACK_SIGNATURE_SECRET` | worker | 开放接口回调 HMAC-SHA256 签名密钥，用于生成 `X-Signature: sha256=<hex>`。 | **必须配置**；缺失时回调 worker 报错，调用方无法可靠验签。 |
| `TOS_ACCESS_KEY_ID` / `TOS_SECRET_ACCESS_KEY` | api / worker | 火山 TOS 对象存储访问密钥，用于参考图、PDF、图片 / 视频 / 音频 / HTML 等产物转存。 | 上传 / 转存失败，最终回调无法返回永久公网 URL。 |
| `TOS_REGION` | api / worker | TOS 区域，默认 `cn-shanghai`。 | 区域与 bucket 不匹配会导致上传失败。 |
| `TOS_ENDPOINT` | api / worker | TOS endpoint，例如 `https://tos-cn-shanghai.volces.com`。 | endpoint 错误会导致上传失败。 |
| `TOS_BUCKET` | api / worker | TOS bucket 名称。 | bucket 不存在或无权限会导致上传失败。 |
| `TOS_PUBLIC_URL` | api / worker | TOS 公网访问前缀，用于拼接返回给调用方的永久 URL。 | 为空或不可公网访问会导致调用方拿到不可访问的产物地址。 |
| `DATABASE_URL` | api / worker | PostgreSQL 连接串，开放接口任务、调用方、幂等记录、状态流转全部依赖数据库。 | api / worker 无法启动或任务落库失败。 |
| `REDIS_URL` | api / worker | Redis 连接串，BullMQ 队列投递、延迟轮询、回调重试依赖 Redis。 | api 无法投递任务，worker 无法消费任务。 |

部署建议：

- api 服务器至少需要：`DATABASE_URL` / `REDIS_URL` / `DOUBAO_*`（文本润色、资讯任务参数快照）/
  `TOS_*`（参考图、PDF 等入参转存）/ `VOLCENGINE_*`（主线与部分视觉签名能力）/
  `MUREKA_*`（与部署模板保持一致）。
- worker 服务器至少需要：`DATABASE_URL` / `REDIS_URL` / `DOUBAO_*` / `VOLCENGINE_*` /
  `MUREKA_*` / `PODCAST_*` / `CALLBACK_SIGNATURE_SECRET` / `TOS_*`。
- `.env.example` 与 `deploy/*/.env.example` 只能保留占位值；真实密钥不要提交到 Git。

### 2.3 新引入依赖

| 包 | 所在包 | 类型 | 作用 |
|---|---|---|---|
| `crypto-js` | `apps/api` | runtime dependency（运行时依赖） | Toby 开放接口兼容层使用 DES-CBC + PKCS7 加解密，对齐外部接口的参数加密 / 解密契约。Node 原生 `crypto` 与源项目兼容细节不完全一致，因此保留 `crypto-js` 以降低迁移偏差。 |
| `@types/crypto-js` | `apps/api` | dev dependency（开发期类型依赖） | 为 TypeScript 提供 `crypto-js` 类型声明，避免加解密工具和开放接口适配代码退化成 `any`。 |
| `ws` | `apps/worker` | runtime dependency（运行时依赖） | 播客生成接入字节 sami WebSocket TTS。Node 20 当前没有可直接替代该链路所需的稳定服务端 WebSocket 客户端封装，因此 worker 使用 `ws` 建连、收发二进制帧并驱动 TTS 状态机。 |
| `@types/ws` | `apps/worker` | dev dependency（开发期类型依赖） | 为 `ws` 提供 TypeScript 类型，覆盖播客 provider、mock WebSocket 测试与帧协议校验。 |

> 其他依赖如 BullMQ、Kysely、TOS SDK、Sharp、ioredis 等为主线已有能力，本次开放接口迁移复用它们，不作为新增依赖记录。

### 2.4 Worker 进程

worker 启动自动监听全部业务队列（BullMQ 同名即同队列，api 投递 + worker 消费）：

`image-queue` / `video-queue` / `music-queue` / `storybook-queue` / `podcast-queue` /
`news-queue` / `open-api-callback-queue` / `transfer-queue`

> 开放接口各 worker 在 `apps/worker/src/index.ts` 注册（image / video / music /
> storybook / podcast / news / open-api-callback）。无需额外 `-Q` 配置（BullMQ 按队列名消费）。

### 2.5 调用方签发

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
