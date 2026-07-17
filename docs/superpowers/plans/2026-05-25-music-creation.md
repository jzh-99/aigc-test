# Music Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Music feature with song/instrumental generation, personal vocal clones, streamable generation progress, TOS persistence, workspace isolation, and polished list/detail pages.

**Architecture:** Music domain data lives in new `music_tracks` and `music_voice_clones` tables, while task state and credits reuse existing `task_batches/tasks` with new `music` and `music_voice_clone` modules. API routes create music jobs and expose lists/details/SSE; worker jobs call Mureka and Seedream, publish progress, transfer files to TOS, and update music tables. Frontend adds `/music` and `/music/[id]` pages with single-column forms, personal voice dropdown/upload dialog, stream preview playback, and workspace-scoped records.

**Tech Stack:** pnpm 10, Turborepo, TypeScript, Kysely, Fastify autoload routes, BullMQ, Redis Pub/Sub SSE, Next.js 14 App Router, SWR, Radix UI, Tailwind CSS, TOS storage, Mureka API, Seedream image generation.

---

## File Structure

Create or modify these files:

- Create: `packages/types/src/music.ts`  
  Shared request/response/event types and runtime helpers for music modes, models, status, title/description limits, and voice gender.
- Modify: `packages/types/src/index.ts`  
  Export music types.
- Modify: `packages/types/src/queue.ts`  
  Add `MusicJobData` and `MusicVoiceCloneJobData`.
- Create: `packages/types/src/music.test.ts`  
  Type helper unit tests using Node assert.
- Create: `packages/db/migrations/044_music.ts`  
  Add music tables and extend `task_batches.module` constraint.
- Modify: `packages/db/src/schema.ts`  
  Add Kysely table interfaces and extend module unions.
- Modify: `packages/db/scripts/seed.ts`  
  Add Mureka provider/models/pricing for music generation and voice clone prices.
- Create: `packages/db/src/music-schema.test.ts`  
  Lock table type assumptions where practical.
- Modify: `apps/api/src/lib/queue.ts`  
  Add `music-queue` and `music-voice-clone-queue` helpers.
- Create: `apps/api/src/routes/music/_shared.ts`  
  Workspace permission, music payload validation, response mapping.
- Create: `apps/api/src/routes/music/post-generate.ts`  
  `POST /music/generate`.
- Create: `apps/api/src/routes/music/get-tracks.ts`  
  `GET /music/tracks`.
- Create: `apps/api/src/routes/music/get-tracks-id.ts`  
  `GET /music/tracks/:id`.
- Create: `apps/api/src/routes/music/get-tracks-id-adjacent.ts`  
  `GET /music/tracks/:id/adjacent`.
- Create: `apps/api/src/routes/music/get-tracks-id-events.ts`  
  `GET /music/tracks/:id/events`.
- Create: `apps/api/src/routes/music/post-voice-clones.ts`  
  `POST /music/voice-clones`.
- Create: `apps/api/src/routes/music/get-voice-clones.ts`  
  `GET /music/voice-clones`.
- Create: `apps/api/src/__tests__/music-validation.test.ts`  
  Validation and response helper tests.
- Create: `apps/worker/src/lib/mureka.ts`  
  Mureka HTTP client.
- Create: `apps/worker/src/lib/music-storage.ts`  
  Download and upload music/cover files to TOS.
- Create: `apps/worker/src/workers/music.ts`  
  Music generation worker.
- Create: `apps/worker/src/workers/music-voice-clone.ts`  
  Voice clone worker.
- Modify: `apps/worker/src/index.ts`  
  Start and close new workers.
- Create: `apps/worker/src/workers/music.test.ts`  
  Pure helper tests for payload/status mapping.
- Modify: `apps/web/src/components/layout/sidebar.tsx`  
  Add Music nav item below Canvas.
- Create: `apps/web/src/lib/music/types.ts`  
  Frontend-specific types if needed.
- Create: `apps/web/src/lib/music/api.ts`  
  API client functions.
- Create: `apps/web/src/hooks/use-music.ts`  
  SWR hooks for tracks, voices, adjacent records, and SSE connection helpers.
- Create: `apps/web/src/components/music/music-create-panel.tsx`  
  Single-column creation form.
- Create: `apps/web/src/components/music/music-voice-upload-dialog.tsx`  
  Upload dialog for voice clone.
- Create: `apps/web/src/components/music/music-track-list.tsx`  
  List, filters, pagination, empty state.
- Create: `apps/web/src/components/music/music-player.tsx`  
  Detail player.
- Create: `apps/web/src/app/(dashboard)/music/page.tsx`  
  `/music` page.
- Create: `apps/web/src/app/(dashboard)/music/[id]/page.tsx`  
  `/music/[id]` page.
- Create: `apps/web/e2e/music/music-page.spec.ts`  
  Browser-level smoke tests with API mocks.

---

### Task 1: Shared Music Types And Validation Helpers

**Files:**
- Create: `packages/types/src/music.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/queue.ts`
- Test: `packages/types/src/music.test.ts`

- [ ] **Step 1: Write failing tests for title, description, and model helpers**

Create `packages/types/src/music.test.ts`:

```ts
import assert from 'node:assert/strict'
import {
  isMusicModel,
  normalizeMusicTitle,
  normalizeVoiceCloneDescription,
  MUSIC_CUSTOM_TITLE_MAX_LENGTH,
  MUSIC_VOICE_DESCRIPTION_MAX_LENGTH,
} from './music.js'

assert.equal(isMusicModel('mureka-8'), true)
assert.equal(isMusicModel('mureka-9'), true)
assert.equal(isMusicModel('mureka-10'), false)

assert.equal(MUSIC_CUSTOM_TITLE_MAX_LENGTH, 20)
assert.equal(normalizeMusicTitle('  星空来信  '), '星空来信')
assert.throws(() => normalizeMusicTitle('一'.repeat(21)), /标题不能超过 20 字/)

assert.equal(MUSIC_VOICE_DESCRIPTION_MAX_LENGTH, 1024)
assert.equal(normalizeVoiceCloneDescription(undefined), null)
assert.equal(normalizeVoiceCloneDescription('  温柔清亮  '), '温柔清亮')
assert.throws(() => normalizeVoiceCloneDescription('a'.repeat(1025)), /描述不能超过 1024 字/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aigc/types build`

Expected: FAIL because `packages/types/src/music.ts` does not exist and exports are missing.

- [ ] **Step 3: Implement shared music types**

Create `packages/types/src/music.ts`:

```ts
export const MUSIC_MODE_VALUES = ['inspiration', 'custom'] as const
export type MusicMode = typeof MUSIC_MODE_VALUES[number]

export const MUSIC_TRACK_TYPE_VALUES = ['song', 'instrumental'] as const
export type MusicTrackType = typeof MUSIC_TRACK_TYPE_VALUES[number]

export const MUSIC_MODEL_VALUES = ['mureka-8', 'mureka-9'] as const
export type MusicModel = typeof MUSIC_MODEL_VALUES[number]

export const MUSIC_VOICE_GENDER_VALUES = ['auto', 'male', 'female'] as const
export type MusicVoiceGender = typeof MUSIC_VOICE_GENDER_VALUES[number]

export const MUSIC_TRACK_STATUS_VALUES = [
  'pending',
  'lyrics_generating',
  'song_generating',
  'cover_generating',
  'transferring',
  'completed',
  'failed',
] as const
export type MusicTrackStatus = typeof MUSIC_TRACK_STATUS_VALUES[number]

export const MUSIC_VOICE_CLONE_STATUS_VALUES = ['pending', 'processing', 'ready', 'failed'] as const
export type MusicVoiceCloneStatus = typeof MUSIC_VOICE_CLONE_STATUS_VALUES[number]

export const MUSIC_PROMPT_MAX_LENGTH = 1024
export const MUSIC_LYRICS_MAX_LENGTH = 3000
export const MUSIC_CUSTOM_TITLE_MAX_LENGTH = 20
export const MUSIC_VOICE_DESCRIPTION_MAX_LENGTH = 1024

export function isMusicModel(value: unknown): value is MusicModel {
  return typeof value === 'string' && (MUSIC_MODEL_VALUES as readonly string[]).includes(value)
}

export function isMusicVoiceGender(value: unknown): value is MusicVoiceGender {
  return typeof value === 'string' && (MUSIC_VOICE_GENDER_VALUES as readonly string[]).includes(value)
}

export function normalizeMusicTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new Error('标题不能为空')
  if (title.length > MUSIC_CUSTOM_TITLE_MAX_LENGTH) throw new Error('标题不能超过 20 字')
  return title
}

export function normalizeVoiceCloneDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const description = typeof value === 'string' ? value.trim() : ''
  if (!description) return null
  if (description.length > MUSIC_VOICE_DESCRIPTION_MAX_LENGTH) throw new Error('描述不能超过 1024 字')
  return description
}

export interface MusicGenerateRequest {
  idempotency_key: string
  workspace_id: string
  mode: MusicMode
  type: MusicTrackType
  model: MusicModel
  prompt?: string
  title?: string
  lyrics?: string
  styles?: string[]
  voice_clone_id?: string | null
  voice_gender?: MusicVoiceGender
}

export interface MusicTrackResponse {
  id: string
  workspace_id: string
  type: MusicTrackType
  mode: MusicMode
  title: string
  prompt: string | null
  lyrics: string | null
  styles: string[]
  voice_clone_id: string | null
  voice_name: string | null
  voice_gender: MusicVoiceGender
  model: MusicModel
  cover_url: string | null
  stream_url: string | null
  audio_url: string | null
  flac_url: string | null
  wav_url: string | null
  status: MusicTrackStatus
  error_message: string | null
  created_at: string
}

export interface MusicVoiceCloneResponse {
  id: string
  workspace_id: string
  name: string
  description: string | null
  voice_id: string | null
  status: MusicVoiceCloneStatus
  error_message: string | null
  created_at: string
}

export type MusicSseEvent =
  | { event: 'status'; status: MusicTrackStatus; message?: string }
  | { event: 'lyrics_delta'; delta: string; lyrics: string }
  | { event: 'stream_url'; stream_url: string }
  | { event: 'completed'; track: MusicTrackResponse }
  | { event: 'failed'; error_message: string }
```

Modify `packages/types/src/index.ts`:

```ts
export * from './api.js'
export * from './adapter.js'
export * from './db.js'
export * from './music.js'
export * from './queue.js'
```

Modify `packages/types/src/queue.ts` by appending:

```ts
export interface MusicJobData {
  taskId: string
  batchId: string
  trackId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}

export interface MusicVoiceCloneJobData {
  taskId: string
  batchId: string
  voiceCloneId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}
```

- [ ] **Step 4: Run test and build**

Run: `pnpm --filter @aigc/types build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/music.ts packages/types/src/index.ts packages/types/src/queue.ts packages/types/src/music.test.ts
git commit -m "feat(types): add music contracts"
```

---

### Task 2: Database Migration, Schema, And Seed Pricing

**Files:**
- Create: `packages/db/migrations/044_music.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/scripts/seed.ts`
- Test: `packages/db/src/music-schema.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `packages/db/src/music-schema.test.ts`:

```ts
import assert from 'node:assert/strict'
import type { Database } from './schema.js'

type MusicTrack = Database['music_tracks']
type MusicVoiceClone = Database['music_voice_clones']

const trackStatus: MusicTrack['status'] = 'lyrics_generating'
const voiceStatus: MusicVoiceClone['status'] = 'ready'
const voiceId: MusicVoiceClone['voice_id'] = 'voice_123'

assert.equal(trackStatus, 'lyrics_generating')
assert.equal(voiceStatus, 'ready')
assert.equal(voiceId, 'voice_123')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aigc/db build`

Expected: FAIL because `music_tracks` and `music_voice_clones` are missing from `Database`.

- [ ] **Step 3: Create migration**

Create `packages/db/migrations/044_music.ts`:

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`
    ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module
    CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','music','music_voice_clone'))
  `.execute(db)

  await db.schema
    .createTable('music_tracks')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('batch_id', 'uuid', (col) => col.references('task_batches.id').onDelete('set null'))
    .addColumn('task_id', 'uuid', (col) => col.references('tasks.id').onDelete('set null'))
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('mode', 'varchar(20)', (col) => col.notNull())
    .addColumn('title', 'varchar(100)', (col) => col.notNull())
    .addColumn('prompt', 'text')
    .addColumn('lyrics', 'text')
    .addColumn('styles', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('voice_clone_id', 'uuid', (col) => col.references('music_voice_clones.id').onDelete('set null'))
    .addColumn('voice_gender', 'varchar(20)', (col) => col.notNull().defaultTo('auto'))
    .addColumn('model', 'varchar(50)', (col) => col.notNull())
    .addColumn('cover_url', 'text')
    .addColumn('cover_storage_url', 'text')
    .addColumn('stream_url', 'text')
    .addColumn('audio_url', 'text')
    .addColumn('audio_storage_url', 'text')
    .addColumn('flac_url', 'text')
    .addColumn('flac_storage_url', 'text')
    .addColumn('wav_url', 'text')
    .addColumn('wav_storage_url', 'text')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('music_voice_clones')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('batch_id', 'uuid', (col) => col.references('task_batches.id').onDelete('set null'))
    .addColumn('task_id', 'uuid', (col) => col.references('tasks.id').onDelete('set null'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('source_audio_url', 'text')
    .addColumn('source_audio_storage_url', 'text')
    .addColumn('voice_id', 'varchar(255)')
    .addColumn('external_voice_id', 'varchar(255)')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_type CHECK (type IN ('song','instrumental'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_mode CHECK (mode IN ('inspiration','custom'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_voice_gender CHECK (voice_gender IN ('auto','male','female'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_status CHECK (status IN ('pending','lyrics_generating','song_generating','cover_generating','transferring','completed','failed'))`.execute(db)
  await sql`ALTER TABLE music_voice_clones ADD CONSTRAINT chk_music_voice_clones_status CHECK (status IN ('pending','processing','ready','failed'))`.execute(db)

  await db.schema.createIndex('idx_music_tracks_workspace_created').on('music_tracks').columns(['workspace_id', 'created_at']).execute()
  await db.schema.createIndex('idx_music_tracks_batch').on('music_tracks').column('batch_id').execute()
  await db.schema.createIndex('idx_music_voice_clones_workspace').on('music_voice_clones').columns(['workspace_id', 'created_at']).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_music_voice_clones_workspace').ifExists().execute()
  await db.schema.dropIndex('idx_music_tracks_batch').ifExists().execute()
  await db.schema.dropIndex('idx_music_tracks_workspace_created').ifExists().execute()
  await db.schema.dropTable('music_tracks').ifExists().execute()
  await db.schema.dropTable('music_voice_clones').ifExists().execute()
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`
    ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module
    CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard'))
  `.execute(db)
}
```

- [ ] **Step 4: Update schema types**

Modify `packages/db/src/schema.ts`:

```ts
export interface MusicTracksTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  team_id: string
  batch_id: string | null
  task_id: string | null
  type: 'song' | 'instrumental'
  mode: 'inspiration' | 'custom'
  title: string
  prompt: string | null
  lyrics: string | null
  styles: ColumnType<string[], string, string>
  voice_clone_id: string | null
  voice_gender: 'auto' | 'male' | 'female'
  model: 'mureka-8' | 'mureka-9'
  cover_url: string | null
  cover_storage_url: string | null
  stream_url: string | null
  audio_url: string | null
  audio_storage_url: string | null
  flac_url: string | null
  flac_storage_url: string | null
  wav_url: string | null
  wav_storage_url: string | null
  external_task_id: string | null
  status: 'pending' | 'lyrics_generating' | 'song_generating' | 'cover_generating' | 'transferring' | 'completed' | 'failed'
  error_message: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface MusicVoiceClonesTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  team_id: string
  batch_id: string | null
  task_id: string | null
  name: string
  description: string | null
  source_audio_url: string | null
  source_audio_storage_url: string | null
  voice_id: string | null
  external_voice_id: string | null
  external_task_id: string | null
  status: 'pending' | 'processing' | 'ready' | 'failed'
  error_message: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

Extend `TaskBatchesTable['module']` union:

```ts
module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation' | 'storyboard' | 'music' | 'music_voice_clone'
```

Add to `Database`:

```ts
music_tracks: MusicTracksTable
music_voice_clones: MusicVoiceClonesTable
```

- [ ] **Step 5: Seed Mureka provider and pricing**

Modify `packages/db/scripts/seed.ts` near provider/model seed logic. Add provider `mureka` and three model records:

```ts
const murekaResult = await db
  .insertInto('providers')
  .values({
    code: 'mureka',
    name: 'Mureka',
    region: 'global',
    modules: JSON.stringify(['music', 'music_voice_clone']),
    config: JSON.stringify({ api_base_url: 'https://api.mureka.ai' }),
    is_active: true,
  })
  .onConflict((oc) => oc.column('code').doUpdateSet({
    name: 'Mureka',
    modules: JSON.stringify(['music', 'music_voice_clone']),
    config: JSON.stringify({ api_base_url: 'https://api.mureka.ai' }),
    is_active: true,
  }))
  .returning('id')
  .execute()

const murekaProvider = murekaResult[0]
const murekaModels = [
  { code: 'mureka-8', name: 'Mureka 8', module: 'music', credit_cost: 20 },
  { code: 'mureka-9', name: 'Mureka 9', module: 'music', credit_cost: 30 },
  { code: 'mureka-vocal-clone', name: 'Mureka 音色克隆', module: 'music_voice_clone', credit_cost: 15 },
]
```

If the current `provider_models.module` check does not allow `music` and `music_voice_clone`, include it in migration `044_music.ts` by dropping/recreating `chk_pm_module` too.

- [ ] **Step 6: Run DB build**

Run: `pnpm --filter @aigc/db build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/044_music.ts packages/db/src/schema.ts packages/db/src/music-schema.test.ts packages/db/scripts/seed.ts
git commit -m "feat(db): add music tables and pricing"
```

---

### Task 3: API Validation And Queue Creation

**Files:**
- Modify: `apps/api/src/lib/queue.ts`
- Create: `apps/api/src/routes/music/_shared.ts`
- Test: `apps/api/src/__tests__/music-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `apps/api/src/__tests__/music-validation.test.ts`:

```ts
import assert from 'node:assert/strict'
import { sanitizeMusicGenerateBody, sanitizeVoiceCloneBody } from '../routes/music/_shared.js'

assert.deepEqual(sanitizeMusicGenerateBody({
  idempotency_key: 'abc',
  workspace_id: '00000000-0000-0000-0000-000000000001',
  mode: 'inspiration',
  type: 'instrumental',
  prompt: '  synth wave  ',
  model: 'mureka-9',
}), {
  idempotencyKey: 'abc',
  workspaceId: '00000000-0000-0000-0000-000000000001',
  mode: 'inspiration',
  type: 'instrumental',
  prompt: 'synth wave',
  title: 'synth wave',
  lyrics: null,
  styles: [],
  voiceCloneId: null,
  voiceGender: 'auto',
  model: 'mureka-9',
})

assert.throws(() => sanitizeMusicGenerateBody({
  idempotency_key: 'abc',
  workspace_id: '00000000-0000-0000-0000-000000000001',
  mode: 'custom',
  type: 'song',
  title: '一'.repeat(21),
  lyrics: '歌词',
  model: 'mureka-9',
}), /标题不能超过 20 字/)

assert.throws(() => sanitizeVoiceCloneBody({
  workspace_id: '00000000-0000-0000-0000-000000000001',
  name: '我的音色',
  description: 'a'.repeat(1025),
}), /描述不能超过 1024 字/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aigc/api build`

Expected: FAIL because `routes/music/_shared.ts` is missing.

- [ ] **Step 3: Add API queue helpers**

Modify `apps/api/src/lib/queue.ts`:

```ts
let _musicQueue: Queue | null = null
let _musicVoiceCloneQueue: Queue | null = null

export function getMusicQueue(): Queue {
  if (!_musicQueue) {
    _musicQueue = new Queue('music-queue', { connection: getRedisOptions() })
  }
  return _musicQueue
}

export function getMusicVoiceCloneQueue(): Queue {
  if (!_musicVoiceCloneQueue) {
    _musicVoiceCloneQueue = new Queue('music-voice-clone-queue', { connection: getRedisOptions() })
  }
  return _musicVoiceCloneQueue
}
```

- [ ] **Step 4: Add shared validation helpers**

Create `apps/api/src/routes/music/_shared.ts`:

```ts
import { getDb } from '@aigc/db'
import {
  isMusicModel,
  isMusicVoiceGender,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  normalizeMusicTitle,
  normalizeVoiceCloneDescription,
  type MusicMode,
  type MusicModel,
  type MusicTrackType,
  type MusicVoiceGender,
} from '@aigc/types'

export interface SanitizedMusicGenerateBody {
  idempotencyKey: string
  workspaceId: string
  mode: MusicMode
  type: MusicTrackType
  prompt: string | null
  title: string
  lyrics: string | null
  styles: string[]
  voiceCloneId: string | null
  voiceGender: MusicVoiceGender
  model: MusicModel
}

function requireString(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${label}不能为空`)
  return text
}

function normalizeStyles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((v) => typeof v === 'string' ? v.trim() : '').filter(Boolean))).slice(0, 20)
}

export function sanitizeMusicGenerateBody(body: Record<string, unknown>): SanitizedMusicGenerateBody {
  const idempotencyKey = requireString(body.idempotency_key, '幂等键')
  const workspaceId = requireString(body.workspace_id, '工作区')
  const mode = body.mode === 'custom' ? 'custom' : 'inspiration'
  const type = body.type === 'instrumental' ? 'instrumental' : 'song'
  if (!isMusicModel(body.model)) throw new Error('音乐模型无效')
  const voiceGender = isMusicVoiceGender(body.voice_gender) ? body.voice_gender : 'auto'
  const voiceCloneId = typeof body.voice_clone_id === 'string' && body.voice_clone_id.trim() ? body.voice_clone_id.trim() : null

  if (mode === 'custom') {
    const title = normalizeMusicTitle(body.title)
    const lyrics = requireString(body.lyrics, '歌词')
    if (lyrics.length > MUSIC_LYRICS_MAX_LENGTH) throw new Error('歌词不能超过 3000 字')
    return {
      idempotencyKey,
      workspaceId,
      mode,
      type: 'song',
      prompt: typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MUSIC_PROMPT_MAX_LENGTH) : null,
      title,
      lyrics,
      styles: normalizeStyles(body.styles),
      voiceCloneId,
      voiceGender,
      model: body.model,
    }
  }

  const prompt = requireString(body.prompt, '灵感提示词')
  if (prompt.length > MUSIC_PROMPT_MAX_LENGTH) throw new Error('灵感提示词不能超过 1024 字')
  return {
    idempotencyKey,
    workspaceId,
    mode,
    type,
    prompt,
    title: prompt.slice(0, 20),
    lyrics: null,
    styles: [],
    voiceCloneId,
    voiceGender,
    model: body.model,
  }
}

export function sanitizeVoiceCloneBody(body: Record<string, unknown>) {
  return {
    workspaceId: requireString(body.workspace_id, '工作区'),
    name: requireString(body.name, '音色名称').slice(0, 100),
    description: normalizeVoiceCloneDescription(body.description),
  }
}

export async function resolveEditableWorkspace(workspaceId: string, userId: string, isAdmin: boolean) {
  const db = getDb()
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select(['workspaces.team_id as teamId', 'workspace_members.role'])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .executeTakeFirst()
  if (!member && !isAdmin) throw new Error('无权访问该工作区')
  if (member?.role === 'viewer' && !isAdmin) throw new Error('查看者无权创建音乐')
  if (member) return member
  const workspace = await db.selectFrom('workspaces').select('team_id as teamId').where('id', '=', workspaceId).executeTakeFirst()
  if (!workspace) throw new Error('工作区不存在')
  return { teamId: workspace.teamId, role: 'admin' as const }
}
```

- [ ] **Step 5: Run API build**

Run: `pnpm --filter @aigc/api build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/queue.ts apps/api/src/routes/music/_shared.ts apps/api/src/__tests__/music-validation.test.ts
git commit -m "feat(api): add music validation helpers"
```

---

### Task 4: Music API Routes

**Files:**
- Create: `apps/api/src/routes/music/post-generate.ts`
- Create: `apps/api/src/routes/music/get-tracks.ts`
- Create: `apps/api/src/routes/music/get-tracks-id.ts`
- Create: `apps/api/src/routes/music/get-tracks-id-adjacent.ts`
- Create: `apps/api/src/routes/music/get-tracks-id-events.ts`
- Create: `apps/api/src/routes/music/post-voice-clones.ts`
- Create: `apps/api/src/routes/music/get-voice-clones.ts`

- [ ] **Step 1: Write failing route build expectation**

Run: `pnpm --filter @aigc/api build`

Expected: PASS before files exist. This task uses TypeScript build as the acceptance gate after each route file is added.

- [ ] **Step 2: Implement `POST /music/generate`**

Create `apps/api/src/routes/music/post-generate.ts` with this route skeleton:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { getMusicQueue } from '../../lib/queue.js'
import { sanitizeMusicGenerateBody, resolveEditableWorkspace } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.post('/music/generate', async (request, reply) => {
    let body
    try {
      body = sanitizeMusicGenerateBody(request.body as Record<string, unknown>)
    } catch (err) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : '参数错误' } })
    }

    const userId = request.user.id
    let workspace
    try {
      workspace = await resolveEditableWorkspace(body.workspaceId, userId, request.user.role === 'admin')
    } catch (err) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: err instanceof Error ? err.message : '无权访问' } })
    }

    const db = getDb()
    const modelRow = await db
      .selectFrom('provider_models')
      .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
      .select(['provider_models.credit_cost', 'providers.code as providerCode'])
      .where('provider_models.code', '=', body.model)
      .where('provider_models.module', '=', 'music' as any)
      .where('provider_models.is_active', '=', true)
      .where('providers.is_active', '=', true)
      .executeTakeFirst()
    if (!modelRow) {
      return reply.status(404).send({ success: false, error: { code: 'MODEL_NOT_FOUND', message: '音乐模型不可用' } })
    }

    const estimatedCredits = modelRow.credit_cost
    let creditAccountId: string
    try {
      const frozen = await freezeCredits(workspace.teamId, userId, estimatedCredits)
      creditAccountId = frozen.creditAccountId
    } catch (err) {
      return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: err instanceof Error ? err.message : '积分不足' } })
    }

    try {
      const created = await db.transaction().execute(async (trx) => {
        const batch = await trx.insertInto('task_batches').values({
          user_id: userId,
          team_id: workspace.teamId,
          workspace_id: body.workspaceId,
          credit_account_id: creditAccountId,
          idempotency_key: body.idempotencyKey,
          module: 'music' as any,
          provider: 'mureka',
          model: body.model,
          prompt: body.prompt ?? body.title,
          params: JSON.stringify(body),
          quantity: 1,
          status: 'pending',
          estimated_credits: estimatedCredits,
        }).returningAll().executeTakeFirstOrThrow()

        const task = await trx.insertInto('tasks').values({
          batch_id: batch.id,
          user_id: userId,
          version_index: 0,
          estimated_credits: estimatedCredits,
          status: 'pending',
        }).returningAll().executeTakeFirstOrThrow()

        const track = await trx.insertInto('music_tracks').values({
          workspace_id: body.workspaceId,
          user_id: userId,
          team_id: workspace.teamId,
          batch_id: batch.id,
          task_id: task.id,
          type: body.type,
          mode: body.mode,
          title: body.title,
          prompt: body.prompt,
          lyrics: body.lyrics,
          styles: JSON.stringify(body.styles),
          voice_clone_id: body.voiceCloneId,
          voice_gender: body.voiceGender,
          model: body.model,
          status: 'pending',
        }).returningAll().executeTakeFirstOrThrow()

        return { batch, task, track }
      })

      await getMusicQueue().add('music-generate', {
        taskId: created.task.id,
        batchId: created.batch.id,
        trackId: created.track.id,
        userId,
        teamId: workspace.teamId,
        workspaceId: body.workspaceId,
        creditAccountId,
        estimatedCredits,
      })

      return reply.status(201).send({ track_id: created.track.id, batch_id: created.batch.id, task_id: created.task.id })
    } catch (err) {
      await refundCredits(workspace.teamId, creditAccountId, userId, estimatedCredits)
      request.log.error({ err }, 'music generate create failed')
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '音乐任务创建失败，积分已退回' } })
    }
  })
}

export default route
```

- [ ] **Step 3: Implement list/detail/adjacent routes**

Use Kysely queries in:

`apps/api/src/routes/music/get-tracks.ts`:

```ts
app.get<{ Querystring: { workspace_id: string; type?: 'song' | 'instrumental'; cursor?: string; limit?: string } }>('/music/tracks', async (request, reply) => {
  const limit = Math.min(Number(request.query.limit ?? 20), 50)
  const rows = await getDb().selectFrom('music_tracks')
    .selectAll()
    .where('workspace_id', '=', request.query.workspace_id)
    .$if(!!request.query.type, (qb) => qb.where('type', '=', request.query.type!))
    .$if(!!request.query.cursor, (qb) => qb.where('created_at', '<', new Date(request.query.cursor!)))
    .orderBy('created_at', 'desc')
    .limit(limit + 1)
    .execute()
  return reply.send({ data: rows.slice(0, limit), cursor: rows.length > limit ? rows[limit].created_at.toISOString() : null })
})
```

`apps/api/src/routes/music/get-tracks-id.ts` selects by `id` and checks workspace membership.

`apps/api/src/routes/music/get-tracks-id-adjacent.ts` returns previous/next IDs by `created_at` within the same `workspace_id`.

- [ ] **Step 4: Implement `POST /music/voice-clones` and list**

Use multipart upload like existing upload routes:

```ts
app.post('/music/voice-clones', async (request, reply) => {
  const data = await request.file()
  if (!data) return reply.badRequest('缺少音频文件')
  const fields = data.fields as Record<string, any>
  const body = sanitizeVoiceCloneBody({
    workspace_id: fields.workspace_id?.value,
    name: fields.name?.value,
    description: fields.description?.value,
  })
  // upload buffer to TOS, create task_batch/tasks/music_voice_clones, enqueue music-voice-clone-queue
  return reply.status(201).send({ voice_clone_id: voiceClone.id, batch_id: batch.id })
})
```

The implementation must follow `apps/api/src/routes/canvas/post-canvases-asset-upload.ts` for multipart parsing and `uploadToTos`.

- [ ] **Step 5: Implement SSE route**

Create `apps/api/src/routes/music/get-tracks-id-events.ts`:

```ts
app.get<{ Params: { id: string } }>('/music/tracks/:id/events', async (request, reply) => {
  const track = await getDb().selectFrom('music_tracks').select(['id', 'workspace_id']).where('id', '=', request.params.id).executeTakeFirst()
  if (!track) return reply.notFound('音乐作品不存在')
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const channel = `music:track:${track.id}`
  const { Redis } = await import('ioredis')
  const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  await sub.subscribe(channel)
  sub.on('message', (_channel, message) => {
    reply.raw.write(`event: music_update\ndata: ${message}\n\n`)
  })
  request.raw.on('close', () => {
    sub.unsubscribe(channel).catch(() => undefined)
    sub.quit().catch(() => undefined)
  })
  return reply.hijack()
})
```

- [ ] **Step 6: Run API build**

Run: `pnpm --filter @aigc/api build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/music apps/api/src/lib/queue.ts
git commit -m "feat(api): add music routes"
```

---

### Task 5: Worker Mureka Client And Storage Helpers

**Files:**
- Create: `apps/worker/src/lib/mureka.ts`
- Create: `apps/worker/src/lib/music-storage.ts`
- Test: `apps/worker/src/workers/music.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/worker/src/workers/music.test.ts`:

```ts
import assert from 'node:assert/strict'
import { buildCustomSongPrompt, pickMurekaTrackUrls } from './music.js'

assert.equal(buildCustomSongPrompt({
  title: '星空来信',
  lyrics: '第一句',
  styles: ['流行', 'R&B'],
  voiceGender: 'female',
}), '标题：星空来信\n风格：流行、R&B\n音色性别：女声\n歌词：\n第一句')

assert.deepEqual(pickMurekaTrackUrls({
  url: 'https://cdn/song.mp3',
  flac_url: 'https://cdn/song.flac',
  wav_url: 'https://cdn/song.wav',
  stream_url: 'https://cdn/song-stream.mp3',
}), {
  audioUrl: 'https://cdn/song.mp3',
  flacUrl: 'https://cdn/song.flac',
  wavUrl: 'https://cdn/song.wav',
  streamUrl: 'https://cdn/song-stream.mp3',
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aigc/worker build`

Expected: FAIL because helpers are not exported.

- [ ] **Step 3: Add Mureka client**

Create `apps/worker/src/lib/mureka.ts`:

```ts
const MUREKA_API_URL = process.env.MUREKA_API_URL ?? 'https://api.mureka.ai'
const MUREKA_API_KEY = process.env.MUREKA_API_KEY ?? ''

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${MUREKA_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MUREKA_API_KEY}`,
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Mureka API ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

export interface MurekaTaskResponse {
  id?: string
  task_id?: string
  status?: string
  lyrics?: string
  url?: string
  flac_url?: string
  wav_url?: string
  stream_url?: string
  voice_id?: string
  data?: Record<string, unknown>
}

export async function generateLyrics(payload: Record<string, unknown>): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>('/v1/lyrics/generate', { method: 'POST', body: JSON.stringify(payload) })
}

export async function generateSong(payload: Record<string, unknown>): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>('/v1/song/generate', { method: 'POST', body: JSON.stringify(payload) })
}

export async function generateInstrumental(payload: Record<string, unknown>): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>('/v1/instrumental/generate', { method: 'POST', body: JSON.stringify(payload) })
}

export async function cloneVocal(payload: Record<string, unknown>): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>('/v1/song/vocal-clone', { method: 'POST', body: JSON.stringify(payload) })
}

export async function querySongTask(taskId: string): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>(`/v1/song/query/${encodeURIComponent(taskId)}`, { method: 'GET' })
}

export async function queryInstrumentalTask(taskId: string): Promise<MurekaTaskResponse> {
  return requestJson<MurekaTaskResponse>(`/v1/instrumental/query/${encodeURIComponent(taskId)}`, { method: 'GET' })
}
```

- [ ] **Step 4: Add music storage helper**

Create `apps/worker/src/lib/music-storage.ts` using patterns from `apps/worker/src/workers/transfer.ts`:

```ts
import { getTos, getBucket, getPublicUrl } from './storage.js'

export async function downloadMusicFile(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载音乐文件失败: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function uploadMusicBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
  await getTos().putObject({ bucket: getBucket(), key, body: buffer, contentType })
  return `${getPublicUrl()}/${key}`
}

export function inferMusicContentType(kind: 'audio' | 'flac' | 'wav' | 'cover'): string {
  if (kind === 'flac') return 'audio/flac'
  if (kind === 'wav') return 'audio/wav'
  if (kind === 'cover') return 'image/jpeg'
  return 'audio/mpeg'
}
```

- [ ] **Step 5: Run worker build**

Run: `pnpm --filter @aigc/worker build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/lib/mureka.ts apps/worker/src/lib/music-storage.ts apps/worker/src/workers/music.test.ts
git commit -m "feat(worker): add mureka client"
```

---

### Task 6: Music And Voice Clone Workers

**Files:**
- Create: `apps/worker/src/workers/music.ts`
- Create: `apps/worker/src/workers/music-voice-clone.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement music progress publisher and helpers**

Create `apps/worker/src/workers/music.ts`:

```ts
import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { MusicJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { generateLyrics, generateSong, generateInstrumental, querySongTask, queryInstrumentalTask } from '../lib/mureka.js'
import { downloadMusicFile, inferMusicContentType, uploadMusicBuffer } from '../lib/music-storage.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

export function buildCustomSongPrompt(input: { title: string; lyrics: string; styles: string[]; voiceGender: string }): string {
  const gender = input.voiceGender === 'male' ? '男声' : input.voiceGender === 'female' ? '女声' : '自动'
  return `标题：${input.title}\n风格：${input.styles.join('、') || '未指定'}\n音色性别：${gender}\n歌词：\n${input.lyrics}`
}

export function pickMurekaTrackUrls(raw: any) {
  return {
    audioUrl: raw.url ?? raw.data?.url ?? null,
    flacUrl: raw.flac_url ?? raw.data?.flac_url ?? null,
    wavUrl: raw.wav_url ?? raw.data?.wav_url ?? null,
    streamUrl: raw.stream_url ?? raw.data?.stream_url ?? null,
  }
}

async function publishTrack(trackId: string, event: unknown) {
  await getPubRedis().publish(`music:track:${trackId}`, JSON.stringify(event))
}
```

- [ ] **Step 2: Implement job processing**

Append to `apps/worker/src/workers/music.ts`:

```ts
export const musicWorker = new Worker<MusicJobData>('music-queue', async (job) => {
  const db = getDb()
  const data = job.data
  const track = await db.selectFrom('music_tracks').selectAll().where('id', '=', data.trackId).executeTakeFirstOrThrow()
  const params = JSON.parse((await db.selectFrom('task_batches').select('params').where('id', '=', data.batchId).executeTakeFirstOrThrow()).params as string)

  await db.updateTable('tasks').set({ status: 'processing', processing_started_at: new Date().toISOString(), queue_job_id: job.id ?? null }).where('id', '=', data.taskId).execute()

  try {
    let lyrics = track.lyrics
    if (track.type === 'song' && track.mode === 'inspiration') {
      await db.updateTable('music_tracks').set({ status: 'lyrics_generating' }).where('id', '=', track.id).execute()
      await publishTrack(track.id, { event: 'status', status: 'lyrics_generating' })
      const lyricsResult = await generateLyrics({ prompt: track.prompt, model: track.model, voice_gender: track.voice_gender })
      lyrics = lyricsResult.lyrics ?? String(lyricsResult.data?.lyrics ?? '')
      await db.updateTable('music_tracks').set({ lyrics }).where('id', '=', track.id).execute()
      await publishTrack(track.id, { event: 'lyrics_delta', delta: lyrics, lyrics })
    }

    await db.updateTable('music_tracks').set({ status: 'song_generating' }).where('id', '=', track.id).execute()
    await publishTrack(track.id, { event: 'status', status: 'song_generating' })

    const submit = track.type === 'instrumental'
      ? await generateInstrumental({ prompt: track.prompt, model: track.model, n: 1 })
      : await generateSong({ lyrics, title: track.title, model: track.model, prompt: params.prompt, voice_id: params.voice_id, n: 1 })

    const externalTaskId = submit.task_id ?? submit.id ?? String(submit.data?.task_id ?? '')
    await db.updateTable('music_tracks').set({ external_task_id: externalTaskId }).where('id', '=', track.id).execute()

    let finalResult: any = submit
    for (let i = 0; i < 180; i++) {
      finalResult = track.type === 'instrumental' ? await queryInstrumentalTask(externalTaskId) : await querySongTask(externalTaskId)
      const urls = pickMurekaTrackUrls(finalResult)
      if (urls.streamUrl) {
        await db.updateTable('music_tracks').set({ stream_url: urls.streamUrl }).where('id', '=', track.id).execute()
        await publishTrack(track.id, { event: 'stream_url', stream_url: urls.streamUrl })
      }
      if (urls.audioUrl && urls.flacUrl && urls.wavUrl) break
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    const urls = pickMurekaTrackUrls(finalResult)
    if (!urls.audioUrl) throw new Error('Mureka 任务完成但缺少音频 URL')

    await db.updateTable('music_tracks').set({ status: 'transferring', audio_url: urls.audioUrl, flac_url: urls.flacUrl, wav_url: urls.wavUrl }).where('id', '=', track.id).execute()
    await publishTrack(track.id, { event: 'status', status: 'transferring' })

    const audioStorageUrl = await uploadMusicBuffer(`music/${track.id}/audio.mp3`, await downloadMusicFile(urls.audioUrl), inferMusicContentType('audio'))
    const flacStorageUrl = urls.flacUrl ? await uploadMusicBuffer(`music/${track.id}/audio.flac`, await downloadMusicFile(urls.flacUrl), inferMusicContentType('flac')) : null
    const wavStorageUrl = urls.wavUrl ? await uploadMusicBuffer(`music/${track.id}/audio.wav`, await downloadMusicFile(urls.wavUrl), inferMusicContentType('wav')) : null

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('music_tracks').set({
        status: 'completed',
        audio_storage_url: audioStorageUrl,
        flac_storage_url: flacStorageUrl,
        wav_storage_url: wavStorageUrl,
      }).where('id', '=', track.id).execute()
      await trx.updateTable('tasks').set({ status: 'completed', credits_cost: data.estimatedCredits, completed_at: new Date().toISOString() }).where('id', '=', data.taskId).execute()
      await trx.updateTable('task_batches').set({ status: 'completed', completed_count: 1, actual_credits: data.estimatedCredits }).where('id', '=', data.batchId).execute()
      await trx.updateTable('credit_accounts').set({
        frozen_credits: sql`frozen_credits - ${data.estimatedCredits}`,
        balance: sql`balance - ${data.estimatedCredits}`,
        total_spent: sql`total_spent + ${data.estimatedCredits}`,
      }).where('id', '=', data.creditAccountId).execute()
    })
    const completed = await db.selectFrom('music_tracks').selectAll().where('id', '=', track.id).executeTakeFirstOrThrow()
    await publishTrack(track.id, { event: 'completed', track: completed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message, trackId: data.trackId }, 'music worker failed')
    await db.updateTable('music_tracks').set({ status: 'failed', error_message: message }).where('id', '=', data.trackId).execute()
    await db.updateTable('tasks').set({ status: 'failed', error_message: message }).where('id', '=', data.taskId).execute()
    await db.updateTable('task_batches').set({ status: 'failed', failed_count: 1 }).where('id', '=', data.batchId).execute()
    await publishTrack(data.trackId, { event: 'failed', error_message: message })
    throw err
  }
}, { connection: getBullMQConnection(), concurrency: 3, lockDuration: 900_000 })
```

- [ ] **Step 3: Implement voice clone worker**

Create `apps/worker/src/workers/music-voice-clone.ts`:

```ts
import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { MusicVoiceCloneJobData } from '@aigc/types'
import { getBullMQConnection } from '../lib/redis.js'
import { cloneVocal } from '../lib/mureka.js'

export const musicVoiceCloneWorker = new Worker<MusicVoiceCloneJobData>('music-voice-clone-queue', async (job) => {
  const db = getDb()
  const data = job.data
  const row = await db.selectFrom('music_voice_clones').selectAll().where('id', '=', data.voiceCloneId).executeTakeFirstOrThrow()
  try {
    await db.updateTable('music_voice_clones').set({ status: 'processing' }).where('id', '=', row.id).execute()
    const result = await cloneVocal({
      name: row.name,
      description: row.description,
      audio_url: row.source_audio_storage_url ?? row.source_audio_url,
      model: 'mureka-vocal-clone',
    })
    const voiceId = result.voice_id ?? String(result.data?.voice_id ?? '')
    if (!voiceId) throw new Error('音色克隆完成但缺少 voice_id')
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('music_voice_clones').set({ status: 'ready', voice_id: voiceId, external_voice_id: voiceId }).where('id', '=', row.id).execute()
      await trx.updateTable('tasks').set({ status: 'completed', credits_cost: data.estimatedCredits, completed_at: new Date().toISOString() }).where('id', '=', data.taskId).execute()
      await trx.updateTable('task_batches').set({ status: 'completed', completed_count: 1, actual_credits: data.estimatedCredits }).where('id', '=', data.batchId).execute()
      await trx.updateTable('credit_accounts').set({
        frozen_credits: sql`frozen_credits - ${data.estimatedCredits}`,
        balance: sql`balance - ${data.estimatedCredits}`,
        total_spent: sql`total_spent + ${data.estimatedCredits}`,
      }).where('id', '=', data.creditAccountId).execute()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.updateTable('music_voice_clones').set({ status: 'failed', error_message: message }).where('id', '=', row.id).execute()
    await db.updateTable('tasks').set({ status: 'failed', error_message: message }).where('id', '=', data.taskId).execute()
    await db.updateTable('task_batches').set({ status: 'failed', failed_count: 1 }).where('id', '=', data.batchId).execute()
    throw err
  }
}, { connection: getBullMQConnection(), concurrency: 2, lockDuration: 900_000 })
```

- [ ] **Step 4: Register workers in index**

Modify `apps/worker/src/index.ts`:

```ts
import { musicWorker } from './workers/music.js'
import { musicVoiceCloneWorker } from './workers/music-voice-clone.js'
```

Add startup logs:

```ts
logger.info('Music worker started — listening on music-queue')
logger.info('Music voice clone worker started — listening on music-voice-clone-queue')
```

Add to shutdown close list:

```ts
await Promise.all([
  imageWorker.close(),
  transferWorker.close(),
  videoSubmitWorker.close(),
  storyboardWorker.close(),
  cronWorker.close(),
  musicWorker.close(),
  musicVoiceCloneWorker.close(),
])
```

- [ ] **Step 5: Run worker build**

Run: `pnpm --filter @aigc/worker build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/workers/music.ts apps/worker/src/workers/music-voice-clone.ts apps/worker/src/index.ts
git commit -m "feat(worker): process music jobs"
```

---

### Task 7: Frontend API Hooks And Navigation

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Create: `apps/web/src/lib/music/api.ts`
- Create: `apps/web/src/hooks/use-music.ts`

- [ ] **Step 1: Add Music nav item**

Modify `apps/web/src/components/layout/sidebar.tsx` imports:

```ts
import { Music } from 'lucide-react'
```

Add item after canvas:

```ts
{ href: '/music', label: '音乐', icon: Music },
```

- [ ] **Step 2: Create frontend API functions**

Create `apps/web/src/lib/music/api.ts`:

```ts
import { apiGet, apiPost } from '@/lib/api-client'
import type { MusicGenerateRequest, MusicTrackResponse, MusicVoiceCloneResponse } from '@aigc/types'

export interface MusicListResponse {
  data: MusicTrackResponse[]
  cursor: string | null
}

export function createMusicTrack(payload: MusicGenerateRequest) {
  return apiPost<{ track_id: string; batch_id: string; task_id: string }>('/music/generate', payload)
}

export function listMusicTracks(workspaceId: string, type?: 'song' | 'instrumental', cursor?: string) {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: '20' })
  if (type) params.set('type', type)
  if (cursor) params.set('cursor', cursor)
  return apiGet<MusicListResponse>(`/music/tracks?${params}`)
}

export function getMusicTrack(id: string) {
  return apiGet<MusicTrackResponse>(`/music/tracks/${id}`)
}

export function getMusicAdjacent(id: string) {
  return apiGet<{ previous_id: string | null; next_id: string | null }>(`/music/tracks/${id}/adjacent`)
}

export function listMusicVoiceClones(workspaceId: string) {
  return apiGet<{ data: MusicVoiceCloneResponse[] }>(`/music/voice-clones?workspace_id=${workspaceId}`)
}
```

- [ ] **Step 3: Create SWR hooks**

Create `apps/web/src/hooks/use-music.ts`:

```ts
'use client'

import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useAuthStore } from '@/stores/auth-store'
import { apiFetcher } from '@/lib/api-client'
import type { MusicListResponse } from '@/lib/music/api'
import type { MusicVoiceCloneResponse, MusicTrackResponse } from '@aigc/types'

export function useMusicTracks(type?: 'song' | 'instrumental') {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const getKey = (pageIndex: number, previous: MusicListResponse | null) => {
    if (!workspaceId) return null
    if (previous && !previous.cursor) return null
    const params = new URLSearchParams({ workspace_id: workspaceId, limit: '20' })
    if (type) params.set('type', type)
    if (pageIndex > 0 && previous?.cursor) params.set('cursor', previous.cursor)
    return `/music/tracks?${params}`
  }
  const swr = useSWRInfinite<MusicListResponse>(getKey, apiFetcher, { revalidateOnFocus: false })
  const tracks = swr.data ? swr.data.flatMap((page) => page.data) : []
  return { ...swr, tracks, hasMore: !!swr.data?.[swr.data.length - 1]?.cursor, loadMore: () => swr.setSize(swr.size + 1) }
}

export function useMusicVoiceClones() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  return useSWR<{ data: MusicVoiceCloneResponse[] }>(workspaceId ? `/music/voice-clones?workspace_id=${workspaceId}` : null, apiFetcher)
}

export function useMusicTrack(id: string) {
  return useSWR<MusicTrackResponse>(id ? `/music/tracks/${id}` : null, apiFetcher)
}
```

- [ ] **Step 4: Run web build**

Run: `pnpm --filter @aigc/web build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/sidebar.tsx apps/web/src/lib/music/api.ts apps/web/src/hooks/use-music.ts
git commit -m "feat(web): add music hooks and navigation"
```

---

### Task 8: Music Creation And List Page

**Files:**
- Create: `apps/web/src/components/music/music-create-panel.tsx`
- Create: `apps/web/src/components/music/music-voice-upload-dialog.tsx`
- Create: `apps/web/src/components/music/music-track-list.tsx`
- Create: `apps/web/src/app/(dashboard)/music/page.tsx`

- [ ] **Step 1: Create voice upload dialog**

Create `apps/web/src/components/music/music-voice-upload-dialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

export function MusicVoiceUploadDialog({ open, onOpenChange, workspaceId, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onCreated: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const invalidDescription = description.length > 1024

  async function submit() {
    if (!file || !name.trim() || invalidDescription || submitting) return
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('workspace_id', workspaceId)
      form.set('name', name.trim())
      form.set('description', description.trim())
      form.set('file', file)
      const res = await fetch('/api/v1/music/voice-clones', { method: 'POST', body: form, credentials: 'include' })
      if (!res.ok) throw new Error('音色克隆提交失败')
      toast.success('音色克隆已提交')
      onCreated()
      onOpenChange(false)
    } catch {
      toast.error('音色克隆提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>上传音频生成音色</DialogTitle></DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="音色名称" maxLength={100} />
        <Input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="音色描述（可选，1024 字以内）" />
        <div className="text-xs text-muted-foreground text-right">{description.length} / 1024</div>
        <Button onClick={submit} disabled={!file || !name.trim() || invalidDescription || submitting}>
          {submitting ? '提交中...' : '提交克隆'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create creation panel**

Create `apps/web/src/components/music/music-create-panel.tsx` implementing the single-column form:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { createMusicTrack } from '@/lib/music/api'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import type { MusicModel, MusicVoiceCloneResponse, MusicVoiceGender } from '@aigc/types'

const PROMPTS = [
  '一首关于星空与思念的中文流行歌曲，旋律舒缓，充满情感',
  'An upbeat electronic dance track with futuristic synths',
  '轻快的儿童歌曲，关于春天和小动物，欢快可爱',
]

export function MusicCreatePanel({ voices, onOpenVoiceDialog, onCreated }: {
  voices: MusicVoiceCloneResponse[]
  onOpenVoiceDialog: () => void
  onCreated: () => void
}) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [mode, setMode] = useState<'inspiration' | 'custom'>('inspiration')
  const [instrumental, setInstrumental] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [voiceCloneId, setVoiceCloneId] = useState<string>('')
  const [voiceGender, setVoiceGender] = useState<MusicVoiceGender>('auto')
  const [model, setModel] = useState<MusicModel>('mureka-9')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!workspaceId || submitting) return
    if (mode === 'custom' && title.trim().length > 20) {
      toast.error('标题不能超过 20 字')
      return
    }
    setSubmitting(true)
    try {
      await createMusicTrack({
        idempotency_key: `music_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        workspace_id: workspaceId,
        mode,
        type: mode === 'inspiration' && instrumental ? 'instrumental' : 'song',
        model,
        prompt: prompt.trim(),
        title: title.trim(),
        lyrics: lyrics.trim(),
        styles,
        voice_clone_id: voiceCloneId || null,
        voice_gender: voiceGender,
      })
      toast.success('音乐任务已提交')
      onCreated()
    } catch {
      toast.error('音乐任务提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">创造你的专属音乐</h1>
        <p className="text-sm text-muted-foreground mt-2">描述你想要的音乐风格、主题和情感，Toby AI 将为你创作独一无二的歌曲</p>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <Button variant={mode === 'inspiration' ? 'default' : 'ghost'} onClick={() => setMode('inspiration')}>灵感模式</Button>
        <Button variant={mode === 'custom' ? 'default' : 'ghost'} onClick={() => setMode('custom')}>自定义模式</Button>
      </div>
      {mode === 'inspiration' ? (
        <>
          <label className="flex items-center justify-between rounded-lg border p-3">
            <span>纯音乐</span>
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
          </label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 1024))} placeholder="灵感提示词" />
        </>
      ) : (
        <>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="歌曲标题（20 字以内）" />
          <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))} placeholder="歌词（3000 字以内）" />
          <Input value={styles.join('、')} onChange={(e) => setStyles(e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))} placeholder="风格多选输入框：流行、R&B、电子" />
        </>
      )}
      <select className="w-full rounded-lg border bg-background px-3 py-2" value={voiceCloneId} onChange={(e) => e.target.value === '__upload__' ? onOpenVoiceDialog() : setVoiceCloneId(e.target.value)}>
        <option value="">不使用我的音色</option>
        {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        {voices.length === 0 && <option value="__upload__">暂无音色，上传自己的音频文件生成音色</option>}
      </select>
      <select className="w-full rounded-lg border bg-background px-3 py-2" value={voiceGender} onChange={(e) => setVoiceGender(e.target.value as MusicVoiceGender)}>
        <option value="auto">自动</option>
        <option value="male">男声</option>
        <option value="female">女声</option>
      </select>
      <div className="grid grid-cols-2 gap-2">
        {(['mureka-9', 'mureka-8'] as MusicModel[]).map((item) => (
          <button key={item} onClick={() => setModel(item)} className={`rounded-lg border p-3 text-left ${model === item ? 'border-primary bg-primary/5' : ''}`}>
            <div className="font-medium">{item}</div>
            <div className="text-xs text-muted-foreground mt-1">{item === 'mureka-9' ? '质量优先' : '速度更快'}</div>
          </button>
        ))}
      </div>
      {mode === 'inspiration' && <div className="flex flex-wrap gap-2">{PROMPTS.map((item) => <Button key={item} variant="outline" size="sm" onClick={() => setPrompt(item)}>{item}</Button>)}</div>}
      <Button className="w-full" onClick={submit} disabled={submitting}>{submitting ? '提交中...' : mode === 'inspiration' && instrumental ? '生成纯音乐' : '生成歌曲'}</Button>
    </section>
  )
}
```

- [ ] **Step 3: Create track list**

Create `apps/web/src/components/music/music-track-list.tsx` with empty text:

```tsx
'use client'

import Link from 'next/link'
import type { MusicTrackResponse } from '@aigc/types'

export function MusicTrackList({ tracks }: { tracks: MusicTrackResponse[] }) {
  if (tracks.length === 0) {
    return <div className="rounded-xl border bg-card py-20 text-center text-muted-foreground">还没有音乐哦，快去创作吧</div>
  }
  return (
    <div className="space-y-3">
      {tracks.map((track) => (
        <Link key={track.id} href={`/music/${track.id}`} className="grid grid-cols-[72px_1fr_auto] gap-3 rounded-xl border bg-card p-3 hover:border-primary">
          <div className="aspect-square rounded-lg bg-muted overflow-hidden">
            {track.cover_url ? <img src={track.cover_url} alt={track.title} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{track.title}</div>
            <div className="text-xs text-muted-foreground mt-1">{track.type === 'instrumental' ? '纯音乐' : '歌曲'} · {track.voice_name ?? '无音色'} · {track.model}</div>
          </div>
          <span className="text-xs text-muted-foreground">查看详情</span>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create `/music` page**

Create `apps/web/src/app/(dashboard)/music/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { MusicCreatePanel } from '@/components/music/music-create-panel'
import { MusicTrackList } from '@/components/music/music-track-list'
import { MusicVoiceUploadDialog } from '@/components/music/music-voice-upload-dialog'
import { useMusicTracks, useMusicVoiceClones } from '@/hooks/use-music'
import { useAuthStore } from '@/stores/auth-store'

export default function MusicPage() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const tracks = useMusicTracks()
  const voices = useMusicVoiceClones()
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <MusicCreatePanel
        voices={voices.data?.data ?? []}
        onOpenVoiceDialog={() => setDialogOpen(true)}
        onCreated={() => tracks.mutate()}
      />
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">我的音乐作品</h2>
          <p className="text-sm text-muted-foreground mt-1">列表页只展示记录；点击封面进入详情页播放与查看歌词</p>
        </div>
        <MusicTrackList tracks={tracks.tracks} />
      </section>
      {workspaceId && (
        <MusicVoiceUploadDialog open={dialogOpen} onOpenChange={setDialogOpen} workspaceId={workspaceId} onCreated={() => voices.mutate()} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run web build**

Run: `pnpm --filter @aigc/web build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/music apps/web/src/app/\(dashboard\)/music/page.tsx
git commit -m "feat(web): add music creation page"
```

---

### Task 9: Music Detail Page And Player

**Files:**
- Create: `apps/web/src/components/music/music-player.tsx`
- Create: `apps/web/src/app/(dashboard)/music/[id]/page.tsx`

- [ ] **Step 1: Create player component**

Create `apps/web/src/components/music/music-player.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { MusicTrackResponse } from '@aigc/types'

export function MusicPlayer({ track }: { track: MusicTrackResponse }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const src = track.audio_url ?? track.stream_url
  function toggle() {
    const audio = audioRef.current
    if (!audio || !src) return
    if (playing) audio.pause()
    else audio.play()
    setPlaying(!playing)
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-center">
      <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
        {track.cover_url ? <img src={track.cover_url} alt={track.title} className="h-full w-full object-cover" /> : null}
      </div>
      <div>
        <h1 className="text-3xl font-semibold">{track.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">作曲 Toby AI · 作词 {track.type === 'instrumental' ? '无歌词' : 'Toby AI'} · {track.voice_name ?? '无音色'} · {track.model}</p>
        <div className="my-8 flex h-16 items-center gap-1">
          {Array.from({ length: 24 }).map((_, i) => <span key={i} className="w-1 rounded-full bg-primary/70" style={{ height: `${16 + ((i * 17) % 44)}px` }} />)}
        </div>
        <audio ref={audioRef} src={src ?? undefined} controls className="w-full" />
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={toggle} disabled={!src}>{playing ? '暂停' : '播放'}</Button>
          {track.audio_url && <span className="rounded-full border px-2 py-1 text-xs">MP3</span>}
          {track.flac_url && <span className="rounded-full border px-2 py-1 text-xs">FLAC</span>}
          {track.wav_url && <span className="rounded-full border px-2 py-1 text-xs">WAV</span>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create detail page**

Create `apps/web/src/app/(dashboard)/music/[id]/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MusicPlayer } from '@/components/music/music-player'
import { useMusicTrack } from '@/hooks/use-music'
import useSWR from 'swr'
import { apiFetcher } from '@/lib/api-client'

export default function MusicDetailPage() {
  const params = useParams<{ id: string }>()
  const { data: track, error } = useMusicTrack(params.id)
  const { data: adjacent } = useSWR<{ previous_id: string | null; next_id: string | null }>(params.id ? `/music/tracks/${params.id}/adjacent` : null, apiFetcher)
  if (error) return <div className="text-destructive">加载音乐详情失败</div>
  if (!track) return <div className="text-muted-foreground">加载中...</div>
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
      <section className="rounded-2xl border bg-card p-6">
        <MusicPlayer track={track} />
        <div className="mt-6 flex gap-2">
          {adjacent?.previous_id && <Link className="rounded-lg border px-3 py-2 text-sm" href={`/music/${adjacent.previous_id}`}>上一首</Link>}
          {adjacent?.next_id && <Link className="rounded-lg border px-3 py-2 text-sm" href={`/music/${adjacent.next_id}`}>下一首</Link>}
        </div>
      </section>
      <aside className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">歌词</h2>
        <div className="mt-4 whitespace-pre-line leading-8 text-sm text-muted-foreground">
          {track.type === 'instrumental' ? '暂无歌词' : track.lyrics ?? '暂无歌词'}
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Run web build**

Run: `pnpm --filter @aigc/web build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/music/music-player.tsx apps/web/src/app/\(dashboard\)/music/\[id\]/page.tsx
git commit -m "feat(web): add music detail page"
```

---

### Task 10: End-To-End Verification

**Files:**
- Create: `apps/web/e2e/music/music-page.spec.ts`
- Modify after failures only: files from earlier tasks.

- [ ] **Step 1: Add e2e smoke test**

Create `apps/web/e2e/music/music-page.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('music page shows empty state and creation form', async ({ page }) => {
  await page.route('**/api/v1/music/tracks**', async (route) => {
    await route.fulfill({ json: { data: [], cursor: null } })
  })
  await page.route('**/api/v1/music/voice-clones**', async (route) => {
    await route.fulfill({ json: { data: [] } })
  })
  await page.goto('/music')
  await expect(page.getByText('创造你的专属音乐')).toBeVisible()
  await expect(page.getByText('还没有音乐哦，快去创作吧')).toBeVisible()
  await expect(page.getByText('暂无音色，上传自己的音频文件生成音色')).toBeVisible()
})
```

- [ ] **Step 2: Run focused builds**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/db build
pnpm --filter @aigc/api build
pnpm --filter @aigc/worker build
pnpm --filter @aigc/web build
```

Expected: all PASS.

- [ ] **Step 3: Run web e2e smoke**

Run: `pnpm --filter @aigc/web test:e2e -- music/music-page.spec.ts`

Expected: PASS. If auth middleware blocks `/music`, update the e2e fixture to seed authenticated storage following existing `apps/web/e2e/fixtures/auth.ts`.

- [ ] **Step 4: Browser manual verification**

Start local app:

```bash
pnpm --filter @aigc/web dev
```

Open `http://localhost:6006/music` in Browser/IAB and verify:

- Music nav item appears below Canvas.
- Creation form is single-column.
- Inspiration mode has pure music switch, prompt, voice dropdown, voice gender dropdown, model cards, reference prompts.
- Empty list shows `还没有音乐哦，快去创作吧`.
- Voice dropdown empty option opens upload dialog.
- Custom mode title rejects more than 20 characters.
- Detail page layout has right-side lyrics drawer.

- [ ] **Step 5: Final commit**

```bash
git add apps/web/e2e/music/music-page.spec.ts
git commit -m "test(web): add music page smoke coverage"
```

---

## Self-Review Checklist

- Spec coverage:
  - Navigation, `/music`, `/music/[id]`: Tasks 7, 8, 9.
  - Single-column form, two tabs, pure music switch, title/lyrics/style limits: Tasks 1, 3, 8.
  - Voice clone upload, description, `voice_id`: Tasks 1, 2, 4, 6, 8.
  - Workspace isolation and music not in assets: Tasks 2, 4.
  - Stream URL and SSE: Tasks 4, 6.
  - Mureka and TOS: Tasks 5, 6.
  - Pricing: Task 2 and Task 4.
  - Empty state text: Task 8 and Task 10.
- Placeholder scan:
  - No `TBD`, `TODO`, `implement later`, or unresolved placeholder steps.
- Type consistency:
  - `music_tracks.voice_clone_id` references `music_voice_clones.id`.
  - `music_voice_clones.voice_id` stores Mureka returned voice ID.
  - Queue payloads use `trackId` and `voiceCloneId`.
  - Frontend route names match API route names.
