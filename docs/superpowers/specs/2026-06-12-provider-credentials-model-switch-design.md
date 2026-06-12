# 供应商凭据落库 + 模型切换供应商（L3-A）设计文档

- 日期：2026-06-12
- 作者：liushi + Claude
- 状态：待评审

## 1. 背景与目标

当前所有 AI 供应商的 `base_url` 与 `api_key` 通过环境变量管理，散落在 api/worker 两侧 30+ 个读取点，读取方式不统一（`?? ''`、`|| ''`、`!`、多级兜底），存在空 key 静默失败、视频链路 URL 硬编码、换 key 需重启容器等问题。同时 `provider_models.code` 通过 `(provider_id, code)` 唯一约束**绑死了模型与供应商**，无法表达"同一模型由多家供应商提供"。

本次目标：

1. **凭据落库**：每个供应商的 `base_url` + 凭据加密存入数据库，支持运营在后台管理、免重启切换。
2. **模型与供应商解耦**：引入"逻辑模型"层，一个逻辑模型可绑定多个供应商实现，运营可为模型指定"当前生效供应商"并手动切换。
3. **切换立即生效**：运营切换后，下一次请求即使用新供应商。
4. **移除模型图标重依赖**：为模型增加 `avatar`（自托管图片），逐步移除 `@lobehub/icons`。

## 2. 范围

- **覆盖供应商**：火山（ARK）、火山（Visual 数字人）、豆包、Nano Banana、Qwen、Minimax、Mureka，共 7 路。
- **覆盖应用**：`apps/api`、`apps/worker`、`apps/web`、`packages/db`、`packages/types`。
- **不包含**（YAGNI，明确排除）：
  - 自动故障转移 / 熔断 / 重试（本次仅运营手动切换，静态生效）。
  - 同供应商多账号轮询 / 负载均衡。
  - 按团队 / 套餐路由不同供应商（`team_model_configs` 表保留，本次不扩展凭据字段）。
  - 凭据管理后台 UI（本次仅提供 admin API；UI 后续单独迭代）。

## 3. 关键决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 多供应商场景 | 运营手动切换（静态、全局） |
| D2 | 数据模型 | 方案 A：独立"逻辑模型"表 |
| D3 | 覆盖范围 | 一次性覆盖 7 路 AI 供应商 |
| D4 | 切换生效 | 立即生效（Redis pub/sub 广播失效） |
| D5 | 火山双鉴权 | 拆分为 `volcengine-ark` 与 `volcengine-visual` 两个 provider |
| D6 | 加密主密钥 | 独立 `MASTER_KEY`，不再复用 `JWT_SECRET` |
| D7 | 图标方案 | `model.avatar` → `provider.logo_url` → 首字母色块；`@lobehub/icons` 渐进移除 |

## 4. 数据模型

### 4.1 新建 `models` 表（逻辑模型，面向用户/前端）

```sql
CREATE TABLE models (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        varchar(100) UNIQUE NOT NULL,  -- 'seedance-2.0'，面向用户
  name                        varchar(255) NOT NULL,          -- 展示名
  module                      varchar(20)  NOT NULL,          -- image|video|tts|lipsync|agent
  description                 text,
  avatar                      varchar(500),                   -- 模型图标 TOS URL
  sort_order                  integer NOT NULL DEFAULT 0,
  is_active                   boolean  NOT NULL DEFAULT true,
  active_provider_model_id    uuid,                           -- 当前生效供应商实现（后置外键）
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_models_module CHECK (module IN ('image','video','tts','lipsync','agent'))
);
-- active_provider_model_id → provider_models.id，循环外键，迁移末尾用 DEFERRABLE 建立
```

### 4.2 改造 `provider_models`（某供应商对该模型的实现）

- 新增 `model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE`
- 新增 `vendor_model_id varchar(255)`：供应商真实模型 ID（原 `VOLCENGINE_MODEL_ID['seedance-2.0']` 的值 `doubao-seedance-2-0-260128` 落此）
- 原 `(provider_id, code)` 唯一约束 → 替换为 `(model_id, provider_id)` 唯一约束（一个模型在一个供应商下只有一条实现）
- `code` 列保留但语义降级为"供应商侧标识"，可空；面向用户的标识完全由 `models.code` 接管
- `params_pricing`、`params_schema`、`category_references` 等业务字段保留不动

### 4.3 改造 `providers`（供应商 + 凭据）

- 新增 `base_url varchar(500)`：该供应商 API 基地址
- 新增 `credentials_encrypted text`：AES-256-GCM 密文（base64url），明文为 JSON
- 新增 `logo_url varchar(500)`：供应商 logo，作模型 avatar 缺失兜底
- `config jsonb` 保留作杂项配置
- **D5 拆分**：现有单条 `code='volcengine'` 拆为：
  - `volcengine-ark`：图片 / 视频 / 对话，凭据 `{ api_key }`，base_url `https://ark.cn-beijing.volces.com/api/v3`
  - `volcengine-visual`：数字人 OmniHuman，凭据 `{ access_key, secret_key }`（AK/SK 签名），base_url 为 Visual API 地址

### 4.4 凭据明文结构（加密前 JSON）

```jsonc
// ARK 类（volcengine-ark / doubao / nano-banana / qwen / minimax / mureka）
{ "api_key": "xxxx" }
// Visual 类（volcengine-visual，AK/SK 签名）
{ "access_key": "xxxx", "secret_key": "xxxx" }
```

> TOS 与支付（`LIFE_SERVICE_*`）凭据**本次不纳入** providers（它们不是 AI 供应商，且形态特殊），仍保留环境变量。

### 4.5 ER 关系

```
models 1 ──────< provider_models >──────── 1 providers
  active_provider_model_id ──→ provider_models.id   (当前生效)
  model_id ←───── provider_models.model_id           (归属)
  provider_id ─── provider_models.provider_id
```

`models.active_provider_model_id` 必须指向该 model 名下的一条 `provider_models`（应用层保证一致性；DB 层不加复杂约束）。

## 5. 架构分层

### 5.1 加密层 `packages/db/src/crypto.ts`

- 算法：AES-256-GCM（复用现有 `encryptProxyUrl` 模式，但独立 master key）
- 主密钥：`process.env.MASTER_KEY`（任意长度 passphrase，启动期校验必须存在，否则进程退出）；内部以 `sha256(MASTER_KEY + '-credentials')` 派生 32 字节 key（与现有 `encryptProxyUrl` 派生模式一致，降低配置门槛）
- 导出 `encryptCredentials(plain: object): string`、`decryptCredentials(b64: string): object`
- 密文格式：`base64url(iv(12) + tag(16) + ciphertext)`

### 5.2 解析层 `packages/db/src/provider-resolver.ts`

核心入口，api/worker 共享：

```ts
resolveModel(modelCode: string): Promise<ResolvedModel>

interface ResolvedModel {
  modelCode: string                 // 'seedance-2.0'
  vendorModelId: string             // 'doubao-seedance-2-0-260128'
  providerCode: string              // 'volcengine-ark'
  baseUrl: string
  credentials: Record<string, string>  // 已解密
}
```

解析步骤：`models(code)` → `active_provider_model_id` → `provider_models(vendor_model_id, provider_id)` → `providers(base_url, credentials_encrypted)` → 解密。

### 5.3 缓存与立即生效（D4）

- **进程内缓存**：`Map<modelCode, ResolvedModel>`，命中则直接返回（避免每次 AI 调用查 3 张表 + 解密）
- **失效广播**：admin 写入 / 切换后，`redis.publish('provider:invalidated', JSON.stringify({ scope, code }))`；各 api/worker 节点订阅该频道，收到后 `cache.delete(code)`（scope 为 `model` 或 `provider`，provider 维度失效时清所有相关 model）
- **兜底 TTL**：缓存条目设 5 分钟 TTL 作为广播丢失的保险（正常路径靠广播即时失效，TTL 仅兜底）

## 6. 数据流（以 seedance-2.0 为例）

```
前端选 models.code = 'seedance-2.0'
   │ POST /videos/generate { model: 'seedance-2.0', ... }
   ▼
api: resolveModel('seedance-2.0')        ← 命中缓存或查 DB+解密
   → vendorModelId='doubao-seedance-2-0-260128'
   → providerCode='volcengine-ark', baseUrl, credentials
   │ 冻结积分、写 batch/task
   ▼
入队 video-queue { providerCode, vendorModelId, modelCode, prompt, params, ... }
   ← 注意：不传明文 credentials
   ▼
worker: 消费任务
   → resolveModel(modelCode) 再次解析（worker 自取 credentials，不入队列）
   → buildVolcengineTaskBody 用 vendorModelId（替代硬编码 VOLCENGINE_MODEL_ID）
   → POST {baseUrl}/contents/generations/tasks，Authorization: Bearer {credentials.api_key}
```

> 凭据**不入 BullMQ 队列**，避免明文过 Redis；worker 自行连 DB 读 + 解密，靠缓存层降低开销。

## 7. 图标方案（D7）

### 7.1 渲染优先级（前端 `model-brand-icon.tsx` 改造）

1. `model.avatar`（TOS URL）→ 直接 `<img>`
2. `provider.logo_url`（TOS URL）→ `<img>`（同供应商模型共享 logo）
3. 首字母色块（纯 CSS，零依赖兜底）

### 7.2 `@lobehub/icons` 渐进移除

- **过渡期**：保留 `@lobehub/icons` 作为"avatar + logo 均空"时的最后 fallback，保证迁移期所有模型都有可见图标。
- **移除时机**：所有在用模型均补齐 `avatar` 后，单独 PR 删除 `@lobehub/icons` 依赖与 `model-images.ts` 映射表。
- 此方案符合既有"映射表 + 兜底"图标原则（在兜底链前端新增一档自托管图片，非二极管式优先级切换）。

### 7.3 avatar 资源管理

- admin API 支持上传图标到 TOS，回填 `models.avatar` / `providers.logo_url`
- 迁移期可批量导入（脚本读取现有映射，运营提供图标文件）

## 8. 错误处理

| 场景 | 处理 |
|------|------|
| `MASTER_KEY` 缺失 / 非法 | 进程启动即退出（启动失败 > 运行时失败） |
| 模型无 `active_provider_model_id` | API 返回 `503 MODEL_NOT_CONFIGURED`，提示运营配置 |
| 凭据缺失 / 解密失败 | 该模型不可用，API 返回明确错误并记 `provider_api_logs`，不静默 401 |
| 失效广播丢失 | 缓存 5min TTL 兜底 |
| 切换瞬间在途任务 | 已入队任务按入队时 `modelCode` 解析，可能命中旧供应商——属可接受行为（运营手动切换低频，且任务已扣冻结积分，最终以结果轮询为准） |
| 循环外键 | 迁移末尾以 `DEFERRABLE INITIALLY DEFERRED` 建立 `active_provider_model_id` 外键 |

## 9. 测试策略

- **单元测试**：
  - `crypto.ts`：加密 → 解密往返；错误密文 / 错误 master key 抛错
  - `provider-resolver.ts`：命中缓存、缓存失效后重查、`active_provider_model_id` 缺失分支
- **迁移测试**（参照 `packages/db/src/*.test.ts` 模式）：
  - 现有 `provider_models` 数据正确生成 `models`（按 code 去重）
  - `model_id` / `vendor_model_id` 回填正确
  - 火山拆分后 `provider_models` 挂到正确 provider
- **集成测试**：
  - 切换 `active_provider_model_id` → 发广播 → 缓存失效 → 下次 `resolveModel` 返回新供应商
  - seedance-2.0 端到端：生成请求实际打到解析后的供应商

## 10. 迁移步骤（迁移脚本 + 数据回填）

1. 新建 `models` 表（无 `active_provider_model_id` 外键先建为普通列）
2. `provider_models` 加 `model_id`、`vendor_model_id` 列
3. **数据回填**：遍历现有 `provider_models`，按 `code` 去重生成 `models` 记录（首个出现的 code 作为该 model 来源），回填每条 `provider_models.model_id`；`vendor_model_id` 从 worker/api 两处硬编码的 `VOLCENGINE_MODEL_ID` 等映射表灌入
4. 每个 `model` 设 `active_provider_model_id` = 其当前唯一/首选 `provider_model`
5. `provider_models` 唯一约束改为 `(model_id, provider_id)`
6. `providers` 加 `base_url`、`credentials_encrypted`、`logo_url`
7. **火山拆分**：插入 `volcengine-ark` / `volcengine-visual`，原 `provider_models` 中火山记录的 `provider_id` 迁移到对应新 provider，删除旧 `volcengine` 记录
8. **凭据 bootstrap**：迁移脚本从环境变量读取现有 key（`VOLCENGINE_API_KEY` 等），加密写入对应 `providers.credentials_encrypted`（一次性，生产首次部署执行）
9. 建立 `active_provider_model_id` 外键（DEFERRABLE）
10. 更新 `packages/types` 中 DB 类型与共享类型

## 11. 改造文件清单

**packages**
- `packages/db/migrations/062_provider_credentials_model_switch.ts`（新迁移；编号以执行时仓库最新序号为准，当前最大为 061）
- `packages/db/src/crypto.ts`（新增）、`packages/db/src/provider-resolver.ts`（新增）
- `packages/db/src/schema.ts`（models/provider_models/providers 类型）
- `packages/types/src/*`（ResolvedModel 等共享类型）

**apps/api**
- `routes/admin/*`：新增凭据写入 + 切换供应商 + 图标上传接口
- `lib/queue.ts` 或入队点：投递时带 `modelCode` / `vendorModelId` / `providerCode`
- 所有 env 读取点改为 `resolveModel`：`routes/ai-assistant`、`routes/canvas-agent/*`、`routes/picture-book`、`routes/video-studio/_shared`、`services/minimax-tts.ts` 等
- 启动钩子：校验 `MASTER_KEY`、订阅失效广播

**apps/worker**
- `workers/video-submit.ts`、`workers/video-submit-payload.ts`、`pollers/video-poller.ts`：改用 `resolveModel`，移除硬编码 `VOLCENGINE_API_URL` / `VOLCENGINE_MODEL_ID`
- `adapters/volcengine-image.ts`、`adapters/nano-banana.ts`、`adapters/factory.ts`：凭据从构造注入改为按解析结果传入
- `lib/mureka.ts`、`workers/storyboard.ts`、`workers/music.ts` 等：改用 `resolveModel`
- 启动钩子：校验 `MASTER_KEY`、订阅失效广播

**apps/web**
- `lib/model-images.ts`、`components/generation/shared/model-brand-icon.tsx`：avatar → logo → 首字母三级渲染
- 模型列表接口消费 `models.avatar`
- （后续单独 PR）移除 `@lobehub/icons` 依赖

## 12. 非目标（YAGNI 重申）

- 凭据管理后台 UI
- 自动故障转移 / 多账号轮询 / 按团队路由
- TOS、支付凭据落库
- `MASTER_KEY` 自动轮换
