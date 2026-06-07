import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { extractStorageKey, normalizeStorageUrl } from '../lib/storage.js'

describe('storage url normalization', () => {
  test('从已签名 TOS URL 中提取真实 object key，不包含签名 query', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const signedUrl = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/canvas-assets/demo.jpg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Date=20260607T071739Z'

    assert.equal(extractStorageKey(signedUrl), 'canvas-assets/demo.jpg')
    assert.equal(normalizeStorageUrl(signedUrl), 'https://toby-ai-dev.tos-cn-shanghai.volces.com/canvas-assets/demo.jpg')
  })

  test('非本存储 URL 保持原样', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const externalUrl = 'https://example.com/image.jpg?token=1'

    assert.equal(extractStorageKey(externalUrl), null)
    assert.equal(normalizeStorageUrl(externalUrl), externalUrl)
  })
})
