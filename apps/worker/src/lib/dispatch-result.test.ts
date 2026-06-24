import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  dispatchBatchResult,
  type DispatchDeps,
} from './dispatch-result.js'

// mock queue：记录 add 调用参数
type AddCall = {
  name: string
  data: {
    batchId: string
    payload: {
      result: Record<string, unknown>
      meta: Record<string, unknown>
    }
  }
  opts: { attempts: number; backoff: { type: string; delay: number } }
}

function makeMockQueue(): { queue: any; calls: AddCall[] } {
  const calls: AddCall[] = []
  const queue = {
    add(name: string, data: any, opts: any) {
      calls.push({ name, data, opts })
      return Promise.resolve({ id: 'mock-job-id' })
    },
  }
  return { queue, calls }
}

// mock publish：记录调用
function makeMockPublish(): {
  publish: (ch: string, msg: string) => Promise<number>
  calls: { channel: string; message: string }[]
} {
  const calls: { channel: string; message: string }[] = []
  const publish = async (channel: string, message: string) => {
    calls.push({ channel, message })
    return 1
  }
  return { publish, calls }
}

describe('dispatchBatchResult', () => {
  test('有 callbackUrl → 投递 open-api-callback-queue，参数含 { batchId, payload } 与重试策略；SSE 不被调用', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    const { publish, calls: pubCalls } = makeMockPublish()
    const deps: DispatchDeps = { queue, publish }

    await dispatchBatchResult(
      {
        batchId: 'b1',
        status: 'succeeded',
        serviceType: 'image',
        media: { image_url: 'https://tos/x.png' },
        businessId: 'biz1',
        taskId: 't1',
        callbackUrl: 'https://cb.example/open',
      },
      deps,
    )

    // 队列入队一次
    assert.equal(queueCalls.length, 1)
    const call = queueCalls[0]
    assert.equal(call.name, 'send')
    assert.equal(call.data.batchId, 'b1')
    // payload 含 result + meta
    assert.deepEqual(call.data.payload.result, {
      task_id: 't1',
      bussiness_id: 'biz1',
      code: '0000',
      message: null,
    })
    assert.deepEqual(call.data.payload.meta, {
      status: 'succeeded',
      failed_reason: null,
      image_url: 'https://tos/x.png',
    })

    // 重试策略：4 次尝试 + 固定 10s 退避
    assert.deepEqual(call.opts, {
      attempts: 4,
      backoff: { type: 'fixed', delay: 10_000 },
    })

    // SSE 未被调用
    assert.equal(pubCalls.length, 0)
  })

  test('有 callbackUrl 且失败 → payload code 为 SYSTEM_FAILED，failed_reason 取固定文案', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    await dispatchBatchResult(
      {
        batchId: 'b2',
        status: 'failed',
        serviceType: 'image',
        media: {},
        businessId: 'biz2',
        taskId: 't2',
        callbackUrl: 'https://cb.example/open',
      },
      { queue },
    )

    assert.equal(queueCalls.length, 1)
    assert.equal(queueCalls[0].data.payload.result.code, '5001')
    assert.equal(queueCalls[0].data.payload.meta.failed_reason, '不符合创作规范')
  })

  test('无 callbackUrl → 发布 SSE 到 sse:batch:<id>，queue.add 不被调用', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    const { publish, calls: pubCalls } = makeMockPublish()

    await dispatchBatchResult(
      {
        batchId: 'b3',
        status: 'succeeded',
        serviceType: 'image',
        media: {},
        businessId: '',
        taskId: 't3',
        callbackUrl: null,
      },
      { queue, publish },
    )

    // SSE 发布一次，channel 与 payload 与原 complete.ts 一致
    assert.equal(pubCalls.length, 1)
    assert.equal(pubCalls[0].channel, 'sse:batch:b3')
    assert.equal(pubCalls[0].message, JSON.stringify({ event: 'batch_update' }))

    // 队列未被调用
    assert.equal(queueCalls.length, 0)
  })

  test('无 callbackUrl 且 publish 抛错 → 异常上抛（对齐原 SSE 失败 throw 行为）', async () => {
    const { queue } = makeMockQueue()
    const failingPublish = async (): Promise<number> => {
      throw new Error('redis down')
    }

    await assert.rejects(
      dispatchBatchResult(
        {
          batchId: 'b4',
          status: 'succeeded',
          serviceType: 'image',
          media: {},
          businessId: '',
          taskId: 't4',
          callbackUrl: null,
        },
        { queue, publish: failingPublish },
      ),
      /redis down/,
    )
  })

  test('serviceType=text 且有 callbackUrl → result 不含 bussiness_id（对齐源项目契约）', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    await dispatchBatchResult(
      {
        batchId: 'b5',
        status: 'succeeded',
        serviceType: 'text',
        media: { output_text: '润色结果' },
        businessId: 'ignored',
        taskId: 't5',
        callbackUrl: 'https://cb.example/open',
      },
      { queue },
    )
    assert.equal(queueCalls.length, 1)
    const result = queueCalls[0].data.payload.result as Record<string, unknown>
    assert.equal(result.bussiness_id, undefined)
    assert.equal(result.task_id, 't5')
  })

  // ─── Phase 2 视频接入契约（video-poller.handleVideoFailure + transfer.ts 视频分支）───
  // 这两个用例锁定视频回调的关键契约：
  //   1. 成功：media.video_url 为 TOS URL（transfer.ts 已修正 assetType=video 时用 video_url）
  //   2. 失败：failureCode=EXTERNAL_SERVICE_FAILED（video-poller.handleVideoFailure 传入）

  test('video 成功 → meta.video_url 为传入的 TOS URL（transfer.ts 视频分支契约）', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    await dispatchBatchResult(
      {
        batchId: 'b6',
        status: 'succeeded',
        serviceType: 'video',
        media: { video_url: 'https://tos/v.mp4' },
        businessId: 'biz6',
        taskId: 't6',
        callbackUrl: 'https://cb.example/open',
      },
      { queue },
    )
    assert.equal(queueCalls.length, 1)
    const meta = queueCalls[0].data.payload.meta as Record<string, unknown>
    assert.equal(meta.status, 'succeeded')
    assert.equal(meta.video_url, 'https://tos/v.mp4')
    // video meta 不应含 image_url（对齐 buildAsyncCallbackPayload 的 video 分支）
    assert.equal(meta.image_url, undefined)
  })

  test('video 失败 + failureCode=EXTERNAL_SERVICE_FAILED → result.code=4001，media 为空', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    await dispatchBatchResult(
      {
        batchId: 'b7',
        status: 'failed',
        serviceType: 'video',
        media: {},
        businessId: 'biz7',
        taskId: 't7',
        callbackUrl: 'https://cb.example/open',
        failureCode: '4001',
      },
      { queue },
    )
    assert.equal(queueCalls.length, 1)
    const result = queueCalls[0].data.payload.result as Record<string, unknown>
    const meta = queueCalls[0].data.payload.meta as Record<string, unknown>
    assert.equal(result.code, '4001')
    assert.equal(meta.status, 'failed')
    assert.equal(meta.video_url, null)
  })

  // ─── Phase 3 音乐接入契约（music.ts 完成点 + 失败点）───
  // 这两个用例锁定音乐回调的关键契约（对齐源 callbacks.py 的 _song_meta）：
  //   1. 成功：meta 含 music_url/image_url/title/duration/lyrics_sections/status
  //   2. 失败：failureCode=EXTERNAL_SERVICE_FAILED（music.ts failMusicJob 接入点传入）

  test('song 成功 → meta 含 music_url/image_url/title/duration/lyrics_sections（对齐 _song_meta）', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    const lyricsSections = [
      { section_type: 'verse', start: 0, end: 30, lines: [{ start: 0, end: 10, text: '夏日微风' }] },
    ]
    await dispatchBatchResult(
      {
        batchId: 'b8',
        status: 'succeeded',
        serviceType: 'song',
        media: {
          music_url: 'https://tos/song.mp3',
          image_url: 'https://tos/cover.png',
        },
        extraMeta: {
          title: '夏日之歌',
          duration: 120,
          lyrics_sections: lyricsSections,
        },
        businessId: 'biz8',
        taskId: 't8',
        callbackUrl: 'https://cb.example/open',
      },
      { queue },
    )
    assert.equal(queueCalls.length, 1)
    const result = queueCalls[0].data.payload.result as Record<string, unknown>
    const meta = queueCalls[0].data.payload.meta as Record<string, unknown>
    // result 契约（非 text 分支含 bussiness_id）
    assert.equal(result.task_id, 't8')
    assert.equal(result.bussiness_id, 'biz8')
    assert.equal(result.code, '0000')
    // meta 契约（逐项对齐 _song_meta）
    assert.equal(meta.status, 'succeeded')
    assert.equal(meta.failed_reason, null)
    assert.equal(meta.title, '夏日之歌')
    assert.equal(meta.music_url, 'https://tos/song.mp3')
    assert.equal(meta.image_url, 'https://tos/cover.png')
    assert.equal(meta.duration, 120)
    assert.deepEqual(meta.lyrics_sections, lyricsSections)
  })

  test('song 失败 + failureCode=EXTERNAL_SERVICE_FAILED → result.code=4001，media 字段为 null', async () => {
    const { queue, calls: queueCalls } = makeMockQueue()
    await dispatchBatchResult(
      {
        batchId: 'b9',
        status: 'failed',
        serviceType: 'song',
        media: {},
        businessId: 'biz9',
        taskId: 't9',
        callbackUrl: 'https://cb.example/open',
        failureCode: '4001',
      },
      { queue },
    )
    assert.equal(queueCalls.length, 1)
    const result = queueCalls[0].data.payload.result as Record<string, unknown>
    const meta = queueCalls[0].data.payload.meta as Record<string, unknown>
    assert.equal(result.code, '4001')
    // 失败时 _song_meta 各字段兜底为 null
    assert.equal(meta.status, 'failed')
    assert.equal(meta.music_url, null)
    assert.equal(meta.image_url, null)
    assert.equal(meta.title, null)
    assert.equal(meta.duration, null)
    assert.equal(meta.lyrics_sections, null)
  })
})
