import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetryableNanoBananaError } from './nano-banana.js'

test('系统繁忙类 API 500 属于可重试错误', () => {
  const message = 'API 500: {"error":{"message":"系统繁忙，请稍后再试（traceid: 2f25ec97d932b918b1daf170df180607）","type":"new_api_error","param":"","code":"unknown_error"}}'

  assert.equal(isRetryableNanoBananaError(message), true)
})

test('参数类 API 400 不重试', () => {
  const message = 'API 400: {"error":{"message":"invalid image","type":"invalid_request_error"}}'

  assert.equal(isRetryableNanoBananaError(message), false)
})

test('超时错误不重试', () => {
  assert.equal(isRetryableNanoBananaError('This operation was aborted'), false)
  assert.equal(isRetryableNanoBananaError('Image adapter timed out after 330000ms'), false)
})
