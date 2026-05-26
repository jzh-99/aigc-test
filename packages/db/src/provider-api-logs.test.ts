import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sanitizeProviderApiPayload,
  truncateProviderApiPayload,
} from './provider-api-logs.js'

test('sanitizeProviderApiPayload redacts secrets and summarizes binary-like fields', () => {
  const sanitized = sanitizeProviderApiPayload({
    Authorization: 'Bearer secret',
    api_key: 'secret',
    prompt: 'hello',
    image_base64: 'a'.repeat(160),
    nested: {
      token: 'secret',
      file: 'b'.repeat(200),
    },
  })

  assert.deepEqual(sanitized, {
    Authorization: '[REDACTED]',
    api_key: '[REDACTED]',
    prompt: 'hello',
    image_base64: { type: 'omitted_large_string', length: 160 },
    nested: {
      token: '[REDACTED]',
      file: { type: 'omitted_large_string', length: 200 },
    },
  })
})

test('truncateProviderApiPayload marks oversized payloads', () => {
  const result = truncateProviderApiPayload({ text: 'x'.repeat(200) }, 80)

  assert.equal(result.truncated, true)
  assert.equal(typeof result.payload, 'object')
})
