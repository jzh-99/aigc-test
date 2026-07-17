import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeLlmStreamChunk, type LlmStreamSummary } from './provider-api-audit.js'

test('summarizeLlmStreamChunk records stream size and preview', () => {
  const summary: LlmStreamSummary = {
    stream: true,
    chunk_count: 0,
    response_bytes: 0,
    text_preview: '',
    finished: false,
  }

  summarizeLlmStreamChunk(summary, 'hello')
  summarizeLlmStreamChunk(summary, '世界')

  assert.equal(summary.chunk_count, 2)
  assert.equal(summary.response_bytes, Buffer.byteLength('hello') + Buffer.byteLength('世界'))
  assert.equal(summary.text_preview, 'hello世界')
})

test('summarizeLlmStreamChunk caps preview length', () => {
  const summary: LlmStreamSummary = {
    stream: true,
    chunk_count: 0,
    response_bytes: 0,
    text_preview: '',
    finished: false,
  }

  summarizeLlmStreamChunk(summary, 'a'.repeat(2500))
  summarizeLlmStreamChunk(summary, 'b')

  assert.equal(summary.text_preview.length, 2000)
  assert.equal(summary.text_preview.endsWith('b'), false)
})
