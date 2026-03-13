# AIGC 创作平台 — 系统设计文档

**日期：** 2026-02-28
**状态：** 已确认，待实现
**技术栈：** Node.js · Next.js 14 · PostgreSQL · Redis · BullMQ

---

## 一、需求概要

### 核心功能模块

| 模块 | MVP 优先级 | 说明 |
|------|-----------|------|
| 图片生成 | P0 | 文生图、图生图 |
| 视频生成 | P1 | 基础 API 调用，首尾帧参考 |
| 语音配音 | P1 | TTS、声音克隆 |
| 视频对口型 | P2 | 视频 + 音频合成 |
| 海报 Agent | P2 | 模板化海报生成（Phase 4 实现） |
| 分镜 Agent | P2 | 长文本 → 分镜 → 批量生成 |

### 目标用户

- 个人创作者
- 小型团队（2-10人协作）
- 企业客户（私有积分池、定制报价）

### 商业模式

混合制：订阅套餐（含基础额度）+ 超额按量付费，企业可定制。

### API 接入策略

国内外混合接入，服务端代理调用，前端无感知。

---

## 二、整体架构

### 方案选择

采用**方案 B：前后端分离 + 异步 Worker**

- Next.js 前端 + Fastify API 网关 + BullMQ Worker 服务
- 所有生成任务走异步队列，不阻塞 API 网关
- Worker 服务可独立扩展

### 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                           客户端层                                │
│       Next.js 14 (App Router)  ·  React  ·  TailwindCSS          │
│  · 提交时生成 idempotency_key (UUID，绑定整个 batch)              │
│  · 数量选择器：默认1，上限按套餐（免费2 / 专业4 / 企业自定义）    │
│  · SSE 订阅：batch 聚合进度 + 各子任务独立状态                    │
│  · 携带 Last-Event-ID，指数退避自动重连（1→2→4→最长30s）         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS / SSE
┌────────────────────────────▼─────────────────────────────────────┐
│                         API 网关层                                │
│                      Node.js + Fastify                            │
│                                                                   │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐ │
│  │ JWT 鉴权     │  │ Prompt 安全过滤  │  │ 幂等性校验           │ │
│  │ 全局限流     │  │ 二级：通过/拒绝  │  │ idempotency_key 去重 │ │
│  └──────────────┘  └─────────────────┘  └──────────────────────┘ │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                提交任务                                     │   │
│  │  Step 0（事务外）：Redis GET concurrency_key               │   │
│  │    → 当前计数 + quantity > 并发上限 → 返回 CONCURRENCY_LIMIT│   │
│  │    （Advisory 检查，Worker 侧 Lua Script 为最终强制执行）   │   │
│  │                                                           │   │
│  │  BEGIN TRANSACTION（SELECT ... FOR UPDATE credit_accounts）│   │
│  │    1. 校验可用余额 balance - frozen_credits >= 单价×quantity│   │
│  │    2. balance -= 单价×quantity                            │   │
│  │       frozen_credits += 单价×quantity                     │   │
│  │    3. INSERT credits_ledger（type='freeze', amount=-cost） │   │
│  │    4. INSERT task_batches（quantity, status: pending）     │   │
│  │    5. INSERT tasks × quantity（各自独立，共享 batch_id）   │   │
│  │  COMMIT  ── 任意失败则 ROLLBACK，0 扣费                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  /webhook/:provider   签名验证 → 更新对应子任务状态        │   │
│  │  SSE heartbeat        每30秒发送 ping 防连接超时           │   │
│  └───────────────────────────────────────────────────────────┘   │
└───────┬───────────────────────────────────────┬──────────────────┘
        │ 读写                                   │ 批量投递
┌───────▼──────────────────┐      ┌─────────────▼──────────────────┐
│       PostgreSQL          │      │       BullMQ + Redis            │
│  users                    │      │  image-queue                    │
│  credit_accounts          │◄─────│  video-queue                    │
│  credits_ledger           │ 写回 │  tts-queue                      │
│  task_batches             │      │  agent-queue                    │
│  tasks                    │      │  Redis 并发计数器（Lua Script） │
│  assets                   │      │  SSE Pub/Sub 频道               │
│  teams / workspaces       │      │    sse:batch:{batchId}          │
└───────────────────────────┘      └──────┬──────────────┬───────────┘
                                          │ 订阅          │ 批量投递
                              ┌───────────▼──────┐       │
                              │  API 实例 1..N   │       │
                              │  订阅 Pub/Sub 后  │       │
                              │  推送给已连接的   │       │
                              │  SSE 客户端       │       │
                              └──────────────────┘       │
                                                 ┌────────▼───────────────────┐
                                                 │         Worker 服务        │
                                                 │  ① Lua Script 原子并发校验│
                                                 │  ② 调用第三方 API + Webhook│
                                                 │  ③ Webhook 兜底轮询       │
                                                 │  ④ 下载临时URL → 转存OSS  │
                                                 │     storageKey: assets/YYYY/│
                                                 │  ⑤ 成功→确认扣费          │
                                                 │     失败→退回积分         │
                                                 │  ⑥ PUBLISH sse:batch:{id} │
                                                 └────────────┬──────────────┘
                                                 │
                        ┌────────────────────────▼──────────────────┐
                        │             第三方 AI API 层               │
                        │  国内: 可灵 · 即梦 · 通义万相 · 腾讯云语音 │
                        │  海外: Runway · Replicate · ElevenLabs     │
                        └────────────────────────┬──────────────────┘
                                                 │ Webhook 回调
                                     /webhook/:provider（API 网关）

┌──────────────────────────────────────────────────────────────────┐
│  超时守护 Job（每5分钟）                                          │
│  扫描 processing 超过阈值 → retry_count<3 重新入队               │
│                           → retry_count=3 failed + 全额退回      │
│                             + releaseConcurrency（Redis -1）     │
├──────────────────────────────────────────────────────────────────┤
│  补转存 Job（每小时）                                             │
│  扫描 transfer_status='failed' → 重新投入 transfer-queue         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、数据库模型

### 用户与账户体系

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  username          VARCHAR(100) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  avatar_url        TEXT,
  role              VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin','member')),
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  plan_tier         VARCHAR(20) DEFAULT 'free'
                    CHECK (plan_tier IN ('free','basic','pro','enterprise')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscription_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL,
  tier              VARCHAR(20) NOT NULL CHECK (tier IN ('free','basic','pro','enterprise')),
  price_monthly     DECIMAL(10,2),
  price_yearly      DECIMAL(10,2),
  credits_monthly   INTEGER NOT NULL,
  max_concurrency   INTEGER NOT NULL,
  max_batch_size    INTEGER NOT NULL,
  features          JSONB NOT NULL,
  is_active         BOOLEAN DEFAULT true
);

CREATE TABLE user_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  plan_id           UUID NOT NULL REFERENCES subscription_plans(id),
  status            VARCHAR(20) NOT NULL CHECK (status IN ('active','expired','cancelled')),
  started_at        TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_user_subscriptions_active ON user_subscriptions (user_id, status);

-- Refresh Token 持久化，支持 revoke（logout / 多端踢出）
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL, -- 存 SHA-256(token)，不存明文
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- 邮箱验证（注册 & 找回密码均通过此表生成 token）
CREATE TABLE email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,   -- SHA-256(token)
  type        VARCHAR(20) NOT NULL CHECK (type IN ('verify_email','reset_password')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_verifications_user ON email_verifications (user_id, type);

-- 积分账户（用户或团队，二选一）
-- ⚠️ migration 依赖：此表引用 teams，必须在 teams 之后创建
CREATE TABLE credit_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type        VARCHAR(10) NOT NULL CHECK (owner_type IN ('user','team')),
  user_id           UUID REFERENCES users(id),
  team_id           UUID REFERENCES teams(id),
  balance           INTEGER NOT NULL DEFAULT 0,   -- 可用余额（已扣除冻结部分）
  frozen_credits    INTEGER NOT NULL DEFAULT 0,   -- 当前冻结中的积分（已提交未完成任务）
  total_earned      INTEGER NOT NULL DEFAULT 0,
  total_spent       INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id),
  UNIQUE (team_id),
  CHECK (balance >= 0),
  CHECK (frozen_credits >= 0),
  CHECK (balance >= frozen_credits),   -- 不可冻结超过可用余额
  CHECK (
    (owner_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR
    (owner_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE TABLE credits_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_account_id UUID NOT NULL REFERENCES credit_accounts(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  amount            INTEGER NOT NULL,
  type              VARCHAR(20) NOT NULL CHECK (type IN (
                      'topup','subscription','freeze','confirm','refund','bonus','expire')),
  -- 'expire': credits-expire Job 写入的订阅积分到期负向流水
  -- task_id / batch_id 有意不加外键约束，确保账单记录独立于任务生命周期（任务删除后账单仍可查）
  task_id           UUID,
  batch_id          UUID,
  description       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_credits_ledger_account ON credits_ledger (credit_account_id, created_at DESC);
CREATE INDEX idx_credits_ledger_user    ON credits_ledger (user_id, created_at DESC);
```

### 团队与协作体系

```sql
CREATE TABLE teams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  owner_id          UUID NOT NULL REFERENCES users(id),
  plan_tier         VARCHAR(20) DEFAULT 'free'
                    CHECK (plan_tier IN ('free','basic','pro','enterprise')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
  team_id           UUID NOT NULL REFERENCES teams(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  role              VARCHAR(20) NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- 团队订阅（对应 user_subscriptions，subscription-expire Job 同时处理两张表）
CREATE TABLE team_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id),
  plan_id     UUID NOT NULL REFERENCES subscription_plans(id),
  status      VARCHAR(20) NOT NULL CHECK (status IN ('active','expired','cancelled')),
  started_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_team_subscriptions_active ON team_subscriptions (team_id, status);

CREATE TABLE workspaces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           UUID NOT NULL REFERENCES teams(id),
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### 任务体系

```sql
CREATE TABLE task_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  team_id             UUID REFERENCES teams(id),
  workspace_id        UUID REFERENCES workspaces(id),
  credit_account_id   UUID NOT NULL REFERENCES credit_accounts(id),
  parent_batch_id     UUID REFERENCES task_batches(id) ON DELETE SET NULL,   -- Agent 子批次关联父批次；为 NULL 表示独立批次
  idempotency_key     VARCHAR(64) UNIQUE NOT NULL,
  module              VARCHAR(20) NOT NULL CHECK (module IN ('image','video','tts','lipsync','agent')),
  provider            VARCHAR(50) NOT NULL,
  model               VARCHAR(100) NOT NULL,
  prompt              TEXT NOT NULL,
  params              JSONB NOT NULL DEFAULT '{}',
  quantity            SMALLINT NOT NULL DEFAULT 1,
  completed_count     SMALLINT NOT NULL DEFAULT 0,
  failed_count        SMALLINT NOT NULL DEFAULT 0,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','completed',
                                        'partial_complete','failed')),
  estimated_credits   INTEGER NOT NULL,
  actual_credits      INTEGER NOT NULL DEFAULT 0,
  is_hidden           BOOLEAN NOT NULL DEFAULT false,
  is_deleted          BOOLEAN NOT NULL DEFAULT false,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_batches_user       ON task_batches (user_id, created_at DESC);
CREATE INDEX idx_batches_visible    ON task_batches (user_id, created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX idx_batches_idem       ON task_batches (idempotency_key);
CREATE INDEX idx_batches_processing ON task_batches (status, processing_started_at)
  WHERE status = 'processing';
-- idx_batches_processing 供 timeout-guardian 每5分钟扫描 processing 状态任务使用，partial index 仅覆盖少数活跃行，效率优于全列索引

CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES task_batches(id),
  user_id               UUID NOT NULL REFERENCES users(id),
  version_index         SMALLINT NOT NULL,
  queue_job_id          VARCHAR(255),                 -- BullMQ Job ID，用于主动取消或清理
  external_task_id      VARCHAR(255),
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','completed','failed')),
  retry_count           SMALLINT NOT NULL DEFAULT 0,
  estimated_credits     INTEGER NOT NULL,
  credits_cost          INTEGER,
  provider_cost_raw     JSONB,               -- 服务商返回的原始计费信息（格式因服务商而异），用于毛利分析；为空表示服务商未返回
  processing_started_at TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  error_message         TEXT
);
CREATE INDEX idx_tasks_batch   ON tasks (batch_id);
CREATE INDEX idx_tasks_ext_id  ON tasks (external_task_id);
CREATE INDEX idx_tasks_active  ON tasks (processing_started_at)
  WHERE status IN ('pending','processing');

CREATE TABLE assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID UNIQUE NOT NULL REFERENCES tasks(id),
  batch_id         UUID NOT NULL REFERENCES task_batches(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('image','video','audio')),
  storage_url      TEXT,
  original_url     TEXT,
  transfer_status  VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (transfer_status IN ('pending','completed','failed')),
  file_size        BIGINT,
  duration         INTEGER,
  width            INTEGER,
  height           INTEGER,
  metadata         JSONB DEFAULT '{}',
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_assets_user  ON assets (user_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_assets_batch ON assets (batch_id);
```

### 安全与审计

```sql
CREATE TABLE prompt_filter_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  prompt        TEXT NOT NULL,
  matched_rules JSONB NOT NULL DEFAULT '[]',
  action        VARCHAR(10) NOT NULL CHECK (action IN ('pass','rejected')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         VARCHAR(50) NOT NULL,
  external_task_id VARCHAR(255) NOT NULL,
  payload          JSONB NOT NULL,
  signature_valid  BOOLEAN NOT NULL,
  processed_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_webhook_ext_id ON webhook_logs (external_task_id);
```

### 支付体系

```sql
CREATE TABLE payment_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  order_no          VARCHAR(64) UNIQUE NOT NULL,   -- 内部订单号
  provider          VARCHAR(50) NOT NULL,           -- alipay / wechatpay / stripe
  provider_order_id VARCHAR(255),                   -- 渠道侧订单号
  type              VARCHAR(20) NOT NULL CHECK (type IN ('topup','subscription')),
  amount_fen        INTEGER NOT NULL,               -- 金额（分）
  credits           INTEGER,                        -- 充值积分数（topup 时填写）
  plan_id           UUID REFERENCES subscription_plans(id),  -- 订阅计划（subscription 时填写）
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payment_orders_user ON payment_orders (user_id, created_at DESC);
CREATE INDEX idx_payment_orders_no   ON payment_orders (order_no);
CREATE INDEX idx_payment_orders_ext  ON payment_orders (provider_order_id);
```

### 服务商配置

服务商信息存入数据库，支持运营后台动态管理，不硬编码到代码中。API 密钥等敏感凭证存环境变量，`config` 字段仅存非敏感配置（API Base URL、Webhook 前缀等）。

```sql
CREATE TABLE providers (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code      VARCHAR(50) UNIQUE NOT NULL,   -- 'kling', 'runway', 'elevenlabs'
  name      VARCHAR(100) NOT NULL,
  region    VARCHAR(10) NOT NULL CHECK (region IN ('cn','global')),
  modules   JSONB NOT NULL DEFAULT '[]',   -- ['image','video']
  is_active BOOLEAN NOT NULL DEFAULT true,
  config    JSONB NOT NULL DEFAULT '{}'    -- API base URL 等非敏感配置
);

CREATE TABLE provider_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES providers(id),
  code          VARCHAR(100) NOT NULL,      -- 'kling-v1.6-pro'
  name          VARCHAR(255) NOT NULL,
  module        VARCHAR(20) NOT NULL
                CHECK (module IN ('image','video','tts','lipsync','agent')),
  credit_cost   INTEGER NOT NULL,           -- 基础单价（固定费用，单位：积分）
  params_pricing JSONB NOT NULL DEFAULT '{}', -- 动态计价规则，由 utils/credit-calculator 解析，支持两种策略：
  -- 线性：{"duration": {"per_unit": 1, "cost": 5}}  → 每秒 5 积分
  -- 阶梯：{"duration": {"tiers": [{"up_to": 5, "flat": 10}, {"per_unit": 1, "cost": 5}]}}
  --        → 前5秒固定 10 积分，之后每秒 5 积分；不支持动态公式（避免 eval 安全风险）
  params_schema JSONB NOT NULL DEFAULT '{}',-- JSON Schema 描述可接受 params 字段
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (provider_id, code)
);
CREATE INDEX idx_provider_models_provider ON provider_models (provider_id);
```

### 声音克隆

```sql
-- 用户克隆的音色，TTS 生成时通过 voice_profile_id 引用
CREATE TABLE voice_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  name              VARCHAR(100) NOT NULL,
  provider          VARCHAR(50) NOT NULL,
  external_voice_id VARCHAR(255) NOT NULL,    -- 渠道侧音色 ID
  sample_asset_id   UUID REFERENCES assets(id), -- 克隆所用样本音频
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','ready','failed')),
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_voice_profiles_user ON voice_profiles (user_id) WHERE is_deleted = false;
```

### Prompt 过滤规则

过滤规则存入数据库，支持运营后台热更新，无需重启服务。**API 服务**启动时加载规则到内存，每5分钟从 DB 拉取增量更新（规则在 API 层执行过滤，Worker 不需要此缓存）。

```sql
CREATE TABLE prompt_filter_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern     TEXT NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('keyword','regex')),
  action      VARCHAR(10) NOT NULL CHECK (action IN ('reject','flag')),
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 四、API 接口设计

### 规范

```
Base URL:  /api/v1
Auth:      Authorization: Bearer <JWT>
成功响应:  { "success": true, "data": {...} }
错误响应:  { "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
分页:      cursor-based，next_cursor = base64(created_at:id)
```

**基础设施**
```
GET    /healthz            → { "status": "ok", "db": "ok", "redis": "ok" }
```

### 接口清单

**认证**
```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh        ← 同时换发新 Refresh Token（rotation），旧 token 标记 revoked_at
DELETE /auth/logout
POST   /auth/verify-email   → 邮箱激活（token 查 email_verifications）
POST   /auth/forgot-password
POST   /auth/reset-password
```

**用户**
```
GET    /users/me
PATCH  /users/me
PATCH  /users/me/password
DELETE /users/me
GET    /users/me/sessions   → 列出有效 Refresh Token（脱敏，仅展示设备/IP/时间）
DELETE /users/me/sessions   → 吊销所有 Refresh Token（全端踢出）
```

**订阅**
```
GET    /subscriptions/plans
GET    /subscriptions/current
POST   /subscriptions/subscribe      → 返回 checkout_url
POST   /subscriptions/cancel
```

**积分**
```
GET    /credits/balance
POST   /credits/topup
GET    /credits/ledger
```

**团队**
```
POST   /teams
GET    /teams/:id
PATCH  /teams/:id
DELETE /teams/:id
GET    /teams/:id/members
POST   /teams/:id/members
PATCH  /teams/:id/members/:userId
DELETE /teams/:id/members/:userId
GET    /teams/:id/credits
POST   /teams/:id/workspaces
GET    /teams/:id/workspaces
PATCH  /workspaces/:id
DELETE /workspaces/:id
```

**文件上传**
```
POST   /uploads/presign
```
请求：`{ "filename": "frame.jpg", "content_type": "image/jpeg", "purpose": "video_frame" }`
响应：`{ "upload_url": "<pre-signed PUT URL>", "asset_key": "uploads/tmp/UUID.jpg", "expires_in": 300 }`

- 客户端用 PUT 直传对象存储，服务端不转发文件流
- `asset_key` 在后续 `POST /generate/video` 的 `params.first_frame` / `params.last_frame` 中引用
- **提交时永久化：** `POST /generate/video` 收到请求后，在写入 DB 事务之前，API 先将 `params` 中引用的 `uploads/tmp/` 路径 copy 到 `assets/permanent/UUID.ext`，用新路径替换 params 再落库。Worker 拿到的 params 已是永久地址，不依赖 TTL
- 临时文件 24h 后由对象存储生命周期策略自动清理（24h 内未被提交的临时文件）；已被提交的文件已 copy 到 permanent 路径，TTL 不影响

**生成**
```
POST   /generate/image
POST   /generate/image/poster
POST   /generate/video
POST   /generate/tts
POST   /generate/tts/clone
POST   /generate/lipsync
```

生成请求通用结构：
```json
{
  "idempotency_key": "uuid-v4",
  "quantity": 1,
  "provider": "kling",
  "model": "kling-v1.6-pro",
  "workspace_id": "可选",
  "prompt": "...",
  "params": {}
}
```

workspace_id 存在时：
- 强制校验用户在该 workspace 的权限 >= editor
- 强制从团队积分账户扣费

**任务与资产**
```
GET    /batches
GET    /batches/:id
GET    /batches/:id/tasks
PATCH  /batches/:id/hide
DELETE /batches/:id
POST   /batches/:id/retry-failed
GET    /assets
GET    /assets/:id              响应含 generation 字段（prompt + params）
DELETE /assets/:id
POST   /assets/:id/download     → 生成带签名的临时下载 URL（有效期 10min），同时记录下载次数；不直接返回文件流
```

`retry-failed` 语义：
- 仅对 `status IN ('failed','partial_complete')` 的 batch 有效
- 服务端查出所有 `status='failed'` 的子任务，生成新 task_batch（`parent_batch_id` 指向原批次，idempotency_key 由服务端生成 UUID，避免客户端派生带来的长度溢出和状态丢失问题）
- 原批次保留不变，前端通过 `parent_batch_id` 关联展示重试历史链路
- 响应返回新 `batch_id`，客户端订阅新 SSE

**SSE**
```
GET    /sse/batches/:id
```

SSE 推送格式：
```json
{
  "batch_id": "xxx",
  "status": "processing",
  "progress": "1/2",
  "tasks": [
    { "id": "t1", "version": 1, "status": "completed", "asset_url": "..." },
    { "id": "t2", "version": 2, "status": "processing" }
  ]
}
```

**SSE 断线重连行为：**
- 客户端携带 `Last-Event-ID` 重连时，服务端**不存储历史事件**，直接推送 batch 当前全量快照（等同于一次 `GET /batches/:id` 的结果）
- `Last-Event-ID` 由客户端用于去重（防止重连瞬间重复处理同一事件），服务端无需处理
- batch 已完成时建立连接，服务端立即推送终态快照后关闭连接（不保持长连接）
- 指数退避：1s → 2s → 4s → … → 最长 30s

**Webhook**
```
POST   /webhooks/:provider
POST   /webhooks/payment/:provider
```

**服务商**
```
GET    /providers
GET    /providers/:id/models
```

### 错误码

```
AUTH_REQUIRED            未登录
INSUFFICIENT_CREDITS     积分不足
CONCURRENCY_LIMIT        并发任务数已达上限
BATCH_SIZE_LIMIT         单次生成数量超出套餐限制
PROMPT_REJECTED          Prompt 命中敏感词
IDEMPOTENT_DUPLICATE     重复提交，返回原 batch_id（任何状态下同一 key 均触发；failed/partial_complete 状态请使用 POST /batches/:id/retry-failed 或前端生成新 UUID，不允许复用已消耗的 key，避免审计混淆）
PROVIDER_UNAVAILABLE     服务商暂时不可用
TASK_NOT_FOUND           任务不存在
FEATURE_NOT_IN_PLAN      当前套餐不支持此功能
```

---

## 五、Worker 核心处理逻辑

### 适配器接口

```typescript
interface GenerationAdapter {
  submit(params: AdapterSubmitParams): Promise<AdapterSubmitResult>
  queryStatus(externalTaskId: string): Promise<AdapterStatusResult>
  verifyWebhook(payload: unknown, signature: string): boolean
  parseWebhook(payload: unknown): AdapterWebhookResult
}
```

### 任务流水线

**提交流水线（submit.pipeline）：**
1. 防重复执行检查：
   - `status === 'completed'` → 直接 return（已完成）
   - `status === 'processing' AND external_task_id IS NOT NULL` → 跳过 API 调用，直接进入轮询兜底（BullMQ stalled job 重跑时走此分支，防止二次提交第三方 API）
2. Lua Script 原子并发计数器校验 + 递增
   - 返回 -1（超限）→ BullMQ job.moveToDelayed(30s) 后重试，最多等待 5 分钟；超时仍无法获取则走 fail.pipeline + 退回积分
3. 更新 task status → processing，写入 processing_started_at
4. 调用适配器 submit，注册 Webhook 回调（URL 含 taskId）
5. COALESCE 写入 externalTaskId（防 Webhook 已先到）
6. 投入轮询兜底队列（delay 30s）

**完成流水线（complete.pipeline）：**
1. 防重入检查（status === 'completed' 则 return）
2. 原子事务：
   - INSERT assets（original_url、transfer_status='pending'）← **必须在此创建行，transfer.worker 只做 UPDATE**
   - 确认扣费：`frozen_credits -= estimated_cost`；`total_spent += actual_cost`；
     若 `actual_cost < estimated_cost`：`balance += (estimated_cost - actual_cost)`（退还多冻结部分）
   - credits_cost 写回 tasks；credits_ledger 写 `type='confirm', amount=-actual_cost`
   - 更新 task status → completed；更新 batch `completed_count`、status（completed / partial_complete）
3. 并发计数器 -1（releaseConcurrency）
4. 投入 transfer-queue 异步转存（传入 task_id，worker 通过 task_id 查 assets 行）
5. 取消轮询兜底任务（通过 queue_job_id 调用 job.remove()）
6. 推送 SSE

**失败流水线（fail.pipeline）：**
1. 原子事务：
   - `frozen_credits -= estimated_cost`；`balance += estimated_cost`（归还冻结积分）
   - credits_ledger 写 `type='refund', amount=+estimated_cost`
   - 更新 task status → failed，`error_message` 写入；更新 batch `failed_count`、status（failed / partial_complete）
2. 并发计数器 -1
3. 推送 SSE

**文件转存（transfer.worker）：**
1. 下载第三方临时 URL
2. storageKey = `assets/YYYY/MM/DD/${taskId}.${ext}`
3. 上传对象存储
4. 写入 assets 表（storage_url + transfer_status = completed）
5. 失败时：仅标记 transfer_status = failed，**不影响任务状态**
6. 前端降级：`displayUrl = asset.storageUrl ?? asset.originalUrl`

### Webhook 竞态处理

Webhook URL 携带 `taskId`，Handler 按 taskId 查询，不依赖 externalTaskId：
- task 找到但 externalTaskId 为空 → 补写后继续处理
- task.status 为 pending 或 processing 均可触发完成流水线

**Webhook 调用路径：** API Webhook Handler 验证签名后，将 `{ taskId, result }` 投入 BullMQ `completion-queue`，由 Worker 消费并执行 complete/fail pipeline。API 层不直接调用 pipeline，保持单向依赖（API → Queue → Worker）。`pipelines/` 代码仅在 Worker 服务中存在。

### Redis 并发控制（Lua Script）

**递增（acquireConcurrency）：**
```lua
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local incr  = tonumber(ARGV[2])
local cur   = tonumber(redis.call('GET', key) or 0)
if cur + incr > limit then
  return -1
end
local new = redis.call('INCRBY', key, incr)
redis.call('EXPIRE', key, 3600)
return new
```

**递减（releaseConcurrency）：**
```lua
-- 防止 key TTL 过期后递减导致计数器变负
local key  = KEYS[1]
local decr = tonumber(ARGV[1])
local cur  = tonumber(redis.call('GET', key) or 0)
if cur <= 0 then
  return 0
end
local new = redis.call('DECRBY', key, decr)
if new < 0 then
  redis.call('SET', key, 0)
  return 0
end
redis.call('EXPIRE', key, 3600)
return new
```

> **边界说明：** timeout-guardian 在 key TTL（1h）已过期后执行 releaseConcurrency 时，key 不存在（GET 返回 0），直接返回 0，不产生负数计数器。

### 定时任务

| Job | 频率 | 功能 |
|-----|------|------|
| timeout-guardian | 每5分钟 | 重置超时任务，retry < 3 重新入队；retry = 3 → failed + 全额退回 + **releaseConcurrency**（Redis -1） |
| retry-transfers | 每小时 | 重试 transfer_status = failed 的资产 |
| subscription-expire | 每天 | 过期用户/团队订阅降级 plan_tier（同时扫描 user_subscriptions 和 team_subscriptions） |
| credits-expire | 每天 | 清理订阅赠送积分（credits_ledger.type = 'subscription' 中已过期月份的积分，计入 type = 'expire' 负向流水） |
| bullmq-cleanup | 每天凌晨3点 | 清理 BullMQ 中 completed（保留7天）和 failed（保留30天）的历史 Job，防止 Redis 内存膨胀 |
| webhook-logs-cleanup | 每天凌晨4点 | 删除 90 天前的 webhook_logs 记录，防止无限膨胀 |

> **`updated_at` 维护：** 所有含 `updated_at` 的表均需在 migration 中创建 `BEFORE UPDATE` 触发器自动刷新（`SET NEW.updated_at = NOW()`），不依赖应用层手动更新。触发器统一在 `packages/db/triggers.sql` 中定义。

### 超时阈值

| 模块 | 超时时间 |
|------|---------|
| image | 5 分钟 |
| video | 20 分钟 |
| tts | 3 分钟 |

---

## 六、前端页面设计

### 页面清单

| 页面 | 路径 | 说明 |
|------|------|------|
| 工作台 | / | 快捷入口 + 最近创作 + 积分概览 |
| 图片生成 | /image | 左参数面板 / 右结果网格，SSE 实时更新 |
| 视频生成 | /video | 含首尾帧上传 |
| 语音配音 | /tts | 音色选择 + 声音克隆入口 |
| 资产库 | /assets | 瀑布流，侧抽屉含 prompt 复制 |
| 任务历史 | /history | batch 列表，软删除/隐藏 |
| 团队管理 | /teams | 成员管理 + 团队积分 |
| 积分订阅 | /credits | 余额 + 套餐 + 流水 |
| 设置 | /settings | 个人信息 + 密码 |

### 关键 UX 规范

| 场景 | 处理 |
|------|------|
| 任务进行中 | SSE 实时渲染，无需刷新 |
| 积分不足 | 按钮 disabled + tooltip |
| 并发超限 | Toast 提示 |
| Prompt 被过滤 | 行内错误，高亮触发词 |
| SSE 断连 | 静默重连，补拉状态 |
| 批次部分失败 | 成功展示 + 失败显示退回积分 |
| 移动端 | 参数面板折叠为底部抽屉 |

---

## 七、项目目录结构

```
aigc-platform/
├── apps/
│   ├── web/                    # Next.js 14 前端
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (auth)/     # login, register
│   │       │   └── (dashboard)/# 所有登录后页面
│   │       ├── components/
│   │       │   ├── generation/ # PromptInput, BatchResultGrid 等
│   │       │   ├── assets/
│   │       │   └── layout/
│   │       ├── hooks/          # useBatchSSE, useCredits, useGenerate
│   │       ├── stores/         # Zustand（auth, workspace）
│   │       └── lib/            # api-client, idempotency
│   │
│   ├── api/                    # Fastify API 网关
│   │   └── src/
│   │       ├── plugins/        # auth, rate-limit, error-handler
│   │       ├── routes/         # 路由层（零业务逻辑）
│   │       ├── services/       # 业务逻辑层
│   │       ├── middlewares/    # workspace-guard, prompt-filter, idempotency
│   │       └── lib/            # redis, queue, storage
│   │
│   └── worker/                 # BullMQ Worker 服务
│       └── src/
│           ├── workers/        # image, video, tts, transfer
│           ├── adapters/       # base, factory, kling, runway...
│           ├── pipelines/      # submit, complete, fail
│           ├── jobs/           # timeout-guardian, retry-transfers
│           └── lib/            # redis, concurrency(Lua), storage, metadata
│
├── packages/
│   ├── types/                  # 共享 TS 类型（API/Queue/Adapter）
│   ├── db/                     # Schema + migrations + queries
│   └── utils/                  # 积分计算、日期工具
│
└── docs/
    └── plans/
        └── 2026-02-28-aigc-platform-design.md
```

---

## 八、开发阶段规划

> **过渡约定（Phase 0–3）：** 使用单个硬编码测试用户 + 固定 API Key 认证，积分系统 mock（无限额度）。队列、Worker、Webhook、SSE 均为生产级实现，Phase 4 接入真实多用户体系时无需返工核心逻辑，只需补充权限校验与计费。

### Phase 0 — 基础设施（1-2 周）

Monorepo 初始化、数据库全量 migration、Redis/BullMQ/对象存储配置、三个服务骨架启动。

- `docker-compose.yml`：本地依赖（PostgreSQL、Redis、MinIO）一键启动
- `.env.example`：所有环境变量模板（含 DB、Redis、MinIO、JWT 密钥占位符）
- `packages/db`：Kysely migration 文件按序号命名（`001_init.ts`...），执行 `pnpm db:migrate` 完成全量建表
- Seed 数据（`pnpm db:seed`）包含：
  - 1 个测试用户 + 对应 credit_account
  - 1 条 `subscription_plans`（free tier）+ 对应 `user_subscriptions`（active）
  - 至少 1 条 `providers`（如 kling）+ 对应 `provider_models`（Phase 1 需要）
  - 至少 1 条 `prompt_filter_rules`（关键词拦截示例，验证过滤链路）
- API Key 中间件：请求头 `X-API-Key: <固定测试 Key>`，Key 值存 `.env`，不通过数据库校验

**验收：** `docker compose up -d && pnpm dev` 三服务无报错，所有表创建成功，测试用 API Key 可通过鉴权中间件，`GET /api/v1/healthz` 返回 `{ "status": "ok" }`。

### Phase 1 — 图片生成（可测试版）（3-4 周）

**Week 1：** 图片生成接口 + Worker（接入可灵，完整 submit/complete/fail pipeline）
**Week 2：** Webhook 回调 + SSE 实时推送 + 兜底轮询
**Week 3：** 资产库（列表、详情、prompt 复制）+ 文件转存 OSS
**Week 4：** 超时守护 Job、补转存 Job、第二个图片服务商接入、基础 E2E 测试

**验收：** 测试用户可完整走通生成→Webhook 回调→SSE 推送→资产下载，Webhook 竞态和转存降级经验证。

### Phase 2 — 视频生成基础（2-3 周）

视频生成接口（首尾帧上传）、视频 Worker 适配器、超时阈值调整（20 分钟）、视频资产转存。

**验收：** 测试用户可提交视频任务并通过 SSE 收到完成通知，资产可下载。

### Phase 3 — Agent（3-4 周）

**Week 1-2：** 海报 Agent（模板解析 → 图片生成编排 → 合成输出）
**Week 3-4：** 分镜 Agent（长文本 → 分镜脚本 → 批量图片生成）

Agent 任务使用 `module = 'agent'`，编排层创建多个子 task_batch，积分在此阶段仍为 mock。

**验收：** 输入长文本可产出完整分镜图集，海报模板可生成成品图。

### Phase 4 — 商业化上线（4-5 周）

**Week 1：** 真实用户注册/登录（JWT + Refresh Token）、密码找回
**Week 2：** 积分系统（余额、冻结、流水）、订阅套餐、支付接入（支付宝/微信/Stripe）
**Week 3：** 团队管理、工作空间、团队积分池
**Week 4：** 并发限制、套餐功能门控（FEATURE_NOT_IN_PLAN）、Rate Limiting 按套餐分级
**Week 5：** 生产部署、日志告警、E2E 回归测试

Rate limiting 配置：
- 全局：100 req/min per IP
- /auth/*：10 req/min per IP
- /generate/*：按套餐，免费版 20 req/min，专业版 60 req/min

**验收：** 新用户可完整走通注册→充值→生成→下载，积分扣费与退回经验证，团队工作空间可正常协作。

### Phase 5 — TTS & 语音（2-3 周）

TTS 接口、声音克隆（voice_profiles 入库）、对口型（lipsync）。

**验收：** 用户可提交 TTS 任务并下载音频，克隆音色可在后续 TTS 任务中复用。

### 技术选型汇总

| 层次 | 技术 |
|------|------|
| 前端框架 | Next.js 14 App Router |
| UI 组件 | shadcn/ui + TailwindCSS |
| 前端状态 | Zustand + TanStack Query |
| API 框架 | Fastify |
| ORM | Kysely |
| 任务队列 | BullMQ + Redis |
| 数据库 | PostgreSQL 15+ |
| 对象存储 | S3 兼容接口（本地 MinIO，生产 OSS/S3） |
| Monorepo | pnpm workspaces + Turborepo |
| 日志 | Pino |

---

## 九、关键设计决策汇总

| 决策 | 方案 | 理由 |
|------|------|------|
| 任务执行 | 全异步 Queue | 生成耗时长，不阻塞 API |
| 并发控制 | Redis Lua Script | 原子检查+递增，消除竞态 |
| 并发计数泄漏防护 | timeout-guardian 执行 releaseConcurrency | 任务超时或崩溃时计数器能被兜底回收 |
| releaseConcurrency 负数防护 | Lua Script 中 cur ≤ 0 时直接 return 0 | TTL 过期后 key 不存在，DECRBY 会产生负数计数器，需显式 guard |
| 幂等性 | idempotency_key UNIQUE（任何状态均不可复用） | 防重复提交和重复扣费；审计清晰；失败重试走 retry-failed 接口（生成新 key）|
| 预扣费 | frozen_credits 字段 | 防超额消费 |
| 视频帧永久化 | POST /generate/video 提交时 API 将 uploads/tmp/ copy 到 assets/permanent/ | 防止 24h TTL 导致 Worker 执行时 404；Worker 无感知临时文件生命周期 |
| 文件存储 | 转存到自有 OSS | 第三方 URL 会过期 |
| 存储路径 | assets/YYYY/MM/DD/ | 防单目录过多，支持冷热迁移 |
| 转存失败 | 不影响任务状态 | 图片已生成，降级用 original_url |
| Webhook 竞态 | URL 携带 taskId | 不依赖 externalTaskId 查询 |
| 积分账户 | 支持 user 或 team | CHECK 约束保证二选一 |
| 分页 | cursor-based | 性能稳定，无跳页问题 |
| plan_tier | users / teams 表冗余 | 避免每次请求 JOIN 订阅表 |
| SSE 多实例 | Redis Pub/Sub 扇出 | Worker 发布到 `sse:batch:{batchId}` 频道，所有 API 实例订阅后转发给已连接的客户端，避免事件只路由到单实例 |
| SSE 断线重连 | 重连后推全量快照，不存历史事件 | 无需额外存储，实现简单；batch 终态时立即关闭连接 |
| Refresh Token | 数据库持久化（refresh_tokens 表）+ rotation | 使用时换发新 token、旧 token 标记 revoked_at；支持单点/全端 revoke |
| 服务商配置 | providers / provider_models 表 | 支持运营后台动态管理，无需发布代码 |
| Prompt 过滤规则 | prompt_filter_rules 表 + 内存缓存 | 支持热更新，启动加载后每5分钟拉取增量 |
| credits_ledger FK | 有意不加 task_id / batch_id 外键 | 账单记录独立于任务生命周期，任务软删除后账单仍可审计 |
| Agent 子批次 | parent_batch_id 字段关联 | 支持聚合进度、统一退款、SSE 整体订阅 |
| BullMQ Job 取消 | tasks.queue_job_id 持久化 | timeout-guardian 可主动调用 job.remove()，防止超时 Job 重复触发 |
| 视频帧上传 | 预签名 URL 直传 OSS | 服务端不转发文件流，节省带宽；24h 临时文件自动清理 |
| 视频模型计费 | credit_cost（基础）+ params_pricing（动态） | 视频时长/分辨率影响费用，单一字段无法覆盖 |
| 下载接口 | POST /assets/:id/download 返回签名 URL | 不直接暴露 OSS 地址；签名10min有效；记录下载次数 |
| 邮箱验证 | email_verifications 表（token SHA-256 存储） | 注册激活 + 密码重置复用同一张表，type 字段区分 |
| 积分过期 | credits-expire 每日 Job | 订阅赠送积分按月清零，写入负向流水保持账单可审计 |
| BullMQ 清理 | bullmq-cleanup 每日 Job | completed Job 保留7天，failed Job 保留30天，防 Redis 内存膨胀 |
| 本地开发环境 | docker-compose.yml + .env.example | 一键启动 PostgreSQL/Redis/MinIO，降低新成员上手成本 |
