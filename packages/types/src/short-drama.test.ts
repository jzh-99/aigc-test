import assert from 'node:assert/strict'
import {
  SHORT_DRAMA_ASPECT_RATIOS,
  SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
  SHORT_DRAMA_EPISODE_COUNTS,
  SHORT_DRAMA_IMAGE_MODEL,
  SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT,
  SHORT_DRAMA_STYLE_TABS,
  SHORT_DRAMA_TEXT_MODEL,
  SHORT_DRAMA_VIDEO_MODEL,
  canEnterShortDramaStep,
  isShortDramaAspectRatio,
  isShortDramaDurationSeconds,
  isShortDramaEpisodeCount,
  makeDefaultShortDramaState,
  normalizeShortDramaState,
  sortShortDramaSegments,
} from './short-drama.js'

// 常量验证
assert.deepEqual(SHORT_DRAMA_STYLE_TABS, ['全部', '真人', '2D', '3D'])
assert.equal(SHORT_DRAMA_TEXT_MODEL, 'qwen3.6-plus')
assert.equal(SHORT_DRAMA_IMAGE_MODEL, 'seedream-5.0-lite')
assert.equal(SHORT_DRAMA_VIDEO_MODEL, 'seedance-1.0-lite')
assert.deepEqual(SHORT_DRAMA_ASPECT_RATIOS, ['9:16', '16:9'])
assert.deepEqual(SHORT_DRAMA_EPISODE_COUNTS, [5, 10, 15, 20])
assert.equal(SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT, 50)
assert.equal(SHORT_DRAMA_DEFAULT_DURATION_SECONDS, 4)

// 类型守卫
assert.equal(isShortDramaAspectRatio('9:16'), true)
assert.equal(isShortDramaAspectRatio('1:1'), false)
assert.equal(isShortDramaEpisodeCount(5), true)
assert.equal(isShortDramaEpisodeCount(50), true)
assert.equal(isShortDramaEpisodeCount(51), false)
assert.equal(isShortDramaDurationSeconds(4, [4, 5, 8]), true)
assert.equal(isShortDramaDurationSeconds(6, [4, 5, 8]), false)

// makeDefaultShortDramaState
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

// normalizeShortDramaState - 非法值归一化
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

// normalizeShortDramaState - 嵌套对象深度补默认值
const nestedPartial = normalizeShortDramaState({
  steps: { active: 'assets' },
  script: { originalPrompt: '测试' },
})
assert.equal(nestedPartial.steps.active, 'assets')
assert.deepEqual(nestedPartial.steps.completed, [])
assert.equal(nestedPartial.script.originalPrompt, '测试')
assert.equal(nestedPartial.script.refinedPrompt, null)
assert.deepEqual(nestedPartial.script.outlines, [])
assert.equal(nestedPartial.script.status, 'idle')

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
})
assert.equal(canEnterShortDramaStep(assetsCompleted, 'episodes'), true)

// canEnterShortDramaStep - script+assets 锁定后可进 episodes
const bothLocked = normalizeShortDramaState({
  locks: { script: true, assets: true, episodes: false },
})
assert.equal(canEnterShortDramaStep(bothLocked, 'episodes'), true)

// sortShortDramaSegments
const sorted = sortShortDramaSegments([
  { id: 'b', order: 2, title: 'B', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
  { id: 'a', order: 1, title: 'A', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
])
assert.deepEqual(sorted.map(segment => segment.id), ['a', 'b'])

console.log('✓ All tests passed')
