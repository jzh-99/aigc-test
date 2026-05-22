import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calculateVideoEstimatedCredits } from './api.js'

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
