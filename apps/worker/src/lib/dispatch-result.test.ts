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
})
