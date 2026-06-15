import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState } from '@aigc/types'
import type { ShortDramaState, ShortDramaEpisode } from '@aigc/types'
import {
  isShortDramaTextTaskStuck,
  resetShortDramaTextTaskState,
  TEXT_TASK_STUCK_THRESHOLD_MS,
  TEXT_TASK_HEARTBEAT_INTERVAL_MS,
} from '../routes/short-drama/_text-task.js'

console.log('测试短剧文本任务僵死检测与重置...')

function makeState(): ShortDramaState {
  return makeDefaultShortDramaState({ prompt: '测试', style: '真人都市', aspectRatio: '9:16', episodeCount: 2 })
}

function makeEpisode(overrides: Partial<ShortDramaEpisode>): ShortDramaEpisode {
  return {
    episodeNumber: 1,
    title: 't',
    summary: 's',
    segments: [],
    status: 'generating',
    videoUrl: null,
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2026-06-15T00:00:00Z',
    ...overrides,
  }
}

const NOW = new Date('2026-06-15T10:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

// --- isShortDramaTextTaskStuck ---
{
  assert.equal(isShortDramaTextTaskStuck({ status: 'processing', updated_at: minutesAgo(11) }, NOW), true)
  console.log('✓ processing 且 updated_at 超 10 分钟 → 僵死')
}
{
  assert.equal(isShortDramaTextTaskStuck({ status: 'processing', updated_at: minutesAgo(3) }, NOW), false)
  console.log('✓ processing 但 updated_at 仅 3 分钟（宽限期内）→ 非僵死')
}
{
  assert.equal(isShortDramaTextTaskStuck({ status: 'processing', updated_at: minutesAgo(9) }, NOW), false)
  console.log('✓ processing 且 updated_at 9 分钟（未超阈值）→ 非僵死')
}
{
  assert.equal(isShortDramaTextTaskStuck({ status: 'completed', updated_at: minutesAgo(60) }, NOW), false)
  console.log('✓ 非 processing 状态 → 不判僵死')
}

// --- resetShortDramaTextTaskState: script-summary ---
{
  const state = makeState()
  state.script.status = 'generating'
  state.script.refinedPrompt = null
  assert.equal(resetShortDramaTextTaskState(state, 'script-summary'), true)
  assert.equal(state.script.status, 'idle')
  console.log('✓ script-summary 僵死 → status 重置 idle')
}
{
  const state = makeState()
  state.script.status = 'generating'
  state.script.refinedPrompt = '已有摘要'
  assert.equal(resetShortDramaTextTaskState(state, 'script-summary'), false)
  assert.equal(state.script.status, 'generating')
  console.log('✓ script-summary 已有 refinedPrompt → 不重置（保护成功结果）')
}

// --- resetShortDramaTextTaskState: episode-outlines ---
{
  const state = makeState()
  state.script.status = 'generating'
  state.script.outlinesStatus = 'generating'
  assert.equal(resetShortDramaTextTaskState(state, 'episode-outlines'), true)
  assert.equal(state.script.status, 'idle')
  assert.equal(state.script.outlinesStatus, 'idle')
  assert.equal(state.script.outlinesErrorMessage, null)
  console.log('✓ episode-outlines 僵死 → status/outlinesStatus 重置 idle')
}
{
  const state = makeState()
  state.script.outlinesStatus = 'completed'
  assert.equal(resetShortDramaTextTaskState(state, 'episode-outlines'), false)
  console.log('✓ episode-outlines 已 completed → 不重置')
}

// --- resetShortDramaTextTaskState: episode-summaries ---
{
  const state = makeState()
  state.script.episodeSummaryStatus = 'generating'
  assert.equal(resetShortDramaTextTaskState(state, 'episode-summaries'), true)
  assert.equal(state.script.episodeSummaryStatus, 'idle')
  assert.equal(state.script.episodeSummaryErrorMessage, null)
  console.log('✓ episode-summaries 僵死 → 重置 episodeSummaryStatus')
}
{
  const state = makeState()
  state.script.episodeSummaryStatus = 'generating'
  state.script.episodeSummaries = [
    { episodeNumber: 1, summary: 'a' },
    { episodeNumber: 2, summary: 'b' },
  ]
  assert.equal(resetShortDramaTextTaskState(state, 'episode-summaries'), false)
  console.log('✓ episode-summaries 已满 → 不重置')
}

// --- resetShortDramaTextTaskState: asset-prompts ---
{
  const state = makeState()
  state.assets.status = 'generating'
  assert.equal(resetShortDramaTextTaskState(state, 'asset-prompts'), true)
  assert.equal(state.assets.status, 'idle')
  console.log('✓ asset-prompts 僵死 → 重置 assets.status')
}
{
  const state = makeState()
  state.assets.status = 'completed'
  assert.equal(resetShortDramaTextTaskState(state, 'asset-prompts'), false)
  console.log('✓ asset-prompts 已 completed → 不重置')
}

// --- resetShortDramaTextTaskState: episode-segments ---
{
  const state = makeState()
  state.episodes.status = 'generating'
  state.episodes.items = [makeEpisode({ episodeNumber: 1, segments: [], status: 'generating' })]
  assert.equal(resetShortDramaTextTaskState(state, 'episode-segments', 1), true)
  assert.equal(state.episodes.items[0].status, 'idle')
  assert.equal(state.episodes.status, 'idle')
  console.log('✓ episode-segments 僵死 → 该集 status 重置 idle，顶层 episodes.status 重算')
}
{
  const state = makeState()
  state.episodes.items = [
    makeEpisode({
      episodeNumber: 1,
      status: 'idle',
      segments: [
        { id: 's1', order: 1, title: 'x', prompt: 'p', mentionRefs: [], durationSeconds: 5, videoUrl: null, status: 'idle' },
      ],
    }),
  ]
  assert.equal(resetShortDramaTextTaskState(state, 'episode-segments', 1), false)
  console.log('✓ episode-segments 已有 segments 且非 failed → 不重置')
}
{
  const state = makeState()
  state.episodes.items = [makeEpisode({ episodeNumber: 2, status: 'generating' })]
  assert.equal(resetShortDramaTextTaskState(state, 'episode-segments', 1), false)
  console.log('✓ episode-segments 指定集不存在 → 不重置')
}

// --- 常量 ---
assert.equal(TEXT_TASK_STUCK_THRESHOLD_MS, 10 * 60 * 1000)
assert.equal(TEXT_TASK_HEARTBEAT_INTERVAL_MS, 15_000)
console.log('✓ 常量：阈值 10 分钟、心跳 15s')

console.log('\n✅ 全部测试通过')
