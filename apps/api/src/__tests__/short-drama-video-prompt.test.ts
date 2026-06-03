import { strict as assert } from 'node:assert'
import { buildShortDramaFinalVideoPrompt } from '../routes/short-drama/post-generate-segment-video.js'
import type { ShortDramaAsset, ShortDramaSegment } from '@aigc/types'

const asset: ShortDramaAsset = {
  id: 'asset-1',
  kind: 'character',
  scope: 'global',
  name: '祁同伟（大学阶段）',
  aliases: ['祁同伟', '祁厅长', '老祁'],
  description: '青年男性全身定妆照',
  imageUrl: 'https://cdn.example.com/qi.png',
  referenceImageUrl: null,
  episodeNumber: null,
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const segment: ShortDramaSegment = {
  id: 'segment-1',
  order: 1,
  title: '场1-1：枪口抵颌',
  prompt: [
    '本片段场景设定在：深夜荒僻的孤坟山岗，@祁同伟 濒死闪回收尾段落。',
    '分镜1 · 3s：中景平视，@祁同伟 半个身子靠在冰冷的墓碑上。',
    '分镜2 · 4s：特写，@祁同伟 抬眼看向镜头。',
    '分镜3 · 4s：远景，山岗冷光压住人物轮廓。',
  ].join('\n'),
  mentionRefs: [],
  durationSeconds: 11,
  videoUrl: null,
  status: 'idle',
}

const finalPrompt = buildShortDramaFinalVideoPrompt({
  segment,
  assets: [asset],
  references: [],
  aspectRatio: '16:9',
})

assert.match(finalPrompt, /@祁同伟（大学阶段）（参考<图1>）/)
assert.ok(!finalPrompt.includes('@祁同伟 濒死'), '短名引用应替换为带参考图的正式素材名')

const aliasSegment: ShortDramaSegment = {
  ...segment,
  id: 'segment-2',
  prompt: [
    '本片段场景设定在：办公室夜景，@祁厅长 坐在办公桌后压低声音。',
    '分镜1 · 3s：中景，@祁厅长 抬手按住文件。',
    '分镜2 · 4s：特写，@祁厅长 眼神冷下来。',
    '分镜3 · 4s：远景，办公室灯光压暗。',
  ].join('\n'),
}

const aliasPrompt = buildShortDramaFinalVideoPrompt({
  segment: aliasSegment,
  assets: [asset],
  references: [],
  aspectRatio: '16:9',
})

assert.match(aliasPrompt, /@祁同伟（大学阶段）（参考<图1>）/)
assert.ok(!aliasPrompt.includes('@祁厅长 坐在'), '显式别名引用应替换为正式素材名和参考图')

console.log('✓ 短剧视频 prompt 可从 @短名和 aliases 兜底解析素材参考图')
