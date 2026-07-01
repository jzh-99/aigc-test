import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTokenbusImageRequest } from './tokenbus-image.js'

test('Tokenbus openai/gpt-image-2 使用 OpenAI 图片生成路径并要求 url 返回（避免 data: URL 被 transfer SSRF 拦截）', () => {
  const request = buildTokenbusImageRequest({
    model: 'openai/gpt-image-2',
    prompt: '生成一张产品海报',
    params: {
      aspect_ratio: '3:2',
      quality: 'high',
      background: 'transparent',
    },
  })

  assert.equal(request.endpoint, '/v1/images/generations')
  assert.deepEqual(request.body, {
    model: 'openai/gpt-image-2',
    prompt: '生成一张产品海报',
    n: 1,
    response_format: 'url',
    size: '1280x848',
    quality: 'high',
    background: 'transparent',
  })
})

test('Tokenbus openai/gpt-image-2 按 resolution + aspect_ratio 生成 4K 竖图尺寸', () => {
  const request = buildTokenbusImageRequest({
    model: 'openai/gpt-image-2',
    prompt: '打乒乓球',
    params: {
      resolution: '4k',
      aspect_ratio: '9:16',
      quality: 'low',
    },
  })

  assert.equal(request.body.size, '2160x3840')
})

test('Tokenbus Gemini Pro 使用 Gemini 原生 generateContent 路径', () => {
  const request = buildTokenbusImageRequest({
    model: 'google/gemini-3-pro-image-preview',
    prompt: '生成方图',
    params: {
      resolution: '2k',
      aspect_ratio: '16:9',
    },
  })

  assert.equal(request.endpoint, '/v1beta/models/google/gemini-3-pro-image-preview:generateContent')
  assert.deepEqual(request.body, {
    contents: [{ parts: [{ text: '生成方图' }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
    },
  })
})

test('Tokenbus Gemini Pro 4K 请求透传 imageSize=4K', () => {
  const request = buildTokenbusImageRequest({
    model: 'google/gemini-3-pro-image-preview',
    prompt: '海绵宝宝和他的朋友们',
    params: {
      resolution: '4k',
      aspect_ratio: '9:16',
    },
  })

  assert.deepEqual((request.body.generationConfig as any).imageConfig, {
    aspectRatio: '9:16',
    imageSize: '4K',
  })
})

test('Tokenbus Gemini 保留 3:2 和 2:3 比例，避免回退成方图', () => {
  const landscape = buildTokenbusImageRequest({
    model: 'google/gemini-3-pro-image-preview',
    prompt: '生成横版照片',
    params: { resolution: '2k', aspect_ratio: '3:2' },
  })
  const portrait = buildTokenbusImageRequest({
    model: 'google/gemini-3.1-flash-image-preview',
    prompt: '生成竖版海报',
    params: { resolution: '2k', aspect_ratio: '2:3' },
  })

  assert.deepEqual((landscape.body.generationConfig as any).imageConfig, { aspectRatio: '3:2', imageSize: '2K' })
  assert.deepEqual((portrait.body.generationConfig as any).imageConfig, { aspectRatio: '2:3', imageSize: '2K' })
})

test('Tokenbus Gemini Flash 默认 1K 1:1', () => {
  const request = buildTokenbusImageRequest({
    model: 'google/gemini-3.1-flash-image-preview',
    prompt: '生成方图',
    params: {},
  })

  assert.equal(request.endpoint, '/v1beta/models/google/gemini-3.1-flash-image-preview:generateContent')
  assert.deepEqual(request.body, {
    contents: [{ parts: [{ text: '生成方图' }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
    },
  })
})

test('Tokenbus 拒绝未登记的模型，避免误打供应商', () => {
  assert.throws(
    () => buildTokenbusImageRequest({
      model: 'seedream-4.5',
      prompt: '生成图片',
      params: {},
    }),
    /Tokenbus 暂不支持模型/,
  )
})
