import { Worker } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'
import { dispatchBizMgmtOutboxEvent } from '../lib/biz-mgmt-outbox-dispatch.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

/**
 * biz-mgmt-notify-queue 消费者。
 *
 * 消费 outbox 事件并调业管接口，失败按指数退避重试（outbox 表 next_attempt_at + BullMQ attempts 双保险）。
 * 注意：成功与失败记录都保留在 biz_mgmt_outbox_events，worker 只负责派发与状态流转。
 */
export function startBizMgmtNotifyWorker(): Worker {
  return new Worker(
    'biz-mgmt-notify-queue',
    async (job) => {
      await dispatchBizMgmtOutboxEvent(String(job.data.eventId))
    },
    {
      connection: getBullMQConnection(),
      ...DEFAULT_JOB_OPTIONS,
      // BullMQ 层重试兜底网络抖动；outbox 表内 next_attempt_at 控制实际下次投递可见性
      settings: {
        backoffStrategy: (attempts: number) => Math.min(60 * attempts, 3600) * 1000,
      },
    },
  ).on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'biz-mgmt-notify job failed (will retry or mark failed in outbox)')
  })
}
