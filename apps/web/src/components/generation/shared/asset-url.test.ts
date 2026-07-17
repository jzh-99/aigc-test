import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAssetFetchUrl } from './asset-url'

describe('asset-url', () => {
  test('将火山存储签名 URL 改写为同源素材读取接口', () => {
    const url = 'https://bucket.tos-cn-beijing.volces.com/generated/video/frame.jpg?X-Tos-Signature=abc'

    assert.equal(
      resolveAssetFetchUrl(url, 'https://aigc.example.com'),
      '/api/v1/assets/fetch?key=generated%2Fvideo%2Fframe.jpg',
    )
  })
})
