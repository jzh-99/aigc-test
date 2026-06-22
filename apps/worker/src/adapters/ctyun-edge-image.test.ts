import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCtyunEdgeImageBody } from './ctyun-edge-image.js'

test('天翼云边缘 Seedream 5.0 Lite 使用网关模型 ID 和 URL 响应', () => {
  const body = buildCtyunEdgeImageBody({
    model: 'ctyun-seedream-5.0-lite',
    prompt: '生成短剧角色定妆照',
    params: {
      resolution: '2k',
      aspect_ratio: '9:16',
      watermark: true,
    },
  })

  assert.deepEqual(body, {
    model: 'Doubao-Seedream-5.0-lite',
    prompt: '生成短剧角色定妆照',
    response_format: 'url',
    size: '1600x2848',
    stream: false,
    watermark: true,
  })
})

test('天翼云边缘 Seedream 默认使用 2K 1:1 且默认无水印', () => {
  const body = buildCtyunEdgeImageBody({
    model: 'ctyun-seedream-5.0-lite',
    prompt: '生成场景图',
    params: {},
  })

  assert.equal(body.size, '2048x2048')
  assert.equal(body.watermark, false)
})

test('天翼云边缘 Seedream 支持官方 3K 和 4K 尺寸参数', () => {
  assert.equal(buildCtyunEdgeImageBody({
    model: 'ctyun-seedream-5.0-lite',
    prompt: '生成竖版海报',
    params: { resolution: '3k', aspect_ratio: '9:16' },
  }).size, '2304x4096')

  assert.equal(buildCtyunEdgeImageBody({
    model: 'ctyun-seedream-5.0-lite',
    prompt: '生成横版海报',
    params: { resolution: '4k', aspect_ratio: '16:9' },
  }).size, '5504x3040')
})

test('普通生图入队传入网关模型 ID 时仍能构造请求体', () => {
  const body = buildCtyunEdgeImageBody({
    model: 'Doubao-Seedream-5.0-lite',
    prompt: '生成商品海报',
    params: { resolution: '2k' },
  })

  assert.equal(body.model, 'Doubao-Seedream-5.0-lite')
  assert.equal(body.prompt, '生成商品海报')
})
