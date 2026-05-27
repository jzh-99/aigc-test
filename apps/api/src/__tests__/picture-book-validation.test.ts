import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  calculateProjectChargeTotal,
  parsePictureBookJson,
  validatePictureBookTargets,
} from '../routes/picture-book/_shared.js'

describe('picture book validation helpers', () => {
  test('parsePictureBookJson 能解析 json fenced object', () => {
    const parsed = parsePictureBookJson('```json\n{"title":"小兔历险","pages":[1,2]}\n```')

    assert.deepEqual(parsed, { title: '小兔历险', pages: [1, 2] })
  })

  test('parsePictureBookJson 能从前后有多余文本的字符串中提取 JSON object', () => {
    const parsed = parsePictureBookJson('这里是说明\n{"ok":true,"count":3}\n谢谢')

    assert.deepEqual(parsed, { ok: true, count: 3 })
  })

  test('parsePictureBookJson 对无 JSON 抛中文格式错误', () => {
    assert.throws(
      () => parsePictureBookJson('没有结构化数据'),
      /AI 返回格式错误，请重试/,
    )
  })

  test('validatePictureBookTargets 拒绝空生成目标', () => {
    assert.throws(
      () => validatePictureBookTargets([]),
      /至少选择 1 个生成目标/,
    )
  })

  test('validatePictureBookTargets 缺 ref_id 抛错', () => {
    assert.throws(
      () => validatePictureBookTargets([{ kind: 'character', ref_id: '' }]),
      /ref_id/,
    )
  })

  test('calculateProjectChargeTotal 按状态统计预估和实际积分', () => {
    const total = calculateProjectChargeTotal([
      { estimated_credits: 10, actual_credits: 8, status: 'completed' },
      { estimated_credits: 20, actual_credits: null, status: 'processing' },
      { estimated_credits: 30, actual_credits: 25, status: 'failed' },
      { estimated_credits: 40, actual_credits: 35, status: 'refunded' },
    ])

    assert.deepEqual(total, { estimatedCredits: 30, actualCredits: 28 })
  })
})
