# provider_models.avatar + 移除 @lobehub/icons 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `provider_models` 表新增 `avatar` 字段，模型图标改为从数据库读取自托管图片，并移除 `@lobehub/icons` 依赖。

**Architecture:** DB 加字段 → 打通 `DB → API（签名）→ types → 前端组件` 链路 → seed 填充 image/video 模块 avatar → admin 可编辑 → 移除 lobehub。avatar 存完整 TOS 公网 URL（方案 A），seed 用 `TOS_PUBLIC_URL` 动态拼接适配 dev/prod。

**Tech Stack:** Kysely（迁移/schema）、Fastify（API）、Next.js 14 + React 18（前端）、TOS 对象存储（signAssetUrl 签名）。

**验证约束（来自 CLAUDE.md）：** 本项目为 L2 任务，TDD 可选。前端改动完成后即结束，**不执行构建、浏览器刷新、重启 localhost:6006**。DB/API 改动用 `pnpm db:migrate` 与 lint 验证；前端用代码审查 + lint 验证。

---

## 文件结构

**Create:**
- `packages/db/migrations/062_provider_models_avatar.ts` — 加 avatar 列的迁移

**Modify:**
- `packages/db/src/schema.ts` — `ProviderModelsTable` 加 avatar
- `packages/types/src/api.ts` — `ModelItem` 加 avatar
- `apps/api/src/routes/models/get.ts` — `/models` select avatar + signAssetUrl 签名
- `apps/api/src/routes/admin/get-models.ts` — `/admin/models` select avatar（原始 URL）
- `apps/api/src/routes/admin/patch-models-id.ts` — PATCH body 加 avatar
- `packages/db/scripts/seed.ts` — image/video 模块填充 avatar
- `apps/web/src/components/generation/shared/model-brand-icon.tsx` — 改为 avatar 渲染 + 占位兜底
- `apps/web/src/components/generation/image/image-panel.tsx` — 调用改传 avatar
- `apps/web/src/components/generation/video/video-panel.tsx` — 调用改传 avatar
- `apps/web/src/components/admin/model-edit-dialog.tsx` — 编辑弹窗加 avatar
- `apps/web/package.json` — 移除 `@lobehub/icons`

**Delete:**
- `apps/web/src/lib/model-images.ts` — 重写 model-brand-icon 后无引用

---

## Task 1: DB 迁移 + schema 类型

**Files:**
- Create: `packages/db/migrations/062_provider_models_avatar.ts`
- Modify: `packages/db/src/schema.ts:283-304`

- [ ] **Step 1: 创建迁移文件**

写入 `packages/db/migrations/062_provider_models_avatar.ts`：

```ts
import { type Kysely, sql } from 'kysely'

/**
 * provider_models 增加 avatar 字段
 *
 * 模型图标改为从数据库读取自托管图片 URL，替代 @lobehub/icons。
 * avatar 存完整 TOS 公网存储 URL，API 用 signAssetUrl 签名后返回前端。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models ADD COLUMN avatar TEXT
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models DROP COLUMN avatar
  `.execute(db)
}
```

- [ ] **Step 2: 修改 schema.ts ProviderModelsTable**

在 `packages/db/src/schema.ts` 的 `ProviderModelsTable` 接口中，`resolution: string | null` 之后、`is_active` 之前新增一行：

```ts
export interface ProviderModelsTable {
  id: Generated<string>
  provider_id: string
  code: string
  name: string
  description: string | null
  module:
    | 'image'
    | 'video'
    | 'tts'
    | 'lipsync'
    | 'agent'
    | 'avatar'
    | 'action_imitation'
    | 'music'
    | 'music_voice_clone'
  category_references: ColumnType<unknown, string, string> | null
  params_pricing: ColumnType<unknown, string, string>
  params_schema: ColumnType<unknown, string, string>
  resolution: string | null
  avatar: string | null
  is_active: Generated<boolean>
}
```

- [ ] **Step 3: 执行迁移验证**

Run: `pnpm db:migrate`
Expected: 控制台输出 `062_provider_models_avatar` 迁移成功，无报错。

- [ ] **Step 4: 提交**

```bash
git add packages/db/migrations/062_provider_models_avatar.ts packages/db/src/schema.ts
git commit -m "feat(db): provider_models 增加 avatar 字段"
```

---

## Task 2: types ModelItem 加 avatar

**Files:**
- Modify: `packages/types/src/api.ts:356-368`

- [ ] **Step 1: 修改 ModelItem 接口**

在 `packages/types/src/api.ts` 的 `ModelItem` 中，`provider_code: string` 之后新增 `avatar: string | null`：

```ts
export interface ModelItem {
  id: string
  code: string
  name: string
  description: string | null
  module: AigcModule
  category_references: CategoryReferences | unknown
  params_pricing: ParamsPricingRule[]
  params_schema: unknown
  resolution: string | null
  is_active: boolean
  provider_code: string
  avatar: string | null
}
```

- [ ] **Step 2: 构建类型包（下游应用依赖）**

Run: `pnpm --filter @aigc/types build`
Expected: 构建成功，`packages/types/dist/` 更新。

- [ ] **Step 3: 提交**

```bash
git add packages/types/src/api.ts
git commit -m "feat(types): ModelItem 增加 avatar 字段"
```

---

## Task 3: API /models 返回签名 avatar

**Files:**
- Modify: `apps/api/src/routes/models/get.ts:61-96`

> 说明：`signAssetUrl` 已在该文件 import（`import { signAssetUrl, uploadToTos } from '../../lib/storage.js'`）。`normalizeModelJsonFields` 用 `{ ...model }` 展开，会自动透传 avatar。

- [ ] **Step 1: select 增加 avatar 字段**

在 `apps/api/src/routes/models/get.ts` 的 `.select([...])` 数组中，`'pm.resolution',` 之后新增 `'pm.avatar',`：

```ts
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.category_references', 'pm.params_pricing',
        'pm.params_schema', 'pm.resolution', 'pm.avatar',
        'p.code as provider_code',
        'pm.is_active as global_is_active', 'tmc.is_active as team_is_active',
      ])
```

- [ ] **Step 2: 响应 map 改为异步并签名 avatar**

将 `return rows.filter(...).map(...)` 同步链改为 `Promise.all` 异步 map，map 内对 avatar 调用 `signAssetUrl`：

```ts
    const rows = await query.execute()

    // 团队配置优先于全局配置：team_is_active 不为 null 时以团队配置为准
    const filtered = rows.filter((r) => {
      const effective = r.team_is_active !== null ? r.team_is_active : r.global_is_active
      return effective
    })

    return Promise.all(
      filtered.map(async (r) =>
        normalizeModelJsonFields({
          id: r.id, code: r.code, name: r.name, description: r.description,
          module: r.module, category_references: r.category_references,
          params_pricing: r.params_pricing,
          params_schema: r.params_schema, resolution: r.resolution,
          is_active: true, provider_code: r.provider_code,
          avatar: await signAssetUrl(r.avatar),
        }),
      ),
    )
```

- [ ] **Step 3: lint 验证**

Run: `pnpm --filter @aigc/api lint`
Expected: 无新增错误。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/models/get.ts
git commit -m "feat(api): /models 返回签名后的 avatar"
```

---

## Task 4: API admin 路由支持 avatar

**Files:**
- Modify: `apps/api/src/routes/admin/get-models.ts:9-26`
- Modify: `apps/api/src/routes/admin/patch-models-id.ts:6-38`

> 说明：`/admin/models` 返回**原始**存储 URL（不签名），用于编辑回显。`normalizeModelJsonFields` 自动透传 avatar。

- [ ] **Step 1: get-models select 增加 avatar**

在 `apps/api/src/routes/admin/get-models.ts` 的 `.select([...])` 中，`'pm.resolution', 'pm.is_active',` 之后新增 `'pm.avatar',`：

```ts
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.category_references',
        'pm.params_pricing', 'pm.params_schema', 'pm.resolution', 'pm.is_active',
        'pm.avatar',
        'p.code as provider_code',
      ])
```

- [ ] **Step 2: patch-models-id Body 增加 avatar**

修改 `apps/api/src/routes/admin/patch-models-id.ts`，Body 类型新增 `avatar?: string | null`，并加入 updates 逻辑：

```ts
  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string | null
      params_pricing?: unknown
      params_schema?: unknown
      resolution?: string | null
      avatar?: string | null
      is_active?: boolean
    }
  }>('/admin/models/:id', async (req, reply) => {
    const db = getDb()
    const { name, description, params_pricing, params_schema, resolution, avatar, is_active } = req.body
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (params_pricing !== undefined) updates.params_pricing = JSON.stringify(params_pricing)
    if (params_schema !== undefined) updates.params_schema = JSON.stringify(params_schema)
    if (resolution !== undefined) updates.resolution = resolution
    if (avatar !== undefined) updates.avatar = avatar
    if (is_active !== undefined) updates.is_active = is_active
```

（后续 `returningAll()` 会返回包含 avatar 的完整记录，无需额外改动。）

- [ ] **Step 3: lint 验证**

Run: `pnpm --filter @aigc/api lint`
Expected: 无新增错误。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/admin/get-models.ts apps/api/src/routes/admin/patch-models-id.ts
git commit -m "feat(api): admin 模型路由支持 avatar 读取与编辑"
```

---

## Task 5: seed 填充 image/video 模块 avatar

**Files:**
- Modify: `packages/db/scripts/seed.ts`（顶部常量 + image 块 487-573 + video 块 800-880）

> avatar 映射：gemini/nano-banana → nanoBanana.png；gpt-image-2 → openai.png；seedance 系 → volcengine.png。其余模型不填（走占位图标）。

- [ ] **Step 1: 顶部新增 avatar 拼接辅助**

在 `packages/db/scripts/seed.ts` 顶部 import 语句之后（第一个变量定义之前）新增：

```ts
// 模型 avatar 图标：拼接 TOS 公网域名，未配置 TOS_PUBLIC_URL 时返回 null（走占位图标）
const TOS_PUBLIC_URL = process.env.TOS_PUBLIC_URL ?? ''
const llmAvatar = (icon: string): string | null =>
  TOS_PUBLIC_URL ? `${TOS_PUBLIC_URL}/assets/llm/${icon}.png` : null
```

- [ ] **Step 2: image 块 model 对象加 avatar**

在 `imageModels` 数组（约 line 487-540）的每个对象末尾加 `avatar` 字段：

```ts
  const imageModels = [
    {
      code: 'gemini-3.1-flash-image-preview',
      name: '全能图片2',
      description: '快速生成，适合日常使用',
      params_pricing: [
        { resolution: '1k', model: 'gemini-3.1-flash-image-preview', unit_price: 1 },
        { resolution: '2k', model: 'gemini-3.1-flash-image-preview-2k', unit_price: 1 },
        { resolution: '4k', model: 'gemini-3.1-flash-image-preview-4k', unit_price: 1 },
      ],
      params_schema: {
        resolution: ['1k', '2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
      avatar: llmAvatar('nanoBanana'),
    },
    {
      code: 'gpt-image-2',
      name: '超能图片2',
      description: '文字渲染准确，UI截图逼真，照片级真实感',
      params_pricing: [
        { resolution: '2k', model: 'gpt-image-2', unit_price: 2 },
      ],
      params_schema: {
        resolution: ['2k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
      avatar: llmAvatar('openai'),
    },
    {
      code: 'nano-banana-2',
      name: '全能图片Pro',
      description: '高质量输出，细节丰富',
      params_pricing: [
        { resolution: '1k', model: 'nano-banana-2', unit_price: 4 },
        { resolution: '2k', model: 'nano-banana-2-2k', unit_price: 4 },
        { resolution: '4k', model: 'nano-banana-2-4k', unit_price: 4 },
      ],
      params_schema: {
        resolution: ['1k', '2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
      avatar: llmAvatar('nanoBanana'),
    },
  ]
```

- [ ] **Step 3: image 块 insert 加 avatar**

在 imageModels 的 insert（约 line 548-572）的 `.values({...})` 与 `.onConflict(...).doUpdateSet({...})` 中各加一行 `avatar: m.avatar,`：

```ts
  for (const m of imageModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        params_pricing: JSON.stringify((m.params_pricing ?? [])),
        params_schema: JSON.stringify(m.params_schema),
        avatar: m.avatar,
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        params_pricing: JSON.stringify(m.params_pricing ?? []),
        params_schema: JSON.stringify(m.params_schema),
        avatar: m.avatar,
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }
```

- [ ] **Step 4: video 块 model 对象加 avatar**

在 `volcVideoModels` 数组（约 line 800-854）的每个对象末尾加 `avatar: llmAvatar('volcengine'),`：

```ts
  const volcVideoModels = [
    {
      code: 'seedance-1.5-pro',
      name: 'Seedance 1.5 Pro',
      description: '有声视频生成，支持首尾帧',
      category_references: FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-1.5-pro', unit_price: 5 },
        { resolution: '720p', model: 'seedance-1.5-pro', unit_price: 10 },
        { resolution: '1080p', model: 'seedance-1.5-pro', unit_price: 20 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
      avatar: llmAvatar('volcengine'),
    },
    {
      code: 'seedance-2.0',
      name: 'Seedance 2.0',
      description: '全能王者，音视文图均可参考',
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0', unit_price: 7 },
        { resolution: '720p', model: 'seedance-2.0', unit_price: 15 },
        { resolution: '1080p', model: 'seedance-2.0', unit_price: 35 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
      avatar: llmAvatar('volcengine'),
    },
    {
      code: 'seedance-2.0-fast',
      name: 'Seedance 2.0 Fast',
      description: '高性价比，音视文图均可参考',
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0-fast', unit_price: 5 },
        { resolution: '720p', model: 'seedance-2.0-fast', unit_price: 12 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
      avatar: llmAvatar('volcengine'),
    },
  ]
```

- [ ] **Step 5: video 块 insert 加 avatar**

在 volcVideoModels 的 insert（约 line 856-879）的 `.values({...})` 与 `.onConflict(...).doUpdateSet({...})` 中各加一行 `avatar: m.avatar,`：

```ts
  for (const m of volcVideoModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: volcProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'video',
        category_references: JSON.stringify(m.category_references),
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: m.params_schema,
        avatar: m.avatar,
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        category_references: JSON.stringify(m.category_references),
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: m.params_schema,
        avatar: m.avatar,
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }
```

- [ ] **Step 6: 提交**

```bash
git add packages/db/scripts/seed.ts
git commit -m "feat(db): seed 填充 image/video 模型 avatar"
```

> 验证（可选，部署/本地配好 DB+TOS_PUBLIC_URL 后）：`pnpm db:seed`，查 `provider_models` 表 image/video 模块 avatar 已填。

---

## Task 6: 前端 ModelBrandIcon 改为 avatar 渲染

**Files:**
- Modify: `apps/web/src/components/generation/shared/model-brand-icon.tsx`
- Modify: `apps/web/src/components/generation/image/image-panel.tsx:18-23,334,370`
- Modify: `apps/web/src/components/generation/video/video-panel.tsx:12-17,604,640`
- Delete: `apps/web/src/lib/model-images.ts`

- [ ] **Step 1: 重写 model-brand-icon.tsx**

用以下内容**完整替换** `apps/web/src/components/generation/shared/model-brand-icon.tsx`：

```tsx
'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelBrandIconProps {
  /** 模型图标 URL（已签名）。无值时显示占位图标 */
  avatar?: string | null
  /** 模型 code，用于 <img alt> 无障碍标签 */
  modelCode: string
  size: number
  className?: string
}

/**
 * 模型图标渲染：
 * 1. 有 avatar → 渲染 <img>，加载失败回退占位图标（避免裂图）
 * 2. 无 avatar → 渲染统一占位图标（lucide Sparkles）
 */
export function ModelBrandIcon({ avatar, modelCode, size, className }: ModelBrandIconProps): React.ReactElement {
  const [imgError, setImgError] = useState(false)

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={modelCode}
        width={size}
        height={size}
        onError={() => setImgError(true)}
        className={cn('object-contain', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return <Sparkles style={{ width: size, height: size }} className={cn('text-muted-foreground', className)} />
}
```

- [ ] **Step 2: image-panel.tsx 改为同步 import + 传 avatar**

在 `apps/web/src/components/generation/image/image-panel.tsx`：
1. 删除 line 18-23 的 `dynamic` 定义块，在 import 区（如 line 6 `lucide-react` 附近）改为普通命名导入：

```tsx
import { ModelBrandIcon } from '../shared/model-brand-icon'
```

2. 检查 `import dynamic from 'next/dynamic'`（line 18）是否还被其他代码使用。Run: 在该文件内搜索 `dynamic(`，若无其他使用则删除该 import 行。

3. line 334 调用改为：

```tsx
              <ModelBrandIcon avatar={currentModel?.avatar} modelCode={currentModel?.code ?? modelType} size={40} />
```

4. line 370 调用改为：

```tsx
                    <ModelBrandIcon avatar={m.avatar} modelCode={m.code} size={32} />
```

- [ ] **Step 3: video-panel.tsx 改为同步 import + 传 avatar**

在 `apps/web/src/components/generation/video/video-panel.tsx`：
1. 删除 line 12-17 的 `dynamic` 定义块，import 区改为：

```tsx
import { ModelBrandIcon } from '../shared/model-brand-icon'
```

2. 检查 `import dynamic from 'next/dynamic'`（line 12）是否还被使用，若无则删除。

3. line 604 调用改为：

```tsx
              <ModelBrandIcon avatar={currentModel?.avatar} modelCode={currentModel?.code ?? videoModel} size={40} />
```

4. line 640 调用改为：

```tsx
                    <ModelBrandIcon avatar={m.avatar} modelCode={m.code} size={32} />
```

- [ ] **Step 4: 删除 model-images.ts**

先确认无残留引用。Run: `rg "model-images" apps/web/src`
Expected: 无输出（model-brand-icon 已重写不再 import）。

确认无引用后删除：

```bash
rm apps/web/src/lib/model-images.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/generation/shared/model-brand-icon.tsx apps/web/src/components/generation/image/image-panel.tsx apps/web/src/components/generation/video/video-panel.tsx
git rm apps/web/src/lib/model-images.ts
git commit -m "refactor(web): ModelBrandIcon 改为 avatar 渲染，移除 lobehub 引用"
```

---

## Task 7: admin 编辑弹窗加 avatar

**Files:**
- Modify: `apps/web/src/components/admin/model-edit-dialog.tsx`

- [ ] **Step 1: 增加 avatar state 与初始化**

在 `apps/web/src/components/admin/model-edit-dialog.tsx`：
1. import 区增加 `Image as ImageIcon`（用于预览占位），修改 line 4：

```tsx
import { Loader2, Image as ImageIcon } from 'lucide-react'
```

2. 在 `useState` 区（line 37-41 附近）增加 avatar state：

```tsx
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [avatar, setAvatar] = useState('')
  const [pricingRules, setPricingRules] = useState<ParamsPricingRule[]>([])
  const [saving, setSaving] = useState(false)
```

3. `useEffect`（line 46-53）增加 avatar 初始化：

```tsx
  useEffect(() => {
    if (model) {
      setDescription(model.description ?? '')
      setAvatar(model.avatar ?? '')
      setIsActive(model.is_active)
      setPricingRules(model.params_pricing.map((r) => ({ ...r })))
    }
  }, [model])
```

- [ ] **Step 2: handleSubmit 提交 avatar**

在 `handleSubmit` 的 `apiPatch` body（line 76-80）增加 avatar：

```tsx
      await apiPatch(`/admin/models/${model.id}`, {
        description: description.trim() || null,
        avatar: avatar.trim() || null,
        is_active: isActive,
        params_pricing: pricingRules,
      })
```

- [ ] **Step 3: 弹窗 JSX 增加 avatar 输入与预览**

在「模型描述」Textarea 区块（line 110-121）之后、「定价规则」区块（line 123）之前插入：

```tsx
          {/* 模型图标 avatar */}
          <div className="space-y-1.5">
            <Label htmlFor="model-avatar">模型图标 URL</Label>
            <div className="flex items-center gap-2">
              <Input
                id="model-avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="TOS 存储地址，如 https://.../assets/llm/openai.png"
              />
              {avatar.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  alt="图标预览"
                  className="h-9 w-9 shrink-0 rounded object-contain ring-1 ring-border"
                />
              )}
              {!avatar.trim() && <ImageIcon className="h-9 w-9 shrink-0 text-muted-foreground" />}
            </div>
          </div>
```

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/admin/model-edit-dialog.tsx
git commit -m "feat(web): admin 模型编辑弹窗支持 avatar"
```

---

## Task 8: 移除 @lobehub/icons 依赖 + 清理验证

**Files:**
- Modify: `apps/web/package.json:16`

> 说明：`@lobehub/ui` 未在 `apps/web/package.json` 中直接声明（仅作为 `@lobehub/icons` 的传递依赖存在于 lockfile），移除 icons 后 `pnpm install` 会自动清理。

- [ ] **Step 1: 删除 package.json 中的 @lobehub/icons**

在 `apps/web/package.json` 的 `dependencies` 中删除该行：

```json
    "@lobehub/icons": "^5.10.0",
```

- [ ] **Step 2: 重新安装更新 lockfile**

Run: `pnpm install`
Expected: `@lobehub/icons` 与 `@lobehub/ui` 从 `pnpm-lock.yaml` 移除，无报错。

- [ ] **Step 3: 确认无 lobehub 残留引用**

Run: `rg "@lobehub" apps/web/src apps/api/src packages`
Expected: 无输出（docs/specs/plans 中的历史文档不计）。

- [ ] **Step 4: lint 验证**

Run: `pnpm --filter @aigc/web lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): 移除 @lobehub/icons 依赖"
```

---

## 完成标准（验收清单）

- [ ] `pnpm db:migrate` 成功，`provider_models.avatar` 列存在
- [ ] `pnpm db:seed` 后，image/video 模块模型 avatar 已填，其余为 NULL
- [ ] `/models` 响应 avatar 为签名 URL
- [ ] `/admin/models` 响应含 avatar 原始 URL，PATCH `/admin/models/:id` 可更新 avatar
- [ ] 全仓库无 `@lobehub` 引用（不含历史文档）
- [ ] `pnpm lint` 通过

## 注意事项

1. **迁移与 API 配套上线**：API select `pm.avatar` 要求列已存在，DB 迁移必须先于 API 部署执行。
2. **types 包重建**：Task 2 改 types 后必须 `pnpm --filter @aigc/types build`，否则下游拿不到 avatar 类型。
3. **TOS_PUBLIC_URL 依赖**：seed 的 `llmAvatar` 在该变量未配置时返回 null（走占位图标），不会生成 `undefined/...`。
4. **本地验证边界**：前端改动完成即结束，不执行构建/刷新/重启（CLAUDE.md 约束）。
