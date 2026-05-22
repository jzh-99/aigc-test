import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveAssetThumbnailUrl } from '../routes/assets/get-list.js'

describe('resolveAssetThumbnailUrl', () => {
  test('图片资产没有数据库缩略图时不临时生成 thumbnail_url', async () => {
    const thumbnailUrl = await resolveAssetThumbnailUrl({
      thumbnail_url: null,
    })

    assert.equal(thumbnailUrl, null)
  })

  test('有数据库缩略图时返回签名后的 thumbnail_url', async () => {
    const thumbnailUrl = await resolveAssetThumbnailUrl(
      {
        thumbnail_url: 'https://storage.example.com/assets/video/thumb.jpg',
      },
      async (url) => `/signed?url=${encodeURIComponent(url)}`,
    )

    assert.equal(
      thumbnailUrl,
      '/signed?url=https%3A%2F%2Fstorage.example.com%2Fassets%2Fvideo%2Fthumb.jpg',
    )
  })
})
