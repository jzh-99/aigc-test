import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_IMAGE_CATEGORY_LIMITS, DEFAULT_TEXT_CATEGORY_LIMITS, DEFAULT_VIDEO_CATEGORY_LIMITS } from './types'
import { validateReferenceKindLimit } from './reference-limits'

describe('validateReferenceKindLimit', () => {
  test('按 category_references 禁止图片节点引用音频', () => {
    const result = validateReferenceKindLimit({
      categoryReferences: DEFAULT_IMAGE_CATEGORY_LIMITS,
      categoryKey: 'image_to_image',
      referenceKind: 'audio',
      existingCount: 0,
    })

    assert.equal(result, '图生图最多允许 0 个音频参考素材')
  })

  test('按首尾帧 category_references 禁止视频节点引用音频', () => {
    const result = validateReferenceKindLimit({
      categoryReferences: DEFAULT_VIDEO_CATEGORY_LIMITS,
      categoryKey: 'frames',
      referenceKind: 'audio',
      existingCount: 0,
    })

    assert.equal(result, '首尾帧最多允许 0 个音频参考素材')
  })

  test('按 text_to_text category_references 禁止文本节点引用文本', () => {
    const result = validateReferenceKindLimit({
      categoryReferences: DEFAULT_TEXT_CATEGORY_LIMITS,
      categoryKey: 'text_to_text',
      referenceKind: 'text',
      existingCount: 0,
    })

    assert.equal(result, '文本生成最多允许 0 个文本参考素材')
  })
})
