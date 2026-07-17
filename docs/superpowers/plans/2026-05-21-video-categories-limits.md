# video_categories 能力限制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `provider_models.video_categories` 从旧数组升级为“视频模式 + 图片/视频/音频数量限制”对象，并让创作生成页、画布视频节点和 `/videos/generate` 共用同一套限制规则。

**Architecture:** 在 `@aigc/types` 中定义强类型和纯函数校验工具，前端通过同一工具解析模型能力并在模式切换、提交、画布连线前拦截，后端在冻结积分前执行兜底校验。Seed 统一写入新对象结构，不保留旧数组兼容逻辑。

**Tech Stack:** TypeScript、Next.js 14 App Router、React 18、Fastify 4、Kysely、pnpm、Turborepo。

---

## File Structure

- Modify: `packages/types/src/db.ts`
  - 移除废弃 `components` 模式，导出 `VideoCategory = 'multimodal' | 'frames'`。
- Modify: `packages/types/src/api.ts`
  - 新增 `VideoReferenceKind`、`VideoCategoryLimit`、`VideoCategoryConfig`、`VideoCategories`、解析函数、限制校验函数。
  - 将 `ModelItem.video_categories` 从 `unknown` 改为 `VideoCategories | unknown`，保留前端解析入口需要的 `unknown` 输入能力。
- Modify: `packages/db/scripts/seed.ts`
  - 新增 `VIDEO_CATEGORY_LIMITS` 常量。
  - 将视频模型 `video_categories` 改为对象结构并 `JSON.stringify()` 入库。
  - 删除已废弃 `components` 出现在活动模型数据中的配置。
- Modify: `apps/api/src/routes/videos/post-generate.ts`
  - 查询模型时读取 `provider_models.video_categories`。
  - 在积分冻结前调用共享校验函数，非法请求直接返回 400。
  - 移除 `request.body as any`，改成局部请求体接口，满足类型安全。
- Modify: `apps/web/src/components/generation/video/video-panel.tsx`
  - 删除 `components` 模式分支和硬编码模型切换列表。
  - 基于当前模型 `video_categories` 渲染模式按钮。
  - 模式切换前校验当前已选资源；不满足时阻止切换并 `toast.error()`。
  - 生成按钮点击前校验当前模式；不满足时不上传、不请求。
- Modify: `apps/web/src/components/generation/video/video-params.tsx`
  - 模型下拉过滤改用 `parseVideoCategories()` + 当前模式 key。
- Modify: `apps/web/src/components/generation/video/video-multimodal-zone.tsx`
  - 接收动态 limits，替换 `MAX_MULTIMODAL_*` 硬编码上限。
- Modify: `apps/web/src/lib/canvas/types.ts`
  - 给 `VideoGenConfig` 增加 `videoCategoryLimits?: VideoCategories` 快照字段，供结构 store 在连线校验时读取。
- Modify: `apps/web/src/components/canvas/node-param-panel.tsx`
  - 解析当前模型能力，模式切换和执行前执行限制校验。
  - 在模型变化时把 `videoCategoryLimits` 写入节点 config，供连线校验使用。
- Modify: `apps/web/src/components/canvas/panels/video-gen-panel.tsx`
  - 模式按钮来自当前模型 `video_categories` key，不再硬编码 “全能参考 / 首尾帧” 可用性。
  - 模型过滤改用新解析工具。
- Modify: `apps/web/src/stores/canvas/structure-store.ts`
  - 画布连线校验读取目标视频节点 config 中的 `videoCategoryLimits`，按所有模式同类资源最大值限制输入边数量。

---

## Shared Helper Contract

在 `packages/types/src/api.ts` 中新增运行时工具，前后端都使用它：

```ts
export type VideoReferenceKind = 'image' | 'video' | 'audio'
export type VideoCategory = 'multimodal' | 'frames'

export interface VideoCategoryLimit {
  min: number
  max: number
}

export interface VideoCategoryConfig {
  label: string
  limits: Record<VideoReferenceKind, VideoCategoryLimit>
}

export type VideoCategories = Partial<Record<VideoCategory, VideoCategoryConfig>>

export interface VideoReferenceCounts {
  image: number
  video: number
  audio: number
}

export interface VideoLimitValidationResult {
  valid: boolean
  message?: string
}

const VIDEO_REFERENCE_KINDS: VideoReferenceKind[] = ['image', 'video', 'audio']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLimit(value: unknown): value is VideoCategoryLimit {
  if (!isPlainObject(value)) return false
  return Number.isInteger(value.min) && Number.isInteger(value.max) && value.min >= 0 && value.max >= value.min
}

function isCategoryConfig(value: unknown): value is VideoCategoryConfig {
  if (!isPlainObject(value) || typeof value.label !== 'string' || !isPlainObject(value.limits)) return false
  return VIDEO_REFERENCE_KINDS.every((kind) => isLimit(value.limits[kind]))
}

export function parseVideoCategories(raw: unknown): VideoCategories {
  const value = typeof raw === 'string'
    ? (() => {
        try { return JSON.parse(raw) as unknown } catch { return null }
      })()
    : raw

  if (!isPlainObject(value)) return {}

  const out: VideoCategories = {}
  if (isCategoryConfig(value.multimodal)) out.multimodal = value.multimodal
  if (isCategoryConfig(value.frames)) out.frames = value.frames
  return out
}

export function getVideoCategoryKeys(categories: VideoCategories): VideoCategory[] {
  return (['multimodal', 'frames'] as const).filter((key) => !!categories[key])
}

export function getMaxVideoReferenceLimits(categories: VideoCategories): VideoReferenceCounts {
  return getVideoCategoryKeys(categories).reduce<VideoReferenceCounts>((acc, key) => {
    const limits = categories[key]?.limits
    if (!limits) return acc
    return {
      image: Math.max(acc.image, limits.image.max),
      video: Math.max(acc.video, limits.video.max),
      audio: Math.max(acc.audio, limits.audio.max),
    }
  }, { image: 0, video: 0, audio: 0 })
}

export function validateVideoReferenceLimits(
  categories: VideoCategories,
  category: VideoCategory,
  counts: VideoReferenceCounts,
): VideoLimitValidationResult {
  const config = categories[category]
  if (!config) return { valid: false, message: '当前模型不支持该视频生成模式' }

  for (const kind of VIDEO_REFERENCE_KINDS) {
    const count = counts[kind]
    const limit = config.limits[kind]
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
    if (count < limit.min) return { valid: false, message: `${config.label}至少需要 ${limit.min} 个${label}参考素材` }
    if (count > limit.max) return { valid: false, message: `${config.label}最多允许 ${limit.max} 个${label}参考素材` }
  }

  return { valid: true }
}
```

---

### Task 1: Shared Types and Runtime Validation

**Files:**
- Modify: `packages/types/src/db.ts:1-3`
- Modify: `packages/types/src/api.ts:1-220`

- [ ] **Step 1: Write RED assertion for old type surface**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const api = fs.readFileSync('packages/types/src/api.ts', 'utf8')
const db = fs.readFileSync('packages/types/src/db.ts', 'utf8')
if (!api.includes('video_categories: unknown')) process.exit(1)
if (!db.includes("'components'")) process.exit(1)
console.log('RED: old video_categories type and components mode still exist')
NODE
```

Expected: PASS, proving the old type surface still exists.

- [ ] **Step 2: Update shared types and helper functions**

In `packages/types/src/db.ts`, replace:

```ts
export type VideoCategory = 'multimodal' | 'frames' | 'components'
```

with:

```ts
export type VideoCategory = 'multimodal' | 'frames'
```

In `packages/types/src/api.ts`, add the helper contract above after the import block and before request/response interfaces. Replace `ModelItem.video_categories` with:

```ts
  video_categories: VideoCategories | unknown
```

Update the comment to:

```ts
  video_categories: VideoCategories | unknown  // 视频模型支持的模式与参考素材数量限制
```

- [ ] **Step 3: Run GREEN assertion and type build**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const api = fs.readFileSync('packages/types/src/api.ts', 'utf8')
const db = fs.readFileSync('packages/types/src/db.ts', 'utf8')
for (const text of ['parseVideoCategories', 'validateVideoReferenceLimits', 'getMaxVideoReferenceLimits']) {
  if (!api.includes(text)) throw new Error(`missing ${text}`)
}
if (db.includes("'components'")) throw new Error('components mode should be removed')
console.log('GREEN: shared video category helpers exist')
NODE
pnpm --filter @aigc/types build
```

Expected: assertion prints `GREEN...`; build exits 0.

---

### Task 2: Seed New `video_categories` Object Structure

**Files:**
- Modify: `packages/db/scripts/seed.ts:454-719`

- [ ] **Step 1: Write RED assertion for old seed arrays**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const seed = fs.readFileSync('packages/db/scripts/seed.ts', 'utf8')
if (!seed.includes("video_categories: ['frames']")) process.exit(1)
if (!seed.includes("video_categories: ['multimodal', 'frames', 'components']")) process.exit(1)
console.log('RED: seed still uses old video category arrays')
NODE
```

Expected: PASS.

- [ ] **Step 2: Add reusable seed constants**

Before `const veoVideoModels = [` add:

```ts
  const FRAMES_VIDEO_CATEGORIES = {
    frames: {
      label: '首尾帧',
      limits: {
        image: { min: 1, max: 2 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
      },
    },
  }

  const MULTIMODAL_AND_FRAMES_VIDEO_CATEGORIES = {
    multimodal: {
      label: '全能参考',
      limits: {
        image: { min: 0, max: 9 },
        video: { min: 0, max: 3 },
        audio: { min: 0, max: 3 },
      },
    },
    frames: FRAMES_VIDEO_CATEGORIES.frames,
  }
```

- [ ] **Step 3: Replace model category arrays**

Replace active model category assignments:

```ts
video_categories: ['frames'],
```

with:

```ts
video_categories: FRAMES_VIDEO_CATEGORIES,
```

Replace:

```ts
video_categories: ['multimodal', 'frames', 'components'],
```

with:

```ts
video_categories: MULTIMODAL_AND_FRAMES_VIDEO_CATEGORIES,
```

Leave the commented `veo3.1-components` block commented, but remove its old category line or change it to a comment that does not contain an active old array string.

- [ ] **Step 4: Run GREEN assertion**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const seed = fs.readFileSync('packages/db/scripts/seed.ts', 'utf8')
if (seed.includes("video_categories: ['frames']")) throw new Error('old frames array still exists')
if (seed.includes("video_categories: ['multimodal', 'frames', 'components']")) throw new Error('old multimodal array still exists')
for (const text of ['FRAMES_VIDEO_CATEGORIES', 'MULTIMODAL_AND_FRAMES_VIDEO_CATEGORIES', "label: '全能参考'", "image: { min: 0, max: 9 }"]) {
  if (!seed.includes(text)) throw new Error(`missing ${text}`)
}
console.log('GREEN: seed uses video category limit objects')
NODE
```

Expected: PASS.

---

### Task 3: Backend `/videos/generate` Fallback Validation

**Files:**
- Modify: `apps/api/src/routes/videos/post-generate.ts:1-220`

- [ ] **Step 1: Write RED assertion for missing backend validation**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const route = fs.readFileSync('apps/api/src/routes/videos/post-generate.ts', 'utf8')
if (!route.includes('provider_models.video_categories')) console.log('RED: model query does not read video_categories')
if (!route.includes('validateVideoReferenceLimits')) console.log('RED: route does not validate video reference limits')
if (route.includes('provider_models.video_categories') && route.includes('validateVideoReferenceLimits')) process.exit(1)
NODE
```

Expected: prints RED messages.

- [ ] **Step 2: Import helpers and add request body type**

Replace imports with an additional type/helper import:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import {
  parseVideoCategories,
  validateVideoReferenceLimits,
  type VideoCategory,
  type VideoReferenceCounts,
} from '@aigc/types'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { getVideoQueue } from '../../lib/queue.js'
```

Add after `ALLOWED_PARAM_KEYS`:

```ts
interface VideoGenerateBody {
  prompt: string
  workspace_id: string
  model: string
  aspect_ratio?: string
  resolution?: string
  duration?: number
  generate_audio?: boolean
  camera_fixed?: boolean
  enable_upsample?: boolean
  watermark?: boolean
  images?: string[]
  reference_images?: string[]
  reference_videos?: string[]
  reference_audios?: string[]
  canvas_id?: string
  canvas_node_id?: string
  video_studio_project_id?: string
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function resolveRequestCategory(body: VideoGenerateBody): { category: VideoCategory; counts: VideoReferenceCounts } | { error: string } {
  const framesCount = countArray(body.images)
  const referenceCounts: VideoReferenceCounts = {
    image: countArray(body.reference_images),
    video: countArray(body.reference_videos),
    audio: countArray(body.reference_audios),
  }
  const hasReferences = referenceCounts.image > 0 || referenceCounts.video > 0 || referenceCounts.audio > 0

  if (framesCount > 0 && hasReferences) return { error: '同一次请求不能同时使用首尾帧和全能参考素材' }
  if (framesCount > 0) return { category: 'frames', counts: { image: framesCount, video: 0, audio: 0 } }
  return { category: 'multimodal', counts: referenceCounts }
}
```

- [ ] **Step 3: Use typed body and read model categories**

Replace:

```ts
    } = request.body as any
```

with:

```ts
    } = request.body as VideoGenerateBody
```

Add model select field:

```ts
        'provider_models.video_categories',
```

- [ ] **Step 4: Validate before credit freeze**

After `if (!providerModel) { ... }`, add:

```ts
    const categories = parseVideoCategories(providerModel.video_categories)
    const requestCategory = resolveRequestCategory(request.body as VideoGenerateBody)

    if ('error' in requestCategory) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_VIDEO_REFERENCES', message: requestCategory.error } })
    }

    const validation = validateVideoReferenceLimits(categories, requestCategory.category, requestCategory.counts)
    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_VIDEO_REFERENCES', message: validation.message ?? '视频参考素材数量不符合模型限制' },
      })
    }
```

- [ ] **Step 5: Run GREEN assertion and API build**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const route = fs.readFileSync('apps/api/src/routes/videos/post-generate.ts', 'utf8')
for (const text of ['provider_models.video_categories', 'parseVideoCategories', 'validateVideoReferenceLimits', 'INVALID_VIDEO_REFERENCES', 'resolveRequestCategory']) {
  if (!route.includes(text)) throw new Error(`missing ${text}`)
}
if (route.includes('request.body as any')) throw new Error('request.body as any should be removed')
console.log('GREEN: backend video limit validation is wired')
NODE
pnpm --filter @aigc/api build
```

Expected: assertion passes; API build exits 0.

---

### Task 4: Creation Page Model Modes and Submit Validation

**Files:**
- Modify: `apps/web/src/components/generation/video/video-panel.tsx:1-276`
- Modify: `apps/web/src/components/generation/video/video-params.tsx:1-120`
- Modify: `apps/web/src/components/generation/video/video-multimodal-zone.tsx:1-120`

- [ ] **Step 1: Write RED assertion for old hardcoded modes**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const panel = fs.readFileSync('apps/web/src/components/generation/video/video-panel.tsx', 'utf8')
const params = fs.readFileSync('apps/web/src/components/generation/video/video-params.tsx', 'utf8')
if (!panel.includes("type VideoMode = 'frames' | 'components' | 'multimodal'")) process.exit(1)
if (!params.includes('Array.isArray(m.video_categories)')) process.exit(1)
console.log('RED: creation page still uses old mode/model filtering')
NODE
```

Expected: PASS.

- [ ] **Step 2: Import helpers and narrow `VideoMode`**

In `video-panel.tsx`, add imports:

```ts
import {
  getVideoCategoryKeys,
  parseVideoCategories,
  validateVideoReferenceLimits,
  type VideoCategory,
  type VideoReferenceCounts,
} from '@aigc/types'
```

Replace:

```ts
type VideoMode = 'frames' | 'components' | 'multimodal'
```

with:

```ts
type VideoMode = VideoCategory
```

- [ ] **Step 3: Add current model capability helpers**

Inside `VideoPanel`, after `useModels(...)` add:

```ts
  const currentVideoModel = videoModels.find((m) => m.code === videoModel)
  const currentVideoCategories = parseVideoCategories(currentVideoModel?.video_categories)
  const availableVideoModes = getVideoCategoryKeys(currentVideoCategories)
```

Add count helpers before `handleVideoGenerate`:

```ts
  const getResourceCounts = (mode: VideoMode): VideoReferenceCounts => {
    if (mode === 'frames') {
      return { image: [firstFrame, lastFrame].filter(Boolean).length, video: 0, audio: 0 }
    }

    return {
      image: multimodalImages.length,
      video: multimodalVideos.length,
      audio: multimodalAudios.length,
    }
  }

  const validateModeResources = (mode: VideoMode): boolean => {
    const result = validateVideoReferenceLimits(currentVideoCategories, mode, getResourceCounts(mode))
    if (!result.valid) toast.error(result.message ?? '当前参考素材不符合模型限制')
    return result.valid
  }
```

- [ ] **Step 4: Replace hardcoded model/mode effect**

Replace the existing model validity `useEffect` with:

```ts
  useEffect(() => {
    if (!videoModelsReady || videoModels.length === 0) return

    const nextModel = videoModels.find((m) => {
      const categories = parseVideoCategories(m.video_categories)
      return getVideoCategoryKeys(categories).length > 0
    })
    const isValid = videoModels.some((m) => m.code === videoModel)

    if (!isValid && nextModel) setVideoModel(nextModel.code)
  }, [videoModelsReady, videoModels, videoModel])

  useEffect(() => {
    if (!videoModelsReady || availableVideoModes.length === 0) return
    if (!availableVideoModes.includes(videoMode)) setVideoMode(availableVideoModes[0])
  }, [availableVideoModes, videoMode, videoModelsReady])
```

- [ ] **Step 5: Validate before upload and remove components branch**

At the start of `handleVideoGenerate`, after prompt check, add:

```ts
    if (!validateModeResources(videoMode)) return
```

Remove the `components` branch from `handleVideoGenerate` entirely. The remaining branches should be only:

```ts
      if (videoMode === 'frames') {
        const arr: string[] = []
        if (firstFrame) arr.push(await resolveVideoImageInput(firstFrame, 'first_frame.jpg', isSeedance))
        if (lastFrame) arr.push(await resolveVideoImageInput(lastFrame, 'last_frame.jpg', isSeedance))
        imagesParam = arr.length > 0 ? arr : undefined
      } else if (videoMode === 'multimodal') {
        const [imgs, vids, auds] = await Promise.all([
          multimodalImages.length > 0
            ? Promise.all(multimodalImages.map((img, i) => resolveVideoImageInput(img, `ref_image_${i}.jpg`, true)))
            : Promise.resolve(undefined),
          multimodalVideos.length > 0
            ? Promise.all(multimodalVideos.map((v) => uploadToVideoTemp(v.file, v.name)))
            : Promise.resolve(undefined),
          multimodalAudios.length > 0
            ? Promise.all(multimodalAudios.map((a) => uploadToVideoTemp(a.file, a.name)))
            : Promise.resolve(undefined),
        ])
        referenceImagesParam = imgs ?? undefined
        referenceVideosParam = vids ?? undefined
        referenceAudiosParam = auds ?? undefined
      }
```

- [ ] **Step 6: Replace `switchMode`**

Replace `switchMode` with:

```ts
  const switchMode = (mode: VideoMode) => {
    if (mode === videoMode) return
    if (!validateModeResources(mode)) return
    setVideoMode(mode)
  }
```

Render buttons from current model categories:

```tsx
          {availableVideoModes.map((mode) => {
            const category = currentVideoCategories[mode]
            if (!category) return null
            return (
              <button key={mode} onClick={() => switchMode(mode)} className={modeBtnCls(videoMode === mode)}>
                {category.label}
              </button>
            )
          })}
```

Remove `VideoComponentsZone` import, state, JSX, and `isComponentsDisabled`.

- [ ] **Step 7: Wire dynamic multimodal limits**

Pass limits into zone:

```tsx
            limits={currentVideoCategories.multimodal?.limits}
```

In `video-multimodal-zone.tsx`, add prop:

```ts
  limits?: Record<'image' | 'video' | 'audio', { min: number; max: number }>
```

Use dynamic max values:

```ts
  const maxImages = limits?.image.max ?? MAX_MULTIMODAL_IMAGES
  const maxVideos = limits?.video.max ?? MAX_MULTIMODAL_VIDEOS
  const maxAudios = limits?.audio.max ?? MAX_MULTIMODAL_AUDIOS
```

Replace uses of `MAX_MULTIMODAL_IMAGES` / `MAX_MULTIMODAL_VIDEOS` / `MAX_MULTIMODAL_AUDIOS` inside runtime checks and labels with `maxImages` / `maxVideos` / `maxAudios`.

- [ ] **Step 8: Update model filtering in `video-params.tsx`**

Import:

```ts
import { parseVideoCategories } from '@aigc/types'
```

Replace available model filter with:

```ts
  const availableModels = (models ?? []).filter((m) => {
    const categories = parseVideoCategories(m.video_categories)
    return !!categories[videoMode]
  })
```

Narrow local `VideoMode` to:

```ts
type VideoMode = 'frames' | 'multimodal'
```

- [ ] **Step 9: Run GREEN assertion and web build**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const panel = fs.readFileSync('apps/web/src/components/generation/video/video-panel.tsx', 'utf8')
const params = fs.readFileSync('apps/web/src/components/generation/video/video-params.tsx', 'utf8')
if (panel.includes("'components'")) throw new Error('components mode should be removed from video-panel')
if (panel.includes('VideoComponentsZone')) throw new Error('VideoComponentsZone should no longer be used')
for (const text of ['parseVideoCategories', 'getVideoCategoryKeys', 'validateVideoReferenceLimits', 'availableVideoModes.map']) {
  if (!panel.includes(text)) throw new Error(`missing ${text}`)
}
if (!params.includes('parseVideoCategories')) throw new Error('video params should parse categories')
console.log('GREEN: creation page uses dynamic video category limits')
NODE
pnpm --filter @aigc/web build
```

Expected: assertion passes; web build exits 0.

---

### Task 5: Canvas Node Mode Buttons, Execution Validation, and Limit Snapshot

**Files:**
- Modify: `apps/web/src/lib/canvas/types.ts:33-44`
- Modify: `apps/web/src/components/canvas/node-param-panel.tsx:1-528`
- Modify: `apps/web/src/components/canvas/panels/video-gen-panel.tsx:1-376`

- [ ] **Step 1: Write RED assertion for old canvas category handling**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const panel = fs.readFileSync('apps/web/src/components/canvas/panels/video-gen-panel.tsx', 'utf8')
const nodePanel = fs.readFileSync('apps/web/src/components/canvas/node-param-panel.tsx', 'utf8')
if (!panel.includes('Array.isArray(m.video_categories)')) process.exit(1)
if (!nodePanel.includes('Array.isArray(dbModel.video_categories)')) process.exit(1)
console.log('RED: canvas video panel still uses old array category checks')
NODE
```

Expected: PASS.

- [ ] **Step 2: Extend canvas video config**

In `apps/web/src/lib/canvas/types.ts`, import type:

```ts
import type { VideoCategories } from '@aigc/types'
```

Add to `VideoGenConfig`:

```ts
  videoCategoryLimits?: VideoCategories
```

- [ ] **Step 3: Add mode mapping and imports to `node-param-panel.tsx`**

Import:

```ts
import {
  parseVideoCategories,
  validateVideoReferenceLimits,
  type VideoCategory,
  type VideoReferenceCounts,
} from '@aigc/types'
```

Add near constants:

```ts
const CANVAS_MODE_TO_CATEGORY: Record<VideoGenConfig['videoMode'], VideoCategory> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

const CATEGORY_TO_CANVAS_MODE: Record<VideoCategory, VideoGenConfig['videoMode']> = {
  multimodal: 'multiref',
  frames: 'keyframe',
}
```

- [ ] **Step 4: Compute current model categories and snapshot them**

Inside `NodeParamPanel`, after `const videoResolution = ...`, add:

```ts
  const currentVideoDbModel = videoModels.find((m) => m.code === videoModel)
  const currentVideoCategories = parseVideoCategories(currentVideoDbModel?.video_categories ?? videoCfg.videoCategoryLimits)
```

Add effect after `handleModelChange`:

```ts
  useEffect(() => {
    if (!isVideoGen || !videoModelsReady || !currentVideoDbModel) return
    const parsed = parseVideoCategories(currentVideoDbModel.video_categories)
    updateCfg({ videoCategoryLimits: parsed })
  }, [currentVideoDbModel, isVideoGen, updateCfg, videoModelsReady])
```

Also import `useEffect` from React in the existing import.

- [ ] **Step 5: Replace model change logic**

Replace `handleVideoModelChange` with:

```ts
  const handleVideoModelChange = useCallback((val: string) => {
    const dbModel = videoModels.find((m) => m.code === val)
    const isSeedanceModel = val.startsWith('seedance-')
    const categories = parseVideoCategories(dbModel?.video_categories)
    const targetCategory = CANVAS_MODE_TO_CATEGORY[videoMode]
    const nextCategory = categories[targetCategory]
      ? targetCategory
      : (categories.multimodal ? 'multimodal' : categories.frames ? 'frames' : targetCategory)
    const newAspect = isSeedanceModel ? (videoAspect || 'adaptive') : ''

    updateCfg({
      model: val,
      videoMode: CATEGORY_TO_CANVAS_MODE[nextCategory],
      aspectRatio: newAspect,
      videoCategoryLimits: categories,
    })
  }, [updateCfg, videoAspect, videoMode, videoModels])
```

- [ ] **Step 6: Validate canvas mode switch**

Replace `handleVideoModeChange` with:

```ts
  const getCanvasVideoCounts = useCallback((mode: VideoGenConfig['videoMode']): VideoReferenceCounts => {
    if (mode === 'keyframe') return { image: displayedKeyframes.length, video: 0, audio: 0 }
    return { image: multirefImages.length, video: multirefVideos.length, audio: multirefAudios.length }
  }, [displayedKeyframes.length, multirefAudios.length, multirefImages.length, multirefVideos.length])

  const handleVideoModeChange = useCallback((newMode: VideoGenConfig['videoMode']) => {
    if (newMode === videoMode) return

    const category = CANVAS_MODE_TO_CATEGORY[newMode]
    const validation = validateVideoReferenceLimits(currentVideoCategories, category, getCanvasVideoCounts(newMode))
    if (!validation.valid) {
      toast.error(validation.message ?? '请先断开不符合目标模式限制的连线')
      return
    }

    updateCfg({ videoMode: newMode })
    setKeyframeSwapped(false)
  }, [currentVideoCategories, getCanvasVideoCounts, updateCfg, videoMode])
```

- [ ] **Step 7: Validate before execute**

In `handleExecuteVideo`, after prompt validation and before `setExecuting(true)`, add:

```ts
    const category = CANVAS_MODE_TO_CATEGORY[videoMode]
    const validation = validateVideoReferenceLimits(currentVideoCategories, category, getCanvasVideoCounts(videoMode))
    if (!validation.valid) {
      toast.error(validation.message ?? '当前参考素材不符合模型限制')
      return
    }
```

Add `currentVideoCategories` and `getCanvasVideoCounts` to dependency array.

- [ ] **Step 8: Update `video-gen-panel.tsx` mode buttons and model filtering**

Import helpers:

```ts
import { getVideoCategoryKeys, parseVideoCategories, type VideoCategory } from '@aigc/types'
```

Replace current `VIDEO_MODE_TO_CATEGORY` type with:

```ts
const VIDEO_MODE_TO_CATEGORY: Record<VideoMode, VideoCategory> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

const CATEGORY_TO_VIDEO_MODE: Record<VideoCategory, VideoMode> = {
  multimodal: 'multiref',
  frames: 'keyframe',
}
```

Replace `filteredModels`:

```ts
  const filteredModels = (models ?? []).filter((m) => {
    const categories = parseVideoCategories(m.video_categories)
    return !!categories[VIDEO_MODE_TO_CATEGORY[videoMode]]
  })
```

Replace `currentSupportsMultiref` with:

```ts
  const currentCategories = parseVideoCategories(currentDbModel?.video_categories)
  const availableModes = getVideoCategoryKeys(currentCategories)
```

Replace hardcoded two buttons with:

```tsx
          {availableModes.map((category) => {
            const mode = CATEGORY_TO_VIDEO_MODE[category]
            const label = currentCategories[category]?.label ?? category
            return (
              <button
                key={category}
                data-testid={`video-mode-${mode}`}
                onClick={() => onVideoModeChange(mode)}
                className={cn(
                  'flex-1 py-1 transition-colors',
                  videoMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                )}
              >
                {label}
              </button>
            )
          })}
```

- [ ] **Step 9: Run GREEN assertion and web build**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const types = fs.readFileSync('apps/web/src/lib/canvas/types.ts', 'utf8')
const nodePanel = fs.readFileSync('apps/web/src/components/canvas/node-param-panel.tsx', 'utf8')
const panel = fs.readFileSync('apps/web/src/components/canvas/panels/video-gen-panel.tsx', 'utf8')
if (!types.includes('videoCategoryLimits?: VideoCategories')) throw new Error('missing videoCategoryLimits snapshot')
for (const text of ['parseVideoCategories', 'validateVideoReferenceLimits', 'CANVAS_MODE_TO_CATEGORY', 'getCanvasVideoCounts']) {
  if (!nodePanel.includes(text)) throw new Error(`node-param-panel missing ${text}`)
}
if (panel.includes('Array.isArray(m.video_categories)')) throw new Error('old array checks remain in video-gen-panel')
if (!panel.includes('availableModes.map')) throw new Error('mode buttons should come from categories')
console.log('GREEN: canvas panel uses dynamic video category limits')
NODE
pnpm --filter @aigc/web build
```

Expected: assertion passes; web build exits 0.

---

### Task 6: Canvas Connection Limits from Model Capability Snapshot

**Files:**
- Modify: `apps/web/src/stores/canvas/structure-store.ts:1-210`

- [ ] **Step 1: Write RED assertion for hardcoded canvas limits**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const store = fs.readFileSync('apps/web/src/stores/canvas/structure-store.ts', 'utf8')
if (!store.includes('existingImages >= 9')) process.exit(1)
if (!store.includes('existingVideos >= 3')) process.exit(1)
if (!store.includes('existingAudios >= 3')) process.exit(1)
console.log('RED: canvas connection limits are hardcoded')
NODE
```

Expected: PASS.

- [ ] **Step 2: Import max-limit helper**

Add import:

```ts
import { getMaxVideoReferenceLimits, parseVideoCategories } from '@aigc/types'
```

- [ ] **Step 3: Add helper inside `validateConnection`**

After `const sourceMime = getNodeMimeType(sourceNode)`, add:

```ts
  const getVideoNodeMaxLimits = (node: AppNode | undefined) => {
    if (!node || !isVideoGenConfig(node.data.config)) return { image: 0, video: 0, audio: 0 }
    return getMaxVideoReferenceLimits(parseVideoCategories(node.data.config.videoCategoryLimits))
  }
```

In the `video_gen` branch, add:

```ts
      const maxLimits = getVideoNodeMaxLimits(targetNode)
```

Replace hardcoded checks:

```ts
        if (isImage && existingImages >= 9) return '参考图最多 9 张'
        if (isVideo && existingVideos >= 3) return '参考视频最多 3 个'
        if (isAudio && existingAudios >= 3) return '参考音频最多 3 个'
```

with:

```ts
        if (isImage && existingImages >= maxLimits.image) return `参考图最多 ${maxLimits.image} 张`
        if (isVideo && existingVideos >= maxLimits.video) return `参考视频最多 ${maxLimits.video} 个`
        if (isAudio && existingAudios >= maxLimits.audio) return `参考音频最多 ${maxLimits.audio} 个`
```

For keyframe mode, replace the hardcoded `2` with frame max:

```ts
          const maxImages = maxLimits.image || 2
          if (existingImages >= maxImages) return `首尾帧最多连接 ${maxImages} 张图片`
```

- [ ] **Step 4: Run GREEN assertion and web build**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const store = fs.readFileSync('apps/web/src/stores/canvas/structure-store.ts', 'utf8')
for (const text of ['getMaxVideoReferenceLimits', 'parseVideoCategories', 'getVideoNodeMaxLimits', 'maxLimits.image', 'maxLimits.video', 'maxLimits.audio']) {
  if (!store.includes(text)) throw new Error(`missing ${text}`)
}
for (const text of ['existingImages >= 9', 'existingVideos >= 3', 'existingAudios >= 3']) {
  if (store.includes(text)) throw new Error(`hardcoded limit remains: ${text}`)
}
console.log('GREEN: canvas connection limits read from model capability snapshot')
NODE
pnpm --filter @aigc/web build
```

Expected: assertion passes; web build exits 0.

---

### Task 7: Final Verification and Manual Test Checklist

**Files:**
- No code changes expected.

- [ ] **Step 1: Run required builds**

Run:

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/api build
pnpm --filter @aigc/web build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run seed shape assertion**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const seed = fs.readFileSync('packages/db/scripts/seed.ts', 'utf8')
const required = [
  "multimodal: {",
  "frames: {",
  "label: '全能参考'",
  "label: '首尾帧'",
  "image: { min: 0, max: 9 }",
  "video: { min: 0, max: 3 }",
  "audio: { min: 0, max: 3 }",
  "image: { min: 1, max: 2 }",
]
for (const text of required) {
  if (!seed.includes(text)) throw new Error(`missing ${text}`)
}
console.log('Seed video category shape OK')
NODE
```

Expected: prints `Seed video category shape OK`.

- [ ] **Step 3: Start local services for browser verification**

Run in separate terminals if needed:

```bash
pnpm --filter @aigc/api dev
pnpm --filter @aigc/web dev
```

Expected: API serves on `:7001`; web serves on `:6006`.

- [ ] **Step 4: Manually verify creation page**

Browser checklist:

```text
1. 打开创作生成页的视频面板。
2. 选择只支持 frames 的模型，确认只展示“首尾帧”模式。
3. 选择支持 multimodal + frames 的模型，确认展示“全能参考”和“首尾帧”。
4. 在全能参考中添加超过 9 张图片，确认前端阻止或提交前 toast 阻止。
5. 在全能参考中添加超过 3 个视频或 3 个音频，确认前端阻止或提交前 toast 阻止。
6. 切换到首尾帧时，如果当前资源不满足首尾帧限制，确认阻止切换并显示中文提示。
7. 首尾帧不添加图片直接生成，确认不发 `/videos/generate` 请求并提示至少需要 1 个图片参考素材。
```

- [ ] **Step 5: Manually verify canvas video node**

Browser checklist:

```text
1. 打开画布编辑器并添加视频节点。
2. 选择支持 multimodal + frames 的模型，确认模式按钮来自模型配置。
3. 全能参考模式连接 3 条视频边后，再连接第 4 条视频边，确认被阻止。
4. 全能参考模式连接 3 条音频边后，再连接第 4 条音频边，确认被阻止。
5. 从全能参考切换到首尾帧时，如果已有视频或音频边，确认阻止切换并提示先断开连线。
6. 首尾帧模式连接超过 2 张图片，确认被阻止。
7. 执行节点前不满足当前模式 min/max 时，确认不提交 `/videos/generate`。
```

- [ ] **Step 6: Manually verify backend fallback**

With a valid token/workspace, call `/videos/generate` directly with over-limit payloads:

```bash
curl -X POST http://localhost:7001/api/v1/videos/generate \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"测试",
    "workspace_id":"<WORKSPACE_ID>",
    "model":"seedance-2.0",
    "reference_videos":["v1","v2","v3","v4"]
  }'
```

Expected: HTTP 400 with JSON containing:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_VIDEO_REFERENCES",
    "message": "全能参考最多允许 3 个视频参考素材"
  }
}
```

---

## Self-Review

**Spec coverage:**
- 字段名继续使用 `video_categories`：Task 2 keeps field name unchanged.
- 不兼容旧数组结构：Task 1 parser rejects arrays; Task 2 removes active old arrays.
- 支持图片、视频、音频数量限制：Task 1 defines `VideoReferenceCounts` and validation; Tasks 4–6 consume it.
- 创作生成页提交前限制：Task 4 validates mode switch and submit before upload/API call.
- 画布视频节点限制：Tasks 5–6 validate mode switch, execute, and input edge counts.
- 后端 `/videos/generate` 兜底：Task 3 validates before credit freeze.
- Seed 调整：Task 2 updates `packages/db/scripts/seed.ts`.
- 验证命令：Task 7 runs required builds and manual checks.

**Placeholder scan:** No `TBD`、`TODO`、`implement later` placeholders are used as instructions.

**Type consistency:**
- `VideoCategory` is consistently `'multimodal' | 'frames'`.
- Canvas maps use `multiref ↔ multimodal` and `keyframe ↔ frames`.
- Resource keys are consistently `image | video | audio`.
