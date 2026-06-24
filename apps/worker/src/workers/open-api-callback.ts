import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import type { OpenApiCallbackJobData } from '@aigc/types'
import { getBullMQConnection } from '../lib/redis.js'
import { CallbackClient } from '../lib/callback-client.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

/**
 * 回调最大尝试次数（与源 retry_callback 的 attempts>=4 阈值对齐：首次 + 3 次重试 = 4 次）
 */
const MAX_CALLBACK_ATTEMPTS = 4

/**
 * 开放接口异步回调 worker
 *
 * 严格对齐源项目 app/workers/poll_tasks.py 的 retry_callback 任务：
 * 1. 从 task_batches 读取 callback_url / callback_attempts / payload。
 * 2. 用 CallbackClient 以 HMAC-SHA256 签名 POST 到调用方。
 * 3. 成功 → 写 callback_status='succeeded'。
 * 4. 失败 → callback_attempts+1，达 4 次则写 callback_status='failed' 且不再重试；
 *    未达上限则抛错让 BullMQ 按投递时配置的 fixed backoff（10s）重试。
 *
 * 投递方需在 add 时设：
 *   attempts: 4, backoff: { type: 'fixed', delay: 10_000 }
 * 本 worker 自身不做退避计时（BullMQ 负责）。
 */
export const openApiCallbackWorker = new Worker<OpenApiCallbackJobData>(
  'open-api-callback-queue',
  async (job) => {
    const db = getDb()
    const { batchId, payload } = job.data

    // 仅查回调必需字段，避免拉取大字段
    const batch = await db
      .selectFrom('task_batches')
      .select(['callback_url', 'callback_attempts'])
      .where('id', '=', batchId)
      .executeTakeFirst()

    // 无回调地址的批次直接跳过（对齐源：if not request.callback_url: return）
    if (!batch?.callback_url) {
      logger.warn({ batchId }, '[open-api-callback] 无 callback_url，跳过回调')
      return
    }

    // env 仅在函数体内读取（dotenv 已由 bootstrap 加载）
    const secret = process.env.CALLBACK_SIGNATURE_SECRET
    if (!secret) {
      // 缺少密钥是配置错误，不应静默吞掉
      throw new Error('CALLBACK_SIGNATURE_SECRET 未配置')
    }
    const timeoutSeconds = Number(process.env.CALLBACK_TIMEOUT_SECONDS ?? 10)

    try {
      await new CallbackClient(timeoutSeconds, secret).post(batch.callback_url, payload)
      await db
        .updateTable('task_batches')
        .set({ callback_status: 'succeeded' })
        .where('id', '=', batchId)
        .execute()
      logger.info({ batchId }, '[open-api-callback] 回调成功')
    } catch (err) {
      // 读取最新 attempts 后 +1（worker 单队列串行消费此 batch，无并发更新风险）
      const attempts = batch.callback_attempts + 1
      const reachedLimit = attempts >= MAX_CALLBACK_ATTEMPTS
      await db
        .updateTable('task_batches')
        .set({
          callback_attempts: attempts,
          callback_status: reachedLimit ? 'failed' : 'pending',
        })
        .where('id', '=', batchId)
        .execute()

      logger.warn(
        { batchId, attempts, err: err instanceof Error ? err.message : String(err) },
        '[open-api-callback] 回调失败',
      )

      // 达到上限：不再重试，标记 failed 后正常返回（job 成功结束）
      if (reachedLimit) {
        return
      }
      // 未达上限：抛错触发 BullMQ 下一次退避重试
      throw err
    }
  },
  {
    connection: getBullMQConnection(),
    // 单机回调并发限流，避免对调用方造成瞬时压力
    limiter: { max: 20, duration: 1000 },
  },
)

openApiCallbackWorker.on('error', (err) => {
  logger.error({ err: err.message }, '[open-api-callback] worker error')
})
