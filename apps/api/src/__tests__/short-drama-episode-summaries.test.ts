import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState, normalizeShortDramaState, isShortDramaEpisodeSummariesReady } from '@aigc/types'
import { applyShortDramaEpisodeSummariesResult } from '../routes/short-drama/_text-generation.js'

console.log('测试短剧分集概述状态写回...')

// 测试 1：概述生成结果写回
const state = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
state.script.refinedPrompt = '一个普通外卖员意外获得超能力，在都市中守护弱小。'

assert.equal(state.script.episodeSummaries.length, 0)
assert.equal(state.script.episodeSummaryStatus, 'idle')
console.log('✓ 初始状态：概述为空，状态为 idle')

applyShortDramaEpisodeSummariesResult(state, [
  { episodeNumber: 1, summary: '外卖员林晚在暴雨夜送餐途中被雷击，觉醒超能力。' },
  { episodeNumber: 2, summary: '林晚尝试隐藏能力，却在火灾中被迫出手救下邻居小孩。' },
  { episodeNumber: 3, summary: '林晚的能力引来神秘组织注意，被迫在守护与逃跑间抉择。' },
])

assert.equal(state.script.episodeSummaries.length, 3)
assert.equal(state.script.episodeSummaries[0]?.summary, '外卖员林晚在暴雨夜送餐途中被雷击，觉醒超能力。')
assert.equal(state.script.episodeSummaries[2]?.episodeNumber, 3)
assert.equal(state.script.episodeSummaryStatus, 'completed')
console.log('✓ 概述生成结果写回 episodeSummaries + episodeSummaryStatus = completed')

// 测试 2：isShortDramaEpisodeSummariesReady
const readyState = makeDefaultShortDramaState({
  prompt: '测试',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
assert.equal(isShortDramaEpisodeSummariesReady(readyState), false)
readyState.script.episodeSummaries = [
  { episodeNumber: 1, summary: 'a' },
  { episodeNumber: 2, summary: 'b' },
  { episodeNumber: 3, summary: 'c' },
]
assert.equal(isShortDramaEpisodeSummariesReady(readyState), true)
console.log('✓ isShortDramaEpisodeSummariesReady 判断正确')

// 测试 3：normalize 对旧 JSON 的向后兼容
const normalized = normalizeShortDramaState({
  script: {
    source: 'idea',
    originalPrompt: '旧项目',
    refinedPrompt: '旧摘要',
    outlines: [],
  },
  settings: { style: '真人都市', aspectRatio: '9:16', episodeCount: 5 },
})
assert.equal(normalized.script.episodeSummaries.length, 0)
assert.equal(normalized.script.episodeSummaryStatus, 'idle')
console.log('✓ normalizeShortDramaState 对无新字段的旧 JSON 补默认值')

// 测试 4：隐式锁定判断 — outlines.length > 0 即锁定
const lockedState = makeDefaultShortDramaState({
  prompt: '测试',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
lockedState.script.episodeSummaries = [
  { episodeNumber: 1, summary: 'a' },
  { episodeNumber: 2, summary: 'b' },
  { episodeNumber: 3, summary: 'c' },
]
// 概述就绪但无剧本 → 未锁定，可编辑
assert.equal(isShortDramaEpisodeSummariesReady(lockedState), true)
assert.equal(lockedState.script.outlines.length, 0)
console.log('✓ 概述就绪但无剧本 → 未锁定，概述可编辑')

lockedState.script.outlines = [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
]
// 有剧本 → 隐式锁定
assert.equal(lockedState.script.outlines.length > 0, true)
console.log('✓ 有剧本 → outlines.length > 0 → 概述隐式锁定')

console.log('\n✅ 短剧分集概述测试通过！')
