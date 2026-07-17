# Toby AI 绘本完整模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Toby AI 绘本 module with draftable project workflow, project-level billing, Qwen script generation, Seedream image generation, MiniMax bilingual TTS, and polished theme-aware frontend pages.

**Architecture:** Picture book data lives in new project, asset, and charge tables while generation outputs still reuse `task_batches`, `tasks`, `assets`, credits ledger, and provider audit. API routes own project CRUD, draft persistence, Qwen JSON generation, project charge aggregation, and orchestration around existing image/TTS generation primitives. Frontend adds a Toby Studio picture-book workspace with a focused AI generation entry, recent projects, list/detail pages, and a four-step wizard.

**Tech Stack:** pnpm 10, Turborepo, TypeScript, Kysely, PostgreSQL, Fastify autoload routes, Next.js 14 App Router, SWR, Zustand-style local draft patterns, Tailwind CSS, Radix UI, lucide-react, Qwen `qwen3.6-plus`, Volc Seedream `seedream-5.0-lite`, MiniMax `speech-2.8-hd`.

---

## File Structure

Create or modify these files:

- Create: `packages/types/src/picture-book.ts`  
  Shared constants, status unions, state types, validators, and request/response types.
- Modify: `packages/types/src/index.ts`  
  Export picture book types.
- Modify: `packages/types/src/queue.ts`  
  Add optional picture book context fields only if new queue jobs are introduced during implementation; otherwise keep generation routed through existing image/TTS paths.
- Create: `packages/types/src/picture-book.test.ts`  
  Tests for page count, style, status, and state normalization helpers.
- Create: `packages/db/migrations/048_picture_book.ts`  
  Add `picture_book_projects`, `picture_book_project_charges`, `picture_book_project_assets`, and `task_batches.picture_book_project_id`.
- Modify: `packages/db/src/schema.ts`  
  Add Kysely table interfaces and `task_batches.picture_book_project_id`.
- Modify: `packages/db/scripts/seed.ts`  
  Ensure Qwen `qwen3.6-plus`, MiniMax `speech-2.8-hd`, and Seedream `seedream-5.0-lite` are present and documented as picture book defaults.
- Create: `apps/api/src/routes/picture-book/_shared.ts`  
  Project access, state normalization, prompt JSON parsing, charge helpers, model constants, workspace permission helpers.
- Create: `apps/api/src/routes/picture-book/get-projects.ts`  
  List and recent projects.
- Create: `apps/api/src/routes/picture-book/get-project-id.ts`  
  Project detail and charge summary.
- Create: `apps/api/src/routes/picture-book/put-project-id.ts`  
  Upsert project state and patch draft/name.
- Create: `apps/api/src/routes/picture-book/delete-project-id.ts`  
  Soft delete, restore, permanent delete.
- Create: `apps/api/src/routes/picture-book/post-script.ts`  
  Generate script outline with Qwen and create draft project.
- Create: `apps/api/src/routes/picture-book/post-asset-prompts.ts`  
  Regenerate character/background prompts with Qwen.
- Create: `apps/api/src/routes/picture-book/post-storyboard-prompts.ts`  
  Generate page image prompts and bilingual dialogue with Qwen.
- Create: `apps/api/src/routes/picture-book/post-generate-assets.ts`  
  Submit role/background image generation through existing image pipeline with project charge records.
- Create: `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts`  
  Submit page image generation through existing image pipeline.
- Create: `apps/api/src/routes/picture-book/post-generate-storyboard-audio.ts`  
  Generate bilingual page audio through MiniMax TTS with project charge records.
- Create: `apps/api/src/routes/picture-book/post-sync-batches.ts`  
  Refresh project state from linked batches/assets.
- Create: `apps/api/src/__tests__/picture-book-validation.test.ts`  
  Helper, parser, access, and charge tests.
- Create: `apps/web/src/lib/picture-book/types.ts`  
  Frontend state and API types.
- Create: `apps/web/src/lib/picture-book/api.ts`  
  API client wrappers using `fetchWithAuth`.
- Create: `apps/web/src/hooks/picture-book/use-picture-book-project.ts`  
  Project SWR, draft save debounce, and mutation helpers.
- Create: `apps/web/src/components/picture-book/picture-book-home.tsx`  
  AI generation entry and recent projects.
- Create: `apps/web/src/components/picture-book/picture-book-project-card.tsx`  
  Reusable project card.
- Create: `apps/web/src/components/picture-book/picture-book-stepper.tsx`  
  Top horizontal wizard stepper.
- Create: `apps/web/src/components/picture-book/step-script-outline.tsx`  
  Summary and per-page carousel editor.
- Create: `apps/web/src/components/picture-book/step-assets.tsx`  
  Character/background tabs and generation cards.
- Create: `apps/web/src/components/picture-book/step-storyboard.tsx`  
  Page image/audio prompt cards and batch actions.
- Create: `apps/web/src/components/picture-book/step-preview.tsx`  
  Language-switching preview and audio playback.
- Create: `apps/web/src/app/(dashboard)/toby-studio/picture-book/page.tsx`  
  Replace placeholder with home page.
- Create: `apps/web/src/app/(dashboard)/toby-studio/picture-book/projects/page.tsx`  
  My picture books list page.
- Create: `apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx`  
  Project editor page.
- Modify: `apps/web/src/app/(dashboard)/toby-studio/page.tsx`  
  Mark AI 绘本 as available.

---

### Task 1: Shared Picture Book Types

**Files:**
- Create: `packages/types/src/picture-book.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/picture-book.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/types/src/picture-book.test.ts`:

```ts
import assert from 'node:assert/strict'
import {
  PICTURE_BOOK_PAGE_COUNTS,
  PICTURE_BOOK_STYLES,
  isPictureBookPageCount,
  isPictureBookStyle,
  makeDefaultPictureBookState,
  normalizePictureBookState,
} from './picture-book.js'

assert.deepEqual(PICTURE_BOOK_PAGE_COUNTS, [10, 15, 20])
assert.equal(isPictureBookPageCount(10), true)
assert.equal(isPictureBookPageCount(12), false)
assert.equal(isPictureBookStyle('吉卜力风'), true)
assert.equal(isPictureBookStyle('赛博朋克'), false)
assert.equal(PICTURE_BOOK_STYLES.includes('梦幻光影厚涂风'), true)

const state = makeDefaultPictureBookState({ style: '吉卜力风', pageCount: 15 })
assert.equal(state.steps.active, 'script')
assert.equal(state.settings.imageModel, 'seedream-5.0-lite')
assert.equal(state.settings.ttsModel, 'speech-2.8-hd')
assert.equal(state.settings.textModel, 'qwen3.6-plus')
assert.equal(state.settings.billingMode, 'project')

const normalized = normalizePictureBookState({ settings: { style: '坏值', pageCount: 12 } })
assert.equal(normalized.settings.style, '吉卜力风')
assert.equal(normalized.settings.pageCount, 10)
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/picture-book.test.ts
```

Expected: fail because `picture-book.ts` does not exist.

- [ ] **Step 3: Add shared types and helpers**

Create `packages/types/src/picture-book.ts`:

```ts
export const PICTURE_BOOK_STYLES = [
  '扁平矢量风',
  '彩铅蜡笔风',
  '拼贴艺术风',
  '3D黏土盲盒风',
  '新中式水墨风',
  '美影厂剪纸风',
  '吉卜力风',
  '经典水彩风',
  '迪士尼/皮克斯3D风',
  '黑板粉笔画风',
  '复古版画风',
  '梦幻光影厚涂风',
] as const

export type PictureBookStyle = typeof PICTURE_BOOK_STYLES[number]

export const PICTURE_BOOK_PAGE_COUNTS = [10, 15, 20] as const
export type PictureBookPageCount = typeof PICTURE_BOOK_PAGE_COUNTS[number]

export const PICTURE_BOOK_TEXT_MODEL = 'qwen3.6-plus'
export const PICTURE_BOOK_IMAGE_MODEL = 'seedream-5.0-lite'
export const PICTURE_BOOK_TTS_MODEL = 'speech-2.8-hd'

export type PictureBookStepId = 'script' | 'assets' | 'storyboard' | 'preview'
export type PictureBookProjectStatus = 'draft' | 'script_ready' | 'assets_ready' | 'storyboard_ready' | 'completed' | 'failed'
export type PictureBookGenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
export type PictureBookAssetKind = 'character' | 'background' | 'page_image' | 'page_audio_zh' | 'page_audio_en'
export type PictureBookChargeType = 'script_generate' | 'storyboard_prompt' | 'asset_image' | 'page_image' | 'page_audio_zh' | 'page_audio_en'

export interface PictureBookPageScript {
  id: string
  pageNumber: number
  title: string
  visualDescriptionZh: string
  dialogueZh: string
  dialogueEn: string
}

export interface PictureBookElement {
  id: string
  name: string
  kind: 'character' | 'background'
  role?: string
  description: string
  prompt: string
  imageUrl?: string
  selectedAssetId?: string
  status: PictureBookGenerationStatus
}

export interface PictureBookStoryboardPage {
  pageId: string
  pageNumber: number
  imagePrompt: string
  dialogueZh: string
  dialogueEn: string
  imageUrl?: string
  audioZhUrl?: string
  audioEnUrl?: string
  imageStatus: PictureBookGenerationStatus
  audioZhStatus: PictureBookGenerationStatus
  audioEnStatus: PictureBookGenerationStatus
}

export interface PictureBookState {
  steps: { active: PictureBookStepId; completed: PictureBookStepId[] }
  script: { summaryZh: string; pages: PictureBookPageScript[] }
  assets: { characters: PictureBookElement[]; backgrounds: PictureBookElement[] }
  storyboard: PictureBookStoryboardPage[]
  settings: {
    style: PictureBookStyle
    pageCount: PictureBookPageCount
    textModel: typeof PICTURE_BOOK_TEXT_MODEL
    imageModel: typeof PICTURE_BOOK_IMAGE_MODEL
    ttsModel: typeof PICTURE_BOOK_TTS_MODEL
    voiceZhId?: string
    voiceEnId?: string
    billingMode: 'project'
  }
  draft: { savedAt?: string; dirty: boolean; lastError?: string }
}

export function isPictureBookStyle(value: unknown): value is PictureBookStyle {
  return typeof value === 'string' && PICTURE_BOOK_STYLES.includes(value as PictureBookStyle)
}

export function isPictureBookPageCount(value: unknown): value is PictureBookPageCount {
  return typeof value === 'number' && PICTURE_BOOK_PAGE_COUNTS.includes(value as PictureBookPageCount)
}

export function makeDefaultPictureBookState(input: { style?: unknown; pageCount?: unknown } = {}): PictureBookState {
  return {
    steps: { active: 'script', completed: [] },
    script: { summaryZh: '', pages: [] },
    assets: { characters: [], backgrounds: [] },
    storyboard: [],
    settings: {
      style: isPictureBookStyle(input.style) ? input.style : '吉卜力风',
      pageCount: isPictureBookPageCount(input.pageCount) ? input.pageCount : 10,
      textModel: PICTURE_BOOK_TEXT_MODEL,
      imageModel: PICTURE_BOOK_IMAGE_MODEL,
      ttsModel: PICTURE_BOOK_TTS_MODEL,
      billingMode: 'project',
    },
    draft: { dirty: false },
  }
}

export function normalizePictureBookState(value: unknown): PictureBookState {
  const raw = value && typeof value === 'object' ? value as Partial<PictureBookState> : {}
  const defaults = makeDefaultPictureBookState(raw.settings ?? {})
  return {
    ...defaults,
    ...raw,
    steps: { ...defaults.steps, ...(raw.steps ?? {}) },
    script: { ...defaults.script, ...(raw.script ?? {}) },
    assets: { ...defaults.assets, ...(raw.assets ?? {}) },
    storyboard: Array.isArray(raw.storyboard) ? raw.storyboard : defaults.storyboard,
    settings: { ...defaults.settings, ...(raw.settings ?? {}), textModel: PICTURE_BOOK_TEXT_MODEL, imageModel: PICTURE_BOOK_IMAGE_MODEL, ttsModel: PICTURE_BOOK_TTS_MODEL, billingMode: 'project' },
    draft: { ...defaults.draft, ...(raw.draft ?? {}) },
  }
}
```

- [ ] **Step 4: Export types**

Modify `packages/types/src/index.ts`:

```ts
export * from './picture-book.js'
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/picture-book.test.ts
pnpm --filter @aigc/types build
```

Expected: both pass.

Commit:

```bash
git add packages/types/src/picture-book.ts packages/types/src/picture-book.test.ts packages/types/src/index.ts
git commit -m "feat: add picture book shared types"
```

---

### Task 2: Database Schema And Kysely Types

**Files:**
- Create: `packages/db/migrations/048_picture_book.ts`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add migration**

Create `packages/db/migrations/048_picture_book.ts`:

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('picture_book_projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'text', (col) => col.notNull().defaultTo('未命名绘本'))
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('style', 'text', (col) => col.notNull())
    .addColumn('page_count', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('draft'))
    .addColumn('active_step', 'text', (col) => col.notNull().defaultTo('script'))
    .addColumn('cover_url', 'text')
    .addColumn('state', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('draft_saved_at', 'timestamptz')
    .addColumn('estimated_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('actual_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_page_count CHECK (page_count IN (10, 15, 20))`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_status CHECK (status IN ('draft', 'script_ready', 'assets_ready', 'storyboard_ready', 'completed', 'failed'))`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_active_step CHECK (active_step IN ('script', 'assets', 'storyboard', 'preview'))`.execute(db)

  await db.schema.createIndex('idx_picture_book_projects_workspace_updated').on('picture_book_projects').columns(['workspace_id', 'updated_at desc']).execute()
  await db.schema.createIndex('idx_picture_book_projects_workspace_deleted').on('picture_book_projects').columns(['workspace_id', 'is_deleted', 'updated_at desc']).execute()
  await db.schema.createIndex('idx_picture_book_projects_user_updated').on('picture_book_projects').columns(['user_id', 'updated_at desc']).execute()

  await db.schema
    .createTable('picture_book_project_charges')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) => col.notNull().references('picture_book_projects.id').onDelete('cascade'))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('charge_type', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('target_count', 'integer', (col) => col.notNull())
    .addColumn('estimated_credits', 'integer', (col) => col.notNull())
    .addColumn('actual_credits', 'integer')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('batch_ids', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE picture_book_project_charges ADD CONSTRAINT chk_picture_book_charge_status CHECK (status IN ('pending', 'processing', 'completed', 'partial_failed', 'failed', 'refunded'))`.execute(db)
  await db.schema.createIndex('idx_picture_book_charges_project').on('picture_book_project_charges').column('project_id').execute()

  await db.schema
    .createTable('picture_book_project_assets')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) => col.notNull().references('picture_book_projects.id').onDelete('cascade'))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('ref_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('selected_asset_url', 'text')
    .addColumn('selected_asset_id', 'uuid')
    .addColumn('batch_id', 'uuid', (col) => col.references('task_batches.id').onDelete('set null'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE picture_book_project_assets ADD CONSTRAINT chk_picture_book_asset_kind CHECK (kind IN ('character', 'background', 'page_image', 'page_audio_zh', 'page_audio_en'))`.execute(db)
  await sql`ALTER TABLE picture_book_project_assets ADD CONSTRAINT chk_picture_book_asset_status CHECK (status IN ('idle', 'pending', 'processing', 'completed', 'failed'))`.execute(db)
  await db.schema.createIndex('idx_picture_book_assets_project').on('picture_book_project_assets').column('project_id').execute()
  await db.schema.createIndex('idx_picture_book_assets_unique_ref').on('picture_book_project_assets').columns(['project_id', 'kind', 'ref_id']).unique().execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('picture_book_project_id', 'uuid', (col) => col.references('picture_book_projects.id').onDelete('set null'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('task_batches').dropColumn('picture_book_project_id').execute()
  await db.schema.dropIndex('idx_picture_book_assets_unique_ref').execute()
  await db.schema.dropIndex('idx_picture_book_assets_project').execute()
  await db.schema.dropTable('picture_book_project_assets').execute()
  await db.schema.dropIndex('idx_picture_book_charges_project').execute()
  await db.schema.dropTable('picture_book_project_charges').execute()
  await db.schema.dropIndex('idx_picture_book_projects_user_updated').execute()
  await db.schema.dropIndex('idx_picture_book_projects_workspace_deleted').execute()
  await db.schema.dropIndex('idx_picture_book_projects_workspace_updated').execute()
  await db.schema.dropTable('picture_book_projects').execute()
}
```

- [ ] **Step 2: Add schema interfaces**

Modify `packages/db/src/schema.ts` to add table interfaces matching the migration and add:

```ts
export interface DB {
  // existing entries stay untouched
  picture_book_projects: PictureBookProjectsTable
  picture_book_project_charges: PictureBookProjectChargesTable
  picture_book_project_assets: PictureBookProjectAssetsTable
}
```

Add `picture_book_project_id: string | null` to `TaskBatchesTable`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @aigc/db build
```

Expected: pass.

Commit:

```bash
git add packages/db/migrations/048_picture_book.ts packages/db/src/schema.ts
git commit -m "feat: add picture book database schema"
```

---

### Task 3: Seed Picture Book Default Models

**Files:**
- Modify: `packages/db/scripts/seed.ts`

- [ ] **Step 1: Inspect current seed**

Run:

```bash
rg -n "qwen3.6-plus|speech-2.8-hd|seedream-5.0-lite" packages/db/scripts/seed.ts
```

Expected: all three model codes are present.

- [ ] **Step 2: Add explicit picture book comments and defaults**

Modify `packages/db/scripts/seed.ts` near existing Qwen, Volc image, and MiniMax TTS model blocks so the defaults remain explicit:

```ts
// Picture book defaults:
// - text / script split: qwen3.6-plus
// - image: seedream-5.0-lite
// - tts: speech-2.8-hd
```

Ensure `seedream-5.0-lite` remains under `module: 'image'`, `speech-2.8-hd` remains under `module: 'tts'`, and Qwen defaults to `process.env.QWEN_MODEL?.trim() || 'qwen3.6-plus'`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @aigc/db exec tsx scripts/seed.ts --help
```

Expected: if the script does not support `--help`, it may attempt DB access; in that case stop and run `pnpm --filter @aigc/db build` instead. The build must pass.

Commit:

```bash
git add packages/db/scripts/seed.ts
git commit -m "chore: document picture book default models in seed"
```

---

### Task 4: API Shared Helpers And Tests

**Files:**
- Create: `apps/api/src/routes/picture-book/_shared.ts`
- Test: `apps/api/src/__tests__/picture-book-validation.test.ts`

- [ ] **Step 1: Write tests for parsing and validation**

Create `apps/api/src/__tests__/picture-book-validation.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePictureBookJson,
  validatePictureBookTargets,
  calculateProjectChargeTotal,
} from '../routes/picture-book/_shared.js'

test('parsePictureBookJson extracts JSON object from fenced text', () => {
  const parsed = parsePictureBookJson('```json\n{"title":"小狗","pages":[]}\n```')
  assert.equal(parsed.title, '小狗')
})

test('validatePictureBookTargets rejects empty target list', () => {
  assert.throws(() => validatePictureBookTargets([]), /至少选择 1 个生成目标/)
})

test('calculateProjectChargeTotal sums completed and processing charges', () => {
  const total = calculateProjectChargeTotal([
    { estimated_credits: 2, actual_credits: 3, status: 'completed' },
    { estimated_credits: 5, actual_credits: null, status: 'processing' },
    { estimated_credits: 7, actual_credits: null, status: 'refunded' },
  ])
  assert.deepEqual(total, { estimatedCredits: 7, actualCredits: 3 })
})
```

- [ ] **Step 2: Implement helpers**

Create `apps/api/src/routes/picture-book/_shared.ts`:

```ts
import { getDb } from '@aigc/db'
import {
  PICTURE_BOOK_IMAGE_MODEL,
  PICTURE_BOOK_TEXT_MODEL,
  PICTURE_BOOK_TTS_MODEL,
  normalizePictureBookState,
  type PictureBookAssetKind,
} from '@aigc/types'

export const PICTURE_BOOK_MODELS = {
  text: PICTURE_BOOK_TEXT_MODEL,
  image: PICTURE_BOOK_IMAGE_MODEL,
  tts: PICTURE_BOOK_TTS_MODEL,
} as const

export function parsePictureBookJson(raw: string): any {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('AI 返回格式错误，请重试')
  }
}

export function validatePictureBookTargets(targets: Array<{ kind: PictureBookAssetKind; ref_id: string }>) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('至少选择 1 个生成目标')
  for (const target of targets) {
    if (!target.ref_id?.trim()) throw new Error('生成目标缺少 ref_id')
  }
}

export function calculateProjectChargeTotal(charges: Array<{ estimated_credits: number; actual_credits: number | null; status: string }>) {
  return charges.reduce((acc, charge) => {
    if (charge.status === 'refunded' || charge.status === 'failed') return acc
    acc.estimatedCredits += charge.estimated_credits
    acc.actualCredits += charge.actual_credits ?? 0
    return acc
  }, { estimatedCredits: 0, actualCredits: 0 })
}

export async function assertPictureBookWorkspaceAccess(workspaceId: string, userId: string, write = false) {
  const db = getDb()
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select(['workspaces.team_id', 'workspace_members.role'])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .executeTakeFirst()
  if (!member) return null
  if (write && member.role === 'viewer') return null
  return { teamId: member.team_id, role: member.role }
}

export async function assertPictureBookProjectAccess(projectId: string, userId: string, write = false) {
  const db = getDb()
  const project = await db
    .selectFrom('picture_book_projects as p')
    .innerJoin('workspace_members as wm', 'wm.workspace_id', 'p.workspace_id')
    .select(['p.id', 'p.workspace_id', 'p.team_id', 'p.user_id', 'p.state', 'p.is_deleted', 'wm.role'])
    .where('p.id', '=', projectId)
    .where('wm.user_id', '=', userId)
    .executeTakeFirst()
  if (!project || project.is_deleted) return null
  if (write && project.role === 'viewer') return null
  return { ...project, state: normalizePictureBookState(project.state) }
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api exec tsx src/__tests__/picture-book-validation.test.ts
pnpm --filter @aigc/api build
```

Expected: both pass.

Commit:

```bash
git add apps/api/src/routes/picture-book/_shared.ts apps/api/src/__tests__/picture-book-validation.test.ts
git commit -m "feat: add picture book api helpers"
```

---

### Task 5: Project CRUD And Draft API

**Files:**
- Create: `apps/api/src/routes/picture-book/get-projects.ts`
- Create: `apps/api/src/routes/picture-book/get-project-id.ts`
- Create: `apps/api/src/routes/picture-book/put-project-id.ts`
- Create: `apps/api/src/routes/picture-book/delete-project-id.ts`

- [ ] **Step 1: Implement list/recent routes**

Create `apps/api/src/routes/picture-book/get-projects.ts` with:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertPictureBookWorkspaceAccess } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { workspace_id: string; limit?: number } }>('/picture-book/projects/recent', async (request, reply) => {
    const access = await assertPictureBookWorkspaceAccess(request.query.workspace_id, request.user.id)
    if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权访问该工作区' } })
    const limit = Math.min(Math.max(Number(request.query.limit ?? 4), 1), 20)
    const rows = await getDb()
      .selectFrom('picture_book_projects')
      .selectAll()
      .where('workspace_id', '=', request.query.workspace_id)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute()
    return rows
  })

  app.get<{ Querystring: { workspace_id: string; limit?: number } }>('/picture-book/projects', async (request, reply) => {
    const access = await assertPictureBookWorkspaceAccess(request.query.workspace_id, request.user.id)
    if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权访问该工作区' } })
    const limit = Math.min(Math.max(Number(request.query.limit ?? 30), 1), 100)
    const rows = await getDb()
      .selectFrom('picture_book_projects')
      .selectAll()
      .where('workspace_id', '=', request.query.workspace_id)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute()
    return rows
  })
}

export default route
```

- [ ] **Step 2: Implement detail and charges route**

Create `apps/api/src/routes/picture-book/get-project-id.ts` with `GET /picture-book/projects/:id` and `GET /picture-book/projects/:id/charges`, using `assertPictureBookProjectAccess`, `calculateProjectChargeTotal`, and returning normalized state.

- [ ] **Step 3: Implement upsert/draft/name routes**

Create `apps/api/src/routes/picture-book/put-project-id.ts` with:

- `PUT /picture-book/projects/:id`
- `PATCH /picture-book/projects/:id/draft`
- `PATCH /picture-book/projects/:id/name`

Use `sql\`now()\`` for `updated_at` and `draft_saved_at`.

- [ ] **Step 4: Implement delete/restore routes**

Create `apps/api/src/routes/picture-book/delete-project-id.ts` with:

- `DELETE /picture-book/projects/:id`
- `POST /picture-book/projects/:id/restore`
- `DELETE /picture-book/projects/:id/permanent`

Mirror `video-studio/delete-project-id.ts` behavior.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/picture-book
git commit -m "feat: add picture book project routes"
```

---

### Task 6: Qwen Script And Prompt Generation Routes

**Files:**
- Create: `apps/api/src/routes/picture-book/post-script.ts`
- Create: `apps/api/src/routes/picture-book/post-asset-prompts.ts`
- Create: `apps/api/src/routes/picture-book/post-storyboard-prompts.ts`

- [ ] **Step 1: Implement `POST /picture-book/script`**

Create `apps/api/src/routes/picture-book/post-script.ts`. Use Qwen OpenAI-compatible call pattern from `apps/api/src/routes/canvas-agent/post-text-gen.ts` and provider audit helper. The route must:

- validate workspace access
- require `prompt`, `style`, `page_count`
- call `qwen3.6-plus`
- parse strict JSON
- create `picture_book_projects` with `status='draft'`
- create `picture_book_project_charges` with `charge_type='script_generate'`
- return project id and generated state

Use this system prompt shape:

```ts
const systemPrompt = `你是专业儿童绘本编剧。请严格输出 JSON 对象，不要输出 markdown。故事摘要只用中文。脚本结构不区分中英文，但每页必须提供中文台词/旁白 dialogueZh 和英文台词/旁白 dialogueEn。`
```

- [ ] **Step 2: Implement asset prompt regeneration**

Create `apps/api/src/routes/picture-book/post-asset-prompts.ts`. It reads the project state, calls Qwen with the current script, and replaces `state.assets.characters/backgrounds` without generating images.

- [ ] **Step 3: Implement storyboard prompt generation**

Create `apps/api/src/routes/picture-book/post-storyboard-prompts.ts`. It reads project state and asset image URLs, calls Qwen, and writes `state.storyboard` with `imagePrompt`, `dialogueZh`, `dialogueEn`, and all generation statuses as `idle`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/picture-book/post-script.ts apps/api/src/routes/picture-book/post-asset-prompts.ts apps/api/src/routes/picture-book/post-storyboard-prompts.ts
git commit -m "feat: add picture book qwen generation routes"
```

---

### Task 7: Project Image And Audio Generation Routes

**Files:**
- Create: `apps/api/src/routes/picture-book/post-generate-assets.ts`
- Create: `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts`
- Create: `apps/api/src/routes/picture-book/post-generate-storyboard-audio.ts`
- Create: `apps/api/src/routes/picture-book/post-sync-batches.ts`
- Modify: `apps/api/src/routes/generate/post-image.ts`
- Modify: `apps/api/src/routes/tts/post-generate.ts`

- [ ] **Step 1: Extend existing generation routes with project id**

Modify image and TTS route schemas to accept `picture_book_project_id?: string`, then write it into `task_batches` when present:

```ts
picture_book_project_id: { type: 'string', format: 'uuid' }
```

and in insert values:

```ts
...(pictureBookProjectId ? { picture_book_project_id: pictureBookProjectId } : {})
```

- [ ] **Step 2: Implement asset image generation orchestration**

Create `post-generate-assets.ts`. For each target, create a project charge, call the same internal logic or HTTP-compatible helper used by `/generate/image` with model `seedream-5.0-lite`, and update `picture_book_project_assets`.

- [ ] **Step 3: Implement storyboard image generation orchestration**

Create `post-generate-storyboard-images.ts`. It targets `state.storyboard`, submits page image jobs, and writes `page_image` asset rows.

- [ ] **Step 4: Implement storyboard audio generation**

Create `post-generate-storyboard-audio.ts`. It loops targets with bounded concurrency of 2, calls MiniMax TTS model `speech-2.8-hd`, stores assets as audio, and creates project charge rows for `page_audio_zh` and `page_audio_en`.

- [ ] **Step 5: Implement sync route**

Create `post-sync-batches.ts`. It loads batches linked by `picture_book_project_id`, assets linked by those batches, then updates project state URLs and statuses.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/picture-book/post-generate-assets.ts apps/api/src/routes/picture-book/post-generate-storyboard-images.ts apps/api/src/routes/picture-book/post-generate-storyboard-audio.ts apps/api/src/routes/picture-book/post-sync-batches.ts apps/api/src/routes/generate/post-image.ts apps/api/src/routes/tts/post-generate.ts
git commit -m "feat: add picture book media generation routes"
```

---

### Task 8: Frontend API, Hooks, And State Helpers

**Files:**
- Create: `apps/web/src/lib/picture-book/types.ts`
- Create: `apps/web/src/lib/picture-book/api.ts`
- Create: `apps/web/src/hooks/picture-book/use-picture-book-project.ts`

- [ ] **Step 1: Add frontend API wrappers**

Create `apps/web/src/lib/picture-book/api.ts`:

```ts
import { fetchWithAuth } from '@/lib/api-client'
import type { PictureBookState } from '@aigc/types'

export function listRecentPictureBooks(workspaceId: string) {
  return fetchWithAuth(`/picture-book/projects/recent?workspace_id=${workspaceId}&limit=4`)
}

export function getPictureBookProject(projectId: string) {
  return fetchWithAuth(`/picture-book/projects/${projectId}`)
}

export function savePictureBookDraft(projectId: string, state: PictureBookState) {
  return fetchWithAuth(`/picture-book/projects/${projectId}/draft`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
}
```

- [ ] **Step 2: Add project hook**

Create `apps/web/src/hooks/picture-book/use-picture-book-project.ts` with SWR for project load and a debounced `saveDraft` using `setTimeout` at 1200 ms. Flush on unmount and `visibilitychange`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass after component imports are added in later tasks; if build fails only because components do not exist yet, defer full build to Task 11 and run `pnpm --filter @aigc/web exec tsc --noEmit --pretty false` after components are created.

Commit:

```bash
git add apps/web/src/lib/picture-book apps/web/src/hooks/picture-book
git commit -m "feat: add picture book frontend api hooks"
```

---

### Task 9: Picture Book Home And Project List

**Files:**
- Create: `apps/web/src/components/picture-book/picture-book-home.tsx`
- Create: `apps/web/src/components/picture-book/picture-book-project-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/toby-studio/picture-book/page.tsx`
- Create: `apps/web/src/app/(dashboard)/toby-studio/picture-book/projects/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/toby-studio/page.tsx`

- [ ] **Step 1: Build project card**

Create `picture-book-project-card.tsx` with title, cover, page count, status badge, draft saved time, and link target.

- [ ] **Step 2: Build home**

Create `picture-book-home.tsx` with:

- centered AI generation panel
- prompt textarea
- style select
- page count select
- generate button with duplicate-submit guard
- recent 4 cards
- loading/error/empty states

- [ ] **Step 3: Wire routes and Toby Studio card**

Replace placeholder page and mark AI 绘本 as available in Toby Studio root page.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass.

Commit:

```bash
git add apps/web/src/components/picture-book/picture-book-home.tsx apps/web/src/components/picture-book/picture-book-project-card.tsx apps/web/src/app/(dashboard)/toby-studio/picture-book/page.tsx apps/web/src/app/(dashboard)/toby-studio/picture-book/projects/page.tsx apps/web/src/app/(dashboard)/toby-studio/page.tsx
git commit -m "feat: add picture book home and list"
```

---

### Task 10: Four-Step Project Editor UI

**Files:**
- Create: `apps/web/src/components/picture-book/picture-book-stepper.tsx`
- Create: `apps/web/src/components/picture-book/step-script-outline.tsx`
- Create: `apps/web/src/components/picture-book/step-assets.tsx`
- Create: `apps/web/src/components/picture-book/step-storyboard.tsx`
- Create: `apps/web/src/components/picture-book/step-preview.tsx`
- Create: `apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx`

- [ ] **Step 1: Build stepper**

Create a top horizontal stepper with completed/current/locked states and theme-aware colors.

- [ ] **Step 2: Build script outline step**

Create summary textarea and page carousel card with fields:

- title
- visualDescriptionZh
- dialogueZh
- dialogueEn

Validate before continuing.

- [ ] **Step 3: Build assets step**

Create role/background tabs and cards with prompt editing, image state, generate/regenerate buttons, and batch action.

- [ ] **Step 4: Build storyboard step**

Create page card grid with image prompt, dialogueZh, dialogueEn, image/audio status, and per-item retry actions.

- [ ] **Step 5: Build preview step**

Create language switch, page navigation, audio playback, and missing asset warnings.

- [ ] **Step 6: Wire editor page**

Create `[id]/page.tsx` that loads the project, renders active step, and uses the draft save hook.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass.

Commit:

```bash
git add apps/web/src/components/picture-book apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx
git commit -m "feat: add picture book editor wizard"
```

---

### Task 11: End-To-End Verification

**Files:**
- Modify only files needed for fixes discovered during verification.

- [ ] **Step 1: Run full relevant builds**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/db build
pnpm --filter @aigc/api build
pnpm --filter @aigc/web build
```

Expected: all pass.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/picture-book.test.ts
pnpm --filter @aigc/api exec tsx src/__tests__/picture-book-validation.test.ts
```

Expected: all pass.

- [ ] **Step 3: Browser QA**

Start the dev server:

```bash
pnpm --filter @aigc/web dev
```

Open `http://localhost:6006/toby-studio/picture-book` in Browser and verify:

- homepage renders in light and dark theme
- prompt/style/page count controls fit on desktop and mobile
- recent projects shows loading/empty/success state
- project editor stepper does not overlap
- script carousel text fits
- assets cards and storyboard cards do not overflow

- [ ] **Step 4: Commit verification fixes**

If fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: polish picture book verification issues"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: the plan covers shared types, DB schema, seed defaults, project CRUD, draft saving, Qwen script/prompt generation, Seedream image generation, MiniMax bilingual TTS, project-level charges, frontend home/list/editor/preview, theme-aware UI, and verification.
- Placeholder scan: every task has concrete files, commands, and expected results.
- Type consistency: model constants are `qwen3.6-plus`, `seedream-5.0-lite`, and `speech-2.8-hd`; language fields are `dialogueZh` and `dialogueEn`; project billing uses `picture_book_project_charges`.
