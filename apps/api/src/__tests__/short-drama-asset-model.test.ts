import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHORT_DRAMA_IMAGE_MODEL } from '@aigc/types'
import { resolveShortDramaAssetImageModel } from '../routes/short-drama/post-generate-assets.js'

test('短剧素材生成不传模型时使用默认 Seedream 图片模型', () => {
  assert.equal(resolveShortDramaAssetImageModel(undefined), SHORT_DRAMA_IMAGE_MODEL)
})

test('短剧素材生成传入模型时使用请求模型', () => {
  assert.equal(resolveShortDramaAssetImageModel('ctyun-seedream-5.0-lite'), 'ctyun-seedream-5.0-lite')
})

test('短剧素材生成忽略空白模型并回退默认值', () => {
  assert.equal(resolveShortDramaAssetImageModel('   '), SHORT_DRAMA_IMAGE_MODEL)
})
