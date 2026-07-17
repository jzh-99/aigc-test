import assert from 'node:assert/strict'
import {
  SHORT_DRAMA_ASPECT_RATIOS,
  SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
  SHORT_DRAMA_EPISODE_COUNTS,
  SHORT_DRAMA_IMAGE_MODEL,
  SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS,
  SHORT_DRAMA_SHOT_DURATION_SECONDS,
  SHORT_DRAMA_STYLE_TABS,
  SHORT_DRAMA_TEXT_MODEL,
  SHORT_DRAMA_VIDEO_MODEL,
  areShortDramaAssetsReady,
  calculateShortDramaSegmentDuration,
  canEnterShortDramaStep,
  extractShortDramaShotDurations,
  isShortDramaAspectRatio,
  isShortDramaDurationSeconds,
  isShortDramaEpisodeCount,
  isShortDramaShotDurationSeconds,
  makeDefaultShortDramaState,
  makeUploadedShortDramaState,
  normalizeShortDramaSegmentPrompt,
  normalizeShortDramaState,
  sortShortDramaSegments,
  updateShortDramaShotDuration,
} from './short-drama.js'

// 常量验证
assert.deepEqual(SHORT_DRAMA_STYLE_TABS, ['全部', '真人', '2D', '3D'])
assert.equal(SHORT_DRAMA_TEXT_MODEL, 'qwen3.7-max')
assert.equal(SHORT_DRAMA_IMAGE_MODEL, 'seedream-5.0-lite')
assert.equal(SHORT_DRAMA_VIDEO_MODEL, 'seedance-2.0')
assert.deepEqual(SHORT_DRAMA_ASPECT_RATIOS, ['9:16', '16:9'])
assert.deepEqual(SHORT_DRAMA_EPISODE_COUNTS, [5, 10, 15, 20])
assert.equal(SHORT_DRAMA_DEFAULT_DURATION_SECONDS, 4)
assert.equal(SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS, 100000)

// 类型守卫
assert.equal(isShortDramaAspectRatio('9:16'), true)
assert.equal(isShortDramaAspectRatio('1:1'), false)
assert.equal(isShortDramaEpisodeCount(5), true)
assert.equal(isShortDramaEpisodeCount(50), true)
assert.equal(isShortDramaEpisodeCount(80), true)
assert.equal(isShortDramaEpisodeCount(81), false)
assert.equal(isShortDramaEpisodeCount(100, 'upload'), true)
assert.equal(isShortDramaEpisodeCount(101, 'upload'), false)
assert.equal(isShortDramaEpisodeCount(0), false)
assert.equal(isShortDramaDurationSeconds(4, [4, 5, 8]), true)
assert.equal(isShortDramaDurationSeconds(6, [4, 5, 8]), false)

assert.deepEqual(SHORT_DRAMA_SHOT_DURATION_SECONDS, [2, 3, 4, 5, 6, 7, 8, 9, 10])
assert.equal(isShortDramaShotDurationSeconds(2), true)
assert.equal(isShortDramaShotDurationSeconds(10), true)
assert.equal(isShortDramaShotDurationSeconds(1), false)
assert.equal(isShortDramaShotDurationSeconds(11), false)

const structuredPrompt = [
  '本片段场景设定在：@旧教室，白天，自然光。',
  '',
  '分镜1 · 4s：远景，固定机位，拍摄空教室。',
  '',
  '分镜2 · 5s：中景，@林微 整理旧物。',
  '',
  '分镜3 · 6s：近景，@林微 挂断电话。',
].join('\n')

assert.deepEqual(extractShortDramaShotDurations(structuredPrompt), [
  { shotNumber: 1, durationSeconds: 4 },
  { shotNumber: 2, durationSeconds: 5 },
  { shotNumber: 3, durationSeconds: 6 },
])
assert.deepEqual(extractShortDramaShotDurations('分镜4 10s：补充镜头'), [
  { shotNumber: 4, durationSeconds: 10 },
])
assert.deepEqual(extractShortDramaShotDurations('分镜12s：这个格式缺少分隔符'), [])
assert.equal(calculateShortDramaSegmentDuration(structuredPrompt, 4), 15)
assert.equal(calculateShortDramaSegmentDuration('没有分镜时长', 4), 4)
assert.equal(calculateShortDramaSegmentDuration('分镜12s：这个格式缺少分隔符', 4), 4)
assert.equal(
  updateShortDramaShotDuration(structuredPrompt, 2, 8).includes('分镜2 · 8s：中景'),
  true
)
assert.equal(updateShortDramaShotDuration(structuredPrompt, 2, 1), structuredPrompt)
assert.equal(
  updateShortDramaShotDuration('分镜12s：这个格式缺少分隔符', 1, 8),
  '分镜12s：这个格式缺少分隔符'
)

// makeDefaultShortDramaState
const state = makeDefaultShortDramaState({
  prompt: '落魄千金回村创业',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 20,
})
assert.equal(state.steps.active, 'script')
assert.equal(state.script.originalPrompt, '落魄千金回村创业')
assert.equal(state.script.source, 'idea')
assert.equal(state.script.originalScript, '')
assert.equal(state.settings.style, '真人都市')
assert.equal(state.settings.aspectRatio, '9:16')
assert.equal(state.settings.episodeCount, 20)
assert.equal(state.settings.billingMode, 'estimate_actual')
assert.equal(state.locks.script, false)

// makeUploadedShortDramaState
const uploadedState = makeUploadedShortDramaState({
  originalScript: '第一集\n主角推门而入。',
  style: '真人都市',
  aspectRatio: '16:9',
  episodeCount: 5,
})
assert.equal(uploadedState.script.source, 'upload')
assert.equal(uploadedState.script.originalPrompt, '')
assert.equal(uploadedState.script.originalScript, '第一集\n主角推门而入。')
assert.equal(uploadedState.settings.aspectRatio, '16:9')
assert.equal(uploadedState.settings.episodeCount, 5)

// normalizeShortDramaState - 非法值归一化（idea 模式上限 80，超过回退 5）
const normalized = normalizeShortDramaState({
  steps: { active: 'episodes', completed: ['script', 'assets'] },
  locks: { script: true, assets: true, episodes: false },
  settings: {
    style: '真人都市',
    aspectRatio: 'bad' as any,
    episodeCount: 200,
    durationSeconds: 4,
    billingMode: 'estimate_actual',
  },
})
assert.equal(normalized.settings.aspectRatio, '9:16')
assert.equal(normalized.settings.episodeCount, 5)

// normalizeShortDramaState - 上传模式允许到 100
const normalizedUpload = normalizeShortDramaState({
  script: { source: 'upload', originalScript: 'x' },
  settings: { episodeCount: 100 } as any,
})
assert.equal(normalizedUpload.settings.episodeCount, 100)

// normalizeShortDramaState - 嵌套对象深度补默认值
const nestedPartial = normalizeShortDramaState({
  steps: { active: 'assets' },
  script: { originalPrompt: '测试' },
})
assert.equal(nestedPartial.steps.active, 'assets')
assert.deepEqual(nestedPartial.steps.completed, [])
assert.equal(nestedPartial.script.originalPrompt, '测试')
assert.equal(nestedPartial.script.source, 'idea')
assert.equal(nestedPartial.script.originalScript, '')
assert.equal(nestedPartial.script.refinedPrompt, null)
assert.equal(nestedPartial.script.summaryErrorMessage, null)
assert.deepEqual(nestedPartial.script.outlines, [])
assert.equal(nestedPartial.script.status, 'idle')
assert.equal(nestedPartial.script.outlinesStatus, 'idle')
assert.equal(nestedPartial.script.outlinesErrorMessage, null)

// canEnterShortDramaStep - script 总可进入
assert.equal(canEnterShortDramaStep(state, 'script'), true)

// canEnterShortDramaStep - 未完成/未锁定时不能越级
assert.equal(canEnterShortDramaStep(state, 'assets'), false)
assert.equal(canEnterShortDramaStep(state, 'episodes'), false)

// canEnterShortDramaStep - script 完成后可进 assets
const scriptCompleted = normalizeShortDramaState({
  steps: { active: 'script', completed: ['script'] },
})
assert.equal(canEnterShortDramaStep(scriptCompleted, 'assets'), true)
assert.equal(canEnterShortDramaStep(scriptCompleted, 'episodes'), false)

// canEnterShortDramaStep - script 锁定后可进 assets
const scriptLocked = normalizeShortDramaState({
  locks: { script: true, assets: false, episodes: false },
})
assert.equal(canEnterShortDramaStep(scriptLocked, 'assets'), true)
assert.equal(canEnterShortDramaStep(scriptLocked, 'episodes'), false)

// canEnterShortDramaStep - script+assets 完成后可进 episodes
const assetsCompleted = normalizeShortDramaState({
  steps: { active: 'assets', completed: ['script', 'assets'] },
  assets: {
    items: [
      { id: 'c1', kind: 'character', scope: 'global', name: '角色', description: '', imageUrl: 'https://example.com/c.png', referenceImageUrl: null, episodeNumber: null, status: 'completed', createdAt: '', updatedAt: '' },
      { id: 's1', kind: 'scene', scope: 'global', name: '场景', description: '', imageUrl: 'https://example.com/s.png', referenceImageUrl: null, episodeNumber: null, status: 'completed', createdAt: '', updatedAt: '' },
    ],
    status: 'completed',
  },
})
assert.equal(areShortDramaAssetsReady(assetsCompleted), true)
assert.equal(canEnterShortDramaStep(assetsCompleted, 'episodes'), true)

// canEnterShortDramaStep - assets 锁定但图片未完成时不能进 episodes
const bothLocked = normalizeShortDramaState({
  locks: { script: true, assets: true, episodes: false },
  assets: {
    items: [
      { id: 'c1', kind: 'character', scope: 'global', name: '角色', description: '', imageUrl: null, referenceImageUrl: null, episodeNumber: null, status: 'pending', createdAt: '', updatedAt: '' },
    ],
  },
})
assert.equal(areShortDramaAssetsReady(bothLocked), false)
assert.equal(canEnterShortDramaStep(bothLocked, 'episodes'), false)

// sortShortDramaSegments
const sorted = sortShortDramaSegments([
  { id: 'b', order: 2, title: 'B', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
  { id: 'a', order: 1, title: 'A', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
])
assert.deepEqual(sorted.map(segment => segment.id), ['a', 'b'])

// normalizeShortDramaSegmentPrompt - 统一每个「分镜N」独占一行
// 场景一：分镜间用空格分隔（靠 whitespace-pre-wrap 折行）→ 统一为换行
const spaceSeparated = '本片段场景设定在：@大厅。冷灰蓝色调。 分镜1 · 5s：中景。 分镜2 · 4s：近景。 分镜3 · 4s：特写。'
const normalizedFromSpace = normalizeShortDramaSegmentPrompt(spaceSeparated)
assert.equal(normalizedFromSpace, '本片段场景设定在：@大厅。冷灰蓝色调。\n分镜1 · 5s：中景。\n分镜2 · 4s：近景。\n分镜3 · 4s：特写。')

// 场景二：分镜间无分隔，直接接在上一分镜末尾 → 统一为换行
const noSeparator = '本片段场景设定在：@大厅。冷灰蓝色调。分镜1 · 5s：中景。分镜2 · 5s：近景。分镜3 · 4s：特写。'
const normalizedFromNone = normalizeShortDramaSegmentPrompt(noSeparator)
assert.equal(normalizedFromNone, '本片段场景设定在：@大厅。冷灰蓝色调。\n分镜1 · 5s：中景。\n分镜2 · 5s：近景。\n分镜3 · 4s：特写。')

// 场景三：已是标准换行格式 → 幂等，不重复加换行、不破坏既有换行
const alreadyNormalized = '本片段场景设定在：@大厅。\n分镜1 · 5s：中景。\n分镜2 · 4s：近景。'
assert.equal(normalizeShortDramaSegmentPrompt(alreadyNormalized), alreadyNormalized)

// 标准化不得破坏分镜时长解析
assert.deepEqual(extractShortDramaShotDurations(normalizedFromSpace), [
  { shotNumber: 1, durationSeconds: 5 },
  { shotNumber: 2, durationSeconds: 4 },
  { shotNumber: 3, durationSeconds: 4 },
])
// 标准化后仍可正常改写时长
assert.ok(updateShortDramaShotDuration(normalizedFromSpace, 2, 8).includes('分镜2 · 8s：'))

console.log('✓ All tests passed')
