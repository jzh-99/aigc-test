import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ACTIVE_IMAGE_CATEGORY, calculateVideoEstimatedCredits, parseCategoryReferences, validateImageReferenceLimits } from './api.js'

describe('calculateVideoEstimatedCredits', () => {
  test('按生成视频时长和参考视频总时长共同计费', () => {
    const credits = calculateVideoEstimatedCredits({
      generatedDuration: 5,
      referenceVideoDurations: [2.2, 3.1],
      unitPrice: 10,
      fallbackCreditCost: 15,
    })

    assert.equal(credits, 110)
  })
})

describe('category_references 图片参考限制', () => {
  const categories = parseCategoryReferences({
    text_to_image: {
      label: '文生图',
      limits: {
        image: { min: 0, max: 0 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        text: { min: 0, max: 0 },
      },
    },
    image_to_image: {
      label: '图生图',
      limits: {
        image: { min: 0, max: 6 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        text: { min: 0, max: 0 },
      },
    },
  })

  test('文生图不允许携带参考图', () => {
    const result = validateImageReferenceLimits(categories, 'text_to_image', 1)

    assert.equal(result.valid, false)
    assert.equal(result.message, '文生图最多允许 0 张参考图')
  })

  test('图生图允许 0 到模型配置上限内的参考图', () => {
    assert.equal(validateImageReferenceLimits(categories, 'image_to_image', 0).valid, true)
    assert.equal(validateImageReferenceLimits(categories, 'image_to_image', 6).valid, true)
  })

  test('图生图超过模型配置上限时返回错误', () => {
    const result = validateImageReferenceLimits(categories, 'image_to_image', 7)

    assert.equal(result.valid, false)
    assert.equal(result.message, '图生图最多允许 6 张参考图')
  })

  test('当前图片生成入口默认使用图生图模式', () => {
    assert.equal(ACTIVE_IMAGE_CATEGORY, 'image_to_image')
  })
})
