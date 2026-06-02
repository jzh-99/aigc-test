import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { resolveAssetThumbnailUrl } from '../routes/assets/get-list.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

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

describe('assets list filters', () => {
  test('创作生成资产库只查询 generation 来源并排除项目关联资产', async () => {
    const content = await readFile(join(__dirname, '../routes/assets/get-list.ts'), 'utf-8')

    assert.ok(content.includes(".where('b.source', '=', 'generation')"))
    assert.ok(content.includes(".where('b.canvas_id', 'is', null)"))
    assert.ok(content.includes(".where('b.video_studio_project_id', 'is', null)"))
    assert.ok(content.includes(".where('b.picture_book_project_id', 'is', null)"))
    assert.ok(content.includes(".where('b.short_drama_project_id', 'is', null)"))
  })
})
