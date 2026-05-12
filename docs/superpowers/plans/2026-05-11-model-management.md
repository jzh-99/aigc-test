# 模型管理功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将图片/视频/数字人/动作模仿的模型配置从硬编码迁移到数据库，新增管理后台模型管理界面和团队级开关。

**Architecture:** 新增 `team_model_configs` 表存储团队级 `is_active` 覆盖；API 新增 `/admin/models`、`/admin/teams/:id/model-configs`、`/models` 三组端点；前端通过共享 `useModels` hook 动态获取，管理后台新增模型管理 tab 和团队模型配置面板。

**Tech Stack:** Kysely（DB 查询）、Fastify 4（API）、Next.js 14 App Router、SWR、Zustand 5、Radix UI、TypeScript ESM

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| 新增 | `packages/db/migrations/031_team_model_configs.ts` |
| 修改 | `packages/db/src/schema.ts` |
| 修改 | `packages/db/scripts/seed-volcengine.ts` |
| 修改 | `packages/types/src/api.ts` |
| 修改 | `apps/api/src/routes/admin.ts` |
| 新增 | `apps/api/src/routes/models.ts` |
| 修改 | `apps/api/src/routes/avatar.ts` |
| 修改 | `apps/api/src/routes/action-imitation.ts` |
| 修改 | `apps/api/src/lib/credits.ts` |
| 修改 | `apps/api/src/routes/videos.ts` |
| 新增 | `apps/web/src/hooks/use-models.ts` |
| 新增 | `apps/web/src/components/admin/model-table.tsx` |
| 新增 | `apps/web/src/components/admin/model-edit-dialog.tsx` |
| 新增 | `apps/web/src/components/admin/team-model-config.tsx` |
| 修改 | `apps/web/src/app/(dashboard)/admin/page.tsx` |
| 修改 | `apps/web/src/components/admin/team-table.tsx` |
| 修改 | `apps/web/src/components/generation/generation-panel.tsx` |
| 修改 | `apps/web/src/hooks/use-generate.ts` |
| 修改 | `apps/web/src/stores/generation-store.ts` |

---

## 阶段一：数据库层

### Task 1: 新增迁移 031_team_model_configs

**Files:**
- 新增: `packages/db/migrations/031_team_model_configs.ts`

- [ ] **Step 1: 新建迁移文件**

```typescript
// packages/db/migrations/031_team_model_configs.ts
import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('team_model_configs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(db.fn('gen_random_uuid', [])))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull().references('provider_models.id').onDelete('cascade'))
    .addColumn('is_active', 'boolean', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .execute()

  await db.schema
    .alterTable('team_model_configs')
    .addUniqueConstraint('uq_team_model_configs_team_model', ['team_id', 'model_id'])
    .execute()

  await db.schema
    .createIndex('idx_team_model_configs_team')
    .on('team_model_configs')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_team_model_configs_team').execute()
  await db.schema.dropTable('team_model_configs').execute()
}
```

- [ ] **Step 2: 执行迁移**

```bash
pnpm db:migrate
```

预期输出：`Migrated: 031_team_model_configs`（无报错）

- [ ] **Step 3: 验证表已创建**

```bash
# 连接数据库确认
docker exec -it aigc-postgres psql -U aigc -d aigc_dev -c "\d team_model_configs"
```

预期：显示 id / team_id / model_id / is_active / created_at / updated_at 六列，以及 uq 约束和索引。

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/031_team_model_configs.ts
git commit -m "feat(db): add team_model_configs migration"
```

---

### Task 2: 更新 schema.ts

**Files:**
- 修改: `packages/db/src/schema.ts`

- [ ] **Step 1: 在 schema.ts 中新增 TeamModelConfigsTable 接口**

在 `ProviderModelsTable` 定义之后（约第 274 行后）插入：

```typescript
export interface TeamModelConfigsTable {
  id: Generated<string>
  team_id: string
  model_id: string
  is_active: boolean
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

- [ ] **Step 2: 在 Database 接口中注册新表**

找到 `Database` 接口（约第 368 行），在 `provider_models: ProviderModelsTable` 行后添加：

```typescript
team_model_configs: TeamModelConfigsTable
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/db build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add TeamModelConfigsTable to schema"
```

---

### Task 3: 补充 seed 数据（数字人 / 动作模仿模型）

**Files:**
- 修改: `packages/db/scripts/seed-volcengine.ts`

- [ ] **Step 1: 在 seed 脚本中找到 provider_models 的 insert 块，追加两条记录**

在现有 `provider_models` insert 循环或批量 insert 之后，追加：

```typescript
// 数字人和动作模仿模型（单模型，不展示选择器）
const singleModels = [
  {
    code: 'jimeng_realman_avatar_picture_omni_v15',
    name: '数字人生成',
    module: 'avatar' as const,
    credit_cost: 0,
    params_pricing: JSON.stringify({}),
    params_schema: JSON.stringify({}),
    is_active: true,
  },
  {
    code: 'jimeng_dreamactor_m20_gen_video',
    name: '动作模仿',
    module: 'action_imitation' as const,
    credit_cost: 0,
    params_pricing: JSON.stringify({}),
    params_schema: JSON.stringify({}),
    is_active: true,
  },
]

for (const m of singleModels) {
  await db
    .insertInto('provider_models')
    .values({ provider_id: provider.id, ...m })
    .onConflict((oc) =>
      oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        is_active: m.is_active,
      })
    )
    .execute()
}
```

> `provider` 变量是 seed 脚本中已有的火山引擎 provider 记录，`credit_cost: 0` 表示这两个模型按秒计费（在路由层单独处理），此处不用全局 credit_cost。

- [ ] **Step 2: 运行 seed**

```bash
pnpm db:seed
```

预期：无报错，输出包含新增两条 provider_models 记录。

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-volcengine.ts
git commit -m "feat(db): seed avatar and action_imitation models"
```

---

## 阶段二：共享类型

### Task 4: 更新 packages/types/src/api.ts

**Files:**
- 修改: `packages/types/src/api.ts`

- [ ] **Step 1: 在 api.ts 末尾追加两个新接口**

```typescript
export interface ModelItem {
  id: string
  code: string
  name: string
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation'
  credit_cost: number
  params_pricing: unknown
  params_schema: unknown
  is_active: boolean
  provider_code: string
}

export interface TeamModelConfig {
  model_id: string
  is_active: boolean
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/types build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/api.ts
git commit -m "feat(types): add ModelItem and TeamModelConfig interfaces"
```

---

## 阶段三：API 层

### Task 5: admin.ts 新增全局模型管理端点

**Files:**
- 修改: `apps/api/src/routes/admin.ts`

- [ ] **Step 1: 在 adminRoutes 函数末尾追加三个端点**

```typescript
// GET /admin/models
app.get<{ Querystring: { module?: string } }>('/admin/models', async (req) => {
  const db = getDb()
  let query = db
    .selectFrom('provider_models as pm')
    .innerJoin('providers as p', 'p.id', 'pm.provider_id')
    .select([
      'pm.id', 'pm.code', 'pm.name', 'pm.module',
      'pm.credit_cost', 'pm.params_pricing', 'pm.params_schema', 'pm.is_active',
      'p.code as provider_code',
    ])
    .orderBy('pm.module', 'asc')
    .orderBy('pm.name', 'asc')

  if (req.query.module) {
    query = query.where('pm.module', '=', req.query.module as any)
  }
  return query.execute()
})

// GET /admin/models/:id
app.get<{ Params: { id: string } }>('/admin/models/:id', async (req, reply) => {
  const db = getDb()
  const model = await db
    .selectFrom('provider_models as pm')
    .innerJoin('providers as p', 'p.id', 'pm.provider_id')
    .select([
      'pm.id', 'pm.code', 'pm.name', 'pm.module',
      'pm.credit_cost', 'pm.params_pricing', 'pm.params_schema', 'pm.is_active',
      'p.code as provider_code',
    ])
    .where('pm.id', '=', req.params.id)
    .executeTakeFirst()

  if (!model) return reply.status(404).send({ error: 'Model not found' })
  return model
})

// PATCH /admin/models/:id
app.patch<{
  Params: { id: string }
  Body: { name?: string; credit_cost?: number; params_pricing?: unknown; params_schema?: unknown; is_active?: boolean }
}>('/admin/models/:id', async (req, reply) => {
  const db = getDb()
  const { name, credit_cost, params_pricing, params_schema, is_active } = req.body
  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (credit_cost !== undefined) updates.credit_cost = credit_cost
  if (params_pricing !== undefined) updates.params_pricing = JSON.stringify(params_pricing)
  if (params_schema !== undefined) updates.params_schema = JSON.stringify(params_schema)
  if (is_active !== undefined) updates.is_active = is_active

  if (Object.keys(updates).length === 0) return reply.status(400).send({ error: 'No fields to update' })

  const updated = await db
    .updateTable('provider_models')
    .set(updates as any)
    .where('id', '=', req.params.id)
    .returningAll()
    .executeTakeFirst()

  if (!updated) return reply.status(404).send({ error: 'Model not found' })
  return updated
})
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/admin.ts
git commit -m "feat(api): add global model management admin endpoints"
```

---

### Task 6: admin.ts 新增团队模型配置端点

**Files:**
- 修改: `apps/api/src/routes/admin.ts`

- [ ] **Step 1: 在 Task 5 代码之后继续追加三个端点**

```typescript
// GET /admin/teams/:id/model-configs
app.get<{ Params: { id: string } }>('/admin/teams/:id/model-configs', async (req) => {
  const db = getDb()
  const rows = await db
    .selectFrom('provider_models as pm')
    .innerJoin('providers as p', 'p.id', 'pm.provider_id')
    .leftJoin('team_model_configs as tmc', (join) =>
      join.onRef('tmc.model_id', '=', 'pm.id').on('tmc.team_id', '=', req.params.id)
    )
    .select([
      'pm.id', 'pm.code', 'pm.name', 'pm.module',
      'pm.credit_cost', 'pm.is_active as global_is_active',
      'p.code as provider_code',
      'tmc.is_active as team_is_active',
    ])
    .orderBy('pm.module', 'asc')
    .orderBy('pm.name', 'asc')
    .execute()

  return rows.map((r) => ({
    ...r,
    effective_is_active: r.team_is_active !== null ? r.team_is_active : r.global_is_active,
    has_override: r.team_is_active !== null,
  }))
})

// PUT /admin/teams/:id/model-configs/:modelId
app.put<{
  Params: { id: string; modelId: string }
  Body: { is_active: boolean }
}>('/admin/teams/:id/model-configs/:modelId', async (req) => {
  const db = getDb()
  await db
    .insertInto('team_model_configs')
    .values({ team_id: req.params.id, model_id: req.params.modelId, is_active: req.body.is_active })
    .onConflict((oc) =>
      oc.columns(['team_id', 'model_id']).doUpdateSet({ is_active: req.body.is_active })
    )
    .execute()
  return { ok: true }
})

// DELETE /admin/teams/:id/model-configs/:modelId
app.delete<{ Params: { id: string; modelId: string } }>(
  '/admin/teams/:id/model-configs/:modelId',
  async (req) => {
    const db = getDb()
    await db
      .deleteFrom('team_model_configs')
      .where('team_id', '=', req.params.id)
      .where('model_id', '=', req.params.modelId)
      .execute()
    return { ok: true }
  }
)
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/admin.ts
git commit -m "feat(api): add team model config admin endpoints"
```

---

### Task 7: 新增 models.ts 路由（前端动态获取）

**Files:**
- 新增: `apps/api/src/routes/models.ts`
- 修改: `apps/api/src/app.ts`（注册路由）

- [ ] **Step 1: 创建路由文件**

```typescript
// apps/api/src/routes/models.ts
import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { authGuard } from '../plugins/guards.js'

export async function modelsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authGuard())

  app.get<{ Querystring: { module?: string } }>('/models', async (req) => {
    const db = getDb()
    const teamId = (req.user as any).team_id as string

    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .leftJoin('team_model_configs as tmc', (join) =>
        join.onRef('tmc.model_id', '=', 'pm.id').on('tmc.team_id', '=', teamId)
      )
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.module',
        'pm.credit_cost', 'pm.params_pricing', 'pm.params_schema',
        'p.code as provider_code',
        db.fn('coalesce', ['tmc.is_active', 'pm.is_active']).as('is_active'),
      ])
      .where(db.fn('coalesce', ['tmc.is_active', 'pm.is_active']), '=', true)
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as any)
    }

    return query.execute()
  })
}
```

- [ ] **Step 2: 在 app.ts 中注册路由**

找到其他路由注册的位置（如 `app.register(adminRoutes)`），在同一位置添加：

```typescript
import { modelsRoutes } from './routes/models.js'
// ...
app.register(modelsRoutes)
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/models.ts apps/api/src/app.ts
git commit -m "feat(api): add GET /models endpoint for frontend dynamic model list"
```

---

### Task 8: avatar.ts 改为从 DB 动态读取模型 code

**Files:**
- 修改: `apps/api/src/routes/avatar.ts`

- [ ] **Step 1: 删除顶部硬编码常量，改为运行时查询**

删除（约第 27-29 行）：
```typescript
const OMNI_REQ_KEY = 'jimeng_realman_avatar_picture_omni_v15'
```

在路由 handler 内部，在使用 `OMNI_REQ_KEY` 之前添加查询：

```typescript
const db = getDb()
const avatarModel = await db
  .selectFrom('provider_models')
  .select(['code'])
  .where('module', '=', 'avatar')
  .where('is_active', '=', true)
  .orderBy('created_at', 'asc')
  .executeTakeFirst()

if (!avatarModel) {
  return reply.status(503).send({ error: 'No active avatar model configured' })
}
const OMNI_REQ_KEY = avatarModel.code
```

> `OMNI_API_VERSION` 和 `CREDITS_PER_SECOND` 保持不变，它们是 API 版本和计费参数，不属于模型配置。

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/avatar.ts
git commit -m "feat(api): avatar route reads model code from DB"
```

---

### Task 9: action-imitation.ts 改为从 DB 动态读取模型 code

**Files:**
- 修改: `apps/api/src/routes/action-imitation.ts`

- [ ] **Step 1: 删除顶部硬编码常量，改为运行时查询**

删除（约第 22-24 行）：
```typescript
const ACTION_REQ_KEY = 'jimeng_dreamactor_m20_gen_video'
```

在路由 handler 内部，在使用 `ACTION_REQ_KEY` 之前添加查询：

```typescript
const db = getDb()
const actionModel = await db
  .selectFrom('provider_models')
  .select(['code'])
  .where('module', '=', 'action_imitation')
  .where('is_active', '=', true)
  .orderBy('created_at', 'asc')
  .executeTakeFirst()

if (!actionModel) {
  return reply.status(503).send({ error: 'No active action imitation model configured' })
}
const ACTION_REQ_KEY = actionModel.code
```

> `ACTION_API_VERSION` 和 `CREDITS_PER_SECOND` 保持不变。

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/action-imitation.ts
git commit -m "feat(api): action-imitation route reads model code from DB"
```

---

### Task 10: videos.ts 积分改为从 DB 读取 credit_cost

**Files:**
- 修改: `apps/api/src/routes/videos.ts`
- 修改: `apps/api/src/lib/credits.ts`

背景：`videos.ts` 通过 `VIDEO_CREDITS_MAP`（定义在 `lib/credits.ts`）查找每个模型的积分，同时有本地 `VOLCENGINE_MODEL_ID` 映射。本期改为从 `provider_models.credit_cost` 读取，`VOLCENGINE_MODEL_ID` 映射保留（它是 API 调用参数，不是积分配置）。

- [ ] **Step 1: 在 videos.ts 中找到积分计算逻辑，改为查询 DB**

找到使用 `VIDEO_CREDITS_MAP[modelCode]` 的位置，替换为：

```typescript
// 从 DB 读取模型积分配置
const db = getDb()
const modelRecord = await db
  .selectFrom('provider_models')
  .select(['credit_cost', 'params_pricing'])
  .where('code', '=', modelCode)
  .where('is_active', '=', true)
  .executeTakeFirst()

if (!modelRecord) {
  return reply.status(400).send({ error: `Unknown or inactive model: ${modelCode}` })
}
// 使用 modelRecord.credit_cost 替代原来的 VIDEO_CREDITS_MAP[modelCode]
```

> `params_pricing` 字段预留给未来按秒计费的参数，本期只用 `credit_cost`。

- [ ] **Step 2: 移除 videos.ts 中对 VIDEO_CREDITS_MAP 的导入**

删除：
```typescript
import { VIDEO_CREDITS_MAP } from '../lib/credits.js'
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/api build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/videos.ts
git commit -m "feat(api): video credits read from DB provider_models.credit_cost"
```

---

## 阶段四：前端层

### Task 11: 新增 use-models.ts hook

**Files:**
- 新增: `apps/web/src/hooks/use-models.ts`

- [ ] **Step 1: 创建 hook 文件**

```typescript
// apps/web/src/hooks/use-models.ts
import useSWR from 'swr'
import type { ModelItem } from '@aigc/types'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useModels(module: ModelItem['module']) {
  const { data, error, isLoading } = useSWR<ModelItem[]>(
    `/api/models?module=${module}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  return {
    models: data ?? [],
    isLoading,
    isError: !!error,
  }
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-models.ts
git commit -m "feat(web): add useModels hook for dynamic model list"
```

---

### Task 12: 新增 model-table.tsx（管理后台全局模型列表）

**Files:**
- 新增: `apps/web/src/components/admin/model-table.tsx`

- [ ] **Step 1: 创建组件文件**

```typescript
// apps/web/src/components/admin/model-table.tsx
'use client'
import { useState } from 'react'
import useSWR from 'swr'
import type { ModelItem } from '@aigc/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { ModelEditDialog } from './model-edit-dialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const MODULE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  tts: 'TTS',
  lipsync: '口型同步',
  agent: 'Agent',
  avatar: '数字人',
  action_imitation: '动作模仿',
}

export function ModelTable(): React.ReactElement {
  const { data: models = [], mutate } = useSWR<ModelItem[]>('/api/admin/models', fetcher)
  const [editTarget, setEditTarget] = useState<ModelItem | null>(null)

  const modules = [...new Set(models.map((m) => m.module))].sort()

  return (
    <>
      <Tabs defaultValue={modules[0] ?? 'image'}>
        <TabsList>
          {modules.map((mod) => (
            <TabsTrigger key={mod} value={mod}>
              {MODULE_LABELS[mod] ?? mod}
            </TabsTrigger>
          ))}
        </TabsList>
        {modules.map((mod) => (
          <TabsContent key={mod} value={mod}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>积分</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models
                  .filter((m) => m.module === mod)
                  .map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.name}</TableCell>
                      <TableCell className="font-mono text-xs">{m.code}</TableCell>
                      <TableCell>{m.credit_cost}</TableCell>
                      <TableCell>
                        <Badge variant={m.is_active ? 'default' : 'secondary'}>
                          {m.is_active ? '启用' : '禁用'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => setEditTarget(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TabsContent>
        ))}
      </Tabs>
      {editTarget && (
        <ModelEditDialog
          model={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { mutate(); setEditTarget(null) }}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/model-table.tsx
git commit -m "feat(web): add ModelTable admin component"
```

---

### Task 13: 新增 model-edit-dialog.tsx

**Files:**
- 新增: `apps/web/src/components/admin/model-edit-dialog.tsx`

- [ ] **Step 1: 创建组件文件**

```typescript
// apps/web/src/components/admin/model-edit-dialog.tsx
'use client'
import { useState } from 'react'
import type { ModelItem } from '@aigc/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface Props {
  model: ModelItem
  onClose: () => void
  onSaved: () => void
}

export function ModelEditDialog({ model, onClose, onSaved }: Props): React.ReactElement {
  const [name, setName] = useState(model.name)
  const [creditCost, setCreditCost] = useState(model.credit_cost)
  const [isActive, setIsActive] = useState(model.is_active)
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      await fetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, credit_cost: creditCost, is_active: isActive }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑模型：{model.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>积分消耗</Label>
            <Input
              type="number"
              value={creditCost}
              onChange={(e) => setCreditCost(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>全局启用</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/model-edit-dialog.tsx
git commit -m "feat(web): add ModelEditDialog admin component"
```

---

### Task 14: 新增 team-model-config.tsx（团队模型开关面板）

**Files:**
- 新增: `apps/web/src/components/admin/team-model-config.tsx`

- [ ] **Step 1: 创建组件文件**

```typescript
// apps/web/src/components/admin/team-model-config.tsx
'use client'
import useSWR from 'swr'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'

interface ModelConfigRow {
  id: string
  code: string
  name: string
  module: string
  global_is_active: boolean
  team_is_active: boolean | null
  effective_is_active: boolean
  has_override: boolean
}

const MODULE_LABELS: Record<string, string> = {
  image: '图片', video: '视频', tts: 'TTS',
  lipsync: '口型同步', agent: 'Agent', avatar: '数字人', action_imitation: '动作模仿',
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Props { teamId: string }

export function TeamModelConfig({ teamId }: Props): React.ReactElement {
  const { data: rows = [], mutate } = useSWR<ModelConfigRow[]>(
    `/api/admin/teams/${teamId}/model-configs`,
    fetcher
  )

  async function setOverride(modelId: string, isActive: boolean): Promise<void> {
    await fetch(`/api/admin/teams/${teamId}/model-configs/${modelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive }),
    })
    mutate()
  }

  async function resetOverride(modelId: string): Promise<void> {
    await fetch(`/api/admin/teams/${teamId}/model-configs/${modelId}`, { method: 'DELETE' })
    mutate()
  }

  const modules = [...new Set(rows.map((r) => r.module))].sort()

  return (
    <div className="space-y-6">
      {modules.map((mod) => (
        <div key={mod}>
          <h4 className="mb-2 font-medium">{MODULE_LABELS[mod] ?? mod}</h4>
          <div className="space-y-2">
            {rows
              .filter((r) => r.module === mod)
              .map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded border p-2">
                  <Switch
                    checked={r.effective_is_active}
                    onCheckedChange={(v) => setOverride(r.id, v)}
                  />
                  <span className="flex-1 text-sm">{r.name}</span>
                  {r.has_override && (
                    <Badge variant="outline" className="text-xs">已覆盖</Badge>
                  )}
                  {r.has_override && (
                    <Button variant="ghost" size="icon" onClick={() => resetOverride(r.id)}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/team-model-config.tsx
git commit -m "feat(web): add TeamModelConfig admin component"
```

---

### Task 15: 更新 admin/page.tsx（新增模型管理 tab）

**Files:**
- 修改: `apps/web/src/app/(dashboard)/admin/page.tsx`

- [ ] **Step 1: 在 tabs 数组中新增模型管理项**

找到（约第 11-16 行）：
```typescript
const tabs = [
  { key: 'teams',  label: '团队列表' },
  { key: 'create', label: '创建团队' },
  { key: 'users',  label: '用户列表' },
  { key: 'errors', label: '错误诊断' },
] as const
```

替换为：
```typescript
const tabs = [
  { key: 'teams',  label: '团队列表' },
  { key: 'create', label: '创建团队' },
  { key: 'users',  label: '用户列表' },
  { key: 'models', label: '模型管理' },
  { key: 'errors', label: '错误诊断' },
] as const
```

- [ ] **Step 2: 在条件渲染区域新增模型管理 tab 内容**

找到类似 `{activeTab === 'errors' && <ErrorDiagnostics />}` 的位置，在其前面添加：

```typescript
import { ModelTable } from '@/components/admin/model-table'
// ...
{activeTab === 'models' && <ModelTable />}
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/admin/page.tsx
git commit -m "feat(web): add models tab to admin page"
```

---

### Task 16: 更新 team-table.tsx（新增模型配置入口）

**Files:**
- 修改: `apps/web/src/components/admin/team-table.tsx`

- [ ] **Step 1: 在团队行操作区域新增"模型配置"按钮**

找到团队行操作按钮区域（约第 199-236 行），在现有按钮后追加：

```typescript
import { Settings2 } from 'lucide-react'
import { TeamModelConfig } from './team-model-config'
// ...

// 在 state 中新增
const [modelConfigTeamId, setModelConfigTeamId] = useState<string | null>(null)

// 在操作列中新增按钮
<Button variant="ghost" size="sm" onClick={() => setModelConfigTeamId(team.id)}>
  <Settings2 className="mr-1 h-4 w-4" />
  模型配置
</Button>

// 在组件末尾新增 Dialog
{modelConfigTeamId && (
  <Dialog open onOpenChange={() => setModelConfigTeamId(null)}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>团队模型配置</DialogTitle>
      </DialogHeader>
      <TeamModelConfig teamId={modelConfigTeamId} />
    </DialogContent>
  </Dialog>
)}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/team-table.tsx
git commit -m "feat(web): add model config entry to team table"
```

---

### Task 17: 更新 generation-panel.tsx（动态获取图片/视频模型）

**Files:**
- 修改: `apps/web/src/components/generation/generation-panel.tsx`

背景：当前 `MODEL_OPTIONS` 是静态数组，`credits` 从 `@/lib/credits` 的 `IMAGE_MODEL_CREDITS` 读取。改为从 `useModels('image')` 动态获取。

- [ ] **Step 1: 删除静态 MODEL_OPTIONS 数组，改为动态数据**

删除文件顶部的 `MODEL_OPTIONS` 数组定义（约第 58-80 行）。

在组件函数内部添加：

```typescript
import { useModels } from '@/hooks/use-models'
// ...

const { models: imageModels, isLoading: modelsLoading } = useModels('image')
```

- [ ] **Step 2: 将模型选择器的数据源改为 imageModels**

找到渲染模型选择器的 JSX，将原来遍历 `MODEL_OPTIONS` 的地方改为遍历 `imageModels`：

```typescript
// 原来
MODEL_OPTIONS.map((opt) => ...)

// 改为
imageModels.map((m) => ({
  value: m.code,
  label: m.name,
  credits: m.credit_cost,
}))
```

在加载时显示骨架：
```typescript
if (modelsLoading) return <div className="h-10 animate-pulse rounded bg-muted" />
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/generation/generation-panel.tsx
git commit -m "feat(web): generation panel uses dynamic model list"
```

---

### Task 18: 更新 use-generate.ts 和 generation-store.ts（移除硬编码映射）

**Files:**
- 修改: `apps/web/src/hooks/use-generate.ts`
- 修改: `apps/web/src/stores/generation-store.ts`

背景：`MODEL_CODE_MAP` 将 UI 的 `modelType` 映射到 API `code`；`MODEL_REVERSE_MAP` 反向映射用于从历史 batch 还原 UI 状态。动态化后，`code` 直接就是 UI 选择器的 value，不再需要两层映射。

- [ ] **Step 1: 更新 use-generate.ts**

删除 `MODEL_CODE_MAP`（约第 10-37 行）。

找到使用 `MODEL_CODE_MAP[modelType][resolution]` 获取 `code` 的位置，改为直接使用 `modelType`（此时 `modelType` 存的就是 `code`）：

```typescript
// 原来
const modelCode = MODEL_CODE_MAP[modelType]?.[resolution]

// 改为
const modelCode = modelType  // modelType 现在直接存 API code
```

- [ ] **Step 2: 更新 generation-store.ts**

删除 `MODEL_REVERSE_MAP`（约第 12-23 行）。

找到 `applyBatch` 方法中使用 `MODEL_REVERSE_MAP[model]` 的位置，改为：

```typescript
// 原来
const mapped = MODEL_REVERSE_MAP[batch.model]
if (mapped) { set({ modelType: mapped.modelType, resolution: mapped.resolution }) }

// 改为（code 直接作为 modelType，resolution 从 batch 参数读取或保持默认）
if (batch.model) { set({ modelType: batch.model }) }
```

更新 `modelType` 的类型联合，从硬编码的字符串联合改为 `string`：

```typescript
// 原来
modelType: 'gemini' | 'gpt-image-2' | 'nano-banana-pro' | ...

// 改为
modelType: string
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-generate.ts apps/web/src/stores/generation-store.ts
git commit -m "feat(web): remove hardcoded model maps, use API code directly"
```

---

### Task 19: 更新 video-studio 相关页面（动态获取模型）

**Files:**
- 修改: `apps/web/src/components/video-studio/step-video.tsx`
- 修改: `apps/web/src/components/video-studio/step-characters.tsx`

- [ ] **Step 1: 更新 step-video.tsx**

找到视频模型选择器的静态数据源，改为动态获取：

```typescript
import { useModels } from '@/hooks/use-models'
// ...

const { models: videoModels, isLoading } = useModels('video')

// 将原来的静态模型数组替换为 videoModels
// 加载时显示骨架
if (isLoading) return <div className="h-10 animate-pulse rounded bg-muted" />
```

- [ ] **Step 2: 更新 step-characters.tsx**

找到图片模型选择器的静态数据源，改为动态获取：

```typescript
import { useModels } from '@/hooks/use-models'
// ...

const { models: imageModels, isLoading } = useModels('image')

// 将原来的静态模型数组替换为 imageModels
if (isLoading) return <div className="h-10 animate-pulse rounded bg-muted" />
```

- [ ] **Step 3: 构建验证**

```bash
pnpm --filter @aigc/web build
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/video-studio/step-video.tsx apps/web/src/components/video-studio/step-characters.tsx
git commit -m "feat(web): video-studio steps use dynamic model list"
```

---

## 自检清单

### Spec 覆盖检查

| 需求 | 对应 Task |
|------|-----------|
| 管理后台新增模型管理，admin 可查询和修改全局模型配置 | Task 5, 12, 13, 15 |
| 管理后台团队列表中，admin 可为每个团队单独开启/关闭各模型 | Task 6, 14, 16 |
| 前端各功能页面改为动态获取模型列表，不再硬编码 | Task 7, 11, 17, 18, 19 |
| 数字人/动作模仿 API 路由改为从 DB 动态读取模型 code | Task 3, 8, 9 |
| 视频生成积分改为从 DB 读取 credit_cost | Task 10 |
| 新增 team_model_configs 表 | Task 1, 2 |
| 数字人/动作模仿模型入库 | Task 3 |
| 共享类型 ModelItem / TeamModelConfig | Task 4 |

所有需求均有对应 Task，无遗漏。

### 类型一致性检查

- `ModelItem.module` 联合类型在 Task 4 定义，Task 12/14 使用 `MODULE_LABELS` 映射，键与联合类型一致。
- `useModels(module)` 参数类型为 `ModelItem['module']`，调用处 `'image'`/`'video'` 均在联合类型内。
- `generation-store.ts` 中 `modelType` 改为 `string` 后，`use-generate.ts` 直接赋值 `modelCode = modelType` 类型兼容。
