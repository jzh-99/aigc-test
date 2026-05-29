# Batch Source and Resource Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `source` dimension to generation batches so 工作台/创作生成/灵动画布/Toby Studio histories do not mix, and add resource-type labels to batch cards.

**Architecture:** `task_batches.source` stores product origin (`generation | studio | canvas`), while `task_batches.module` keeps concrete capability (`image | video | music | picture_book | short_drama | agent | ...`) and `assets.type` keeps media rendering type (`image | video | audio`). API list routes filter by `source`; front-end cards derive resource labels from returned asset types.

**Tech Stack:** PostgreSQL/Kysely migrations, Fastify routes, shared `@aigc/types`, Next.js React components, TypeScript tests with `node:test`.

---

## File Structure

- `packages/db/migrations/051_batch_source.ts` — add `task_batches.source`, backfill old data, update module/source checks and indexes.
- `packages/db/src/schema.ts` — add `source` to `TaskBatchesTable`; keep `assets.type` unchanged.
- `packages/types/src/db.ts` — add `BatchSource`; adjust `ModuleType` to include `storyboard`, `upload`, `picture_book`, `short_drama` if missing.
- `packages/types/src/api.ts` — expose `source` on `BatchResponse` and `AigcModule` updates.
- Batch creation routes:
  - `apps/api/src/routes/images/*` or actual image generation route — write `source: 'generation'`.
  - `apps/api/src/routes/videos/post-generate.ts` — write `source: 'generation'`.
  - `apps/api/src/routes/avatar/post-generate.ts` — write `source: 'generation'`.
  - `apps/api/src/routes/action-imitation/post-generate.ts` — write `source: 'generation'`.
  - `apps/api/src/routes/music/post-generate.ts` — write `source: 'studio'`.
  - `apps/api/src/routes/music/post-voice-clones.ts` — write `source: 'studio'`.
  - `apps/api/src/routes/picture-book/*.ts` batch sync/create paths — write `source: 'studio'` and `module: 'picture_book'`.
  - canvas batch create routes under `apps/api/src/routes/canvas*` — write `source: 'canvas'` and use `module: 'agent' | 'storyboard' | 'upload'`.
- Batch list/detail routes:
  - `apps/api/src/routes/batches/get-list.ts` — accept `source`, default to `generation`, return `source`, return typed thumbnails/resource types.
  - `apps/api/src/routes/batches/get-hidden.ts` — same source filter/default.
  - `apps/api/src/routes/batches/get-by-id.ts` and SSE batch route if needed — include `source` in response.
  - `apps/api/src/routes/workspaces/get-batches.ts` / `apps/api/src/routes/teams/get-workspaces-batches.ts` — filter or expose source depending callsite.
- Frontend hooks/components:
  - `apps/web/src/hooks/use-batches.ts` — add optional source argument, default `generation`, append `source=` query.
  - `apps/web/src/components/dashboard/recent-batches.tsx` — use generation source.
  - `apps/web/src/components/history/batch-list.tsx` — use generation source.
  - `apps/web/src/components/history/batch-preview.ts` — extend helpers to derive `resourceTypes` from tasks or API resource metadata.
  - `apps/web/src/components/history/batch-preview.test.ts` — add label/filter tests.
  - `apps/web/src/components/history/batch-list-card.tsx` — display `图片 / 视频 / 音频` labels from resource types.

---

### Task 1: Add DB Source Types and Migration

**Files:**
- Create: `packages/db/migrations/051_batch_source.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/types/src/db.ts`
- Modify: `packages/types/src/api.ts`
- Test: `packages/db/src/batch-source-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/batch-source-migration.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const migrationPath = join(__dirname, '../migrations/051_batch_source.ts')

describe('051_batch_source migration', () => {
  test('adds source column and backfills existing modules', async () => {
    const source = await readFile(migrationPath, 'utf-8')

    assert.match(source, /addColumn\('source', 'varchar\(30\)'/)
    assert.match(source, /UPDATE task_batches[\s\S]+SET source = 'generation'[\s\S]+module IN \('image','video','tts','lipsync','avatar','action_imitation'\)/)
    assert.match(source, /UPDATE task_batches[\s\S]+SET source = 'studio'[\s\S]+module IN \('music','music_voice_clone','picture_book','short_drama'\)/)
    assert.match(source, /UPDATE task_batches[\s\S]+SET source = 'canvas'[\s\S]+module IN \('agent','storyboard','upload'\)/)
    assert.match(source, /chk_tb_source/)
    assert.match(source, /idx_task_batches_source_workspace_created/)
  })
})
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run:

```bash
pnpm --filter @aigc/db exec tsc src/batch-source-migration.test.ts --module commonjs --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-test; node ../../.claude/tmp/batch-source-test/batch-source-migration.test.js
```

Expected: FAIL because `../migrations/051_batch_source.ts` does not exist.

- [ ] **Step 3: Create migration**

Create `packages/db/migrations/051_batch_source.ts`:

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task_batches')
    .addColumn('source', 'varchar(30)', (col) => col.notNull().defaultTo('generation'))
    .execute()

  await sql`
    UPDATE task_batches
    SET source = 'generation'
    WHERE module IN ('image','video','tts','lipsync','avatar','action_imitation')
  `.execute(db)

  await sql`
    UPDATE task_batches
    SET source = 'studio'
    WHERE module IN ('music','music_voice_clone','picture_book','short_drama')
      OR picture_book_project_id IS NOT NULL
      OR video_studio_project_id IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE task_batches
    SET source = 'canvas'
    WHERE module IN ('agent','storyboard','upload')
      OR canvas_id IS NOT NULL
      OR canvas_node_id IS NOT NULL
  `.execute(db)

  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_source CHECK (source IN ('generation','studio','canvas'))
  `.execute(db)

  await sql`
    ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module
  `.execute(db)

  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_module CHECK (module IN (
      'image','video','tts','lipsync','agent','avatar','action_imitation',
      'storyboard','upload','music','music_voice_clone','picture_book','short_drama'
    ))
  `.execute(db)

  await db.schema
    .createIndex('idx_task_batches_source_workspace_created')
    .on('task_batches')
    .columns(['source', 'workspace_id', 'created_at desc', 'id desc'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_task_batches_source_workspace_created').ifExists().execute()

  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_source`.execute(db)
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_module CHECK (module IN (
      'image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','music','music_voice_clone'
    ))
  `.execute(db)

  await db.schema.alterTable('task_batches').dropColumn('source').execute()
}
```

- [ ] **Step 4: Update DB and API types**

Modify `packages/types/src/db.ts`:

```ts
export type BatchSource = 'generation' | 'studio' | 'canvas'
export type ModuleType = 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation' | 'music' | 'music_voice_clone' | 'storyboard' | 'upload' | 'picture_book' | 'short_drama'
export type VideoCategory = 'multimodal' | 'frames'
export type ImageCategory = 'text_to_image' | 'image_to_image'
export type TextCategory = 'text_to_text'
export type CategoryReferenceKey = VideoCategory | ImageCategory | TextCategory
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_complete' | 'failed'
export type TransferStatus = 'pending' | 'completed' | 'failed'
export type LedgerType = 'topup' | 'subscription' | 'freeze' | 'confirm' | 'refund' | 'bonus' | 'expire'
export type AssetType = 'image' | 'video' | 'audio'
```

Modify `packages/types/src/api.ts`:

```ts
import type { BatchSource, ModuleType } from './db'

export interface BatchResponse {
  id: string
  source: BatchSource
  module: ModuleType
  provider: string
  model: string
  prompt: string
  params: unknown
  quantity: number
  completed_count: number
  failed_count: number
  status: BatchStatus
  estimated_credits: number
  actual_credits: number
  created_at: string
  queue_position?: number | null
  tasks: TaskResponse[]
  user?: BatchUser
}

export type AigcModule = ModuleType
```

If `api.ts` already imports DB types, merge the import instead of duplicating it.

Modify `packages/db/src/schema.ts` in `TaskBatchesTable`:

```ts
  source: 'generation' | 'studio' | 'canvas'
  module:
    | 'image'
    | 'video'
    | 'tts'
    | 'lipsync'
    | 'agent'
    | 'avatar'
    | 'action_imitation'
    | 'storyboard'
    | 'upload'
    | 'music'
    | 'music_voice_clone'
    | 'picture_book'
    | 'short_drama'
```

- [ ] **Step 5: Run migration/type tests**

Run:

```bash
pnpm --filter @aigc/db exec tsc src/batch-source-migration.test.ts --module commonjs --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-test; node ../../.claude/tmp/batch-source-test/batch-source-migration.test.js
pnpm --filter @aigc/types build
```

Expected: migration test passes; types package builds.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/051_batch_source.ts packages/db/src/schema.ts packages/types/src/db.ts packages/types/src/api.ts packages/db/src/batch-source-migration.test.ts
git commit -m "feat: add batch source dimension"
```

---

### Task 2: Write Source on Batch Creation

**Files:**
- Modify all API routes that insert into `task_batches`.
- Test: existing route tests plus TypeScript build.

- [ ] **Step 1: Locate all batch insertions**

Run:

```bash
rg "insertInto\('task_batches'\)|insertInto\('generation_batches'\)" apps/api/src apps/worker/src packages -n
```

Expected: list all batch creation sites. Update every `task_batches` insertion; if `generation_batches` appears, inspect and update the actual table name used in this repo.

- [ ] **Step 2: Update generation routes**

For routes under image/video/avatar/action-imitation/tts/lipsync generation, add `source: 'generation'` in the inserted object.

Example for `apps/api/src/routes/videos/post-generate.ts` around the insert:

```ts
await trx
  .insertInto('task_batches')
  .values({
    user_id: userId,
    team_id: teamId,
    workspace_id: workspaceId,
    credit_account_id: creditAccountId,
    idempotency_key: `${userId}-${Date.now()}`,
    source: 'generation',
    module: 'video',
    provider: providerModel.providerCode,
    model,
    prompt,
    params: JSON.stringify(params),
    estimated_credits: totalCost,
  })
  .returningAll()
  .executeTakeFirstOrThrow()
```

Apply the same pattern:

```ts
source: 'generation'
```

for `module: 'image'`, `module: 'avatar'`, `module: 'action_imitation'`, `module: 'tts'`, and `module: 'lipsync'` insertions.

- [ ] **Step 3: Update Toby Studio routes**

For `apps/api/src/routes/music/post-generate.ts`:

```ts
source: 'studio',
module: 'music',
```

For `apps/api/src/routes/music/post-voice-clones.ts`:

```ts
source: 'studio',
module: 'music_voice_clone',
```

For picture book batch sync/create code, use:

```ts
source: 'studio',
module: 'picture_book',
picture_book_project_id: projectId,
```

For future short drama creation, use:

```ts
source: 'studio',
module: 'short_drama',
video_studio_project_id: projectId,
```

- [ ] **Step 4: Update canvas routes**

For canvas upload route `apps/api/src/routes/canvas/post-canvases-asset-upload.ts`, use:

```ts
source: 'canvas',
module: 'upload',
```

For canvas agent/image generation routes that currently use `module: 'agent'`, use:

```ts
source: 'canvas',
module: 'agent',
```

For storyboard routes, use:

```ts
source: 'canvas',
module: 'storyboard',
```

- [ ] **Step 5: Run API type check/tests**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: build passes. If tests exist for changed routes, run the focused test file too, e.g.:

```bash
pnpm --filter @aigc/api exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/worker/src packages
git commit -m "feat: write batch source on creation"
```

---

### Task 3: Filter Batch List APIs by Source

**Files:**
- Modify: `apps/api/src/routes/batches/get-list.ts`
- Modify: `apps/api/src/routes/batches/get-hidden.ts`
- Modify: `apps/api/src/routes/batches/get-by-id.ts`
- Modify: `apps/api/src/routes/sse/get-batch.ts` if response selects batch fields explicitly.
- Test: `apps/api/src/__tests__/batch-source-filter.test.ts`

- [ ] **Step 1: Write source parsing helper in test form first**

Create `apps/api/src/__tests__/batch-source-filter.test.ts`:

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBatchSource } from '../routes/batches/source-filter.js'

describe('batch source filter', () => {
  test('defaults list source to generation', () => {
    assert.equal(normalizeBatchSource(undefined), 'generation')
  })

  test('accepts known sources', () => {
    assert.equal(normalizeBatchSource('generation'), 'generation')
    assert.equal(normalizeBatchSource('studio'), 'studio')
    assert.equal(normalizeBatchSource('canvas'), 'canvas')
  })

  test('rejects unknown source', () => {
    assert.throws(() => normalizeBatchSource('music'), /Invalid batch source/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aigc/api exec tsc src/__tests__/batch-source-filter.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-api-test; node ../../.claude/tmp/batch-source-api-test/__tests__/batch-source-filter.test.js
```

Expected: FAIL because `source-filter.js` does not exist.

- [ ] **Step 3: Add source helper**

Create `apps/api/src/routes/batches/source-filter.ts`:

```ts
import type { BatchSource } from '@aigc/types'

const BATCH_SOURCES: BatchSource[] = ['generation', 'studio', 'canvas']

export function normalizeBatchSource(value: unknown): BatchSource {
  if (value === undefined || value === null || value === '') return 'generation'
  if (typeof value === 'string' && BATCH_SOURCES.includes(value as BatchSource)) return value as BatchSource
  throw new Error('Invalid batch source')
}
```

- [ ] **Step 4: Apply source filter in `/batches`**

Modify `apps/api/src/routes/batches/get-list.ts`:

```ts
import { normalizeBatchSource } from './source-filter.js'
```

Change route generic:

```ts
app.get<{ Querystring: { cursor?: string; limit?: string; workspace_id?: string; source?: string } }>(
```

After cursor parsing:

```ts
let source: ReturnType<typeof normalizeBatchSource>
try {
  source = normalizeBatchSource(request.query.source)
} catch {
  return reply.badRequest('Invalid batch source')
}
```

In the base query select and filters:

```ts
.select([
  'id', 'source', 'module', 'provider', 'model', 'prompt', 'params', 'quantity',
  'completed_count', 'failed_count', 'status', 'estimated_credits',
  'actual_credits', 'created_at', 'user_id', 'workspace_id', 'is_deleted',
])
.where('source', '=', source)
```

Remove these legacy filters from `/batches` because `source` replaces them for product separation:

```ts
.where('canvas_id', 'is', null)
.where('video_studio_project_id', 'is', null)
.where('module', 'not in', ['music', 'music_voice_clone'])
```

When returning each batch, include:

```ts
source: b.source,
```

- [ ] **Step 5: Return resource types with thumbnails**

In `get-list.ts`, replace `thumbnailMap = new Map<string, string[]>()` with:

```ts
const resourceMap = new Map<string, Array<{ url: string; type: 'image' | 'video' | 'audio' }>>()
```

When signing each asset, return:

```ts
return {
  batchId: (a as any).batch_id as string,
  url: thumbnailUrl,
  type: (a as any).type as 'image' | 'video' | 'audio',
}
```

When building map:

```ts
const list = resourceMap.get(entry.batchId) ?? []
list.push({ url: entry.url, type: entry.type })
resourceMap.set(entry.batchId, list)
```

Return both legacy URLs and new typed resources for the card to use:

```ts
thumbnail_urls: (resourceMap.get(b.id) ?? []).map((item) => item.url),
resources: resourceMap.get(b.id) ?? [],
```

- [ ] **Step 6: Apply source filter in hidden/detail/SSE routes**

In `apps/api/src/routes/batches/get-hidden.ts`, accept `source?: string`, parse with `normalizeBatchSource`, filter `.where('source', '=', source)`, return `source`.

In `apps/api/src/routes/batches/get-by-id.ts`, include `source` in selected batch/response.

In `apps/api/src/routes/sse/get-batch.ts`, include `source` if the route manually maps batch fields.

- [ ] **Step 7: Run API source filter test and build**

Run:

```bash
pnpm --filter @aigc/api exec tsc src/__tests__/batch-source-filter.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-api-test; node ../../.claude/tmp/batch-source-api-test/__tests__/batch-source-filter.test.js
pnpm --filter @aigc/api build
```

Expected: source helper tests pass; API builds.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/batches apps/api/src/routes/sse apps/api/src/__tests__/batch-source-filter.test.ts
git commit -m "feat: filter batches by source"
```

---

### Task 4: Wire Frontend Source Queries and Resource Labels

**Files:**
- Modify: `apps/web/src/hooks/use-batches.ts`
- Modify: `apps/web/src/components/dashboard/recent-batches.tsx`
- Modify: `apps/web/src/components/history/batch-list.tsx`
- Modify: `apps/web/src/components/history/batch-preview.ts`
- Modify: `apps/web/src/components/history/batch-list-card.tsx`
- Test: `apps/web/src/components/history/batch-preview.test.ts`

- [ ] **Step 1: Extend batch preview tests**

Modify `apps/web/src/components/history/batch-preview.test.ts` to include resource type labels:

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { getBatchImagePreviewUrls, getBatchResourceTypes, getBatchVideoPreviewUrl } from './batch-preview'

const createTask = (type: 'image' | 'video' | 'audio', url: string) => ({
  id: `${type}-task`,
  status: 'completed' as const,
  asset: {
    type,
    storage_url: url,
    original_url: null,
  },
})

describe('batch-preview', () => {
  test('图片预览只返回图片资源，忽略音频资源', () => {
    const urls = getBatchImagePreviewUrls({
      thumbnail_urls: ['https://cdn.example.com/audio.mp3'],
      tasks: [
        createTask('audio', 'https://cdn.example.com/audio.mp3'),
        createTask('image', 'https://cdn.example.com/image.png'),
      ],
    })

    assert.deepEqual(urls, ['https://cdn.example.com/image.png'])
  })

  test('视频预览只返回视频资源，忽略音频资源', () => {
    const url = getBatchVideoPreviewUrl({
      thumbnail_urls: ['https://cdn.example.com/audio.mp3'],
      tasks: [
        createTask('audio', 'https://cdn.example.com/audio.mp3'),
        createTask('video', 'https://cdn.example.com/video.mp4'),
      ],
    })

    assert.equal(url, 'https://cdn.example.com/video.mp4')
  })

  test('资源类型标签按资源出现顺序去重', () => {
    const types = getBatchResourceTypes({
      resources: [
        { type: 'audio', url: 'https://cdn.example.com/a.mp3' },
        { type: 'image', url: 'https://cdn.example.com/a.png' },
        { type: 'audio', url: 'https://cdn.example.com/b.mp3' },
      ],
      tasks: [],
    })

    assert.deepEqual(types, ['audio', 'image'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aigc/web exec tsc src/components/history/batch-preview.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-preview-test; node ../../.claude/tmp/batch-preview-test/batch-preview.test.js
```

Expected: FAIL because `getBatchResourceTypes` is not exported.

- [ ] **Step 3: Implement resource type helper**

Modify `apps/web/src/components/history/batch-preview.ts`:

```ts
type PreviewAssetType = 'image' | 'video' | 'audio'

interface PreviewTask {
  status: string
  asset: {
    type?: PreviewAssetType
    storage_url?: string | null
    original_url?: string | null
  } | null
}

interface PreviewResource {
  type: PreviewAssetType
  url: string
}

interface PreviewBatch {
  tasks?: PreviewTask[]
  thumbnail_urls?: string[]
  resources?: PreviewResource[]
}

function getAssetUrl(task: PreviewTask): string | null {
  return task.asset?.storage_url ?? task.asset?.original_url ?? null
}

function uniqueTypes(types: PreviewAssetType[]): PreviewAssetType[] {
  return types.filter((type, index) => types.indexOf(type) === index)
}

export function getBatchImagePreviewUrls(batch: PreviewBatch): string[] {
  if (batch.resources?.length) return batch.resources.filter((item) => item.type === 'image').map((item) => item.url)

  return (batch.tasks ?? [])
    .filter((task) => task.status === 'completed' && task.asset?.type === 'image')
    .map(getAssetUrl)
    .filter((url): url is string => Boolean(url))
}

export function getBatchVideoPreviewUrl(batch: PreviewBatch): string | undefined {
  const resourceUrl = batch.resources?.find((item) => item.type === 'video')?.url
  if (resourceUrl) return resourceUrl

  return (batch.tasks ?? [])
    .filter((task) => task.status === 'completed' && task.asset?.type === 'video')
    .map(getAssetUrl)
    .find((url): url is string => Boolean(url))
}

export function getBatchResourceTypes(batch: PreviewBatch): PreviewAssetType[] {
  if (batch.resources?.length) return uniqueTypes(batch.resources.map((item) => item.type))

  return uniqueTypes(
    (batch.tasks ?? [])
      .filter((task) => task.status === 'completed' && Boolean(getAssetUrl(task)))
      .map((task) => task.asset?.type)
      .filter((type): type is PreviewAssetType => type === 'image' || type === 'video' || type === 'audio'),
  )
}
```

- [ ] **Step 4: Add source query to hook**

Modify `apps/web/src/hooks/use-batches.ts`:

```ts
import type { BatchSource } from '@aigc/types'

export function useBatches(source: BatchSource = 'generation') {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const wsParam = activeWorkspaceId ? `&workspace_id=${activeWorkspaceId}` : ''
  const sourceParam = `&source=${source}`

  const swr = useSWRInfinite<BatchPage>(
    (pageIndex, previousPageData) => {
      if (!activeWorkspaceId) return null
      if (previousPageData && !previousPageData.cursor) return null
      if (pageIndex === 0) return `/batches?limit=${PAGE_SIZE}${wsParam}${sourceParam}`
      return `/batches?limit=${PAGE_SIZE}&cursor=${previousPageData!.cursor}${wsParam}${sourceParam}`
    },
    { revalidateFirstPage: false, revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 10000, focusThrottleInterval: 15000 },
  )
```

Apply the same optional `source` argument to `useHiddenBatches`:

```ts
export function useHiddenBatches(enabled = true, source: BatchSource = 'generation') {
```

and append `sourceParam` to `/batches/hidden` keys.

- [ ] **Step 5: Use generation source in existing lists**

Modify `apps/web/src/components/dashboard/recent-batches.tsx`:

```ts
const { batches, isLoadingInitial, updateBatchInList } = useBatches('generation')
```

Modify `apps/web/src/components/history/batch-list.tsx`:

```ts
const { batches, isLoadingInitial, isLoadingMore, hasMore, loadMore, error, mutate, prependBatch, updateBatchInList, hideBatch } = useBatches('generation')
```

For hidden drawer calls in generation history, pass `generation` if the component exposes it:

```tsx
<HiddenBatchesDrawer open={hiddenDrawerOpen} onOpenChange={setHiddenDrawerOpen} source="generation" />
```

If `HiddenBatchesDrawer` does not accept source yet, update its props:

```ts
interface HiddenBatchesDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source?: BatchSource
}
```

and call:

```ts
const { batches, isLoadingInitial, isLoadingMore, hasMore, loadMore, unhideBatch } = useHiddenBatches(open, source ?? 'generation')
```

- [ ] **Step 6: Render resource type labels on cards**

Modify `apps/web/src/components/history/batch-list-card.tsx` imports:

```ts
import { getBatchImagePreviewUrls, getBatchResourceTypes, getBatchVideoPreviewUrl } from './batch-preview'
```

Add label map near constants:

```ts
const resourceTypeLabels: Record<'image' | 'video' | 'audio', string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}
```

Inside `BatchListCard` after `const thumbnails = ...`:

```ts
const resourceTypes = getBatchResourceTypes(batch)
```

Render badges in the meta row after the status badge:

```tsx
{resourceTypes.map((type) => (
  <Badge key={type} variant="outline" className="text-[10px]">
    {resourceTypeLabels[type]}
  </Badge>
))}
```

- [ ] **Step 7: Run frontend tests and typecheck**

Run:

```bash
pnpm --filter @aigc/web exec tsc src/components/history/batch-preview.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-preview-test; node ../../.claude/tmp/batch-preview-test/batch-preview.test.js
pnpm --filter @aigc/web exec tsc --noEmit
```

Expected: preview tests pass; web typecheck passes.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/use-batches.ts apps/web/src/components/dashboard/recent-batches.tsx apps/web/src/components/history/batch-list.tsx apps/web/src/components/history/hidden-batches-drawer.tsx apps/web/src/components/history/batch-preview.ts apps/web/src/components/history/batch-preview.test.ts apps/web/src/components/history/batch-list-card.tsx
git commit -m "feat: show resource labels on batch cards"
```

---

### Task 5: Update Canvas and Studio Call Sites

**Files:**
- Modify canvas history hooks/routes using batch APIs.
- Modify Toby Studio pages/hooks if they list batch records.
- Test: targeted type checks.

- [ ] **Step 1: Find source-specific batch consumers**

Run:

```bash
rg "useBatches\(|/batches\?|/batches/hidden|/workspaces/.*/batches|/teams/.*/batches" apps/web/src apps/api/src -n
```

Expected: list dashboard, generation history, canvas history, admin/team views, hidden drawer.

- [ ] **Step 2: Wire canvas consumers to canvas source**

For canvas UI consumers that should list canvas records, call:

```ts
useBatches('canvas')
```

or request:

```ts
/batches?source=canvas&workspace_id=${workspaceId}
```

If canvas uses dedicated endpoints (`canvas-history-sidebar.tsx` and `canvas-api.ts`), do not replace them unless they call `/batches` internally; only ensure any `/batches` usage asks for `source=canvas`.

- [ ] **Step 3: Wire studio consumers to studio source**

For Toby Studio batch consumers, call:

```ts
useBatches('studio')
```

or request:

```ts
/batches?source=studio&workspace_id=${workspaceId}
```

If Toby Studio uses dedicated tables (`music_tracks`, `picture_book_projects`) and does not use `/batches`, do not add a new list.

- [ ] **Step 4: Preserve admin/team views**

For admin/team list endpoints, keep all sources visible unless the UI explicitly needs a filter. If the UI adds filtering later, use query `source` but do not hide records by default in admin.

- [ ] **Step 5: Typecheck**

Run:

```bash
pnpm --filter @aigc/web exec tsc --noEmit
pnpm --filter @aigc/api build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src apps/api/src
git commit -m "feat: route batch histories by source"
```

---

### Task 6: Final Verification and Review

**Files:**
- No expected code changes unless verification finds defects.

- [ ] **Step 1: Run full relevant checks**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/db exec tsc --noEmit
pnpm --filter @aigc/api build
pnpm --filter @aigc/web exec tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 2: Run focused regression tests**

Run:

```bash
pnpm --filter @aigc/db exec tsc src/batch-source-migration.test.ts --module commonjs --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-test; node ../../.claude/tmp/batch-source-test/batch-source-migration.test.js
pnpm --filter @aigc/api exec tsc src/__tests__/batch-source-filter.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-source-api-test; node ../../.claude/tmp/batch-source-api-test/__tests__/batch-source-filter.test.js
pnpm --filter @aigc/web exec tsc src/components/history/batch-preview.test.ts --module nodenext --moduleResolution nodenext --target es2022 --types node --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit false --outDir ../../.claude/tmp/batch-preview-test; node ../../.claude/tmp/batch-preview-test/batch-preview.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Manual API smoke test**

With local API running and authenticated session, request:

```bash
curl "http://localhost:7001/api/v1/batches?limit=10&workspace_id=<workspace_id>&source=generation"
curl "http://localhost:7001/api/v1/batches?limit=10&workspace_id=<workspace_id>&source=studio"
curl "http://localhost:7001/api/v1/batches?limit=10&workspace_id=<workspace_id>&source=canvas"
```

Expected:
- `source=generation` returns only generation records.
- `source=studio` returns only Toby Studio records.
- `source=canvas` returns only canvas records.
- Each returned batch includes `source`, `module`, `thumbnail_urls`, and `resources`.

- [ ] **Step 4: Manual UI smoke test**

Start frontend/API if needed:

```bash
pnpm --filter @aigc/api dev
pnpm --filter @aigc/web dev
```

Verify:
- 工作台 → 最近生成 shows only `source=generation` records.
- 创作生成 → 历史记录 shows only `source=generation` records.
- Toby Studio music/picture-book records do not appear in those lists.
- Cards with image assets show `图片` label.
- Cards with video assets show `视频` label.
- Cards with audio assets show `音频` label and do not render audio URL as an image.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` with this context:

```text
Review the batch source and resource label migration. Requirements:
1. task_batches.source separates generation/studio/canvas.
2. Existing data is backfilled by module and project/canvas foreign keys.
3. /batches defaults to source=generation and can query source=studio/canvas.
4. Dashboard and generation history only show generation records.
5. Cards show resource type labels from assets.type/resources and never render audio as image/video.
```

Fix Critical and Important findings before finishing.

- [ ] **Step 6: Final commit if review fixes were made**

```bash
git add .
git commit -m "fix: address batch source review findings"
```

Only run this if review fixes changed files.

---

## Self-Review

- Spec coverage: The plan covers DB source addition, old data migration, source writes, source-filtered APIs, frontend query wiring, resource labels, and verification.
- Placeholder scan: No TBD/TODO placeholders remain; each code step includes exact paths and examples.
- Type consistency: `source` uses `generation | studio | canvas`; `module` keeps business capability; `assets.type` remains unchanged and is used for rendering labels.
