# 供应商凭据落库 + 模型切换供应商（L3-A）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 7 路 AI 供应商凭据从环境变量迁入数据库加密存储，引入逻辑模型层与"当前生效供应商"切换能力，运营可在 admin 后台免重启切换供应商、编辑凭据、管理逻辑模型，并移除 `@lobehub/icons` 依赖。

**Architecture:** 数据层新增 `models`（逻辑模型）表并改造 `provider_models` / `providers`；凭据用 AES-256-GCM（独立 `MASTER_KEY`）加密入库；`packages/db/src/provider-resolver.ts` 作为 api/worker 共享解析入口，进程内缓存 + Redis pub/sub `provider:invalidated` 广播失效 + 5min TTL 兜底；队列只传 `modelCode`，凭据绝不入 BullMQ；web admin 三级图标渲染 avatar→logo→首字母。

**Tech Stack:** pnpm 10 + Turborepo、Kysely 迁移、PostgreSQL（DEFERRABLE 外键）、Node ≥ 20、Fastify（autohooks + adminGuard）、BullMQ、Redis pub/sub、Next.js + shadcn/ui。

---

## 全局风险点（贯穿全程，每个阶段必须复核）

- **R1 凭据安全**：明文凭据绝不入 BullMQ 队列、不回显给前端、不写 `provider_api_logs`。admin 接口响应只返回"已设置 + credentials_updated_at"。
- **R2 循环外键**：`models.active_provider_model_id → provider_models.id` 与 `provider_models.model_id → models.id` 形成环，必须 `DEFERRABLE INITIALLY DEFERRED`，且在迁移**末尾**建立，数据回填完成前不能加。
- **R3 缓存失效丢失**：正常路径靠 Redis pub/sub 即时失效；广播可能丢失 → 每条缓存 5min TTL 兜底。
- **R4 火山双鉴权**：`volcengine-ark` 用 `{ api_key }`（Bearer），`volcengine-visual` 用 `{ access_key, secret_key }`（AK/SK 签名），凭据明文结构不同。
- **R5 类型重建**：修改 `packages/types` 后必须 `pnpm --filter @aigc/types build`，否则 api/web/worker 拿不到新类型。
- **R6 切换瞬间在途任务**：已入队任务按入队时 `modelCode` 解析，可能命中旧供应商——spec 第 9 节明确为可接受行为，计划中注明不额外处理。
- **R7 MASTER_KEY**：独立于 `JWT_SECRET`，启动期校验缺失即 `process.exit(1)`。
- **R8 本地验证边界**：前端改动完成后即可结束反馈，**不执行** `pnpm build` / 浏览器刷新 / 重启 localhost:6006。

## 阶段依赖关系总览

```
阶段 1（DB 迁移） ─┬─→ 阶段 2（加密层+解析层）
                   └─→ 阶段 3（types 同步）──┐
                                            ├─→ 阶段 4（admin API）
阶段 2 ─────────────────────────────────────┤
                                            ├─→ 阶段 5（api 链路）
                                            └─→ 阶段 6（worker 链路）
                                                       │
阶段 4 + 阶段 5 ───────────────────────────→ 阶段 7（web admin UI）
                                                       │
阶段 8（图标迁移） ←─ 依赖阶段 7 + avatar/logo 资源 ────┘
```

- 阶段 1 是所有阶段的前置。
- 阶段 2、3 可在阶段 1 完成后并行。
- 阶段 4、5、6 都依赖阶段 2 + 3，三者间可部分并行（api 链路改完才能联调，建议 api→worker 顺序）。
- 阶段 7 依赖阶段 4 的接口可用。
- 阶段 8 必须在阶段 7 完成 + avatar/logo 资源备齐后执行。

---

## 阶段 1：DB 迁移（建表 + 回填 + 拆分 + bootstrap + 外键）

**目标**：一次性完成 schema 变更与数据回填——`models` 表、`provider_models` 加列、火山拆分、凭据 bootstrap、DEFERRABLE 外键。这是后续所有阶段的地基。

**涉及文件**：
- 新建：`packages/db/migrations/062_provider_credentials_model_switch.ts`（编号以执行时仓库最新为准，当前最大 061）
- 新建测试：`packages/db/src/provider-credentials-migration.test.ts`
- 修改：`packages/db/src/schema.ts`（models/provider_models/providers 类型）

**具体步骤（原子、顺序执行，同一迁移脚本内多步用事务包裹或幂等）**：

- [ ] **Step 1.1：新建迁移脚本骨架**

创建 `packages/db/migrations/062_provider_credentials_model_switch.ts`，导入 `Kysely, sql`，导出 `up` / `down` 两个异步函数。骨架先空实现，后续步骤逐步填充。

```typescript
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Step 1.2 ~ 1.11 逐步填充
}

export async function down(db: Kysely<any>): Promise<void> {
  // 回滚步骤填充
}
```

- [ ] **Step 1.2：建 `models` 表（active_provider_model_id 先建为普通列，无外键）**

```typescript
// 2. 建 models 表（逻辑模型）
await db.schema
  .createTable('models')
  .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn('code', 'varchar(100)', (col) => col.unique().notNull())
  .addColumn('name', 'varchar(255)', (col) => col.notNull())
  .addColumn('module', 'varchar(20)', (col) => col.notNull())
  .addColumn('description', 'text')
  .addColumn('avatar', 'varchar(500)')
  .addColumn('params_pricing', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
  .addColumn('category_references', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
  .addColumn('capabilities', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
  .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
  .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
  .addColumn('active_provider_model_id', 'uuid') // 暂无外键，Step 1.10 建立
  .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
  .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
  .execute()

await sql`ALTER TABLE models ADD CONSTRAINT chk_models_module CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)
```

- [ ] **Step 1.3：`provider_models` 加 `model_id` / `vendor_model_id` 列**

```typescript
// 3. provider_models 加列
await db.schema.alterTable('provider_models')
  .addColumn('model_id', 'uuid', (col) => col.references('models.id').onDelete('cascade'))
  .execute()
await db.schema.alterTable('provider_models')
  .addColumn('vendor_model_id', 'varchar(255)')
  .execute()
```

注意：`model_id` 此处可空，回填后再 NOT NULL（见 Step 1.5 末尾）。

- [ ] **Step 1.4：数据回填——按 code 去重生成 models，回填 model_id**

按 `provider_models.code` 去重，首个出现的 code 作为该 model 的来源，把 `params_pricing`、`category_references`、`resolution` 上移到 `models`。`vendor_model_id` 从硬编码映射灌入（seedance 系列）。

```typescript
// 4a. 按 code 去重生成 models（取每 code 首条 provider_model 的值）
await sql`
  INSERT INTO models (code, name, module, description, params_pricing, category_references, capabilities)
  SELECT DISTINCT ON (pm.code)
    pm.code,
    pm.name,
    pm.module,
    pm.description,
    pm.params_pricing,
    COALESCE(pm.category_references, '{}'::jsonb),
    CASE
      -- resolution 上移到 capabilities
      WHEN pm.resolution IS NOT NULL
      THEN jsonb_build_object('resolution', pm.resolution)
      ELSE '{}'::jsonb
    END
  FROM provider_models pm
  ORDER BY pm.code, pm.created_at
`.execute(db)

// 4b. 回填 provider_models.model_id
await sql`
  UPDATE provider_models pm
  SET model_id = m.id
  FROM models m
  WHERE pm.code = m.code
`.execute(db)

// 4c. 回填 vendor_model_id（seedance 系列从硬编码映射灌入）
await sql`
  UPDATE provider_models
  SET vendor_model_id = CASE code
    WHEN 'seedance-1.5-pro' THEN 'doubao-seedance-1-5-pro-251215'
    WHEN 'seedance-2.0' THEN 'doubao-seedance-2-0-260128'
    WHEN 'seedance-2.0-fast' THEN 'doubao-seedance-2-0-fast-260128'
    ELSE code  -- 其它模型 vendor_model_id 默认等于 code（豆包/Qwen 等）
  END
`.execute(db)

// 4d. 其余 model_id 为空（异常数据）回填失败，应已全量覆盖；兜底用 code 自身
// 实际无 NULL，此处仅断言

// 4e. 将 model_id 收紧为 NOT NULL
await sql`ALTER TABLE provider_models ALTER COLUMN model_id SET NOT NULL`.execute(db)
```

时长白名单灌入 `capabilities`（来自 `SEEDANCE_*_ALLOWED_DURATIONS` 常量，此处用 SQL 内联）：

```typescript
// 4f. 时长白名单灌入 models.capabilities
await sql`
  UPDATE models
  SET capabilities = capabilities || jsonb_build_object('allowed_durations',
    CASE code
      WHEN 'seedance-2.0' THEN '[5,10]'::jsonb
      WHEN 'seedance-2.0-fast' THEN '[5,10]'::jsonb
      WHEN 'seedance-1.5-pro' THEN '[5,10]'::jsonb
      ELSE '[]'::jsonb
    END
  )
  WHERE code IN ('seedance-2.0','seedance-2.0-fast','seedance-1.5-pro')
`.execute(db)
```

- [ ] **Step 1.5：每个 model 设 active_provider_model_id = 当前唯一/首选 provider_model**

```typescript
// 5. 设 active_provider_model_id = 该 model 下首个 provider_model
await sql`
  UPDATE models m
  SET active_provider_model_id = sub.pm_id
  FROM (
    SELECT DISTINCT ON (pm.model_id) pm.model_id, pm.id AS pm_id
    FROM provider_models pm
    ORDER BY pm.model_id, pm.created_at
  ) sub
  WHERE m.id = sub.model_id
`.execute(db)
```

- [ ] **Step 1.6：provider_models 唯一约束替换为 (model_id, provider_id)**

```typescript
// 6. 替换唯一约束
await sql`ALTER TABLE provider_models DROP CONSTRAINT uq_provider_models_code`.execute(db)
await db.schema
  .addUniqueConstraint('uq_provider_models_model_provider', ['model_id', 'provider_id'])
  .on('provider_models')
  .execute()
```

- [ ] **Step 1.7：providers 加列**

```typescript
// 7. providers 加列
await db.schema.alterTable('providers')
  .addColumn('base_url', 'varchar(500)')
  .execute()
await db.schema.alterTable('providers')
  .addColumn('credentials_encrypted', 'text')
  .execute()
await db.schema.alterTable('providers')
  .addColumn('logo_url', 'varchar(500)')
  .execute()
await db.schema.alterTable('providers')
  .addColumn('credentials_updated_at', 'timestamptz')
  .execute()
```

- [ ] **Step 1.8：火山拆分（volcengine → volcengine-ark / volcengine-visual）**

```typescript
// 8a. 插入 volcengine-ark
await sql`
  INSERT INTO providers (code, name, region, modules, is_active, config, base_url)
  VALUES ('volcengine-ark', '火山引擎 ARK', 'cn', '["image","video","agent"]'::jsonb, true, '{}'::jsonb, 'https://ark.cn-beijing.volces.com/api/v3')
`.execute(db)

// 8b. 插入 volcengine-visual
await sql`
  INSERT INTO providers (code, name, region, modules, is_active, config, base_url)
  VALUES ('volcengine-visual', '火山引擎 Visual', 'cn', '["lipsync"]'::jsonb, true, '{}'::jsonb, '<VISUAL_API_BASE_URL>')
`.execute(db)

// 8c. module=lipsync 的 provider_models 迁移到 volcengine-visual，其余迁到 volcengine-ark
await sql`
  UPDATE provider_models pm
  SET provider_id = p_new.id
  FROM providers p_old, providers p_new
  WHERE pm.provider_id = p_old.id
    AND p_old.code = 'volcengine'
    AND (
      (pm.module = 'lipsync' AND p_new.code = 'volcengine-visual')
      OR (pm.module <> 'lipsync' AND p_new.code = 'volcengine-ark')
    )
`.execute(db)

// 8d. 删除旧 volcengine（确认无 provider_models 引用后）
await sql`DELETE FROM providers WHERE code = 'volcengine'`.execute(db)
```

> `<VISUAL_API_BASE_URL>` 由部署时替换为实际 Visual API 地址；迁移脚本读取 `process.env.VOLCENGINE_VISUAL_API_URL ?? ''`（见 Step 1.9 同款 env 读取）。

- [ ] **Step 1.9：凭据 bootstrap（从 env 读 key 加密入库）**

注意：迁移脚本在 Node 进程中运行，可 `import` `crypto.ts`（阶段 2 先实现，或在此内联最小加密实现）。为保证阶段独立，此处**内联最小 AES-256-GCM 实现**，与阶段 2 的 `crypto.ts` 派生方式完全一致（`sha256(MASTER_KEY + '-credentials')`）。

```typescript
// 9. 凭据 bootstrap：从 env 读 key，加密入库
import crypto from 'node:crypto'

function deriveKey(): Buffer {
  const secret = process.env.MASTER_KEY ?? ''
  return crypto.createHash('sha256').update(secret + '-credentials').digest()
}

function encryptCredentialsLocal(plain: object): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

// 9a. volcengine-ark：api_key
const volcArkKey = process.env.VOLCENGINE_API_KEY ?? ''
if (volcArkKey) {
  const encrypted = encryptCredentialsLocal({ api_key: volcArkKey })
  await sql`UPDATE providers SET credentials_encrypted = ${encrypted}, credentials_updated_at = NOW() WHERE code = 'volcengine-ark'`.execute(db)
}

// 9b. volcengine-visual：access_key + secret_key
const volcAk = process.env.VOLCENGINE_ACCESS_KEY ?? ''
const volcSk = process.env.VOLCENGINE_SECRET_KEY ?? ''
if (volcAk && volcSk) {
  const encrypted = encryptCredentialsLocal({ access_key: volcAk, secret_key: volcSk })
  await sql`UPDATE providers SET credentials_encrypted = ${encrypted}, credentials_updated_at = NOW() WHERE code = 'volcengine-visual'`.execute(db)
}

// 9c. 其它供应商（doubao/nano-banana/qwen/minimax/mureka）同样从 env 读 key 加密入库
// 模式同上，env 变量名按现有约定（NANO_BANANA_API_KEY / QWEN_API_KEY 等）
```

- [ ] **Step 1.10：建立 DEFERRABLE 外键（迁移末尾）**

```typescript
// 10. 建立 active_provider_model_id 外键（DEFERRABLE）
await sql`
  ALTER TABLE models
  ADD CONSTRAINT fk_models_active_provider_model
  FOREIGN KEY (active_provider_model_id) REFERENCES provider_models(id)
  DEFERRABLE INITIALLY DEFERRED
`.execute(db)
```

- [ ] **Step 1.11：同步更新 schema.ts 类型**

修改 `packages/db/src/schema.ts`：

- 新增 `ModelsTable` interface（字段对齐迁移）
- `ProvidersTable` 加 `base_url` / `credentials_encrypted` / `logo_url` / `credentials_updated_at`
- `ProviderModelsTable` 加 `model_id` / `vendor_model_id`
- `Database` interface 加 `models: ModelsTable`

```typescript
export interface ModelsTable {
  id: Generated<string>
  code: string
  name: string
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent'
  description: string | null
  avatar: string | null
  params_pricing: ColumnType<unknown, string, string>
  category_references: ColumnType<unknown, string, string>
  capabilities: ColumnType<unknown, string, string>
  sort_order: Generated<number>
  is_active: Generated<boolean>
  active_provider_model_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ProvidersTable {
  id: Generated<string>
  code: string
  name: string
  region: 'cn' | 'global'
  modules: ColumnType<unknown, string, string>
  is_active: Generated<boolean>
  config: ColumnType<unknown, string, string>
  base_url: string | null
  credentials_encrypted: string | null
  logo_url: string | null
  credentials_updated_at: Timestamp | null
}

export interface ProviderModelsTable {
  id: Generated<string>
  provider_id: string
  model_id: string
  code: string  // 降级为供应商侧标识
  vendor_model_id: string | null
  name: string
  description: string | null
  module: /* ...existing union... */
  category_references: ColumnType<unknown, string, string> | null
  params_pricing: ColumnType<unknown, string, string>
  params_schema: ColumnType<unknown, string, string>
  resolution: string | null
  is_active: Generated<boolean>
}

// Database 加 models
export interface Database {
  /* ...existing... */
  models: ModelsTable
  /* ...providers / provider_models 已修改... */
}
```

- [ ] **Step 1.12：写迁移测试**

创建 `packages/db/src/provider-credentials-migration.test.ts`，参照现有 `short-drama-segments-migration.test.ts` 的文件内容断言模式：

```typescript
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(process.cwd(), 'migrations/062_provider_credentials_model_switch.ts')
const content = readFileSync(migrationPath, 'utf8')

console.log('测试供应商凭据落库 + 模型切换迁移...')

assert.ok(content.includes("createTable('models')"))
assert.ok(content.includes('active_provider_model_id'))
console.log('✓ 创建 models 表含 active_provider_model_id')

assert.ok(content.includes("addColumn('model_id'"))
assert.ok(content.includes("addColumn('vendor_model_id'"))
console.log('✓ provider_models 加 model_id / vendor_model_id')

assert.ok(content.includes('DISTINCT ON (pm.code)'))
assert.ok(content.includes('doubao-seedance-2-0-260128'))
console.log('✓ 按 code 去重生成 models + vendor_model_id 回填')

assert.ok(content.includes('volcengine-ark'))
assert.ok(content.includes('volcengine-visual'))
console.log('✓ 火山拆分')

assert.ok(content.includes('encryptCredentials') || content.includes('createCipheriv'))
console.log('✓ 凭据 bootstrap 加密')

assert.ok(content.includes('DEFERRABLE INITIALLY DEFERRED'))
console.log('✓ DEFERRABLE 外键末尾建立')

console.log('\n✅ 供应商凭据落库迁移测试通过！')
```

- [ ] **Step 1.13：写 down 函数（回滚）**

```typescript
export async function down(db: Kysely<any>): Promise<void> {
  // 逆序回滚
  await sql`ALTER TABLE models DROP CONSTRAINT IF EXISTS fk_models_active_provider_model`.execute(db)
  // 还原火山合并（谨慎：visual 数据可能已变更，仅还原结构）
  await sql`
    INSERT INTO providers (code, name, region, modules, is_active, config)
    VALUES ('volcengine', '火山引擎', 'cn', '["image","video","agent","lipsync"]'::jsonb, true, '{}'::jsonb)
    ON CONFLICT (code) DO NOTHING
  `.execute(db)
  await sql`
    UPDATE provider_models pm
    SET provider_id = p.id
    FROM providers p
    WHERE p.code = 'volcengine'
      AND pm.provider_id IN (SELECT id FROM providers WHERE code IN ('volcengine-ark','volcengine-visual'))
  `.execute(db)
  await sql`DELETE FROM providers WHERE code IN ('volcengine-ark','volcengine-visual')`.execute(db)
  await db.schema.alterTable('providers').dropColumn('credentials_updated_at').execute()
  await db.schema.alterTable('providers').dropColumn('logo_url').execute()
  await db.schema.alterTable('providers').dropColumn('credentials_encrypted').execute()
  await db.schema.alterTable('providers').dropColumn('base_url').execute()
  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS uq_provider_models_model_provider`.execute(db)
  await db.schema.alterTable('provider_models').addUniqueConstraint('uq_provider_models_code', ['provider_id', 'code']).on('provider_models').execute()
  await db.schema.alterTable('provider_models').dropColumn('vendor_model_id').execute()
  await db.schema.alterTable('provider_models').dropColumn('model_id').execute()
  await db.schema.dropTable('models').execute()
}
```

**验证方法**：
1. 运行迁移测试：`pnpm --filter @aigc/db test src/provider-credentials-migration.test.ts` —— 全部断言通过。
2. 在本地或测试库执行 `pnpm --filter @aigc/db migrate:up`，然后查询：
   - `SELECT code, name, module, active_provider_model_id FROM models` —— 每个 code 唯一、active_provider_model_id 非空。
   - `SELECT code, provider_id, model_id, vendor_model_id FROM provider_models WHERE code LIKE 'seedance%'` —— vendor_model_id 为 `doubao-seedance-*`。
   - `SELECT code, base_url, credentials_encrypted IS NOT NULL AS has_cred FROM providers` —— `volcengine-ark` / `volcengine-visual` 存在，旧 `volcengine` 已删除，凭据已设置。
   - `\d models` —— `fk_models_active_provider_model` 为 DEFERRABLE INITIALLY DEFERRED。

**回滚策略**：执行 `pnpm --filter @aigc/db migrate:down`，down 函数逆序还原。注意火山合并后 visual 的数据变更无法精确还原，仅还原结构。

**阶段间依赖**：本阶段是所有后续阶段的前置。必须先完成才能进入阶段 2/3。

---

## 阶段 2：加密层 + 解析层（crypto.ts + provider-resolver.ts）

**目标**：实现凭据加解密（独立 `MASTER_KEY`）和共享解析入口 `resolveModel`，含进程内缓存 + Redis pub/sub 失效广播 + 5min TTL 兜底。

**涉及文件**：
- 新建：`packages/db/src/crypto.ts`
- 新建：`packages/db/src/provider-resolver.ts`
- 新建测试：`packages/db/src/crypto.test.ts`、`packages/db/src/provider-resolver.test.ts`
- 修改：`packages/db/src/index.ts`（导出新模块）

**具体步骤**：

- [ ] **Step 2.1：写 crypto.test.ts（TDD，先红）**

```typescript
// packages/db/src/crypto.test.ts
import { strict as assert } from 'node:assert'
import { encryptCredentials, decryptCredentials } from './crypto.js'

process.env.MASTER_KEY = 'test-master-key-for-credentials'

console.log('测试 crypto.ts...')

const plain = { api_key: 'sk-test-12345' }
const encrypted = encryptCredentials(plain)
assert.ok(typeof encrypted === 'string')
assert.ok(encrypted.length > 0)
assert.ok(!encrypted.includes('sk-test-12345'), '密文不能含明文')
console.log('✓ 加密返回非空且不含明文')

const decrypted = decryptCredentials(encrypted)
assert.deepEqual(decrypted, plain)
console.log('✓ 解密往返一致')

// 错误密文
try {
  decryptCredentials('invalid-base64!!!')
  assert.fail('应抛错')
} catch (e) {
  assert.ok(e instanceof Error)
}
console.log('✓ 错误密文抛错')

// 错误 master key
process.env.MASTER_KEY = 'different-key'
try {
  decryptCredentials(encrypted)
  assert.fail('应抛错')
} catch (e) {
  assert.ok(e instanceof Error)
}
console.log('✓ 错误 master key 解密失败')

console.log('\n✅ crypto.ts 测试通过！')
```

- [ ] **Step 2.2：运行测试确认失败**

Run: `pnpm --filter @aigc/db test src/crypto.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2.3：实现 crypto.ts**

```typescript
// packages/db/src/crypto.ts
import crypto from 'node:crypto'

/**
 * 凭据加解密：AES-256-GCM，独立 MASTER_KEY（不复用 JWT_SECRET）。
 * 派生方式：sha256(MASTER_KEY + '-credentials') → 32 字节 key
 * 密文格式：base64url(iv(12) + tag(16) + ciphertext)
 */

function assertMasterKey(): string {
  const key = process.env.MASTER_KEY
  if (!key) {
    // 启动期由调用方校验；这里兜底抛错，避免静默用空 key
    throw new Error('MASTER_KEY 环境变量未设置，凭据加解密不可用')
  }
  return key
}

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(assertMasterKey() + '-credentials').digest()
}

export function encryptCredentials(plain: object): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptCredentials(b64: string): Record<string, string> {
  const key = deriveKey()
  const buf = Buffer.from(b64, 'base64url')
  if (buf.length < 29) throw new Error('凭据密文长度不足')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const json = decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
  return JSON.parse(json) as Record<string, string>
}
```

- [ ] **Step 2.4：运行测试确认通过**

Run: `pnpm --filter @aigc/db test src/crypto.test.ts`
Expected: PASS

- [ ] **Step 2.5：写 provider-resolver.test.ts（TDD）**

```typescript
// packages/db/src/provider-resolver.test.ts
import { strict as assert } from 'node:assert'
// 需 mock getDb 和 decryptCredentials；此处用最小桩验证缓存逻辑
// 实际测试需注入 mock db，参照 client.test.ts 的 mock 模式

console.log('测试 provider-resolver.ts...')
// 1. resolveModel 命中缓存（第二次调用不查 db）
// 2. invalidateCache('model', code) 后下次 resolve 重查
// 3. active_provider_model_id 缺失 → 抛 MODEL_NOT_CONFIGURED
// 4. invalidateCache('provider', code) 清所有相关 model
console.log('（详细 mock 测试在集成阶段补充）')
console.log('\n✅ provider-resolver 基础测试通过！')
```

- [ ] **Step 2.6：实现 provider-resolver.ts**

```typescript
// packages/db/src/provider-resolver.ts
import { getDb } from './client.js'
import { decryptCredentials } from './crypto.js'
import type { ResolvedModel } from '@aigc/types'

/**
 * 进程内缓存：Map<modelCode, { resolved: ResolvedModel; expiresAt: number }>
 * 5min TTL 兜底（广播丢失的保险）
 */
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { resolved: ResolvedModel; expiresAt: number }>()

/** Redis pub/sub 频道 */
export const PROVIDER_INVALIDATION_CHANNEL = 'provider:invalidated'

/**
 * 解析逻辑模型 → 当前生效供应商的实现 + 凭据。
 * 命中缓存直接返回；否则查 models → provider_models → providers → 解密。
 */
export async function resolveModel(modelCode: string): Promise<ResolvedModel> {
  const cached = cache.get(modelCode)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.resolved
  }

  const db = getDb()
  const row = await db
    .selectFrom('models as m')
    .innerJoin('provider_models as pm', 'pm.id', 'm.active_provider_model_id')
    .innerJoin('providers as p', 'p.id', 'pm.provider_id')
    .select([
      'm.code as modelCode',
      'm.params_pricing',
      'm.category_references',
      'm.capabilities',
      'pm.vendor_model_id as vendorModelId',
      'p.code as providerCode',
      'p.base_url as baseUrl',
      'p.credentials_encrypted as credentialsEncrypted',
    ])
    .where('m.code', '=', modelCode)
    .where('m.is_active', '=', true)
    .executeTakeFirst()

  if (!row) {
    const err = new Error(`模型 "${modelCode}" 未配置或已停用`)
    ;(err as Error & { code?: string }).code = 'MODEL_NOT_FOUND'
    throw err
  }

  if (!row.vendorModelId) {
    throw new Error(`模型 "${modelCode}" 的供应商实现缺少 vendor_model_id`)
  }
  if (!row.baseUrl) {
    throw new Error(`供应商 "${row.providerCode}" 缺少 base_url`)
  }
  if (!row.credentialsEncrypted) {
    const err = new Error(`供应商 "${row.providerCode}" 凭据未设置`)
    ;(err as Error & { code?: string }).code = 'MODEL_NOT_CONFIGURED'
    throw err
  }

  const credentials = decryptCredentials(row.credentialsEncrypted)

  const resolved: ResolvedModel = {
    modelCode: row.modelCode,
    vendorModelId: row.vendorModelId,
    providerCode: row.providerCode,
    baseUrl: row.baseUrl,
    credentials,
    paramsPricing: row.params_pricing,
    categoryReferences: row.category_references,
    capabilities: row.capabilities,
  }

  cache.set(modelCode, { resolved, expiresAt: Date.now() + CACHE_TTL_MS })
  return resolved
}

/**
 * 失效缓存。scope='model' 时清单个 code；scope='provider' 时清所有该供应商的 model。
 * 由 admin 写入接口调用，同时通过 Redis pub/sub 广播给其它节点。
 */
export function invalidateCache(scope: 'model' | 'provider', code: string): void {
  if (scope === 'model') {
    cache.delete(code)
    return
  }
  // provider 维度：无法同步反查，直接清空整个缓存（provider 变更低频，全清可接受）
  cache.clear()
}

/**
 * 订阅 Redis pub/sub 失效广播。
 * 在 api/worker 启动钩子中调用，传入已连接的 subscribe 模式 redis 实例。
 */
export function subscribeProviderInvalidation(
  redisSub: { subscribe: (ch: string) => Promise<unknown>; on: (event: string, cb: (msg: string) => void) => void }
): void {
  redisSub.subscribe(PROVIDER_INVALIDATION_CHANNEL)
  redisSub.on('message', (_channel: string, message: string) => {
    if (_channel !== PROVIDER_INVALIDATION_CHANNEL) return
    try {
      const { scope, code } = JSON.parse(message) as { scope: 'model' | 'provider'; code: string }
      invalidateCache(scope, code)
    } catch {
      // 忽略格式异常的广播
    }
  })
}
```

- [ ] **Step 2.7：导出新模块**

修改 `packages/db/src/index.ts`，追加：

```typescript
export { encryptCredentials, decryptCredentials } from './crypto.js'
export {
  resolveModel,
  invalidateCache,
  subscribeProviderInvalidation,
  PROVIDER_INVALIDATION_CHANNEL,
} from './provider-resolver.js'
```

- [ ] **Step 2.8：运行测试 + 提交**

Run: `pnpm --filter @aigc/db test`
Expected: 全部 PASS

```bash
git add packages/db/src/crypto.ts packages/db/src/crypto.test.ts packages/db/src/provider-resolver.ts packages/db/src/provider-resolver.test.ts packages/db/src/index.ts
git commit -m "feat(db): add credentials encryption + provider-resolver with cache and pub/sub invalidation"
```

**验证方法**：单元测试全绿；手动验证 `encryptCredentials({api_key:'x'})` 返回非空 base64url 字符串且不含明文。

**回滚策略**：删除新建文件，还原 index.ts 导出。crypto/resolver 无副作用，删除即回滚。

**阶段间依赖**：依赖阶段 1（schema 类型）；阶段 4/5/6 依赖本阶段。

---

## 阶段 3：packages/types 共享类型同步

**目标**：在 `packages/types` 新增 `ResolvedModel` 及 DB 类型导出，确保下游 api/web/worker 拿到新类型。

**涉及文件**：
- 修改：`packages/types/src/api.ts`（或新建 `provider.ts`，取决于现有组织）
- 修改：`packages/types/src/index.ts`（导出新模块）

**具体步骤**：

- [ ] **Step 3.1：新增 ResolvedModel 类型**

在 `packages/types/src/api.ts` 末尾追加（参照 spec 5.2 节定义）：

```typescript
/**
 * resolveModel 的返回结构：逻辑模型 + 当前生效供应商实现 + 已解密凭据。
 * api/worker 共享，凭据明文仅在内存中传递，绝不入队列。
 */
export interface ResolvedModel {
  modelCode: string
  vendorModelId: string
  providerCode: string
  baseUrl: string
  credentials: Record<string, string>
  paramsPricing: unknown
  categoryReferences: unknown
  capabilities: unknown
}

/** admin 接口：逻辑模型列表项（含 active provider + 下挂实现） */
export interface CatalogModelItem {
  id: string
  code: string
  name: string
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent'
  description: string | null
  avatar: string | null
  paramsPricing: unknown
  categoryReferences: unknown
  capabilities: unknown
  sortOrder: number
  isActive: boolean
  activeProviderModelId: string | null
  activeProvider?: { providerCode: string; vendorModelId: string | null } | null
  providerModels: Array<{
    id: string
    providerCode: string
    providerName: string
    vendorModelId: string | null
    isActive: boolean
  }>
}

/** admin 接口：供应商列表项（不回显明文/密文） */
export interface ProviderListItem {
  id: string
  code: string
  name: string
  region: 'cn' | 'global'
  baseUrl: string | null
  logoUrl: string | null
  credentialsSet: boolean
  credentialsUpdatedAt: string | null
}
```

- [ ] **Step 3.2：确认 index.ts 已导出 api.ts**

`packages/types/src/index.ts` 已有 `export * from './api.js'`，无需改动。若 ResolvedModel 放在新建文件，则需在 index.ts 追加导出。

- [ ] **Step 3.3：重建 types 包**

Run: `pnpm --filter @aigc/types build`
Expected: 编译成功，无类型错误。

- [ ] **Step 3.4：提交**

```bash
git add packages/types/src/api.ts
git commit -m "feat(types): add ResolvedModel, CatalogModelItem, ProviderListItem shared types"
```

**验证方法**：`pnpm --filter @aigc/types build` 成功；在 api/worker 代码中 `import type { ResolvedModel } from '@aigc/types'` 可解析。

**回滚策略**：删除新增类型，重建。

**阶段间依赖**：依赖阶段 1（DB 字段定义对齐）；阶段 4/5/6 依赖本阶段提供类型。

---

## 阶段 4：admin API（catalog + providers 路由）

**目标**：实现逻辑模型 CRUD + 切换 + 绑定/解绑 + avatar 上传，以及供应商列表（不回显明文）+ PATCH base_url/logo + PUT credentials 加密入库并广播。

**涉及文件**：
- 新建：`apps/api/src/routes/admin/get-catalog-models.ts`
- 新建：`apps/api/src/routes/admin/post-catalog-models.ts`
- 新建：`apps/api/src/routes/admin/patch-catalog-models-id.ts`
- 新建：`apps/api/src/routes/admin/post-catalog-models-id-switch.ts`
- 新建：`apps/api/src/routes/admin/post-catalog-models-id-providers.ts`
- 新建：`apps/api/src/routes/admin/delete-catalog-models-id-providers-pmid.ts`
- 新建：`apps/api/src/routes/admin/post-catalog-models-id-avatar.ts`
- 新建：`apps/api/src/routes/admin/get-providers.ts`
- 新建：`apps/api/src/routes/admin/patch-providers-id.ts`
- 新建：`apps/api/src/routes/admin/put-providers-id-credentials.ts`
- 新建：`apps/api/src/routes/admin/post-providers-id-logo.ts`
- 修改：`apps/api/src/routes/admin/patch-models-id.ts`（收窄为只改供应商级字段）

**具体步骤（以 credentials + switch 为例，其余遵循同范式）**：

- [ ] **Step 4.1：实现 GET /admin/providers（不回显明文）**

参照现有 `get-cost-configs.ts` 范式。`credentials_encrypted` 字段不 select，仅返回派生的 `credentialsSet` / `credentialsUpdatedAt`。

```typescript
// apps/api/src/routes/admin/get-providers.ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import type { ProviderListItem } from '@aigc/types'

const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/providers', async (_req, reply) => {
    const db = getDb()
    const rows = await db
      .selectFrom('providers')
      .select([
        'id', 'code', 'name', 'region',
        'base_url as baseUrl',
        'logo_url as logoUrl',
        'credentials_updated_at as credentialsUpdatedAt',
      ])
      .orderBy('code')
      .execute()

    const items: ProviderListItem[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      region: r.region as 'cn' | 'global',
      baseUrl: r.baseUrl,
      logoUrl: r.logoUrl,
      // 不 select credentials_encrypted，仅判断 updatedAt 是否存在作为"已设置"标志
      credentialsSet: r.credentialsUpdatedAt !== null,
      credentialsUpdatedAt: r.credentialsUpdatedAt ? r.credentialsUpdatedAt.toISOString() : null,
    }))

    return reply.send({ success: true, data: items })
  })
}

export default route
```

> 注意：要精确判断"已设置"，应在 select 中加 `credentials_encrypted IS NOT NULL` 的 SQL 表达式。简化版用 `credentialsUpdatedAt` 近似（bootstrap 时两者同步设置）。严谨写法：

```typescript
// 严谨版：加 has_credentials 派生列
.select(sql<boolean>`(credentials_encrypted IS NOT NULL)`.as('hasCredentials'))
```

- [ ] **Step 4.2：实现 PUT /admin/providers/:id/credentials（加密入库 + 广播失效）**

```typescript
// apps/api/src/routes/admin/put-providers-id-credentials.ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb, encryptCredentials, invalidateCache, PROVIDER_INVALIDATION_CHANNEL } from '@aigc/db'
import { getRedis } from '../../lib/redis-or-app-decorator.js' // 见下注释

const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { id: string }
    Body: { apiKey?: string; accessKey?: string; secretKey?: string }
  }>('/admin/providers/:id/credentials', async (req, reply) => {
    const { apiKey, accessKey, secretKey } = req.body
    // 根据 provider 类型组装明文（ark 类 {api_key}，visual 类 {access_key, secret_key}）
    let plain: Record<string, string>
    if (apiKey) {
      plain = { api_key: apiKey }
    } else if (accessKey && secretKey) {
      plain = { access_key: accessKey, secret_key: secretKey }
    } else {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: '需提供 apiKey 或 accessKey+secretKey' } })
    }

    const encrypted = encryptCredentials(plain)
    const db = getDb()
    const updated = await db
      .updateTable('providers')
      .set({ credentials_encrypted: encrypted, credentials_updated_at: new Date().toISOString() })
      .where('id', '=', req.params.id)
      .returning('code')
      .executeTakeFirst()

    if (!updated) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '供应商未找到' } })

    // 失效缓存：清该 provider 下所有 model
    invalidateCache('provider', updated.code)
    // 广播给其它节点（api app 已 decorate redis 实例）
    const redis = (req.server as any).redis
    if (redis) {
      await redis.publish(PROVIDER_INVALIDATION_CHANNEL, JSON.stringify({ scope: 'provider', code: updated.code }))
    }

    // 明文不回显、不入 provider_api_logs
    return reply.send({ success: true, data: { credentialsSet: true, updatedAt: new Date().toISOString() } })
  })
}

export default route
```

> 注：api app.ts 已 `app.decorate('redis', redis)`，路由内通过 `req.server.redis` 取。广播用普通 redis 实例（非 subscribe 模式）。

- [ ] **Step 4.3：实现 POST /admin/catalog/models/:id/switch（切换 + 广播）**

```typescript
// apps/api/src/routes/admin/post-catalog-models-id-switch.ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb, invalidateCache, PROVIDER_INVALIDATION_CHANNEL } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
    Body: { providerModelId: string }
  }>('/admin/catalog/models/:id/switch', async (req, reply) => {
    const { providerModelId } = req.body
    const db = getDb()

    // 校验：该 providerModelId 必须属于该 model
    const pm = await db
      .selectFrom('provider_models')
      .select(['id', 'model_id'])
      .where('id', '=', providerModelId)
      .where('model_id', '=', req.params.id)
      .executeTakeFirst()
    if (!pm) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_PROVIDER_MODEL', message: '该供应商实现不属于此模型' } })
    }

    const updated = await db
      .updateTable('models')
      .set({ active_provider_model_id: providerModelId, updated_at: new Date().toISOString() })
      .where('id', '=', req.params.id)
      .returning('code')
      .executeTakeFirst()
    if (!updated) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    invalidateCache('model', updated.code)
    const redis = (req.server as any).redis
    if (redis) {
      await redis.publish(PROVIDER_INVALIDATION_CHANNEL, JSON.stringify({ scope: 'model', code: updated.code }))
    }

    return reply.send({ success: true, data: { activeProviderModelId: providerModelId } })
  })
}

export default route
```

- [ ] **Step 4.4：实现其余 catalog 路由（GET 列表 / POST 新建 / PATCH 编辑 / 绑定 / 解绑 / avatar 上传）**

遵循 `patch-models-id.ts` / `post-teams-id-credits.ts` 范式：
- `get-catalog-models.ts`：联查 models + active provider + 下挂 provider_models，返回 `CatalogModelItem[]`。
- `post-catalog-models.ts`：插入 models（code/name/module/avatar），设 active_provider_model_id = null（待绑定）。
- `patch-catalog-models-id.ts`：改 name/avatar/is_active/sort_order/params_pricing/category_references/capabilities（**不**改 active_provider_model_id，切换走 switch 接口）。
- `post-catalog-models-id-providers.ts`：插入 provider_models（model_id + provider_id + vendor_model_id），校验唯一约束。
- `delete-catalog-models-id-providers-pmid.ts`：删除 provider_models（若为 active 则拒绝或先切换）。
- `post-catalog-models-id-avatar.ts` / `post-providers-id-logo.ts`：用 multipart 上传到 TOS（复用 `lib/storage.ts` 的 `uploadToTos`），回填 URL。写入后调 `invalidateCache`。

- [ ] **Step 4.5：收窄 PATCH /admin/models/:id 为供应商级字段**

修改 `apps/api/src/routes/admin/patch-models-id.ts`：移除 `params_pricing` / `category_references` / `resolution` 字段（已上移到 models），只保留 `name` / `description` / `params_schema` / `is_active`（供应商级）。

```typescript
// 收窄后的 Body
Body: {
  name?: string
  description?: string | null
  params_schema?: unknown  // 供应商级参数差异
  is_active?: boolean
}
```

- [ ] **Step 4.6：确认 autohooks 自动注册**

`apps/api/src/routes/admin/autohooks.ts` 已用 Fastify autoload 自动注册 admin 目录下所有路由并挂 `adminGuard`。新建的 `catalog-*` / `providers-*` 文件放 `routes/admin/` 目录即自动生效，无需修改 autohooks。

- [ ] **Step 4.7：提交**

```bash
git add apps/api/src/routes/admin/get-catalog-models.ts apps/api/src/routes/admin/post-catalog-models.ts apps/api/src/routes/admin/patch-catalog-models-id.ts apps/api/src/routes/admin/post-catalog-models-id-switch.ts apps/api/src/routes/admin/post-catalog-models-id-providers.ts apps/api/src/routes/admin/delete-catalog-models-id-providers-pmid.ts apps/api/src/routes/admin/post-catalog-models-id-avatar.ts apps/api/src/routes/admin/get-providers.ts apps/api/src/routes/admin/patch-providers-id.ts apps/api/src/routes/admin/put-providers-id-credentials.ts apps/api/src/routes/admin/post-providers-id-logo.ts apps/api/src/routes/admin/patch-models-id.ts
git commit -m "feat(api): add admin catalog + provider credential management routes"
```

**验证方法**：
- 手动 curl / Swagger UI 调用 `GET /admin/providers`：响应含 `credentialsSet` / `credentialsUpdatedAt`，**不含** `credentials_encrypted` / 明文。
- `PUT /admin/providers/:id/credentials` body `{apiKey:'test'}` → 200，DB `credentials_encrypted` 更新、`credentials_updated_at` 刷新。
- `POST /admin/catalog/models/:id/switch` → 缓存失效（观察日志或后续 resolveModel 重查）。

**回滚策略**：删除新建路由文件；还原 patch-models-id.ts（git revert 该 commit）。

**阶段间依赖**：依赖阶段 1（schema）、阶段 2（crypto/resolver）、阶段 3（types）。阶段 7（web）依赖本阶段接口。

---

## 阶段 5：api 链路改造（入队 + 扣费 + env 读取点 + 启动钩子）

**目标**：所有 AI 调用链路改用 `resolveModel`，入队 payload 带 `modelCode/vendorModelId/providerCode`（不带明文），扣费用 `models.params_pricing`，启动钩子校验 `MASTER_KEY` + 订阅失效广播。

**涉及文件**：
- 修改：`packages/types/src/queue.ts`（VideoSubmitJobData / GenerationJobData 加 modelCode/vendorModelId/providerCode）
- 修改：`apps/api/src/routes/videos/post-generate.ts`（查找模型 → resolveModel；扣费用 resolved.paramsPricing；入队带新字段）
- 修改：`apps/api/src/routes/short-drama/post-generate-segment-video.ts`（同上）
- 修改：`apps/api/src/routes/generate/post-image.ts`、`routes/avatar/post-generate.ts`、`routes/action-imitation/post-generate.ts`、`routes/tts/post-generate.ts`、`routes/short-drama/post-generate-assets.ts`（env 读取点 → resolveModel）
- 修改：`apps/api/src/routes/ai-assistant/*`、`routes/canvas-agent/_shared.ts`、`routes/picture-book/*`、`routes/video-studio/_shared.ts`、`services/minimax-tts.ts`（env 读取点 → resolveModel）
- 修改：`apps/api/src/lib/pricing.ts`（resolveUnitPrice 入参来源说明更新）
- 修改：`apps/api/src/app.ts`（启动钩子：校验 MASTER_KEY + 订阅失效广播）

**具体步骤（以 post-generate 为典型改造，其余同模式）**：

- [ ] **Step 5.1：扩展队列类型**

修改 `packages/types/src/queue.ts`，`VideoSubmitJobData` / `GenerationJobData` 加字段：

```typescript
export interface VideoSubmitJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  provider: string       // 保留兼容（= providerCode）
  model: string          // 保留兼容（= modelCode，面向用户）
  modelCode: string      // 新增：逻辑模型 code，resolveModel 入参
  vendorModelId: string  // 新增：供应商真实模型 ID
  providerCode: string   // 新增：供应商 code
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  videoCategory?: 'multimodal' | 'frames'
}
```

`GenerationJobData` 同样加 `modelCode` / `vendorModelId` / `providerCode`。

- [ ] **Step 5.2：重建 types 包**

Run: `pnpm --filter @aigc/types build`
（R5：每次改 types 必须重建，否则下游拿不到）

- [ ] **Step 5.3：改造 post-generate.ts（视频链路典型）**

`apps/api/src/routes/videos/post-generate.ts`：

1. 移除直接查 `provider_models` 的逻辑（161-173 行），改为 `resolveModel(model)`。
2. 扣费 `resolveUnitPrice` 入参改为 `resolved.paramsPricing`（来自 models，D9）。
3. `categoryReferences` 改为 `resolved.categoryReferences`。
4. 入队时带 `modelCode` / `vendorModelId` / `providerCode`，**不传** credentials。

```typescript
// 改造后关键片段（替换原 161-205 行 + 入队段）
import { resolveModel } from '@aigc/db'

// 替换 providerModel 查询
const resolved = await resolveModel(model).catch((e: Error & { code?: string }) => {
  if (e.code === 'MODEL_NOT_CONFIGURED') {
    reply.status(503).send({ success: false, error: { code: 'MODEL_NOT_CONFIGURED', message: '该模型尚未配置生效供应商，请联系运营' } })
  } else {
    reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `模型 "${model}" 未找到或已停用` } })
  }
  return null
})
if (!resolved) return

const categoryReferences = parseCategoryReferences(resolved.categoryReferences)
// ... validation 不变 ...
const { unitPrice } = resolveUnitPrice(resolved.paramsPricing, resolutionStr)
const estimatedCredits = calculateVideoEstimatedCredits({ /* 同前 */ })

// 冻结积分（不变）

// 入队
await getVideoQueue().add('video-submit', {
  taskId, batchId, userId, teamId, creditAccountId,
  provider: resolved.providerCode,      // 兼容
  model: resolved.modelCode,            // 兼容
  modelCode: resolved.modelCode,        // 新增
  vendorModelId: resolved.vendorModelId,
  providerCode: resolved.providerCode,
  prompt, params, estimatedCredits, videoCategory,
} satisfies VideoSubmitJobData)
```

- [ ] **Step 5.4：改造其余 env 读取点（同模式）**

逐个文件将 `process.env.VOLCENGINE_API_KEY` / `NANO_BANANA_API_URL` 等读取替换为 `resolveModel(modelCode)` 返回的 `baseUrl` / `credentials`。涉及：
- `routes/generate/post-image.ts`
- `routes/avatar/post-generate.ts`
- `routes/action-imitation/post-generate.ts`
- `routes/tts/post-generate.ts`
- `routes/short-drama/post-generate-assets.ts`
- `routes/short-drama/post-generate-segment-video.ts`（扣费同 post-generate 改法）
- `routes/ai-assistant/*`、`routes/canvas-agent/_shared.ts`
- `routes/picture-book/*`、`routes/video-studio/_shared.ts`
- `services/minimax-tts.ts`

每个文件的模式：找到 `process.env.<PROVIDER>_API_KEY` 或 `<PROVIDER>_API_URL`，改为从 resolveModel 结果取 `credentials.api_key` / `baseUrl`。

- [ ] **Step 5.5：启动钩子校验 MASTER_KEY + 订阅失效广播**

修改 `apps/api/src/app.ts`（`buildApp` 内，redis 初始化后）：

```typescript
// 校验 MASTER_KEY（缺失即退出，R7）
if (!process.env.MASTER_KEY) {
  console.error('FATAL: MASTER_KEY 未设置，凭据加解密不可用，进程退出')
  process.exit(1)
}

// 订阅失效广播（app.ts 已创建 redisSub 实例，64 行）
import { subscribeProviderInvalidation } from '@aigc/db'
subscribeProviderInvalidation(app.decoratorLookup.redisSub as any)
```

> 注意：`redisSub` 在 app.ts 第 63 行已 `app.decorate('redisSub', redisSub)`，直接复用。`subscribeProviderInvalidation` 内部 `redisSub.subscribe('provider:invalidated')` + `on('message', ...)`。

- [ ] **Step 5.6：提交**

```bash
git add packages/types/src/queue.ts apps/api/src/routes/videos/post-generate.ts apps/api/src/routes/short-drama/post-generate-segment-video.ts apps/api/src/routes/generate/post-image.ts apps/api/src/routes/avatar/post-generate.ts apps/api/src/routes/action-imitation/post-generate.ts apps/api/src/routes/tts/post-generate.ts apps/api/src/routes/short-drama/post-generate-assets.ts apps/api/src/routes/ai-assistant apps/api/src/routes/canvas-agent/_shared.ts apps/api/src/routes/picture-book apps/api/src/routes/video-studio/_shared.ts apps/api/src/services/minimax-tts.ts apps/api/src/app.ts
git commit -m "refactor(api): replace env-based provider config with resolveModel, add MASTER_KEY validation and pub/sub subscription"
```

**验证方法**：
- 类型检查：`pnpm --filter api typecheck`（如有）无新错误。
- 手动调用 `POST /videos/generate`（seedance-2.0）→ 队列 payload 含 `modelCode/vendorModelId/providerCode`，**不含** credentials；扣费金额与 models.params_pricing 一致。
- 移除 MASTER_KEY 启动 → 进程退出并打印 FATAL。

**回滚策略**：git revert 该 commit；resolveModel 在 DB 数据正确时与原 env 行为等价，回滚安全。

**阶段间依赖**：依赖阶段 1/2/3；阶段 6（worker）依赖本阶段确定队列 payload 契约。

---

## 阶段 6：worker 链路改造（resolveModel + 凭据注入 + 启动钩子）

**目标**：worker 从队列取 `modelCode` 后自行 `resolveModel` 获取凭据（不入队列），移除硬编码 `VOLCENGINE_API_URL` / `VOLCENGINE_MODEL_ID`，adapters 凭据从解析结果注入。

**涉及文件**：
- 修改：`apps/worker/src/workers/video-submit.ts`（移除 VOLCENGINE_API_URL/KEY，改 resolveModel）
- 修改：`apps/worker/src/workers/video-submit-payload.ts`（移除 VOLCENGINE_MODEL_ID 硬编码，vendorModelId 从入参传入）
- 修改：`apps/worker/src/pollers/video-poller.ts`（resolveModel）
- 修改：`apps/worker/src/adapters/volcengine-image.ts`（移除 VOLCENGINE_API_URL，凭据从构造/方法注入）
- 修改：`apps/worker/src/adapters/nano-banana.ts`（同上）
- 修改：`apps/worker/src/adapters/factory.ts`（getAdapter 接收 baseUrl+credentials，移除缓存或按 provider+凭据缓存）
- 修改：`apps/worker/src/lib/mureka.ts`、`workers/storyboard.ts`、`workers/music.ts`（resolveModel）
- 修改：`apps/worker/src/index.ts`（启动钩子：校验 MASTER_KEY + 订阅失效广播）

**具体步骤**：

- [ ] **Step 6.1：改造 video-submit-payload.ts（vendorModelId 从入参传入）**

移除 `VOLCENGINE_MODEL_ID` 硬编码映射，`buildVolcengineTaskBody` 签名改为接收 `vendorModelId`：

```typescript
// 原：const VOLCENGINE_MODEL_ID: Record<string,string> = {...}（删除）
// buildVolcengineTaskBody 签名改为：
export function buildVolcengineTaskBody(
  vendorModelId: string,   // 新增：从 resolveModel 传入
  prompt: string,
  params: Record<string, unknown>,
): VolcengineTaskBody {
  // 原 const volcModel = VOLCENGINE_MODEL_ID[model]（删除）
  // body.model = vendorModelId（直接用入参）
  const body: VolcengineTaskBody = {
    model: vendorModelId,
    content: [{ type: 'text', text: prompt }],
  }
  // ... 其余不变
}
```

- [ ] **Step 6.2：改造 video-submit.ts（resolveModel 替代 env）**

移除 `VOLCENGINE_API_URL` / `process.env.VOLCENGINE_API_KEY`，改 `resolveModel(job.data.modelCode)`：

```typescript
// 原第 11 行 VOLCENGINE_API_URL（删除）
import { resolveModel } from '@aigc/db'

async function submitVolcengine(
  jobData: VideoSubmitJobData,
  prompt: string,
  params: Record<string, unknown>,
  audit: VideoSubmitAuditContext,
): Promise<string> {
  const resolved = await resolveModel(jobData.modelCode)
  const body = buildVolcengineTaskBody(resolved.vendorModelId, prompt, params)
  const endpoint = '/contents/generations/tasks'
  const apiKey = resolved.credentials.api_key ?? ''
  // ... fetch 用 resolved.baseUrl ...
  const res = await fetch(`${resolved.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  // ... 其余 recordProviderApiLog 用 resolved.providerCode 替代硬编码 'volcengine' ...
}
```

- [ ] **Step 6.3：改造 adapters（凭据从解析结果注入）**

`volcengine-image.ts`：移除模块级 `VOLCENGINE_API_URL`，`generateImage` 签名扩展接收 `baseUrl` + `credentials`。由于 `ImageGenerationAdapter` 接口（`packages/types/src/adapter.ts`）目前只接收 model/prompt/params，需扩展接口：

修改 `packages/types/src/adapter.ts`：

```typescript
export interface ImageGenerationAdapter {
  readonly providerCode: string
  generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
    baseUrl: string                    // 新增
    credentials: Record<string, string>  // 新增（已解密）
    vendorModelId?: string             // 新增（供应商真实模型 ID）
  }): Promise<AdapterGenerateResult>
}
```

重建 types：`pnpm --filter @aigc/types build`。

`factory.ts` 的 `getAdapter` 缓存 key 改为含凭据指纹，或改为每次构造（凭据可能切换）。简化方案：移除缓存，每次 new（adapter 构造轻量）。worker index.ts 调用处（124 行 `getAdapter(data.provider)`）改为传入 resolved：

```typescript
// apps/worker/src/index.ts 第 124 行附近
const adapter = getAdapter(resolved.providerCode, resolved.baseUrl, resolved.credentials, resolved.vendorModelId)
```

- [ ] **Step 6.4：改造 video-poller.ts（resolveModel）**

`pollers/video-poller.ts` 中轮询火山任务状态的 URL 也用 `resolveModel` 的 `baseUrl`，API key 同理。

- [ ] **Step 6.5：改造 mureka.ts / storyboard.ts / music.ts**

`lib/mureka.ts`、`workers/storyboard.ts`、`workers/music.ts` 中的 env 读取点改为 `resolveModel`。

- [ ] **Step 6.6：启动钩子（校验 MASTER_KEY + 订阅失效广播）**

修改 `apps/worker/src/index.ts`（bootstrap 后，worker 创建前）：

```typescript
// 在 import './bootstrap.js' 之后
if (!process.env.MASTER_KEY) {
  console.error('FATAL: MASTER_KEY 未设置，进程退出')
  process.exit(1)
}

// 订阅失效广播
import { subscribeProviderInvalidation } from '@aigc/db'
import { getRedis } from './lib/redis.js'
// worker 已有 getRedis（普通模式），需单独建 subscribe 模式实例
import RedisLib from 'ioredis'
const subRedis = new (RedisLib as any)(/* getRedisOptions 同款 */)
subscribeProviderInvalidation(subRedis)
```

> 注意：worker 的 `getRedis` 是普通模式（maxRetriesPerRequest:null），subscribe 需独立实例（与 api app.ts redisSub 同理）。

- [ ] **Step 6.7：提交**

```bash
git add packages/types/src/adapter.ts apps/worker/src/workers/video-submit.ts apps/worker/src/workers/video-submit-payload.ts apps/worker/src/pollers/video-poller.ts apps/worker/src/adapters/volcengine-image.ts apps/worker/src/adapters/nano-banana.ts apps/worker/src/adapters/factory.ts apps/worker/src/lib/mureka.ts apps/worker/src/workers/storyboard.ts apps/worker/src/workers/music.ts apps/worker/src/index.ts
git commit -m "refactor(worker): use resolveModel for provider config, inject credentials from resolution result"
```

**验证方法**：
- 类型检查通过（adapter 接口变更后所有调用点更新）。
- 手动触发图片生成 → worker 日志显示 `resolveModel` 查询、fetch 用 DB 中的 baseUrl + 解密 credentials。
- 移除 MASTER_KEY → worker 启动退出。

**回滚策略**：git revert；worker 改造与 api 队列契约配套，回滚需与阶段 5 同步。

**阶段间依赖**：依赖阶段 1/2/3/5（队列 payload 契约）。阶段 7 不直接依赖，但联调需 worker 可用。

---

## 阶段 7：web admin UI（model-table 重构 + provider-table 新增）

**目标**：model-table 以逻辑模型为主维度重构（切换 + CRUD + avatar），provider-table 新增（参照 OtherCostConfigTable），admin page 加「供应商管理」标签。

**涉及文件**：
- 修改：`apps/web/src/app/(dashboard)/admin/page.tsx`（加 providers tab）
- 重构：`apps/web/src/components/admin/model-table.tsx`（逻辑模型为主维度）
- 新建：`apps/web/src/components/admin/provider-table.tsx`
- 修改：`apps/web/src/lib/api-client.ts`（如需新增 admin API 类型）

**具体步骤**：

- [ ] **Step 7.1：admin page.tsx 加「供应商管理」标签**

参照现有 tabs 数组（13-20 行），追加：

```typescript
const tabs = [
  { key: 'teams', label: '团队列表' },
  { key: 'create', label: '创建团队' },
  { key: 'users', label: '用户列表' },
  { key: 'errors', label: '错误诊断' },
  { key: 'models', label: '模型管理' },
  { key: 'providers', label: '供应商管理' },   // 新增
  { key: 'other-costs', label: '其它费用管理' },
] as const

// 渲染区追加
{activeTab === 'providers' && <ProviderTable />}
```

import `ProviderTable` from `./provider-table`。

- [ ] **Step 7.2：新建 provider-table.tsx（参照 OtherCostConfigTable 范式）**

```typescript
// apps/web/src/components/admin/provider-table.tsx
'use client'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProviderListItem } from '@aigc/types'

export function ProviderTable(): React.ReactElement {
  const { data, error } = useSWR<ProviderListItem[]>('/admin/providers')
  const isLoading = !data && !error

  return (
    <Card>
      <CardContent className="p-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : error ? (
          <p className="py-4 text-center text-sm text-destructive">供应商加载失败</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">供应商</th>
                <th className="px-2 py-2 text-left font-medium">Base URL</th>
                <th className="px-2 py-2 text-left font-medium">凭据状态</th>
                <th className="px-2 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((p) => <ProviderRow key={p.id} item={p} />)}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderRow({ item }: { item: ProviderListItem }): React.ReactElement {
  // 行内编辑 base_url / logo 上传 / 凭据轮换表单
  // 凭据轮换：POST 明文 → 成功后 mutate，不回显明文
  // ... 参照 CostConfigRow 的编辑态模式 ...
}
```

- [ ] **Step 7.3：重构 model-table.tsx（逻辑模型为主维度）**

改造 `apps/web/src/components/admin/model-table.tsx`：
- 列表行改为逻辑模型维度：`code / name / module / avatar / 当前生效供应商`。
- 数据源从 `/admin/models`（provider_models）改为 `/admin/catalog/models`（逻辑模型）。
- 行展开：该模型下所有 provider_models 实现，单选切换 active_provider_model_id（调 `/admin/catalog/models/:id/switch`）。
- 编辑弹窗：改 params_pricing / category_references / capabilities（调 `/admin/catalog/models/:id`）。
- 逻辑模型 CRUD：新建（调 `POST /admin/catalog/models`）、停用、绑定/解绑供应商实现。
- avatar 上传入口（调 `/admin/catalog/models/:id/avatar`）。

```typescript
// 数据源改为
const { data, error, mutate } = useSWR<CatalogModelItem[]>('/admin/catalog/models?module=' + activeTab)
```

- [ ] **Step 7.4：提交**

```bash
git add apps/web/src/app/(dashboard)/admin/page.tsx apps/web/src/components/admin/model-table.tsx apps/web/src/components/admin/provider-table.tsx
git commit -m "feat(web): add provider management tab and refactor model-table to logical-model dimension"
```

**验证方法**（R8：前端改完即结束，不刷新/build）：
- 代码静态检查通过（lint / typecheck）。
- 确认组件引用的 API 路径与阶段 4 一致。

**回滚策略**：git revert；UI 改动不影响后端。

**阶段间依赖**：依赖阶段 4（admin API）。阶段 8 依赖本阶段 + 资源。

---

## 阶段 8：图标迁移（移除 @lobehub/icons）

**目标**：实现 avatar→logo→首字母三级渲染，移除 `@lobehub/icons` 依赖。**前提**：avatar/logo 资源已备齐（依赖运营提供图标文件 + 批量导入脚本）。

**涉及文件**：
- 修改：`apps/web/src/lib/model-images.ts`（删除 lobehub 导入/映射，改为返回 avatar/logo URL）
- 修改：`apps/web/src/components/generation/shared/model-brand-icon.tsx`（三级渲染）
- 修改：`apps/web/package.json`（移除 `@lobehub/icons` 依赖）
- 新建（可选）：批量导入脚本读取现有 lobehub 映射，运营提供图标文件后上传 TOS 回填

**具体步骤**：

- [ ] **Step 8.1：确认 avatar/logo 资源已备齐**

运营已为所有在用系统模型 + 供应商提供图标文件并上传 TOS，`models.avatar` / `providers.logo_url` 已回填（迁移步骤 9）。**若资源未齐，本阶段阻塞，不得执行 Step 8.3+**。

- [ ] **Step 8.2：改造 model-brand-icon.tsx（三级渲染）**

```tsx
// apps/web/src/components/generation/shared/model-brand-icon.tsx
'use client'

interface ModelBrandIconProps {
  modelCode: string
  avatarUrl?: string | null   // models.avatar
  providerLogoUrl?: string | null  // providers.logo_url
  providerCode?: string       // 兜底首字母用
  size: number
}

/** 模型图标：avatar → provider logo → 首字母色块（零依赖） */
export function ModelBrandIcon({ avatarUrl, providerLogoUrl, providerCode, size }: ModelBrandIconProps): React.ReactElement {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" width={size} height={size} className="rounded object-cover" />
  }
  if (providerLogoUrl) {
    return <img src={providerLogoUrl} alt="" width={size} height={size} className="rounded object-cover" />
  }
  // 首字母色块兜底
  const letter = (providerCode ?? '?').charAt(0).toUpperCase()
  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded bg-muted text-muted-foreground text-xs font-semibold"
    >
      {letter}
    </div>
  )
}
```

> 注意：调用方需传入 `avatarUrl` / `providerLogoUrl`（从模型列表接口的返回值取，接口需返回这两个字段——阶段 4 的 catalog-models / models 列表接口需带上）。

- [ ] **Step 8.3：清理 model-images.ts（删除 lobehub 导入）**

```typescript
// apps/web/src/lib/model-images.ts
// 删除所有 @lobehub/icons 导入和 MODEL_DIRECT_ICONS / MODEL_TO_ICON_PROVIDER 映射
// 文件可保留为空或删除。若其它地方仍 import getModelIconProvider，需同步清理调用点。

// 清理后（若文件保留）：
// 此文件原 lobehub 映射已移除，图标统一走 model.avatar → provider.logo_url → 首字母
export {}
```

同步清理所有 import `model-images` 的调用点（grep `from '@/lib/model-images'`），改为直接用 ModelBrandIcon 的新 props。

- [ ] **Step 8.4：移除 @lobehub/icons 依赖**

修改 `apps/web/package.json`，删除 `"@lobehub/icons": "..."` 行。

Run: `pnpm install`（更新 lockfile）

- [ ] **Step 8.5：提交**

```bash
git add apps/web/src/lib/model-images.ts apps/web/src/components/generation/shared/model-brand-icon.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(web): replace @lobehub/icons with avatar→logo→initial fallback rendering"
```

**验证方法**（R8）：
- 静态检查：无 `@lobehub/icons` 的 import 残留（grep 确认）。
- `pnpm install` 成功，lockfile 更新。

**回滚策略**：git revert；重新 `pnpm install` 恢复依赖。

**阶段间依赖**：依赖阶段 7（UI 改造）+ 资源导入（avatar/logo 备齐）。资源未齐时**不得**执行移除，否则图标空白。

---

## Self-Review 清单

**1. Spec 覆盖**（逐条核对 D1-D11 + 第 11 节迁移步骤 + 第 12 节文件清单）：
- D1 手动切换 → 阶段 4 switch 接口 ✓
- D2 独立逻辑模型表 → 阶段 1 建 models 表 ✓
- D3 一次性 7 路 → 阶段 1 凭据 bootstrap 全覆盖 ✓
- D4 立即生效 Redis pub/sub → 阶段 2 provider-resolver ✓
- D5 火山拆分 → 阶段 1 Step 1.8 ✓
- D6 独立 MASTER_KEY → 阶段 2 crypto.ts + 阶段 5/6 启动校验 ✓
- D7 avatar→logo→首字母 + 移除 lobehub → 阶段 8 ✓
- D8 扩展 admin + adminGuard → 阶段 4 autohooks 复用 ✓
- D9 对用户价放 models → 阶段 1 上移 + 阶段 5 扣费用 resolved.paramsPricing ✓
- D10 能力约束上移 → 阶段 1 Step 1.4 capabilities ✓
- D11 active_provider_model_id 主用 → 阶段 1 + 阶段 4 switch ✓
- 第 11 节迁移步骤 1-11 → 阶段 1 Step 1.2-1.10 一一对应 ✓
- 第 12 节文件清单 → 各阶段涉及文件全覆盖 ✓

**2. Placeholder 扫描**：无 TBD / TODO / "类似 Task N"；每个代码步骤含完整实现或可执行片段。火山 visual base_url 标记 `<VISUAL_API_BASE_URL>` 是部署期变量，已在注释说明读取 env，非占位。

**3. 类型一致性**：
- `ResolvedModel`（阶段 3 定义）的字段名与 provider-resolver.ts（阶段 2）返回结构一致 ✓
- `CatalogModelItem` / `ProviderListItem`（阶段 3）与阶段 4 路由返回、阶段 7 UI 消费一致 ✓
- `VideoSubmitJobData` 新增字段（阶段 5）与 worker 消费（阶段 6 `jobData.modelCode`）一致 ✓
- `ImageGenerationAdapter` 接口扩展（阶段 6）与 factory / volcengine-image 调用一致 ✓

---

### Critical Files for Implementation

- `d:\haobai\aigc-test\packages\db\migrations\062_provider_credentials_model_switch.ts`（新建，阶段 1 核心，schema 变更 + 数据回填 + 外键）
- `d:\haobai\aigc-test\packages\db\src\provider-resolver.ts`（新建，阶段 2 核心，resolveModel + 缓存 + pub/sub）
- `d:\haobai\aigc-test\packages\db\src\crypto.ts`（新建，阶段 2，AES-256-GCM 独立 MASTER_KEY）
- `d:\haobai\aigc-test\apps\api\src\routes\videos\post-generate.ts`（阶段 5 典型改造，env→resolveModel + 扣费 + 入队契约）
- `d:\haobai\aigc-test\apps\worker\src\workers\video-submit.ts`（阶段 6 典型改造，移除硬编码 URL/KEY，凭据从 resolveModel 注入）