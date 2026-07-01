import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeModelJsonFields } from './model-json'

describe('normalizeModelJsonFields', () => {
  test('把字符串形式的 params_pricing 规范化为数组', () => {
    const model = normalizeModelJsonFields({
      params_pricing: '[{"resolution":"2k","model":"seedream-4.0","unit_price":3}]',
    })

    assert.deepEqual(model.params_pricing, [
      { resolution: '2k', model: 'seedream-4.0', unit_price: 3 },
    ])
  })

  test('把双层字符串形式的 params_pricing 规范化为数组', () => {
    const model = normalizeModelJsonFields({
      params_pricing: '"[{\\"resolution\\":\\"default\\",\\"model\\":\\"qwen3.6-plus\\",\\"unit_price\\":1}]"',
    })

    assert.deepEqual(model.params_pricing, [
      { resolution: 'default', model: 'qwen3.6-plus', unit_price: 1 },
    ])
  })

  test('非法 params_pricing 回退为空数组，避免前端数组方法崩溃', () => {
    const model = normalizeModelJsonFields({ params_pricing: 'not-json' })

    assert.deepEqual(model.params_pricing, [])
  })

  test('把单条规则对象形式的 params_pricing 规范化为数组', () => {
    const model = normalizeModelJsonFields({
      params_pricing: { resolution: '1k', model: 'openai/gpt-image-2', unit_price: 2 },
    })

    assert.deepEqual(model.params_pricing, [
      { resolution: '1k', model: 'openai/gpt-image-2', unit_price: 2 },
    ])
  })

  test('把数字键对象形式的 params_pricing 规范化为数组', () => {
    const model = normalizeModelJsonFields({
      params_pricing: {
        0: { resolution: '1k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
        1: { resolution: '2k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
      },
    })

    assert.deepEqual(model.params_pricing, [
      { resolution: '1k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
      { resolution: '2k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
    ])
  })
})
