import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculateTtsCredits,
  countTtsCharacters,
  insertAtCursor,
  normalizeAudioConfigValue,
  parseAudioTagSegments,
  toPauseTag,
  validatePauseSeconds,
  shouldUseStreamingTts,
} from './audio-tts-utils'

test('countTtsCharacters 按用户可见字符统计', () => {
  assert.equal(countTtsCharacters('你好 world'), 8)
  assert.equal(countTtsCharacters('😀好'), 2)
})

test('calculateTtsCredits 按千字向上取整计费', () => {
  assert.equal(calculateTtsCredits(1, 2), 2)
  assert.equal(calculateTtsCredits(1000, 2), 2)
  assert.equal(calculateTtsCredits(1001, 2), 4)
})

test('shouldUseStreamingTts 超过 3000 字时启用流式提示', () => {
  assert.equal(shouldUseStreamingTts(3000), false)
  assert.equal(shouldUseStreamingTts(3001), true)
})

test('insertAtCursor 在光标位置插入标记', () => {
  assert.equal(insertAtCursor('你好世界', '<#1#>', 2, 2), '你好<#1#>世界')
  assert.equal(insertAtCursor('你好世界', '(laughs)', 0, 2), '(laughs)世界')
})

test('normalizeAudioConfigValue 限制数值范围', () => {
  assert.equal(normalizeAudioConfigValue(3, 1, 0.5, 2), 2)
  assert.equal(normalizeAudioConfigValue(-20, 0, -12, 12), -12)
  assert.equal(normalizeAudioConfigValue(Number.NaN, 5, 1, 10), 5)
})

test('validatePauseSeconds 只允许 0.01 到 99.99 且最多两位小数', () => {
  assert.equal(validatePauseSeconds('0.01'), 0.01)
  assert.equal(validatePauseSeconds('99.99'), 99.99)
  assert.equal(validatePauseSeconds('1.234'), null)
  assert.equal(validatePauseSeconds('0'), null)
  assert.equal(validatePauseSeconds('100'), null)
})

test('toPauseTag 生成规范停顿标签', () => {
  assert.equal(toPauseTag(0.5), '<#0.5#>')
  assert.equal(toPauseTag(1), '<#1#>')
  assert.equal(toPauseTag(1.2), '<#1.2#>')
})

test('parseAudioTagSegments 识别停顿和语气词整体标签', () => {
  assert.deepEqual(parseAudioTagSegments('你好<#1#>(laughs)世界'), [
    { type: 'text', text: '你好' },
    { type: 'pause', text: '<#1#>', label: '1s' },
    { type: 'interjection', text: '(laughs)', label: '笑声' },
    { type: 'text', text: '世界' },
  ])
})
