import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import route from '../routes/batches/source-filter.js'
import { normalizeBatchSource } from '../lib/batch-source.js'

describe('batch source helper', () => {
  test('routes/batches/source-filter default export is a Fastify plugin', () => {
    assert.equal(typeof route, 'function')
  })

  test('normalizeBatchSource - 默认值处理', () => {
    assert.equal(normalizeBatchSource(undefined), 'generation')
    assert.equal(normalizeBatchSource(null), 'generation')
    assert.equal(normalizeBatchSource(''), 'generation')
  })

  test('normalizeBatchSource - 合法值', () => {
    assert.equal(normalizeBatchSource('generation'), 'generation')
    assert.equal(normalizeBatchSource('studio'), 'studio')
    assert.equal(normalizeBatchSource('canvas'), 'canvas')
  })

  test('normalizeBatchSource - 非法值抛出错误', () => {
    assert.throws(() => normalizeBatchSource('invalid'), /Invalid batch source/)
    assert.throws(() => normalizeBatchSource('music'), /Invalid batch source/)
    assert.throws(() => normalizeBatchSource('GENERATION'), /Invalid batch source/)
  })
})
