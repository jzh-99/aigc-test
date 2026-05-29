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
  locks: { script: true, assets: true, episodes: false },
  settings: {
    style: '真人都市',
    aspectRatio: 'bad' as any,
    episodeCount: 200,
    durationSeconds: 4,
    billingMode: 'estimate_actual',
  },
})
assert.equal(locked.settings.aspectRatio, '9:16')
assert.equal(locked.settings.episodeCount, 5)
assert.equal(canEnterShortDramaStep(locked, 'episodes'), true)

const sorted = sortShortDramaSegments([
  { id: 'b', order: 2, title: 'B', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
  { id: 'a', order: 1, title: 'A', prompt: '', mentionRefs: [], durationSeconds: 4, videoUrl: null, status: 'idle' },
])
assert.deepEqual(sorted.map(segment => segment.id), ['a', 'b'])
