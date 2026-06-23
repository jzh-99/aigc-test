import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { ErrorCode, buildAsyncCallbackPayload } from './callback-payload.js'

// 测试覆盖 7 种 service_type（image/song/video/news/podcast/storybook/text）
// + 成功/失败 + text 无 bussiness_id + publicMessage 覆盖 + failureCode 默认值
// 字段逐字对齐源项目 app/services/callbacks.py
describe('callback-payload', () => {
  test('image 成功：meta 仅含 status/failed_reason/image_url', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'image',
      taskId: 't1',
      bussinessId: 'b1',
      status: 'succeeded',
      media: { image_url: 'https://tos/x.png' },
      extraMeta: {},
    })
    assert.deepEqual(p.result, {
      task_id: 't1',
      bussiness_id: 'b1',
      code: ErrorCode.SUCCESS,
      message: null,
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      image_url: 'https://tos/x.png',
    })
  })

  test('image 失败：默认 failureCode=SYSTEM_FAILED，failed_reason 取固定文案不泄漏内部文本', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'image',
      taskId: 't1',
      bussinessId: 'b1',
      status: 'failed',
      media: {},
      extraMeta: {},
    })
    assert.equal(p.meta.failed_reason, '不符合创作规范')
    assert.equal(p.result.code, ErrorCode.SYSTEM_FAILED)
    assert.equal(p.result.message, '不符合创作规范')
    // 失败时 media 为空，image_url 兜底为 null
    assert.equal(p.meta.image_url, null)
  })

  test('image 失败：publicMessage 覆盖固定文案', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'image',
      taskId: 't1',
      bussinessId: 'b1',
      status: 'failed',
      media: {},
      extraMeta: {},
      failureCode: ErrorCode.SECURITY_CHECK_FAILED,
      publicMessage: '含敏感信息',
    })
    assert.equal(p.meta.failed_reason, '含敏感信息')
    assert.equal(p.result.code, ErrorCode.SECURITY_CHECK_FAILED)
    assert.equal(p.result.message, '含敏感信息')
  })

  test('song 成功：完整字段 title/music_url/image_url/duration/lyrics_sections + status 来自参数', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'song',
      taskId: 't2',
      bussinessId: 'b2',
      status: 'succeeded',
      media: { music_url: 'https://tos/m.mp3', image_url: 'https://tos/c.jpg' },
      extraMeta: {
        title: '我的歌',
        duration: 180,
        lyrics_sections: [{ text: 'la la' }],
      },
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      title: '我的歌',
      music_url: 'https://tos/m.mp3',
      image_url: 'https://tos/c.jpg',
      duration: 180,
      lyrics_sections: [{ text: 'la la' }],
    })
    assert.equal(p.result.bussiness_id, 'b2')
  })

  test('song 成功：extraMeta 缺省字段兜底为 null', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'song',
      taskId: 't2',
      bussinessId: 'b2',
      status: 'succeeded',
      media: {},
      extraMeta: {},
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      title: null,
      music_url: null,
      image_url: null,
      duration: null,
      lyrics_sections: null,
    })
  })

  test('video 成功：meta 仅含 status/failed_reason/video_url', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'video',
      taskId: 't3',
      bussinessId: 'b3',
      status: 'succeeded',
      media: { video_url: 'https://tos/v.mp4' },
      extraMeta: {},
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      video_url: 'https://tos/v.mp4',
    })
  })

  test('news 成功：title/news_abstract/news_url，源字段名为 abstract 映射为 news_abstract', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'news',
      taskId: 't4',
      bussinessId: 'b4',
      status: 'succeeded',
      media: { news_url: 'https://news/x' },
      extraMeta: { title: '标题', abstract: '摘要' },
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      title: '标题',
      news_abstract: '摘要',
      news_url: 'https://news/x',
    })
  })

  test('storybook 成功：images_url 数组透传；空值兜底为空数组', () => {
    const ok = buildAsyncCallbackPayload({
      serviceType: 'storybook',
      taskId: 't5',
      bussinessId: 'b5',
      status: 'succeeded',
      media: { images_url: ['https://a', 'https://b'] },
      extraMeta: {},
    })
    assert.deepEqual(ok.meta, {
      status: 'succeeded',
      failed_reason: null,
      images_url: ['https://a', 'https://b'],
    })

    // media 无 images_url 时兜底空数组（对齐源项目 `or []`）
    const empty = buildAsyncCallbackPayload({
      serviceType: 'storybook',
      taskId: 't5',
      bussinessId: 'b5',
      status: 'succeeded',
      media: {},
      extraMeta: {},
    })
    assert.deepEqual(empty.meta.images_url, [])
  })

  test('podcast 成功（走 else 默认分支）：{status, failed_reason} + media 展开 + 成功展开 extra', () => {
    // 对齐源项目 poll_tasks.py 1341-1349：media={audio_url}, extra=result.extra_meta
    const p = buildAsyncCallbackPayload({
      serviceType: 'podcast',
      taskId: 't6',
      bussinessId: 'b6',
      status: 'succeeded',
      media: { audio_url: 'https://minio/a.mp3' },
      extraMeta: { duration: 120, speakers: 2 },
    })
    assert.deepEqual(p.meta, {
      status: 'succeeded',
      failed_reason: null,
      audio_url: 'https://minio/a.mp3',
      duration: 120,
      speakers: 2,
    })
    assert.equal(p.result.bussiness_id, 'b6')
  })

  test('podcast 失败：不展开 extra_meta，只保留 status/failed_reason + media', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'podcast',
      taskId: 't6',
      bussinessId: 'b6',
      status: 'failed',
      media: { audio_url: 'https://minio/a.mp3' },
      extraMeta: { duration: 120 },
    })
    // 失败时 extra 不展开（对齐源项目 `if success:` 守卫）
    assert.deepEqual(p.meta, {
      status: 'failed',
      failed_reason: '不符合创作规范',
      audio_url: 'https://minio/a.mp3',
    })
    assert.equal((p.meta as Record<string, unknown>).duration, undefined)
  })

  test('text 成功：result 无 bussiness_id，meta 仅 output_text', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'text',
      taskId: 't7',
      bussinessId: '',
      status: 'succeeded',
      media: { output_text: '润色结果' },
      extraMeta: {},
    })
    assert.deepEqual(p.result, {
      task_id: 't7',
      code: ErrorCode.SUCCESS,
      message: null,
    })
    assert.equal((p.result as Record<string, unknown>).bussiness_id, undefined)
    assert.deepEqual(p.meta, { output_text: '润色结果' })
  })

  test('text 成功：output_text 缺省兜底为空串', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'text',
      taskId: 't7',
      bussinessId: '',
      status: 'succeeded',
      media: {},
      extraMeta: {},
    })
    assert.equal(p.meta.output_text, '')
  })

  test('text 失败：output_text 恒为空串（不回传内部文本）', () => {
    const p = buildAsyncCallbackPayload({
      serviceType: 'text',
      taskId: 't7',
      bussinessId: '',
      status: 'failed',
      media: { output_text: '不该出现的内容' },
      extraMeta: {},
    })
    assert.equal(p.meta.output_text, '')
    assert.equal(p.result.code, ErrorCode.SYSTEM_FAILED)
  })

  test('失败时默认 failureCode=SYSTEM_FAILED，可被 failureCode 参数覆盖', () => {
    const def = buildAsyncCallbackPayload({
      serviceType: 'image',
      taskId: 't',
      bussinessId: 'b',
      status: 'failed',
      media: {},
      extraMeta: {},
    })
    assert.equal(def.result.code, ErrorCode.SYSTEM_FAILED)

    const override = buildAsyncCallbackPayload({
      serviceType: 'image',
      taskId: 't',
      bussinessId: 'b',
      status: 'failed',
      media: {},
      extraMeta: {},
      failureCode: ErrorCode.EXTERNAL_SERVICE_FAILED,
    })
    assert.equal(override.result.code, ErrorCode.EXTERNAL_SERVICE_FAILED)
    assert.equal(override.meta.failed_reason, '不符合创作规范')
  })
})
