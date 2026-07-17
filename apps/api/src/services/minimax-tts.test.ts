import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeMiniMaxAudioPayload,
  parseMiniMaxStreamingAudioBuffer,
  shouldUseMiniMaxStreaming,
} from './minimax-tts.js'

test('shouldUseMiniMaxStreaming 超过 3000 字时启用流式', () => {
  assert.equal(shouldUseMiniMaxStreaming('你'.repeat(3000)), false)
  assert.equal(shouldUseMiniMaxStreaming('你'.repeat(3001)), true)
})

test('decodeMiniMaxAudioPayload 支持 hex 与 base64 音频载荷', () => {
  assert.deepEqual(decodeMiniMaxAudioPayload('6869'), Buffer.from('hi'))
  assert.deepEqual(decodeMiniMaxAudioPayload(Buffer.from('hi').toString('base64')), Buffer.from('hi'))
})

test('parseMiniMaxStreamingAudioBuffer 汇总 SSE 分片中的 hex 音频', () => {
  const payload = [
    'data: {"data":{"audio":"6865"}}',
    'data: {"data":{"audio":"6c6c6f"}}',
    'data: [DONE]',
    '',
  ].join('\n')

  assert.deepEqual(parseMiniMaxStreamingAudioBuffer(payload), Buffer.from('hello'))
})
