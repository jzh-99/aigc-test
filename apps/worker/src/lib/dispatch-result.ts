// 开放接口回调钩子收敛 helper
//
// 统一处理「单任务终态 → 通知调用方」的分发逻辑：
// - 非开放接口任务（callbackUrl 为空）→ 保持现有 SSE 通道（sse:batch:<id>），零改动
// - 开放接口任务（callbackUrl 非空）→ 组装 payload 投递到 open-api-callback-queue，
//   由回调 worker 做 HMAC 签名后 POST 到 task_batches.callback_url
//
// 设计要点：
// 1. 调用方（complete.ts / fail.ts / transfer.ts）只负责判断分流与提供字段，
//    具体「走 SSE 还是走回调队列」由本 helper 内部根据 callbackUrl 决定
// 2. worker 端自建 open-api-callback-queue 实例（与 api 的 getOpenApiCallbackQueue
//    同名即同队列，不跨包引用 api，对齐 complete.ts 的 getTransferQueue 模式）
// 3. 回调重试策略：attempts=4 + 固定 10s 退避，等价源项目 RETRY_DELAYS=[10,10,10]
// 4. 测试用依赖注入（可选 queue/pub 参数），对齐 Task 0.5 finder 注入风格

import { Queue } from 'bullmq'
import {
  buildAsyncCallbackPayload,
  type CallbackServiceType,
} from '@aigc/types'
import type { OpenApiCallbackJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from './redis.js'
import { DEFAULT_JOB_OPTIONS } from './queue-options.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

// 回调队列名：与 apps/api/src/lib/queue.ts 的 getOpenApiCallbackQueue 同名，
// BullMQ 同名即同队列，api/worker 各自实例化即可互通
const OPEN_API_CALLBACK_QUEUE_NAME = 'open-api-callback-queue'

// 回调重试：4 次尝试（首试 + 3 次重试），固定 10s 退避
// 对齐源项目 retry_callback 的 max_retries=4、RETRY_DELAYS=[10,10,10]
const CALLBACK_ATTEMPTS = 4
const CALLBACK_BACKOFF_DELAY_MS = 10_000

// SSE 频道名与负载（保持与 complete.ts/fail.ts/transfer.ts 原逻辑一致）
const sseChannel = (batchId: string): string => `sse:batch:${batchId}`
const SSE_PAYLOAD = JSON.stringify({ event: 'batch_update' })

// ─── worker 端自建回调队列（延迟单例）─────────────────────────────────
let _openApiCallbackQueue: Queue<OpenApiCallbackJobData> | null = null

export function getOpenApiCallbackQueue(): Queue<OpenApiCallbackJobData> {
  if (!_openApiCallbackQueue) {
    _openApiCallbackQueue = new Queue<OpenApiCallbackJobData>(
      OPEN_API_CALLBACK_QUEUE_NAME,
      {
        connection: getBullMQConnection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      },
    )
  }
  return _openApiCallbackQueue
}

// 测试用：替换队列单例
export function __setOpenApiCallbackQueueForTest(
  queue: Queue<OpenApiCallbackJobData> | null,
): void {
  _openApiCallbackQueue = queue
}

export interface DispatchInput {
  batchId: string
  status: 'succeeded' | 'failed'
  serviceType: string
  // 供应商产出媒体字段（image_url / music_url / video_url / news_url /
  // audio_url / images_url / output_text），按 service_type 填
  media: Record<string, unknown>
  // 额外元信息（song 的 title/duration、news 的 title/abstract 等）
  extraMeta?: Record<string, unknown>
  businessId: string
  // 对外 task_id（源项目契约字段）
  taskId: string
  // 为空 → 走现有 SSE；非空 → 走开放接口回调队列
  callbackUrl: string | null
  // 失败码（默认 SYSTEM_FAILED）
  failureCode?: string
  // 对外文案覆盖（优先于 failureCode 对应文案）
  publicMessage?: string
}

// 依赖注入容器：测试时可传入 mock queue / publish 函数
export interface DispatchDeps {
  queue?: Queue<OpenApiCallbackJobData>
  // SSE 发布函数，签名对齐 ioredis.publish(channel, message)
  publish?: (channel: string, message: string) => Promise<number>
}

/**
 * 分发单个任务的终态结果：
 * - callbackUrl 为空（非开放接口）→ 发布 SSE 事件（与原逻辑完全一致）
 * - callbackUrl 非空（开放接口）→ 组装 payload 投递 open-api-callback-queue
 */
export async function dispatchBatchResult(
  input: DispatchInput,
  deps: DispatchDeps = {},
): Promise<void> {
  const { batchId, callbackUrl } = input

  // 非开放接口任务：保持现有 SSE 通道，零改动
  if (!callbackUrl) {
    const channel = sseChannel(batchId)
    const publish =
      deps.publish ??
      ((ch: string, msg: string) => getPubRedis().publish(ch, msg))
    logger.info({ batchId, channel }, '准备发布 SSE 事件')
    try {
      const result = await publish(channel, SSE_PAYLOAD)
      logger.info({ batchId, publishResult: result }, 'SSE 事件发布成功')
    } catch (err) {
      logger.error({ batchId, err }, 'SSE 事件发布失败')
      throw err
    }
    return
  }

  // 开放接口任务：组装 payload 投递回调队列
  const payload = buildAsyncCallbackPayload({
    serviceType: input.serviceType as CallbackServiceType,
    taskId: input.taskId,
    bussinessId: input.businessId,
    status: input.status,
    media: input.media,
    extraMeta: input.extraMeta ?? {},
    failureCode: input.failureCode,
    publicMessage: input.publicMessage,
  })

  const queue = deps.queue ?? getOpenApiCallbackQueue()
  await queue.add(
    'send',
    { batchId, payload } satisfies OpenApiCallbackJobData,
    {
      attempts: CALLBACK_ATTEMPTS,
      backoff: { type: 'fixed', delay: CALLBACK_BACKOFF_DELAY_MS },
    },
  )
  logger.info({ batchId, serviceType: input.serviceType, status: input.status }, '开放接口回调已入队')
}
