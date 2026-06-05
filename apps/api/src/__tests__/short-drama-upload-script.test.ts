import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState, makeUploadedShortDramaState } from '@aigc/types'
import {
  buildShortDramaScriptSummaryPrompts,
  normalizeShortDramaOriginalScript,
  parseShortDramaTxtScriptBuffer,
} from '../routes/short-drama/_script-source.js'

console.log('测试短剧上传原始剧本...')

assert.equal(normalizeShortDramaOriginalScript('  第一集\r\n主角登场。  '), '第一集\n主角登场。')
assert.throws(
  () => normalizeShortDramaOriginalScript(''),
  /原始剧本不能为空/
)
assert.throws(
  () => normalizeShortDramaOriginalScript('字'.repeat(100001)),
  /原始剧本不能超过 100000 字/
)
console.log('✓ 原始剧本文本会归一化并校验 10 万字上限')

assert.equal(
  parseShortDramaTxtScriptBuffer(Buffer.from('第一集\r\n主角登场。', 'utf8')),
  '第一集\n主角登场。'
)
console.log('✓ txt 文件内容可解析为原始剧本文本')

const ideaState = makeDefaultShortDramaState({
  prompt: '落魄千金回村创业',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 5,
})
const ideaPrompts = buildShortDramaScriptSummaryPrompts(ideaState)
assert.match(ideaPrompts.userPrompt, /用户创意：落魄千金回村创业/)
assert.doesNotMatch(ideaPrompts.userPrompt, /原始剧本：/)
console.log('✓ 创意模式摘要 prompt 继续使用原始创意')

const uploadState = makeUploadedShortDramaState({
  originalScript: '第一集\n主角被迫离开家族，三年后归来。',
  style: '真人都市',
  aspectRatio: '16:9',
  episodeCount: 5,
})
const uploadPrompts = buildShortDramaScriptSummaryPrompts(uploadState)
assert.match(uploadPrompts.userPrompt, /原始剧本：第一集/)
assert.match(uploadPrompts.systemPrompt, /从用户提供的原始剧本中提炼/)
assert.doesNotMatch(uploadPrompts.userPrompt, /用户创意：/)
console.log('✓ 上传模式摘要 prompt 从原始剧本提炼')

console.log('\n✅ 短剧上传原始剧本测试通过！')
