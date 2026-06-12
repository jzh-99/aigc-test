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
4. **admin 管理后台**：admin 角色可在可视化界面完成切换供应商、编辑凭据、上传图标、逻辑模型 CRUD。
5. **移除模型图标重依赖**：为模型增加 `avatar`（自托管图片），逐步移除 `@lobehub/icons`。

## 2. 范围

- **覆盖供应商**：火山（ARK）、火山（Visual 数字人）、豆包、Nano Banana、Qwen、Minimax、Mureka，共 7 路。
- **覆盖应用**：`apps/api`、`apps/worker`、`apps/web`、`packages/db`、`packages/types`。
- **admin 管理界面**（本次纳入）：扩展现有 `/admin` 标签页，复用 `adminGuard` 权限体系。
- **不包含**（YAGNI，明确排除）：
  - 自动故障转移 / 熔断 / 重试（本次仅运营手动切换，静态生效）。
  - 同供应商多账号轮询 / 负载均衡。
  - 按团队 / 套餐路由不同供应商（`team_model_configs` 表保留，本次不扩展凭据字段）。
  - TOS、支付（`LIFE_SERVICE_*`）凭据落库（非 AI 供应商，形态特殊，仍走环境变量）。
  - `MASTER_KEY` 自动轮换。

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
| D8 | admin 界面 | 扩展现有 `/admin` 标签页 + 复用 `adminGuard`，不新建独立页/权限 |
| D9 | 定价分层 | 对用户价放 `models`（模型级一致，切换供应商不影响用户扣费）；不存供应商成本价 |
| D10 | 能力约束 | resolution、时长白名单等对用户一致的能力约束上移到 `models.capabilities` |
| D11 | 主备供应商 | `active_provider_model_id`=主（运行时唯一生效），其他候选=备用；手动切换、不自动接管（无故障转移） |

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
  params_pricing              jsonb NOT NULL DEFAULT '[]',    -- 对用户定价（从 provider_models 上移）
  category_references         jsonb NOT NULL DEFAULT '{}',    -- 对用户能力上限（参考素材数量等）
  capabilities                jsonb NOT NULL DEFAULT '{}',    -- 其它对用户一致的能力约束（resolution 档位、时长白名单等）
  sort_order                  integer NOT NULL DEFAULT 0,
  is_active                   boolean  NOT NULL DEFAULT true,
  active_provider_model_id    uuid,                           -- 主供应商（当前生效），后置外键；备用=该模型其他候选 provider_models，运行时不用
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_models_module CHECK (module IN ('image','video','tts','lipsync','agent'))
);
-- active_provider_model_id → provider_models.id，循环外键，迁移末尾以 DEFERRABLE 建立
```

### 4.2 改造 `provider_models`（某供应商对该模型的实现）

- 新增 `model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE`
- 新增 `vendor_model_id varchar(255)`：供应商真实模型 ID（原 `VOLCENGINE_MODEL_ID['seedance-2.0']` 的值 `doubao-seedance-2-0-260128` 落此）
- 原 `(provider_id, code)` 唯一约束 → 替换为 `(model_id, provider_id)` 唯一约束（一个模型在一个供应商下只有一条实现）
- `code` 列保留但语义降级为"供应商侧标识"，可空；面向用户的标识完全由 `models.code` 接管
- `params_pricing`（用户定价）、`category_references`（用户能力上限）**上移到 `models`**（对用户一致的契约，切换供应商不影响用户扣费 / 看到的能力）
- `params_schema`（各供应商支持的参数差异，如火山支持 `camera_fixed`、代理可能不支持）留在本表
- 现有 admin `GET /admin/models`（查 provider_models）保留；`PATCH /admin/models/:id` **收窄为只改 `params_schema` 等供应商级字段**，定价编辑改到 `PATCH /admin/catalog/models/:id`

### 4.3 改造 `providers`（供应商 + 凭据）

- 新增 `base_url varchar(500)`：该供应商 API 基地址
- 新增 `credentials_encrypted text`：AES-256-GCM 密文（base64url），明文为 JSON
- 新增 `logo_url varchar(500)`：供应商 logo，作模型 avatar 缺失兜底
- 新增 `credentials_updated_at timestamptz`：凭据最后更新时间（供 admin 展示，不暴露明文）
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
  paramsPricing: unknown            // 对用户定价（来自 models，与供应商无关）
  categoryReferences: unknown       // 对用户能力上限（来自 models）
  capabilities: unknown             // 其它能力约束（resolution、时长白名单等，来自 models）
}
```

解析步骤：`models(code)`（同时取 `params_pricing` / `category_references`，作为对用户扣费与能力校验的依据）→ `active_provider_model_id` → `provider_models(vendor_model_id, provider_id)` → `providers(base_url, credentials_encrypted)` → 解密。扣费始终用 `models.params_pricing`，与当前生效供应商无关（D9）。

### 5.3 缓存与立即生效（D4）

- **进程内缓存**：`Map<modelCode, ResolvedModel>`，命中则直接返回（避免每次 AI 调用查 3 张表 + 解密）
- **失效广播**：admin 写入 / 切换后，`redis.publish('provider:invalidated', JSON.stringify({ scope, code }))`；各 api/worker 节点订阅该频道，收到后 `cache.delete(code)`（scope 为 `model` 或 `provider`，provider 维度失效时清所有相关 model）
- **兜底 TTL**：缓存条目设 5 分钟 TTL 作为广播丢失的保险（正常路径靠广播即时失效，TTL 仅兜底）
- 导出 `invalidateCache(scope, code)` 供 admin 写入接口调用

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

- admin API 支持上传图标到 TOS，回填 `models.avatar` / `providers.logo_url`（见第 8 节）
- 迁移期可批量导入（脚本读取现有映射，运营提供图标文件）

## 8. Admin 管理界面（D8）

复用现有权限（`adminGuard` + 页面 `role !== 'admin'` 拦截）与标签页范式，扩展现有 `/admin` 页面。

### 8.1 Web 端（扩展 `app/(dashboard)/admin/page.tsx` 标签）

**「模型管理」标签改造**（现有 `ModelTable` 以 `models` 逻辑模型为主维度重构）：
- 列表行：模型 code / name / module / avatar / 当前生效供应商
- 模型行可编辑对用户定价（`params_pricing`）、能力上限（`category_references`）、其它能力约束（`capabilities`：resolution、时长等）—— 模型级，与供应商无关
- 行展开：该模型下所有 `provider_models` 实现（供应商 + vendor_model_id + 状态），单选切换 active_provider_model_id；展开行内编辑各实现的参数 schema（复用现有 `PATCH /admin/models/:id`，已收窄为只改供应商级字段）
- 逻辑模型 CRUD：新建（code/name/module/avatar）、停用（is_active）、绑定 / 解绑供应商实现
- avatar 上传入口

**「供应商管理」标签新增**（新组件 `components/admin/provider-table.tsx`，参照现有 `OtherCostConfigTable` 范式）：
- 列表行：provider code / name / base_url / logo / 凭据状态（已设置 + 最后更新时间，**不显示明文**）
- 编辑 base_url、上传 logo
- 凭据设置 / 轮换：表单提交明文 → 服务端加密入库 → 仅回显"已设置 / 更新时间"

### 8.2 API 端（新增 admin 路由，复用 `autohooks` 自动注册 + `adminGuard`）

> 命名约定：现有 `/admin/models` 管的是 `provider_models`（供应商实现层），保留不动；逻辑模型层用 `/admin/catalog/models` 区分。

**逻辑模型层**（`routes/admin/catalog-*`）：
- `GET /admin/catalog/models` — 查逻辑模型列表（含 active provider + 下挂实现）
- `POST /admin/catalog/models` — 新建逻辑模型
- `PATCH /admin/catalog/models/:id` — 改 name / avatar / is_active / sort_order / params_pricing / category_references / capabilities
- `POST /admin/catalog/models/:id/switch` — 切换 active_provider_model_id（**写入后调 `invalidateCache('model', code)`**）
- `POST /admin/catalog/models/:id/providers` — 绑定一个供应商实现（vendor_model_id）
- `DELETE /admin/catalog/models/:id/providers/:pmId` — 解绑
- `POST /admin/catalog/models/:id/avatar` — 上传 avatar 到 TOS

**供应商凭据层**（`routes/admin/providers-*`）：
- `GET /admin/providers` — 查供应商列表（凭据仅返回"是否已设置 + credentials_updated_at"，不返回密文 / 明文）
- `PATCH /admin/providers/:id` — 改 base_url / logo_url
- `PUT /admin/providers/:id/credentials` — 设置 / 轮换凭据（body 含明文，服务端 `encryptCredentials` 入库，更新 `credentials_updated_at`，**调 `invalidateCache('provider', code)`**）
- `POST /admin/providers/:id/logo` — 上传 logo 到 TOS

### 8.3 凭据安全要点

- `PUT /admin/providers/:id/credentials`：明文仅在请求体一次性传入，加密入库后立即从内存丢弃；**不写 `provider_api_logs`**（避免明文进日志）；响应不回显明文。
- `GET /admin/providers`：`credentials_encrypted` 字段不返回，仅返回派生的"已设置 + 更新时间"。
- 所有写入凭据 / 切换的接口，成功后必须发失效广播（D4）。

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| `MASTER_KEY` 缺失 | 进程启动即退出（启动失败 > 运行时失败） |
| 模型无 `active_provider_model_id` | API 返回 `503 MODEL_NOT_CONFIGURED`，提示运营配置 |
| 凭据缺失 / 解密失败 | 该模型不可用，API 返回明确错误并记 `provider_api_logs`，不静默 401 |
| 失效广播丢失 | 缓存 5min TTL 兜底 |
| 切换瞬间在途任务 | 已入队任务按入队时 `modelCode` 解析，可能命中旧供应商——属可接受行为（运营手动切换低频，且任务已扣冻结积分，最终以结果轮询为准） |
| 循环外键 | 迁移末尾以 `DEFERRABLE INITIALLY DEFERRED` 建立 `active_provider_model_id` 外键 |
| admin 凭据接口被非 admin 调用 | `adminGuard` 返回 403 |

## 10. 测试策略

- **单元测试**：
  - `crypto.ts`：加密 → 解密往返；错误密文 / 错误 master key 抛错
  - `provider-resolver.ts`：命中缓存、缓存失效后重查、`active_provider_model_id` 缺失分支、`invalidateCache` 清理
- **迁移测试**（参照 `packages/db/src/*.test.ts` 模式）：
  - 现有 `provider_models` 数据正确生成 `models`（按 code 去重）
  - `model_id` / `vendor_model_id` 回填正确
  - 火山拆分后 `provider_models` 挂到正确 provider
- **集成测试**：
  - admin 切换 `active_provider_model_id` → 发广播 → 缓存失效 → 下次 `resolveModel` 返回新供应商
  - admin `PUT credentials` → 加密入库 → 广播失效 → worker 取到新凭据
  - seedance-2.0 端到端：生成请求实际打到解析后的供应商

## 11. 迁移步骤（迁移脚本 + 数据回填）

1. 新建 `models` 表（`active_provider_model_id` 先建为普通列，无外键）
2. `provider_models` 加 `model_id`、`vendor_model_id` 列
3. **数据回填**：遍历现有 `provider_models`，按 `code` 去重生成 `models` 记录（首个出现的 code 作为该 model 来源），回填每条 `provider_models.model_id`；`vendor_model_id` 从 worker/api 两处硬编码的 `VOLCENGINE_MODEL_ID` 等映射表灌入；同时把 `params_pricing`、`category_references`、`resolution` 等从该 provider_model **上移到 `models`**（取当前生效实现的值），时长白名单从代码常量 `SEEDANCE_*_ALLOWED_DURATIONS` 灌入 `models.capabilities`
4. 每个 `model` 设 `active_provider_model_id` = 其当前唯一 / 首选 `provider_model`
5. `provider_models` 唯一约束改为 `(model_id, provider_id)`
6. `providers` 加 `base_url`、`credentials_encrypted`、`logo_url`、`credentials_updated_at`
7. **火山拆分**：插入 `volcengine-ark` / `volcengine-visual`，原 `provider_models` 中火山记录的 `provider_id` 迁移到对应新 provider，删除旧 `volcengine` 记录
8. **凭据 bootstrap**：迁移脚本从环境变量读取现有 key（`VOLCENGINE_API_KEY` 等），加密写入对应 `providers.credentials_encrypted`（一次性，生产首次部署执行）
9. 建立 `active_provider_model_id` 外键（DEFERRABLE）
10. 更新 `packages/types` 中 DB 类型与共享类型

## 12. 改造文件清单

**packages**
- `packages/db/migrations/062_provider_credentials_model_switch.ts`（新迁移；编号以执行时仓库最新序号为准，当前最大为 061）
- `packages/db/src/crypto.ts`（新增）、`packages/db/src/provider-resolver.ts`（新增）
- `packages/db/src/schema.ts`（models / provider_models / providers 类型）
- `packages/types/src/*`（ResolvedModel 等共享类型）

**apps/api**
- `routes/admin/catalog-*.ts`（新增：逻辑模型 CRUD + 切换 + avatar 上传）
- `routes/admin/providers-*.ts`（新增：供应商列表 + 凭据 + base_url + logo）
- `lib/queue.ts` 或入队点：投递时带 `modelCode` / `vendorModelId` / `providerCode`
- 所有 env 读取点改为 `resolveModel`：`routes/ai-assistant`、`routes/canvas-agent/*`、`routes/picture-book`、`routes/video-studio/_shared`、`services/minimax-tts.ts` 等
- 扣费逻辑（`routes/videos/post-generate`、`routes/short-drama/post-generate-segment-video` 的 `resolveUnitPrice` / `calculateVideoEstimatedCredits`）改为用 `resolveModel` 返回的 `paramsPricing`（来自 `models`），不再读 `provider_models.params_pricing`
- 启动钩子：校验 `MASTER_KEY`、订阅失效广播

**apps/worker**
- `workers/video-submit.ts`、`workers/video-submit-payload.ts`、`pollers/video-poller.ts`：改用 `resolveModel`，移除硬编码 `VOLCENGINE_API_URL` / `VOLCENGINE_MODEL_ID`
- `adapters/volcengine-image.ts`、`adapters/nano-banana.ts`、`adapters/factory.ts`：凭据从构造注入改为按解析结果传入
- `lib/mureka.ts`、`workers/storyboard.ts`、`workers/music.ts` 等：改用 `resolveModel`
- 启动钩子：校验 `MASTER_KEY`、订阅失效广播

**apps/web**
- `app/(dashboard)/admin/page.tsx`：新增「供应商管理」标签
- `components/admin/model-table.tsx`：以逻辑模型为主维度重构（切换 + CRUD + avatar）
- `components/admin/provider-table.tsx`（新增）：供应商凭据 / base_url / logo 管理
- `lib/model-images.ts`、`components/generation/shared/model-brand-icon.tsx`：avatar → logo → 首字母三级渲染
- 模型列表接口消费 `models.avatar`
- （后续单独 PR）移除 `@lobehub/icons` 依赖

## 13. 非目标（YAGNI 重申）

- 自动故障转移 / 多账号轮询 / 按团队路由
- TOS、支付凭据落库
- `MASTER_KEY` 自动轮换
- admin 界面的操作审计日志（除现有 `provider_api_logs` 外，不额外建审计表）
- 按供应商核算成本 / 利润率（D9：只存对用户价，不存供应商成本价）
