import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState } from '@aigc/types'
import {
  applyShortDramaSegmentRowsToState,
  markShortDramaSegmentVideoGenerating,
} from '../routes/short-drama/_shared.js'

console.log('测试短剧视频状态写回...')

const state = makeDefaultShortDramaState({
  prompt: '校园悬疑短剧',
  style: '2D 动漫',
  aspectRatio: '9:16',
  episodeCount: 1,
})

state.episodes.items = [
  {
    episodeNumber: 1,
    title: '第一集',
    summary: '主角发现异常。',
    status: 'generating',
    videoUrl: null,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    segments: [
      {
        id: 'segment-1',
        order: 0,
        title: '已完成片段',
        prompt: '分镜 1 · 4s：已完成',
        mentionRefs: [],
        durationSeconds: 4,
        videoUrl: 'https://cdn.test/segment-1.mp4',
        status: 'completed',
        videoBatchId: 'batch-1',
        videoTaskId: 'task-1',
      },
      {
        id: 'segment-2',
        order: 1,
        title: '待生成片段',
        prompt: '分镜 1 · 4s：待生成',
        mentionRefs: [],
        durationSeconds: 4,
        videoUrl: null,
        status: 'idle',
      },
    ],
  },
]
state.exports.batches = [
  {
    id: 'export-1',
    episodeNumbers: [1],
    status: 'completed',
    videoUrl: 'https://cdn.test/episode-1.mp4',
    errorMessage: null,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    exports: [
      {
        episodeNumber: 1,
        status: 'completed',
        videoUrl: 'https://cdn.test/episode-1.mp4',
        errorMessage: null,
      },
    ],
  } as any,
]

const changed = markShortDramaSegmentVideoGenerating(state, 1, 'segment-2', 'batch-2', 'task-2')

assert.equal(changed, true)
assert.equal(state.episodes.items[0]?.segments[0]?.videoUrl, 'https://cdn.test/segment-1.mp4')
assert.equal(state.episodes.items[0]?.segments[0]?.status, 'completed')
assert.equal(state.episodes.items[0]?.segments[1]?.videoUrl, null)
assert.equal(state.episodes.items[0]?.segments[1]?.status, 'generating')
assert.equal(state.episodes.items[0]?.segments[1]?.videoBatchId, 'batch-2')
assert.equal(state.episodes.items[0]?.segments[1]?.videoTaskId, 'task-2')
assert.equal(state.exports.batches.length, 0)
console.log('✓ 提交新片段生成时不会清空其它已完成片段视频，并会让旧导出失效')

assert.equal(
  markShortDramaSegmentVideoGenerating(state, 1, 'missing-segment', 'batch-3', 'task-3'),
  false,
)
console.log('✓ 目标片段不存在时不会修改状态')

const mergedState = makeDefaultShortDramaState({
  prompt: '校园悬疑短剧',
  style: '2D 动漫',
  aspectRatio: '9:16',
  episodeCount: 1,
})
mergedState.script.refinedPrompt = '旧脚本摘要必须保留'
mergedState.assets.items = [
  {
    id: 'asset-1',
    kind: 'character',
    scope: 'global',
    name: '林宇',
    aliases: ['男主'],
    description: '学生',
    imageUrl: 'https://cdn.test/linyu.png',
    referenceImageUrl: null,
    episodeNumber: null,
    status: 'completed',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
  },
]
mergedState.episodes.items = [
  {
    episodeNumber: 1,
    title: '第一集',
    summary: '主角发现异常。',
    status: 'idle',
    videoUrl: null,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    segments: [
      {
        id: 'segment-1',
        order: 0,
        title: '旧标题',
        prompt: '旧提示词',
        mentionRefs: [],
        durationSeconds: 4,
        videoUrl: null,
        status: 'idle',
      },
    ],
  },
]

applyShortDramaSegmentRowsToState(mergedState, [
  {
    episodeNumber: 1,
    segmentId: 'segment-1',
    orderIndex: 0,
    title: '结构化标题',
    prompt: '结构化提示词',
    mentionRefs: [{ assetId: 'asset-1', assetName: '林宇' }],
    durationSeconds: 8,
    status: 'completed',
    videoUrl: 'https://cdn.test/structured-segment.mp4',
    videoBatchId: 'batch-structured',
    videoTaskId: 'task-structured',
    updatedAt: '2026-06-04T01:00:00.000Z',
  },
])

assert.equal(mergedState.script.refinedPrompt, '旧脚本摘要必须保留')
assert.equal(mergedState.assets.items.length, 1)
assert.equal(mergedState.episodes.items[0]?.segments[0]?.title, '结构化标题')
assert.equal(mergedState.episodes.items[0]?.segments[0]?.prompt, '结构化提示词')
assert.deepEqual(mergedState.episodes.items[0]?.segments[0]?.mentionRefs, [{ assetId: 'asset-1', assetName: '林宇' }])
assert.equal(mergedState.episodes.items[0]?.segments[0]?.durationSeconds, 8)
assert.equal(mergedState.episodes.items[0]?.segments[0]?.videoUrl, 'https://cdn.test/structured-segment.mp4')
assert.equal(mergedState.episodes.items[0]?.segments[0]?.videoBatchId, 'batch-structured')
assert.equal(mergedState.episodes.items[0]?.segments[0]?.videoTaskId, 'task-structured')
console.log('✓ 结构化片段行可以合并回旧 state，且不破坏脚本和素材状态')

console.log('\n✅ 短剧视频状态写回测试通过！')
