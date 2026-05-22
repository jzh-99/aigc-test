import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyVideoPollHttpError,
  MAX_CONSECUTIVE_VIDEO_POLL_ERRORS,
  parseVolcengineTaskResponse,
  VIDEO_POLL_INTERVAL_MS,
} from './video-poller-result.js'

test('401/403 状态查询错误归类为不可重试鉴权失败', () => {
  assert.deepEqual(classifyVideoPollHttpError(401, '{"error":"invalid token"}'), {
    status: 'POLL_AUTH_ERROR',
    httpStatus: 401,
    errorMessage: '{"error":"invalid token"}',
    failReason: '视频状态查询鉴权失败（HTTP 401）',
    retryable: false,
  })
})

test('429/5xx 状态查询错误归类为可重试轮询错误', () => {
  assert.deepEqual(classifyVideoPollHttpError(503, 'service unavailable'), {
    status: 'POLL_ERROR',
    httpStatus: 503,
    errorMessage: 'service unavailable',
    retryable: true,
  })
})

test('连续轮询错误容忍窗口约为 5 分钟', () => {
  assert.equal(MAX_CONSECUTIVE_VIDEO_POLL_ERRORS * VIDEO_POLL_INTERVAL_MS, 5 * 60 * 1000)
})

test('解析火山数组 content 中的视频地址', () => {
  assert.deepEqual(parseVolcengineTaskResponse({
    status: 'succeeded',
    content: [
      { type: 'text', text: 'ok' },
      { type: 'video_url', video_url: { url: 'https://cdn.test/result.mp4' } },
    ],
  }), {
    status: 'SUCCESS',
    videoUrl: 'https://cdn.test/result.mp4',
    failReason: undefined,
    retryable: false,
    errorMessage: undefined,
  })
})

test('解析火山对象 content 中的视频地址', () => {
  assert.deepEqual(parseVolcengineTaskResponse({
    status: 'succeeded',
    content: { video_url: { url: 'https://cdn.test/object-result.mp4' } },
  }), {
    status: 'SUCCESS',
    videoUrl: 'https://cdn.test/object-result.mp4',
    failReason: undefined,
    retryable: false,
    errorMessage: undefined,
  })
})

test('解析火山 data.content 中的视频地址', () => {
  assert.deepEqual(parseVolcengineTaskResponse({
    status: 'succeeded',
    data: {
      content: { video_url: 'https://cdn.test/data-result.mp4' },
    },
  }), {
    status: 'SUCCESS',
    videoUrl: 'https://cdn.test/data-result.mp4',
    failReason: undefined,
    retryable: false,
    errorMessage: undefined,
  })
})
