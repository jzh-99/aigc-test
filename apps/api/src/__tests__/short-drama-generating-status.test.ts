import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState, type ShortDramaEpisode } from '@aigc/types'
import { hasShortDramaGeneratingStatus } from '../routes/short-drama/_shared.js'

console.log('测试 hasShortDramaGeneratingStatus...')

// 全 idle → false
const idleState = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
assert.equal(hasShortDramaGeneratingStatus(idleState), false, '全 idle 应为 false')
console.log('✓ 全 idle → false')

// script.status=generating → true
const scriptGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
scriptGen.script.status = 'generating'
assert.equal(hasShortDramaGeneratingStatus(scriptGen), true)
console.log('✓ script.status=generating → true')

// outlinesStatus=generating → true
const outlinesGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
outlinesGen.script.outlinesStatus = 'generating'
assert.equal(hasShortDramaGeneratingStatus(outlinesGen), true)
console.log('✓ outlinesStatus=generating → true')

// episodeSummaryStatus=generating → true
const summaryGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
summaryGen.script.episodeSummaryStatus = 'generating'
assert.equal(hasShortDramaGeneratingStatus(summaryGen), true)
console.log('✓ episodeSummaryStatus=generating → true')

// assets.status=generating → true
const assetsGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
assetsGen.assets.status = 'generating'
assert.equal(hasShortDramaGeneratingStatus(assetsGen), true)
console.log('✓ assets.status=generating → true')

// 某集片段脚本生成中（episode.segmentsStatus=generating）→ true
const episodeGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
episodeGen.episodes.items.push({
  episodeNumber: 1,
  title: '第1集',
  summary: '梗概',
  segments: [],
  status: 'idle',
  segmentsStatus: 'generating',
  videoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies ShortDramaEpisode)
assert.equal(hasShortDramaGeneratingStatus(episodeGen), true)
console.log('✓ episode.segmentsStatus=generating → true')

// 片段视频生成中（episode.status=generating，但 segmentsStatus 非 generating）→ false
// 验证视频生成不再误触发文本生成保护（拆分后 status 归视频、segmentsStatus 归脚本）
const videoOnlyGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
videoOnlyGen.episodes.items.push({
  episodeNumber: 1,
  title: '第1集',
  summary: '梗概',
  segments: [],
  status: 'generating',
  segmentsStatus: 'idle',
  videoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies ShortDramaEpisode)
assert.equal(hasShortDramaGeneratingStatus(videoOnlyGen), false)
console.log('✓ 仅 episode.status=generating（视频）→ false，不误触发文本保护')

// failed 不算 generating
const failedState = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
failedState.script.outlinesStatus = 'failed'
assert.equal(hasShortDramaGeneratingStatus(failedState), false)
console.log('✓ failed 状态不算 generating')

console.log('全部通过')
