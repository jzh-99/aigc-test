import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState, makeUploadedShortDramaState, normalizeShortDramaState } from '@aigc/types'
import {
  applyShortDramaAssetPromptsBatchResult,
  applyShortDramaEpisodeOutlinesBatchResult,
  applyShortDramaEpisodeOutlinesResult,
  applyShortDramaScriptSummaryResult,
  buildShortDramaOutlineBatches,
  extractQwenStreamDeltaText,
} from '../routes/short-drama/_text-generation.js'

console.log('测试短剧文本生成状态写回...')

const summaryState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 2,
})

applyShortDramaScriptSummaryResult(summaryState, {
  title: '超能外卖员',
  summary: '一个普通外卖员意外获得超能力，在都市中守护弱小。',
})

assert.equal(summaryState.script.refinedPrompt, '一个普通外卖员意外获得超能力，在都市中守护弱小。')
assert.equal(summaryState.script.status, 'completed')
console.log('✓ 摘要生成结果会写回 script.refinedPrompt')

const uploadedSummaryState = makeUploadedShortDramaState({
  originalScript: '一段非标准原始剧本。',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 1,
})

applyShortDramaScriptSummaryResult(uploadedSummaryState, {
  title: '上传剧本',
  summary: '从原始剧本提炼出的摘要。',
  episodeCount: 12,
})

assert.equal(uploadedSummaryState.settings.episodeCount, 12)
assert.equal(uploadedSummaryState.script.refinedPrompt, '从原始剧本提炼出的摘要。')
console.log('✓ 上传剧本摘要结果会写回模型分析出的集数')

const outlinesState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 2,
})
outlinesState.script.refinedPrompt = '一个普通外卖员意外获得超能力，在都市中守护弱小。'

applyShortDramaEpisodeOutlinesResult(outlinesState, [
  { episodeNumber: 1, title: '意外觉醒', summary: '主角在送餐途中觉醒超能力。' },
  { episodeNumber: 2, title: '街巷救援', summary: '主角用能力救下被困的孩子。' },
])

assert.deepEqual(outlinesState.script.outlines, [
  { episodeNumber: 1, title: '意外觉醒', summary: '主角在送餐途中觉醒超能力。' },
  { episodeNumber: 2, title: '街巷救援', summary: '主角用能力救下被困的孩子。' },
])
assert.equal(outlinesState.script.status, 'completed')
assert.equal(outlinesState.episodes.items.length, 2)
assert.equal(outlinesState.episodes.items[0]?.title, '意外觉醒')
assert.equal(outlinesState.episodes.items[1]?.summary, '主角用能力救下被困的孩子。')
console.log('✓ 分集大纲生成结果会写回 script.outlines 并初始化 episodes')

console.log('\n测试短剧大纲分批与部分完成状态...')

assert.deepEqual(buildShortDramaOutlineBatches(1, 5, 10), [
  { from: 1, to: 5 },
])
assert.deepEqual(buildShortDramaOutlineBatches(1, 25, 10), [
  { from: 1, to: 10 },
  { from: 11, to: 20 },
  { from: 21, to: 25 },
])
assert.deepEqual(buildShortDramaOutlineBatches(11, 25, 10), [
  { from: 11, to: 20 },
  { from: 21, to: 25 },
])
console.log('✓ 可以按每 10 集构建大纲批次')

const partialState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
partialState.script.refinedPrompt = '一个普通外卖员意外获得超能力。'

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
  { episodeNumber: 2, title: '救援', summary: '主角救下邻居。' },
])

assert.equal(partialState.script.outlines.length, 2)
assert.equal(partialState.episodes.items.length, 2)
assert.equal(partialState.script.status, 'generating')
assert.equal(partialState.episodes.status, 'idle')
assert.equal(partialState.episodes.items[0]?.episodeNumber, 1)
assert.equal(partialState.episodes.items[1]?.episodeNumber, 2)
console.log('✓ 部分批次会保留已生成大纲，但不标记 completed')

partialState.episodes.items[0] = {
  ...partialState.episodes.items[0]!,
  segments: [
    {
      id: 'segment-1',
      order: 1,
      title: '旧分镜',
      prompt: '旧提示词',
      mentionRefs: [],
      durationSeconds: 4,
      videoUrl: 'https://example.com/video.mp4',
      status: 'completed',
    },
  ],
  status: 'completed',
  videoUrl: 'https://example.com/episode.mp4',
  createdAt: '2026-01-01T00:00:00.000Z',
}

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 1, title: '觉醒更新', summary: '主角更新后的觉醒剧情。' },
])

assert.equal(partialState.episodes.items[0]?.title, '觉醒更新')
assert.equal(partialState.episodes.items[0]?.segments.length, 1)
assert.equal(partialState.episodes.items[0]?.status, 'completed')
assert.equal(partialState.episodes.items[0]?.videoUrl, 'https://example.com/episode.mp4')
assert.equal(partialState.episodes.items[0]?.createdAt, '2026-01-01T00:00:00.000Z')
console.log('✓ 更新已有集大纲时会保留分镜、状态、视频地址和创建时间')

applyShortDramaEpisodeOutlinesResult(partialState, [
  { episodeNumber: 1, title: '觉醒委托更新', summary: '通过旧入口更新。' },
])

assert.equal(partialState.episodes.items[0]?.title, '觉醒委托更新')
assert.equal(partialState.episodes.items[0]?.segments.length, 1)
console.log('✓ 旧的大纲写回入口复用批次合并逻辑')

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 3, title: '守护', summary: '主角守护街区。' },
])

assert.equal(partialState.script.outlines.length, 3)
assert.equal(partialState.episodes.items.length, 3)
assert.equal(partialState.script.status, 'completed')
assert.equal(partialState.episodes.status, 'idle')
console.log('✓ 全部集数生成完成后标记 script.completed')

console.log('\n测试短剧素材描述分批与去重状态...')

const assetState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
assetState.script.outlines = [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
  { episodeNumber: 2, title: '救援', summary: '主角救下邻居。' },
  { episodeNumber: 3, title: '守护', summary: '主角守护街区。' },
]

assert.equal(assetState.assets.processedOutlineCount, 0)

applyShortDramaAssetPromptsBatchResult(assetState, [
  { kind: 'character', name: '林晚', description: '年轻外卖员，眼神坚毅。' },
  { kind: 'scene', name: '老城区街巷', description: '狭窄潮湿的旧街巷。' },
], 2)

assert.equal(assetState.assets.items.length, 2)
assert.equal(assetState.assets.processedOutlineCount, 2)
assert.equal(assetState.assets.status, 'generating')
assert.equal(assetState.assets.items[0]?.kind, 'character')
assert.equal(assetState.assets.items[1]?.kind, 'scene')
console.log('✓ 部分素材批次会保留角色和场景，并记录已处理集数')

const existingCharacter = assetState.assets.items[0]!
assetState.assets.items[0] = {
  ...existingCharacter,
  imageUrl: 'https://example.com/lin-wan.png',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
}

applyShortDramaAssetPromptsBatchResult(assetState, [
  { kind: 'character', name: '林晚', description: '重复返回的女主，不应覆盖已生成形象。' },
  { kind: 'scene', name: '医院走廊', description: '冷白灯光下的医院走廊。' },
], 3)

assert.equal(assetState.assets.items.length, 3)
assert.equal(assetState.assets.items[0]?.id, existingCharacter.id)
assert.equal(assetState.assets.items[0]?.description, existingCharacter.description)
assert.equal(assetState.assets.items[0]?.imageUrl, 'https://example.com/lin-wan.png')
assert.equal(assetState.assets.items[0]?.status, 'completed')
assert.equal(assetState.assets.items[0]?.createdAt, '2026-01-01T00:00:00.000Z')
assert.equal(assetState.assets.processedOutlineCount, 3)
assert.equal(assetState.assets.status, 'completed')
console.log('✓ 重复角色不会重新创建，也不会覆盖已生成形象')

const normalizedCompletedState = normalizeShortDramaState({
  script: { outlines: assetState.script.outlines },
  assets: { items: assetState.assets.items, status: 'completed' },
})
assert.equal(normalizedCompletedState.assets.processedOutlineCount, 3)

const normalizedPartialState = normalizeShortDramaState({
  script: { outlines: assetState.script.outlines },
  assets: { items: [], status: 'generating' },
})
assert.equal(normalizedPartialState.assets.processedOutlineCount, 0)
console.log('✓ 旧素材状态会按 completed 状态兼容补齐已处理集数')

assert.equal(
  extractQwenStreamDeltaText('data: {"choices":[{"delta":{"content":"你好"}}]}'),
  '你好'
)
assert.equal(extractQwenStreamDeltaText('data: [DONE]'), '')
assert.equal(extractQwenStreamDeltaText(': ping'), '')
assert.equal(extractQwenStreamDeltaText('data: {不是合法 JSON'), '')
assert.equal(extractQwenStreamDeltaText('event: chunk'), '')
console.log('✓ 可以从 OpenAI 兼容 SSE 行提取文本增量')

console.log('\n✅ 短剧文本生成状态写回测试通过！')
