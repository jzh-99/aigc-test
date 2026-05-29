# Toby Studio AI 短剧模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Toby Studio AI 短剧 MVP from creative prompt to episode MP4 export, including project workflow, script generation, asset library, segment video generation, batch sync, billing, and export worker.

**Architecture:** Short drama owns its project state, episode state, segment state, and export state in `short_drama_projects.state`, while media generation reuses existing `task_batches`, `tasks`, `assets`, credits, provider audit, and storage infrastructure. API routes orchestrate project CRUD, text generation, asset/image/video generation, sync, upload, and export submission; worker owns ffmpeg episode concatenation and export result persistence. Frontend follows the existing Toby Studio / AI 绘本 wizard pattern with a three-step locked flow and a dedicated episode editor.

**Tech Stack:** pnpm 10, Turborepo, TypeScript, Kysely, PostgreSQL, Fastify 4, BullMQ, Redis, Next.js 14 App Router, SWR, Tailwind CSS, Radix UI, lucide-react, Qwen `qwen3.6-plus`, existing image/video generation providers, S3/MinIO-compatible storage, fluent-ffmpeg/ffmpeg.

---

## Scope Check

The spec covers frontend, API, database, media generation, worker export, billing, and verification. These subsystems are coupled by the short-drama state machine and must ship as one MVP, but implementation should be split into independently testable tasks. Each task below produces a coherent checkpoint and should be implemented with TDD where practical.

Do not submit `.superpowers/brainstorm/` files. They are local visual companion artifacts.

---

## File Structure

Create or modify these files:

### Shared types

- Create: `packages/types/src/short-drama.ts`  
  Shared constants, unions, state interfaces, validation helpers, default state factory, and normalize helpers.
- Create: `packages/types/src/short-drama.test.ts`  
  Executable tests for episode count, aspect ratio, duration, step lock, asset scope, and state normalization.
- Modify: `packages/types/src/index.ts`  
  Export short drama shared types.
- Modify: `packages/types/src/queue.ts`  
  Add short-drama export job data and optional short-drama context fields for media jobs if the current queue types require them.

### Database

- Create: `packages/db/migrations/052_short_drama.ts`  
  Add `short_drama_projects`, short-drama context fields on `task_batches`, and source fields on `assets` only if `051_batch_source.ts` does not already provide equivalent source metadata.
- Modify: `packages/db/src/schema.ts`  
  Add Kysely table interfaces and optional short-drama fields.
- Modify: `packages/db/scripts/seed.ts`  
  Seed or document `short_drama_episode_export_credits` in the existing system cost config mechanism.

### API

- Create: `apps/api/src/routes/short-drama/_shared.ts`  
  Access checks, JSON parsing, state helpers, source constants, duration validation, mention reference resolution, billing/config helpers.
- Create: `apps/api/src/__tests__/short-drama-validation.test.ts`  
  Tests for helper functions and validation behavior.
- Create: `apps/api/src/routes/short-drama/post-projects.ts`  
  Create project.
- Create: `apps/api/src/routes/short-drama/get-projects.ts`  
  List/recent projects.
- Create: `apps/api/src/routes/short-drama/get-project-id.ts`  
  Project detail and export status.
- Create: `apps/api/src/routes/short-drama/put-project-id.ts`  
  Save state, title, cover, active step, and draft timestamp.
- Create: `apps/api/src/routes/short-drama/delete-project-id.ts`  
  Soft delete.
- Create: `apps/api/src/routes/short-drama/post-script-summary.ts`  
  Generate script summary, streaming-compatible.
- Create: `apps/api/src/routes/short-drama/post-episode-outlines.ts`  
  Generate all episode outlines.
- Create: `apps/api/src/routes/short-drama/post-asset-prompts.ts`  
  Generate global asset prompts.
- Create: `apps/api/src/routes/short-drama/post-generate-assets.ts`  
  Generate selected asset images using existing image generation infrastructure.
- Create: `apps/api/src/routes/short-drama/post-upload-asset.ts`  
  Upload/attach asset image with global or episode scope.
- Create: `apps/api/src/routes/short-drama/post-generate-segments.ts`  
  Generate detailed segments for one episode.
- Create: `apps/api/src/routes/short-drama/post-generate-segment-video.ts`  
  Submit one segment video generation with validated mention image references and duration.
- Create: `apps/api/src/routes/short-drama/post-sync-batches.ts`  
  Sync asset image batches, segment video batches, and export jobs into project state.
- Create: `apps/api/src/routes/short-drama/post-export-episode.ts`  
  Submit one episode export job.
- Create: `apps/api/src/routes/short-drama/post-export-batch.ts`  
  Submit multiple episode export jobs after full balance pre-check.

### Worker

- Create: `apps/worker/src/workers/short-drama-export.ts`  
  BullMQ worker that downloads segment videos, validates input, concat/transcodes with ffmpeg, uploads MP4, updates state, and finalizes billing.
- Create: `apps/worker/src/workers/short-drama-export.test.ts`  
  Tests for export input validation and concat manifest generation.
- Modify: `apps/worker/src/index.ts`  
  Register the short-drama export worker.

### Frontend

- Create: `apps/web/src/lib/short-drama/api.ts`  
  API wrappers using the existing auth fetch helper.
- Create: `apps/web/src/lib/short-drama/styles.ts`  
  Static first-version style library and style tabs.
- Create: `apps/web/src/hooks/short-drama/use-short-drama-project.ts`  
  SWR project hook, draft save, sync polling, and mutation helpers.
- Create: `apps/web/src/components/short-drama/short-drama-home.tsx`  
  Home creative prompt and recent projects.
- Create: `apps/web/src/components/short-drama/short-drama-style-dialog.tsx`  
  Style tabs and custom style entry.
- Create: `apps/web/src/components/short-drama/short-drama-project-card.tsx`  
  Recent/list project card.
- Create: `apps/web/src/components/short-drama/short-drama-stepper.tsx`  
  Picture-book-style horizontal stepper.
- Create: `apps/web/src/components/short-drama/step-script-outline.tsx`  
  Original prompt, summary editor, episode outline editor, confirm lock.
- Create: `apps/web/src/components/short-drama/step-assets.tsx`  
  Asset prompt list, generate/upload/confirm.
- Create: `apps/web/src/components/short-drama/step-episodes.tsx`  
  Episode cards, status aggregation, export actions.
- Create: `apps/web/src/components/short-drama/episode-editor.tsx`  
  Three-column episode editor layout.
- Create: `apps/web/src/components/short-drama/asset-library-panel.tsx`  
  Global and episode asset browser/upload.
- Create: `apps/web/src/components/short-drama/segment-list.tsx`  
  Segment list, add/delete/copy/reorder.
- Create: `apps/web/src/components/short-drama/segment-prompt-editor.tsx`  
  Prompt editor with `@` mention insertion.
- Create: `apps/web/src/components/short-drama/duration-tag.tsx`  
  Non-deletable duration selector.
- Create: `apps/web/src/components/short-drama/episode-preview-panel.tsx`  
  Sequential preview and export panel.
- Modify: `apps/web/src/app/(dashboard)/toby-studio/short-drama/page.tsx`  
  Replace placeholder with home page.
- Create: `apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/page.tsx`  
  Project editor page.
- Create: `apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/episodes/[episodeId]/page.tsx`  
  Episode editor page.

### Documentation

- Already modified: `README.md`  
  Contains confirmed AI 短剧 generation chain.
- Already created: `docs/superpowers/specs/2026-05-29-short-drama-design.md`  
  Confirmed design spec.
- Create: `docs/superpowers/plans/2026-05-29-short-drama.md`  
  This implementation plan.

---

### Task 1: Shared Short Drama Types

**Files:**
- Create: `packages/types/src/short-drama.ts`
- Create: `packages/types/src/short-drama.test.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/types/src/short-drama.test.ts`:

```ts
import assert from 'node:assert/strict'
import {
  SHORT_DRAMA_ASPECT_RATIOS,
  SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
  SHORT_DRAMA_EPISODE_COUNTS,
  SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT,
  canEnterShortDramaStep,
  isShortDramaAspectRatio,
  isShortDramaDurationSeconds,
  isShortDramaEpisodeCount,
  makeDefaultShortDramaState,
  normalizeShortDramaState,
  sortShortDramaSegments,
} from './short-drama.js'

assert.deepEqual(SHORT_DRAMA_ASPECT_RATIOS, ['9:16', '16:9'])
assert.deepEqual(SHORT_DRAMA_EPISODE_COUNTS, [5, 10, 15, 20])
assert.equal(SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT, 50)
assert.equal(SHORT_DRAMA_DEFAULT_DURATION_SECONDS, 4)
assert.equal(isShortDramaAspectRatio('9:16'), true)
assert.equal(isShortDramaAspectRatio('1:1'), false)
assert.equal(isShortDramaEpisodeCount(5), true)
assert.equal(isShortDramaEpisodeCount(50), true)
assert.equal(isShortDramaEpisodeCount(51), false)
assert.equal(isShortDramaDurationSeconds(4, [4, 5, 8]), true)
assert.equal(isShortDramaDurationSeconds(6, [4, 5, 8]), false)

const state = makeDefaultShortDramaState({
  prompt: '落魄千金回村创业',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 20,
})
assert.equal(state.steps.active, 'script')
assert.equal(state.script.originalPrompt, '落魄千金回村创业')
assert.equal(state.settings.style, '真人都市')
assert.equal(state.settings.aspectRatio, '9:16')
assert.equal(state.settings.episodeCount, 20)
assert.equal(state.settings.billingMode, 'estimate_actual')
assert.equal(state.locks.script, false)
assert.equal(canEnterShortDramaStep(state, 'assets'), false)

const locked = normalizeShortDramaState({
  steps: { active: 'episodes', completed: ['script', 'assets'] },
  locks: { script: true, assets: true },
  settings: { aspectRatio: 'bad', episodeCount: 200 },
})
assert.equal(locked.settings.aspectRatio, '9:16')
assert.equal(locked.settings.episodeCount, 5)
assert.equal(canEnterShortDramaStep(locked, 'episodes'), true)

const sorted = sortShortDramaSegments([
  { id: 'b', order: 2, title: 'B', prompt: '', mentionRefs: [], durationSeconds: 4, status: 'idle' },
  { id: 'a', order: 1, title: 'A', prompt: '', mentionRefs: [], durationSeconds: 4, status: 'idle' },
])
assert.deepEqual(sorted.map(segment => segment.id), ['a', 'b'])
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/short-drama.test.ts
```

Expected: fail because `short-drama.ts` does not exist.

- [ ] **Step 3: Add shared types and helpers**

Create `packages/types/src/short-drama.ts`:

```ts
export const SHORT_DRAMA_STYLE_TABS = ['全部', '真人', '2D', '3D'] as const
export const SHORT_DRAMA_ASPECT_RATIOS = ['9:16', '16:9'] as const
export const SHORT_DRAMA_EPISODE_COUNTS = [5, 10, 15, 20] as const
export const SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT = 50
export const SHORT_DRAMA_DEFAULT_DURATION_SECONDS = 4
export const SHORT_DRAMA_TEXT_MODEL = 'qwen3.6-plus'
export const SHORT_DRAMA_IMAGE_MODEL = 'seedream-5.0-lite'
export const SHORT_DRAMA_VIDEO_MODEL = 'seedance-1.0-lite'

export type ShortDramaStyleTab = typeof SHORT_DRAMA_STYLE_TABS[number]
export type ShortDramaAspectRatio = typeof SHORT_DRAMA_ASPECT_RATIOS[number]
export type ShortDramaStepId = 'script' | 'assets' | 'episodes'
export type ShortDramaProjectStatus = 'draft' | 'summary_ready' | 'outline_ready' | 'assets_ready' | 'episodes_ready' | 'completed' | 'failed'
export type ShortDramaGenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
export type ShortDramaAssetKind = 'character' | 'scene' | 'prop' | 'material'
export type ShortDramaAssetScope = 'global' | 'episode'
export type ShortDramaEpisodeStatus = 'outline_only' | 'segments_ready' | 'generating' | 'partially_ready' | 'ready_to_preview' | 'exporting' | 'exported' | 'failed'
export type ShortDramaExportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ShortDramaEpisodeOutline {
  id: string
  episodeNumber: number
  title: string
  logline: string
  synopsis: string
  characters: string[]
  scenes: string[]
  hook: string
  segmentStatus: ShortDramaGenerationStatus
}

export interface ShortDramaAsset {
  id: string
  kind: ShortDramaAssetKind
  scope: ShortDramaAssetScope
  episodeId?: string
  name: string
  description: string
  prompt: string
  imageUrl?: string
  assetId?: string
  batchId?: string
  status: ShortDramaGenerationStatus
  error?: string
}

export interface ShortDramaMentionRef {
  assetId: string
  kind: ShortDramaAssetKind
  name: string
}

export interface ShortDramaSegment {
  id: string
  order: number
  title: string
  prompt: string
  mentionRefs: ShortDramaMentionRef[]
  durationSeconds: number
  cameraNote?: string
  actionNote?: string
  dialogueOrSubtitle?: string
  videoUrl?: string
  assetId?: string
  batchId?: string
  status: ShortDramaGenerationStatus
  error?: string
}

export interface ShortDramaEpisode {
  id: string
  episodeNumber: number
  title: string
  outlineId: string
  status: ShortDramaEpisodeStatus
  segments: ShortDramaSegment[]
  previewVideoUrls: string[]
  exportId?: string
  outputUrl?: string
}

export interface ShortDramaEpisodeExport {
  id: string
  episodeId: string
  status: ShortDramaExportStatus
  outputUrl?: string
  assetId?: string
  jobId?: string
  credits?: number
  error?: string
}

export interface ShortDramaBatchExport {
  id: string
  episodeIds: string[]
  status: ShortDramaExportStatus
  completedCount: number
  failedCount: number
  credits?: number
  error?: string
}

export interface ShortDramaState {
  steps: {
    active: ShortDramaStepId
    completed: ShortDramaStepId[]
  }
  locks: {
    script: boolean
    assets: boolean
  }
  script: {
    originalPrompt: string
    summary: string
    episodeOutlines: ShortDramaEpisodeOutline[]
  }
  assets: {
    global: ShortDramaAsset[]
    episodeScoped: Record<string, ShortDramaAsset[]>
  }
  episodes: ShortDramaEpisode[]
  exports: {
    episodeExports: ShortDramaEpisodeExport[]
    batchExports: ShortDramaBatchExport[]
  }
  settings: {
    style: string
    aspectRatio: ShortDramaAspectRatio
    episodeCount: number
    textModel: typeof SHORT_DRAMA_TEXT_MODEL
    imageModel: typeof SHORT_DRAMA_IMAGE_MODEL
    videoModel: string
    billingMode: 'estimate_actual'
  }
  draft: {
    savedAt?: string
    dirty: boolean
    lastError?: string
  }
}

const SHORT_DRAMA_STEP_IDS: ShortDramaStepId[] = ['script', 'assets', 'episodes']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isShortDramaStepId(value: unknown): value is ShortDramaStepId {
  return typeof value === 'string' && SHORT_DRAMA_STEP_IDS.includes(value as ShortDramaStepId)
}

export function isShortDramaAspectRatio(value: unknown): value is ShortDramaAspectRatio {
  return typeof value === 'string' && SHORT_DRAMA_ASPECT_RATIOS.includes(value as ShortDramaAspectRatio)
}

export function isShortDramaEpisodeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT
}

export function isShortDramaDurationSeconds(value: unknown, allowedDurations: number[]): value is number {
  return typeof value === 'number' && Number.isInteger(value) && allowedDurations.includes(value)
}

export function sortShortDramaSegments(segments: ShortDramaSegment[]): ShortDramaSegment[] {
  return [...segments].sort((a, b) => a.order - b.order)
}

export function makeDefaultShortDramaState(input: {
  prompt?: unknown
  style?: unknown
  aspectRatio?: unknown
  episodeCount?: unknown
  videoModel?: unknown
} = {}): ShortDramaState {
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const style = typeof input.style === 'string' && input.style.trim() ? input.style.trim() : '真人都市'

  return {
    steps: { active: 'script', completed: [] },
    locks: { script: false, assets: false },
    script: { originalPrompt: prompt, summary: '', episodeOutlines: [] },
    assets: { global: [], episodeScoped: {} },
    episodes: [],
    exports: { episodeExports: [], batchExports: [] },
    settings: {
      style,
      aspectRatio: isShortDramaAspectRatio(input.aspectRatio) ? input.aspectRatio : '9:16',
      episodeCount: isShortDramaEpisodeCount(input.episodeCount) ? input.episodeCount : 5,
      textModel: SHORT_DRAMA_TEXT_MODEL,
      imageModel: SHORT_DRAMA_IMAGE_MODEL,
      videoModel: typeof input.videoModel === 'string' && input.videoModel.trim() ? input.videoModel.trim() : SHORT_DRAMA_VIDEO_MODEL,
      billingMode: 'estimate_actual',
    },
    draft: { dirty: false },
  }
}

function normalizeStepIds(value: unknown): ShortDramaStepId[] {
  if (!Array.isArray(value)) return []
  return value.filter(isShortDramaStepId)
}

export function normalizeShortDramaState(input: unknown = {}): ShortDramaState {
  const value = isPlainObject(input) ? input : {}
  const settings = isPlainObject(value.settings) ? value.settings : {}
  const fallback = makeDefaultShortDramaState(settings)
  const steps = isPlainObject(value.steps) ? value.steps : {}
  const locks = isPlainObject(value.locks) ? value.locks : {}
  const script = isPlainObject(value.script) ? value.script : {}
  const assets = isPlainObject(value.assets) ? value.assets : {}
  const exportsValue = isPlainObject(value.exports) ? value.exports : {}
  const draft = isPlainObject(value.draft) ? value.draft : {}

  return {
    steps: {
      active: isShortDramaStepId(steps.active) ? steps.active : fallback.steps.active,
      completed: normalizeStepIds(steps.completed),
    },
    locks: {
      script: typeof locks.script === 'boolean' ? locks.script : fallback.locks.script,
      assets: typeof locks.assets === 'boolean' ? locks.assets : fallback.locks.assets,
    },
    script: {
      originalPrompt: typeof script.originalPrompt === 'string' ? script.originalPrompt : fallback.script.originalPrompt,
      summary: typeof script.summary === 'string' ? script.summary : fallback.script.summary,
      episodeOutlines: Array.isArray(script.episodeOutlines) ? script.episodeOutlines as ShortDramaEpisodeOutline[] : [],
    },
    assets: {
      global: Array.isArray(assets.global) ? assets.global as ShortDramaAsset[] : [],
      episodeScoped: isPlainObject(assets.episodeScoped) ? assets.episodeScoped as Record<string, ShortDramaAsset[]> : {},
    },
    episodes: Array.isArray(value.episodes) ? value.episodes as ShortDramaEpisode[] : [],
    exports: {
      episodeExports: Array.isArray(exportsValue.episodeExports) ? exportsValue.episodeExports as ShortDramaEpisodeExport[] : [],
      batchExports: Array.isArray(exportsValue.batchExports) ? exportsValue.batchExports as ShortDramaBatchExport[] : [],
    },
    settings: fallback.settings,
    draft: {
      savedAt: typeof draft.savedAt === 'string' ? draft.savedAt : undefined,
      dirty: typeof draft.dirty === 'boolean' ? draft.dirty : fallback.draft.dirty,
      lastError: typeof draft.lastError === 'string' ? draft.lastError : undefined,
    },
  }
}

export function canEnterShortDramaStep(state: ShortDramaState, step: ShortDramaStepId): boolean {
  if (step === 'script') return true
  if (step === 'assets') return state.locks.script
  if (step === 'episodes') return state.locks.script && state.locks.assets
  return false
}
```

- [ ] **Step 4: Export types**

Modify `packages/types/src/index.ts` and append:

```ts
export * from './short-drama.js'
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/short-drama.test.ts
pnpm --filter @aigc/types build
```

Expected: both pass.

Commit:

```bash
git add packages/types/src/short-drama.ts packages/types/src/short-drama.test.ts packages/types/src/index.ts
git commit -m "feat: add short drama shared types"
```

---

### Task 2: Database Migration And Schema

**Files:**
- Create: `packages/db/migrations/052_short_drama.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/scripts/seed.ts`

- [ ] **Step 1: Add migration**

Create `packages/db/migrations/052_short_drama.ts`:

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('short_drama_projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'text', (col) => col.notNull().defaultTo('未命名短剧'))
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('style', 'varchar(100)', (col) => col.notNull())
    .addColumn('aspect_ratio', 'varchar(10)', (col) => col.notNull())
    .addColumn('episode_count', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('draft'))
    .addColumn('active_step', 'varchar(30)', (col) => col.notNull().defaultTo('script'))
    .addColumn('cover_url', 'text')
    .addColumn('state', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('estimated_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('actual_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('draft_saved_at', 'timestamptz')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_aspect_ratio CHECK (aspect_ratio IN ('9:16','16:9'))`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_episode_count CHECK (episode_count >= 1 AND episode_count <= 50)`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_status CHECK (status IN ('draft','summary_ready','outline_ready','assets_ready','episodes_ready','completed','failed'))`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_active_step CHECK (active_step IN ('script','assets','episodes'))`.execute(db)

  await db.schema.createIndex('idx_short_drama_projects_workspace_updated').on('short_drama_projects').columns(['workspace_id', 'updated_at desc']).execute()
  await db.schema.createIndex('idx_short_drama_projects_workspace_deleted').on('short_drama_projects').columns(['workspace_id', 'is_deleted', 'updated_at desc']).execute()
  await db.schema.createIndex('idx_short_drama_projects_user_updated').on('short_drama_projects').columns(['user_id', 'updated_at desc']).execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('short_drama_project_id', 'uuid', (col) => col.references('short_drama_projects.id').onDelete('set null'))
    .addColumn('short_drama_episode_id', 'text')
    .addColumn('short_drama_segment_id', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task_batches')
    .dropColumn('short_drama_segment_id')
    .dropColumn('short_drama_episode_id')
    .dropColumn('short_drama_project_id')
    .execute()

  await db.schema.dropTable('short_drama_projects').ifExists().execute()
}
```

- [ ] **Step 2: Add Kysely schema interfaces**

Modify `packages/db/src/schema.ts` and add the table type near existing project table interfaces:

```ts
export interface ShortDramaProjectsTable {
  id: string
  workspace_id: string
  team_id: string
  user_id: string
  title: string
  prompt: string
  style: string
  aspect_ratio: string
  episode_count: number
  status: string
  active_step: string
  cover_url: string | null
  state: unknown
  estimated_credits: number
  actual_credits: number
  draft_saved_at: string | null
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}
```

Add to `DB`:

```ts
short_drama_projects: ShortDramaProjectsTable
```

Add these nullable fields to the existing `TaskBatchesTable` interface:

```ts
short_drama_project_id: string | null
short_drama_episode_id: string | null
short_drama_segment_id: string | null
```

- [ ] **Step 3: Seed export cost config**

Modify `packages/db/scripts/seed.ts` near existing system cost config seed logic and ensure this key exists:

```ts
{
  key: 'short_drama_episode_export_credits',
  name: 'AI 短剧单集合成导出费用',
  value: 2,
  description: '每导出 1 集 AI 短剧 MP4 固定消耗的 A豆数量',
  enabled: true,
}
```

If the actual seed helper uses a different property name, map the same values to the existing shape. Keep the config key exactly `short_drama_episode_export_credits`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/db build
```

Expected: pass.

Commit:

```bash
git add packages/db/migrations/052_short_drama.ts packages/db/src/schema.ts packages/db/scripts/seed.ts
git commit -m "feat: add short drama database schema"
```

---

### Task 3: API Shared Helpers And Tests

**Files:**
- Create: `apps/api/src/routes/short-drama/_shared.ts`
- Create: `apps/api/src/__tests__/short-drama-validation.test.ts`

- [ ] **Step 1: Write helper tests**

Create `apps/api/src/__tests__/short-drama-validation.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateShortDramaTextCredits,
  extractShortDramaJsonObject,
  makeShortDramaSourceMetadata,
  validateShortDramaDuration,
  validateShortDramaEpisodeCount,
} from '../routes/short-drama/_shared.js'

test('extractShortDramaJsonObject extracts fenced json', () => {
  const parsed = extractShortDramaJsonObject('```json\n{"title":"短剧","items":[]}\n```')
  assert.equal(parsed.title, '短剧')
})

test('validateShortDramaEpisodeCount rejects above max', () => {
  assert.throws(() => validateShortDramaEpisodeCount(51), /集数必须在 1 到 50 之间/)
})

test('validateShortDramaDuration rejects unsupported model duration', () => {
  assert.throws(() => validateShortDramaDuration(6, [4, 5, 8]), /当前模型不支持 6 秒/)
})

test('calculateShortDramaTextCredits charges per 1000 chars', () => {
  assert.equal(calculateShortDramaTextCredits(1, 1), 1)
  assert.equal(calculateShortDramaTextCredits(1001, 1), 2)
})

test('makeShortDramaSourceMetadata returns stable source fields', () => {
  assert.deepEqual(makeShortDramaSourceMetadata({ projectId: 'p1', episodeId: 'e1', segmentId: 's1' }), {
    source_module: 'toby_studio',
    source_feature: 'short_drama',
    source_project_id: 'p1',
    source_episode_id: 'e1',
    source_segment_id: 's1',
  })
})
```

- [ ] **Step 2: Implement shared helpers**

Create `apps/api/src/routes/short-drama/_shared.ts`:

```ts
import { getDb } from '@aigc/db'
import {
  SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT,
  normalizeShortDramaState,
  type ShortDramaState,
} from '@aigc/types'

export const SHORT_DRAMA_SOURCE_MODULE = 'toby_studio'
export const SHORT_DRAMA_SOURCE_FEATURE = 'short_drama'
export const SHORT_DRAMA_EXPORT_QUEUE = 'short-drama-export-queue'
export const SHORT_DRAMA_EXPORT_COST_KEY = 'short_drama_episode_export_credits'

export function extractShortDramaJsonObject(raw: string): Record<string, unknown> {
  const candidates = [
    ...Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1]),
    raw,
  ]

  for (const candidate of candidates) {
    const objectText = extractFirstJsonObject(candidate)
    if (!objectText) continue
    try {
      const parsed = JSON.parse(objectText)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // 继续尝试下一个候选片段。
    }
  }

  throw new Error('AI 返回格式错误，请重试')
}

export function validateShortDramaEpisodeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT) {
    throw new Error(`集数必须在 1 到 ${SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT} 之间`)
  }
  return value
}

export function validateShortDramaDuration(durationSeconds: number, allowedDurations: number[]): void {
  if (!allowedDurations.includes(durationSeconds)) {
    throw new Error(`当前模型不支持 ${durationSeconds} 秒时长`)
  }
}

export function calculateShortDramaTextCredits(outputChars: number, creditsPerThousandChars: number): number {
  return Math.max(1, Math.ceil(outputChars / 1000) * creditsPerThousandChars)
}

export function makeShortDramaSourceMetadata(input: { projectId: string; episodeId?: string; segmentId?: string }): Record<string, string> {
  return {
    source_module: SHORT_DRAMA_SOURCE_MODULE,
    source_feature: SHORT_DRAMA_SOURCE_FEATURE,
    source_project_id: input.projectId,
    ...(input.episodeId ? { source_episode_id: input.episodeId } : {}),
    ...(input.segmentId ? { source_segment_id: input.segmentId } : {}),
  }
}

export async function assertShortDramaWorkspaceAccess(workspaceId: string, userId: string, write = false): Promise<{ workspaceId: string; teamId: string; role: string } | null> {
  const row = await getDb()
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select([
      'workspace_members.workspace_id as workspaceId',
      'workspace_members.role',
      'workspaces.team_id as teamId',
    ])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_deleted', '=', false)
    .executeTakeFirst()

  if (!row) return null
  if (write && row.role === 'viewer') return null
  return row
}

export async function assertShortDramaProjectAccess(projectId: string, userId: string, write = false): Promise<{
  id: string
  workspaceId: string
  teamId: string
  ownerId: string
  title: string
  prompt: string
  style: string
  aspectRatio: string
  episodeCount: number
  status: string
  activeStep: string
  coverUrl: string | null
  state: ShortDramaState
  role: string
} | null> {
  const row = await getDb()
    .selectFrom('short_drama_projects')
    .innerJoin('workspaces', 'workspaces.id', 'short_drama_projects.workspace_id')
    .innerJoin('workspace_members', 'workspace_members.workspace_id', 'short_drama_projects.workspace_id')
    .select([
      'short_drama_projects.id',
      'short_drama_projects.workspace_id as workspaceId',
      'short_drama_projects.team_id as teamId',
      'short_drama_projects.user_id as ownerId',
      'short_drama_projects.title',
      'short_drama_projects.prompt',
      'short_drama_projects.style',
      'short_drama_projects.aspect_ratio as aspectRatio',
      'short_drama_projects.episode_count as episodeCount',
      'short_drama_projects.status',
      'short_drama_projects.active_step as activeStep',
      'short_drama_projects.cover_url as coverUrl',
      'short_drama_projects.state',
      'workspace_members.role',
    ])
    .where('short_drama_projects.id', '=', projectId)
    .where('short_drama_projects.is_deleted', '=', false)
    .where('workspaces.is_deleted', '=', false)
    .where('workspace_members.user_id', '=', userId)
    .executeTakeFirst()

  if (!row) return null
  if (write && row.role === 'viewer') return null

  return {
    ...row,
    state: normalizeShortDramaState(row.state),
  }
}

function extractFirstJsonObject(raw: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]

    if (start === -1) {
      if (char === '{') {
        start = i
        depth = 1
      }
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = inString
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return raw.slice(start, i + 1)
  }

  return null
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-validation.test.ts
pnpm --filter @aigc/api build
```

Expected: both pass.

Commit:

```bash
git add apps/api/src/routes/short-drama/_shared.ts apps/api/src/__tests__/short-drama-validation.test.ts
git commit -m "feat: add short drama api helpers"
```

---

### Task 4: Project CRUD API

**Files:**
- Create: `apps/api/src/routes/short-drama/post-projects.ts`
- Create: `apps/api/src/routes/short-drama/get-projects.ts`
- Create: `apps/api/src/routes/short-drama/get-project-id.ts`
- Create: `apps/api/src/routes/short-drama/put-project-id.ts`
- Create: `apps/api/src/routes/short-drama/delete-project-id.ts`

- [ ] **Step 1: Implement project create route**

Create `apps/api/src/routes/short-drama/post-projects.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import { makeDefaultShortDramaState } from '@aigc/types'
import { assertShortDramaWorkspaceAccess, validateShortDramaEpisodeCount } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      workspace_id: string
      prompt: string
      style: string
      aspect_ratio: '9:16' | '16:9'
      episode_count: number
      text_model?: string
    }
  }>('/short-drama/projects', async (request, reply) => {
    const body = request.body
    const access = await assertShortDramaWorkspaceAccess(body.workspace_id, request.user.id, true)
    if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权创建短剧项目' } })

    const prompt = body.prompt?.trim()
    if (!prompt) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '请输入短剧创意' } })
    if (body.aspect_ratio !== '9:16' && body.aspect_ratio !== '16:9') {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '比例仅支持 9:16 或 16:9' } })
    }

    const episodeCount = validateShortDramaEpisodeCount(body.episode_count)
    const state = makeDefaultShortDramaState({
      prompt,
      style: body.style,
      aspectRatio: body.aspect_ratio,
      episodeCount,
      videoModel: undefined,
    })
    const title = prompt.slice(0, 24) || '未命名短剧'

    const project = await getDb()
      .insertInto('short_drama_projects')
      .values({
        workspace_id: body.workspace_id,
        team_id: access.teamId,
        user_id: request.user.id,
        title,
        prompt,
        style: state.settings.style,
        aspect_ratio: state.settings.aspectRatio,
        episode_count: state.settings.episodeCount,
        status: 'draft',
        active_step: 'script',
        state,
        draft_saved_at: sql`now()`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    return { projectId: project.id, state }
  })
}

export default route
```

- [ ] **Step 2: Implement list routes**

Create `apps/api/src/routes/short-drama/get-projects.ts` with `GET /short-drama/projects` and `GET /short-drama/projects/recent`. Use `assertShortDramaWorkspaceAccess`, filter `is_deleted = false`, order by `updated_at desc`, and cap `limit` to `100` for list and `20` for recent.

- [ ] **Step 3: Implement detail routes**

Create `apps/api/src/routes/short-drama/get-project-id.ts` with:

```ts
app.get<{ Params: { id: string } }>('/short-drama/projects/:id', async (request, reply) => {
  const project = await assertShortDramaProjectAccess(request.params.id, request.user.id)
  if (!project) return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '短剧项目不存在' } })
  return project
})
```

Also add `GET /short-drama/projects/:id/export-status` returning `project.state.exports`.

- [ ] **Step 4: Implement state save route**

Create `apps/api/src/routes/short-drama/put-project-id.ts` with `PUT /short-drama/projects/:id`. It must call `assertShortDramaProjectAccess(id, userId, true)`, normalize state, and update `state`, `title`, `cover_url`, `active_step`, `status`, `draft_saved_at`, and `updated_at`.

- [ ] **Step 5: Implement soft delete route**

Create `apps/api/src/routes/short-drama/delete-project-id.ts` with `DELETE /short-drama/projects/:id`, setting `is_deleted = true`, `deleted_at = now()`, `updated_at = now()` after write access check.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/short-drama/post-projects.ts apps/api/src/routes/short-drama/get-projects.ts apps/api/src/routes/short-drama/get-project-id.ts apps/api/src/routes/short-drama/put-project-id.ts apps/api/src/routes/short-drama/delete-project-id.ts
git commit -m "feat: add short drama project routes"
```

---

### Task 5: Text Generation API

**Files:**
- Create: `apps/api/src/routes/short-drama/post-script-summary.ts`
- Create: `apps/api/src/routes/short-drama/post-episode-outlines.ts`
- Create: `apps/api/src/routes/short-drama/post-asset-prompts.ts`
- Create: `apps/api/src/routes/short-drama/post-generate-segments.ts`

- [ ] **Step 1: Implement script summary generation**

Create `apps/api/src/routes/short-drama/post-script-summary.ts`. Reuse the Qwen call pattern from `apps/api/src/routes/picture-book/_shared.ts` by extracting a generic helper if necessary, or copy the same streaming/non-streaming shape with module `short-drama`.

The system prompt must be:

```ts
const systemPrompt = '你是专业短剧编剧。请根据用户创意生成适合连续短剧制作的中文剧本摘要。只输出 JSON 对象，字段为 title 和 summary，不要输出 markdown。'
```

The route must update:

```ts
state.script.summary = parsed.summary
state.draft.dirty = false
status = 'summary_ready'
```

- [ ] **Step 2: Implement episode outlines generation**

Create `apps/api/src/routes/short-drama/post-episode-outlines.ts`. It must generate exactly `state.settings.episodeCount` outlines and reject incomplete output with `VALIDATION_ERROR`.

Parsed episode object shape:

```ts
{
  episodeNumber: number
  title: string
  logline: string
  synopsis: string
  characters: string[]
  scenes: string[]
  hook: string
}
```

After success, set `state.script.episodeOutlines`, initialize `state.episodes`, and set status `outline_ready`.

- [ ] **Step 3: Implement asset prompts generation**

Create `apps/api/src/routes/short-drama/post-asset-prompts.ts`. It must read script summary and episode outlines, ask Qwen for `character`, `scene`, `prop`, and `material` assets, de-duplicate by normalized name, and write `state.assets.global` with `status: 'idle'`.

- [ ] **Step 4: Implement episode segments generation**

Create `apps/api/src/routes/short-drama/post-generate-segments.ts`. It must generate detailed segments for one episode only, using summary, outline, global assets, episode assets, aspect ratio, video model, and default duration `4`.

Segment output shape:

```ts
{
  title: string
  prompt: string
  mentionNames: string[]
  durationSeconds: number
  cameraNote: string
  actionNote: string
  dialogueOrSubtitle: string
}
```

The route must resolve `mentionNames` into `mentionRefs` where possible and set unresolved names only inside `prompt` text.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/short-drama/post-script-summary.ts apps/api/src/routes/short-drama/post-episode-outlines.ts apps/api/src/routes/short-drama/post-asset-prompts.ts apps/api/src/routes/short-drama/post-generate-segments.ts
git commit -m "feat: add short drama text generation routes"
```

---

### Task 6: Asset Image, Upload, Segment Video, And Sync API

**Files:**
- Create: `apps/api/src/routes/short-drama/post-generate-assets.ts`
- Create: `apps/api/src/routes/short-drama/post-upload-asset.ts`
- Create: `apps/api/src/routes/short-drama/post-generate-segment-video.ts`
- Create: `apps/api/src/routes/short-drama/post-sync-batches.ts`
- Modify: existing image/video generation route or internal helper touched during integration

- [ ] **Step 1: Implement asset image generation**

Create `apps/api/src/routes/short-drama/post-generate-assets.ts`. It accepts:

```ts
interface Body {
  assetIds: string[]
  scope: 'global' | 'episode'
  episodeId?: string
}
```

For each target asset, submit through the existing image generation path with source metadata:

```ts
makeShortDramaSourceMetadata({ projectId: project.id, episodeId: target.episodeId })
```

Update target asset status to `pending` and store `batchId`.

- [ ] **Step 2: Implement asset upload**

Create `apps/api/src/routes/short-drama/post-upload-asset.ts`. It must accept a storage key or uploaded asset id from the existing upload mechanism, validate workspace ownership, validate `scope`, and write a `ShortDramaAsset` with `status: 'completed'` and `imageUrl`.

- [ ] **Step 3: Implement segment video generation**

Create `apps/api/src/routes/short-drama/post-generate-segment-video.ts`. It must:

1. Load project with write access.
2. Find `episodeId` and `segmentId`.
3. Validate `durationSeconds` against model duration capabilities.
4. Resolve every `mentionRef.assetId` to an image URL from project assets.
5. Submit the existing video generation request with:

```ts
{
  prompt: segment.prompt,
  imageReferences,
  aspectRatio: state.settings.aspectRatio,
  durationSeconds: segment.durationSeconds,
  model: state.settings.videoModel,
  sourceModule: 'toby_studio',
  sourceFeature: 'short_drama',
  sourceProjectId: project.id,
  sourceEpisodeId: episode.id,
  sourceSegmentId: segment.id,
}
```

6. Store `batchId` and mark segment `pending`.

- [ ] **Step 4: Implement sync route**

Create `apps/api/src/routes/short-drama/post-sync-batches.ts`. It loads all pending/processing short-drama batches by `short_drama_project_id`, maps completed asset/video outputs back into `state.assets` and `state.episodes[].segments`, and maps failed batches to `status: 'failed'` with `error`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/routes/short-drama/post-generate-assets.ts apps/api/src/routes/short-drama/post-upload-asset.ts apps/api/src/routes/short-drama/post-generate-segment-video.ts apps/api/src/routes/short-drama/post-sync-batches.ts
git commit -m "feat: add short drama media generation routes"
```

---

### Task 7: Export API And Worker Queue Types

**Files:**
- Modify: `packages/types/src/queue.ts`
- Create: `apps/api/src/routes/short-drama/post-export-episode.ts`
- Create: `apps/api/src/routes/short-drama/post-export-batch.ts`

- [ ] **Step 1: Add queue type**

Modify `packages/types/src/queue.ts` and add:

```ts
export interface ShortDramaExportEpisodeJobData {
  projectId: string
  episodeId: string
  exportId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}
```

If the file has a central union of queue payloads, add `ShortDramaExportEpisodeJobData` to that union.

- [ ] **Step 2: Implement single episode export route**

Create `apps/api/src/routes/short-drama/post-export-episode.ts`. It must:

1. Load the project with write access.
2. Find the episode.
3. Reject if there are no segments.
4. Reject if any selected segment has no `videoUrl`.
5. Reject if `state.locks.assets` is false.
6. Read `short_drama_episode_export_credits` from system cost config.
7. Pre-check balance.
8. Create `exportId` in `state.exports.episodeExports` with status `pending`.
9. Add BullMQ job `short-drama-export-episode` to `short-drama-export-queue`.
10. Save state and return `{ exportId }`.

- [ ] **Step 3: Implement batch export route**

Create `apps/api/src/routes/short-drama/post-export-batch.ts`. It accepts:

```ts
interface Body {
  episodeIds: string[]
}
```

It must filter exportable episodes, calculate total cost, pre-check total balance before adding any job, create one episode export per episode, and return batch status with `completedCount: 0` and `failedCount: 0`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/api build
```

Expected: both pass.

Commit:

```bash
git add packages/types/src/queue.ts apps/api/src/routes/short-drama/post-export-episode.ts apps/api/src/routes/short-drama/post-export-batch.ts
git commit -m "feat: add short drama export routes"
```

---

### Task 8: Export Worker

**Files:**
- Create: `apps/worker/src/workers/short-drama-export.ts`
- Create: `apps/worker/src/workers/short-drama-export.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write worker utility tests**

Create `apps/worker/src/workers/short-drama-export.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConcatManifest,
  validateShortDramaExportSegments,
} from './short-drama-export.js'

test('validateShortDramaExportSegments rejects empty list', () => {
  assert.throws(() => validateShortDramaExportSegments([]), /至少需要 1 个片段视频/)
})

test('validateShortDramaExportSegments rejects missing video url', () => {
  assert.throws(() => validateShortDramaExportSegments([{ id: 's1', videoUrl: '' }]), /片段 s1 缺少视频地址/)
})

test('buildConcatManifest escapes single quotes', () => {
  const manifest = buildConcatManifest(['C:/tmp/a.mp4', "C:/tmp/b'b.mp4"])
  assert.equal(manifest, "file 'C:/tmp/a.mp4'\nfile 'C:/tmp/b'\\''b.mp4'")
})
```

- [ ] **Step 2: Implement worker**

Create `apps/worker/src/workers/short-drama-export.ts` with exported utility functions and a BullMQ worker. The worker must:

- load project state;
- find episode and export record;
- download segment videos only from trusted storage URLs or storage keys;
- run ffmpeg concat first;
- if concat fails, transcode to unified MP4 parameters then concat;
- upload final MP4 to storage;
- write `outputUrl`, `assetId`, and export status;
- update episode status to `exported`;
- confirm or refund credits using existing credit helpers;
- clean temporary files in `finally`.

Utility functions required by tests:

```ts
export function validateShortDramaExportSegments(segments: Array<{ id: string; videoUrl?: string }>): void {
  if (segments.length === 0) throw new Error('至少需要 1 个片段视频')
  for (const segment of segments) {
    if (!segment.videoUrl) throw new Error(`片段 ${segment.id} 缺少视频地址`)
  }
}

export function buildConcatManifest(paths: string[]): string {
  return paths.map(path => `file '${path.replace(/'/g, `'\\''`)}'`).join('\n')
}
```

- [ ] **Step 3: Register worker**

Modify `apps/worker/src/index.ts` and import/register `shortDramaExportWorker` following the same pattern used for `music` or `storyboard` workers.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/worker exec tsx src/workers/short-drama-export.test.ts
pnpm --filter @aigc/worker build
```

Expected: both pass.

Commit:

```bash
git add apps/worker/src/workers/short-drama-export.ts apps/worker/src/workers/short-drama-export.test.ts apps/worker/src/index.ts
git commit -m "feat: add short drama export worker"
```

---

### Task 9: Frontend API, Styles, And Project Hook

**Files:**
- Create: `apps/web/src/lib/short-drama/api.ts`
- Create: `apps/web/src/lib/short-drama/styles.ts`
- Create: `apps/web/src/hooks/short-drama/use-short-drama-project.ts`

- [ ] **Step 1: Add style library**

Create `apps/web/src/lib/short-drama/styles.ts`:

```ts
import type { ShortDramaStyleTab } from '@aigc/types'

export interface ShortDramaStyleOption {
  id: string
  tab: ShortDramaStyleTab
  name: string
  description: string
  imageUrl?: string
  custom?: boolean
}

export const SHORT_DRAMA_STYLE_OPTIONS: ShortDramaStyleOption[] = [
  { id: 'custom', tab: '全部', name: '自定义风格', description: '输入你自己的视觉风格描述', custom: true },
  { id: 'real-city', tab: '真人', name: '真人都市', description: '适合都市情感、逆袭、创业题材' },
  { id: 'real-costume', tab: '真人', name: '真人古装', description: '适合古风权谋、仙侠、穿越题材' },
  { id: '2d-anime', tab: '2D', name: '2D 动漫', description: '适合轻小说、校园、奇幻题材' },
  { id: '2d-comic', tab: '2D', name: '国漫厚涂', description: '适合热血、玄幻、冒险题材' },
  { id: '3d-cinematic', tab: '3D', name: '3D 电影感', description: '适合科幻、悬疑、动作题材' },
  { id: '3d-clay', tab: '3D', name: '3D 黏土', description: '适合轻喜剧、治愈、合家欢题材' },
]

export function getShortDramaStylesByTab(tab: ShortDramaStyleTab): ShortDramaStyleOption[] {
  if (tab === '全部') return SHORT_DRAMA_STYLE_OPTIONS
  return SHORT_DRAMA_STYLE_OPTIONS.filter(option => option.tab === tab)
}
```

- [ ] **Step 2: Add API wrappers**

Create `apps/web/src/lib/short-drama/api.ts` with wrappers for every API route. Each wrapper must call the existing authenticated fetch helper used by picture book or other dashboard modules and return typed JSON.

Required functions:

```ts
export function createShortDramaProject(input: CreateShortDramaProjectInput): Promise<{ projectId: string }>
export function listRecentShortDramaProjects(workspaceId: string): Promise<ShortDramaProjectListItem[]>
export function getShortDramaProject(projectId: string): Promise<ShortDramaProjectDetail>
export function saveShortDramaProject(projectId: string, input: SaveShortDramaProjectInput): Promise<ShortDramaProjectDetail>
export function generateShortDramaScriptSummary(projectId: string): Promise<ShortDramaProjectDetail>
export function generateShortDramaEpisodeOutlines(projectId: string): Promise<ShortDramaProjectDetail>
export function generateShortDramaAssetPrompts(projectId: string): Promise<ShortDramaProjectDetail>
export function generateShortDramaAssets(projectId: string, input: GenerateShortDramaAssetsInput): Promise<ShortDramaProjectDetail>
export function generateShortDramaEpisodeSegments(projectId: string, episodeId: string): Promise<ShortDramaProjectDetail>
export function generateShortDramaSegmentVideo(projectId: string, episodeId: string, segmentId: string): Promise<ShortDramaProjectDetail>
export function syncShortDramaBatches(projectId: string): Promise<ShortDramaProjectDetail>
export function exportShortDramaEpisode(projectId: string, episodeId: string): Promise<{ exportId: string }>
export function exportShortDramaBatch(projectId: string, episodeIds: string[]): Promise<{ batchExportId: string }>
```

- [ ] **Step 3: Add project hook**

Create `apps/web/src/hooks/short-drama/use-short-drama-project.ts`. It must use SWR, expose `state`, `updateState`, `flushDraft`, `mutate`, `syncBatches`, and set a 10s interval only when state contains pending/processing assets, segments, or exports.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: if build fails only because components are not created yet, run it again after Task 12. Type errors inside these files must be fixed now.

Commit:

```bash
git add apps/web/src/lib/short-drama apps/web/src/hooks/short-drama/use-short-drama-project.ts
git commit -m "feat: add short drama frontend api hooks"
```

---

### Task 10: Short Drama Home Page

**Files:**
- Create: `apps/web/src/components/short-drama/short-drama-home.tsx`
- Create: `apps/web/src/components/short-drama/short-drama-style-dialog.tsx`
- Create: `apps/web/src/components/short-drama/short-drama-project-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/toby-studio/short-drama/page.tsx`

- [ ] **Step 1: Build style dialog**

Create `short-drama-style-dialog.tsx` with Radix dialog/tabs or the project’s existing dialog components. It must show tabs `全部 / 真人 / 2D / 3D`, cards from `SHORT_DRAMA_STYLE_OPTIONS`, and a custom style input for the custom card.

- [ ] **Step 2: Build project card**

Create `short-drama-project-card.tsx` with title, cover placeholder, status badge, episode count, updated time, and link to `/toby-studio/short-drama/${project.id}`.

- [ ] **Step 3: Build home component**

Create `short-drama-home.tsx`. It must include:

- creative prompt textarea;
- style dialog trigger;
- aspect ratio select;
- episode count select with custom count input;
- text pricing note;
- submit loading guard;
- recent project loading/empty/error/success states.

- [ ] **Step 4: Replace placeholder page**

Modify `apps/web/src/app/(dashboard)/toby-studio/short-drama/page.tsx`:

```tsx
import { ShortDramaHome } from '@/components/short-drama/short-drama-home'

export default function ShortDramaPage(): JSX.Element {
  return <ShortDramaHome />
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass or fail only because later editor routes are not created. Fix all errors related to the home components before committing.

Commit:

```bash
git add apps/web/src/components/short-drama/short-drama-home.tsx apps/web/src/components/short-drama/short-drama-style-dialog.tsx apps/web/src/components/short-drama/short-drama-project-card.tsx apps/web/src/app/(dashboard)/toby-studio/short-drama/page.tsx
git commit -m "feat: add short drama home page"
```

---

### Task 11: Project Editor Steps

**Files:**
- Create: `apps/web/src/components/short-drama/short-drama-stepper.tsx`
- Create: `apps/web/src/components/short-drama/step-script-outline.tsx`
- Create: `apps/web/src/components/short-drama/step-assets.tsx`
- Create: `apps/web/src/components/short-drama/step-episodes.tsx`
- Create: `apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/page.tsx`

- [ ] **Step 1: Build stepper**

Create `short-drama-stepper.tsx` with the same horizontal progress behavior as AI 绘本: completed steps clickable read-only, locked steps disabled, current step highlighted.

- [ ] **Step 2: Build script step**

Create `step-script-outline.tsx`. It must show original prompt, summary textarea, generate summary button, generate outlines button, outline cards, and confirm button. Confirm sets `locks.script = true`, adds `script` to completed, and moves active step to `assets`.

- [ ] **Step 3: Build assets step**

Create `step-assets.tsx`. It must show tabs for `全部 / 角色 / 场景 / 素材 / 道具`, asset cards, generate prompt button, batch generate button, upload replace button, and confirm button. Confirm sets `locks.assets = true`, adds `assets` to completed, and moves active step to `episodes`.

- [ ] **Step 4: Build episodes step**

Create `step-episodes.tsx`. It must show total episodes, completed/exportable counts, add episode button, batch export button, and episode cards with preview/edit/export/download actions.

- [ ] **Step 5: Build editor page**

Create `[id]/page.tsx`. It must load project with `useShortDramaProject`, render the stepper, enforce `canEnterShortDramaStep`, call sync polling through the hook, and render the active step component.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass or fail only because episode editor route is not created. Fix all project editor errors before committing.

Commit:

```bash
git add apps/web/src/components/short-drama/short-drama-stepper.tsx apps/web/src/components/short-drama/step-script-outline.tsx apps/web/src/components/short-drama/step-assets.tsx apps/web/src/components/short-drama/step-episodes.tsx apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/page.tsx
git commit -m "feat: add short drama project editor"
```

---

### Task 12: Episode Editor UI

**Files:**
- Create: `apps/web/src/components/short-drama/episode-editor.tsx`
- Create: `apps/web/src/components/short-drama/asset-library-panel.tsx`
- Create: `apps/web/src/components/short-drama/segment-list.tsx`
- Create: `apps/web/src/components/short-drama/segment-prompt-editor.tsx`
- Create: `apps/web/src/components/short-drama/duration-tag.tsx`
- Create: `apps/web/src/components/short-drama/episode-preview-panel.tsx`
- Create: `apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/episodes/[episodeId]/page.tsx`

- [ ] **Step 1: Build duration tag**

Create `duration-tag.tsx`. It must render one non-deletable duration control and only allow values from `allowedDurations`. The default allowed list for MVP is `[4, 5, 8]` until model config is wired.

- [ ] **Step 2: Build segment prompt editor**

Create `segment-prompt-editor.tsx`. It must render prompt textarea, `@` asset insertion buttons, selected mention chips, and the `DurationTag`. It must update `prompt`, `mentionRefs`, and `durationSeconds` separately.

- [ ] **Step 3: Build segment list**

Create `segment-list.tsx`. It must render ordered segment cards and actions: add, delete, copy, move up/down, generate video. Use move up/down first; drag-and-drop can be added later without changing state shape.

- [ ] **Step 4: Build asset panel**

Create `asset-library-panel.tsx`. It must show global assets and episode scoped assets, category tabs, upload action, and scope selector `全剧可用 / 仅本集可用`.

- [ ] **Step 5: Build preview panel**

Create `episode-preview-panel.tsx`. It must play available segment videos in order, show missing segment warnings, show export cost, export status, export button, and download button.

- [ ] **Step 6: Build episode editor and route**

Create `episode-editor.tsx` and the route page. The page must load the same project hook, find the episode by `episodeId`, render three columns, and save state after segment edits.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: pass.

Commit:

```bash
git add apps/web/src/components/short-drama/episode-editor.tsx apps/web/src/components/short-drama/asset-library-panel.tsx apps/web/src/components/short-drama/segment-list.tsx apps/web/src/components/short-drama/segment-prompt-editor.tsx apps/web/src/components/short-drama/duration-tag.tsx apps/web/src/components/short-drama/episode-preview-panel.tsx apps/web/src/app/(dashboard)/toby-studio/short-drama/[id]/episodes/[episodeId]/page.tsx
git commit -m "feat: add short drama episode editor"
```

---

### Task 13: Asset And History Source Isolation

**Files:**
- Modify: asset/history query files discovered by searching for `source_module`, `source_feature`, `assets`, and history route names.
- Test: add focused API tests if the project already has route-level tests for assets/history.

- [ ] **Step 1: Locate asset/history queries**

Run:

```bash
rg -n "source_module|sourceModule|source_feature|sourceFeature|selectFrom\('assets'|selectFrom\(\"assets\"|history" apps/api/src packages/db/src
```

Expected: identify routes that return assets/history to non-short-drama modules.

- [ ] **Step 2: Add default exclusion**

For every general asset/history query, add this exclusion unless the route is under `/short-drama`:

```ts
.where((eb) => eb.or([
  eb('source_module', 'is', null),
  eb('source_module', '!=', 'toby_studio'),
  eb('source_feature', '!=', 'short_drama'),
]))
```

If source data lives in `metadata` JSON instead of columns, use the existing JSON query style in this codebase and exclude `metadata->>'source_module' = 'toby_studio' AND metadata->>'source_feature' = 'short_drama'`.

- [ ] **Step 3: Add short drama inclusion**

For short-drama asset queries, explicitly include:

```ts
source_module = 'toby_studio'
source_feature = 'short_drama'
source_project_id = projectId
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src packages/db/src
git commit -m "fix: isolate short drama assets from other modules"
```

---

### Task 14: Documentation, Full Verification, And Cleanup

**Files:**
- Modify only files required by verification fixes.
- Keep: `README.md`
- Keep: `docs/superpowers/specs/2026-05-29-short-drama-design.md`
- Keep: `docs/superpowers/plans/2026-05-29-short-drama.md`
- Do not add: `.superpowers/brainstorm/**`

- [ ] **Step 1: Run shared type tests**

Run:

```bash
pnpm --filter @aigc/types exec tsx src/short-drama.test.ts
```

Expected: pass.

- [ ] **Step 2: Run API helper tests**

Run:

```bash
pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-validation.test.ts
```

Expected: pass.

- [ ] **Step 3: Run worker tests**

Run:

```bash
pnpm --filter @aigc/worker exec tsx src/workers/short-drama-export.test.ts
```

Expected: pass.

- [ ] **Step 4: Run builds**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/db build
pnpm --filter @aigc/api build
pnpm --filter @aigc/worker build
pnpm --filter @aigc/web build
```

Expected: all pass.

- [ ] **Step 5: Run lint if available**

Run:

```bash
pnpm lint
```

Expected: pass. If unrelated existing lint failures appear, record exact failures and do not silently claim success.

- [ ] **Step 6: Browser QA**

Start development services as needed:

```bash
pnpm --filter @aigc/web dev
pnpm --filter @aigc/api dev
pnpm --filter @aigc/worker dev
```

Verify manually:

- `/toby-studio/short-drama` renders home page.
- Prompt submit is blocked when empty.
- Submit button shows loading and prevents duplicate submit.
- Style dialog tabs work.
- Custom style saves a custom style name.
- Project page uses AI 绘本 style horizontal stepper.
- Locked steps cannot be edited.
- Script summary loading/error/success states render.
- Episode outlines render and can be edited.
- Asset library loading/empty/error/success states render.
- Episode cards show status and navigation.
- Episode editor has left asset panel, middle segments, right preview.
- Duration tag cannot be deleted.
- Segment video generation uses selected duration.
- Export button shows configured cost.
- `.superpowers/brainstorm/` remains untracked and uncommitted.

- [ ] **Step 7: Commit verification fixes**

If fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: polish short drama verification issues"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: the plan covers shared types, DB schema, project CRUD, homepage, three-step editor, text generation, asset prompt/image/upload, episode list, episode editor, `@` mentions, non-deletable duration tag, segment video generation, sync, export API, export worker, source isolation, billing config, and verification.
- Placeholder scan: no `TBD`, no `TODO`, no “implement later”, and no task that says only “write tests” without concrete commands or expected behavior.
- Type consistency: shared names use `ShortDramaState`, `ShortDramaAsset`, `ShortDramaSegment`, `ShortDramaEpisode`, `ShortDramaGenerationStatus`, `short_drama_projects`, `short_drama_project_id`, source fields `source_module/source_feature/source_project_id/source_episode_id/source_segment_id`, and route prefix `/short-drama` consistently.
- Scope control: first version intentionally avoids public sharing, ZIP export, multi-track editing, subtitles, BGM, transition editing, cross-module asset return, and advanced mobile editing.
