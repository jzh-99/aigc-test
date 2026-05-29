import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchAssetFile } from './asset-file'

describe('asset-file', () => {
  test('通过传入的鉴权 fetch 读取资产文件', async () => {
    const calls: string[] = []
    const file = await fetchAssetFile(
      'https://bucket.tos-cn-beijing.volces.com/generated/image/ref.png?X-Tos-Signature=abc',
      'image',
      'asset',
      async (url) => {
        calls.push(url)
        return new Response(new Blob(['image']), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      },
    )

    assert.deepEqual(calls, ['/api/v1/assets/fetch?key=generated%2Fimage%2Fref.png'])
    assert.equal(file.name, 'asset.png')
    assert.equal(file.type, 'image/png')
  })
})
