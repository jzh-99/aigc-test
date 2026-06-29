import { Worker } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { dispatchBizMgmtOutboxEvent } from '../lib/biz-mgmt-outbox-dispatch.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

/**
 * biz-mgmt-notify-queue 消费者。
 *
 * 消费 outbox 事件并调业管接口，失败按指数退避重试（outbox 表 next_attempt_at + BullMQ attempts 双保险）。
 * 注意：成功与失败记录都保留在 biz_mgmt_outbox_events，worker 只负责派发与状态流转。
 *
 * 可观测性：active/completed/failed/error 四个事件都打日志，便于判断「job 到底有没有被取走」。
 * 注意 Worker 不需要 defaultJobOptions（那是 Queue 的字段）；只保留 connection/concurrency/lockDuration。
 */
export function startBizMgmtNotifyWorker(): Worker {
  const worker = new Worker(
    'biz-mgmt-notify-queue',
    async (job) => {
      logger.info({ jobId: job.id, eventId: job.data?.eventId }, '[biz-mgmt-notify] 开始消费 job')
      await dispatchBizMgmtOutboxEvent(String(job.data.eventId))
    },
    {
      connection: getBullMQConnection(),
      concurrency: 5,
      lockDuration: 60_000,
    },
  )

  // job 被 Worker 取走开始执行（确认消费链路通的第一道证据）
  worker.on('active', (job) => {
    logger.info({ jobId: job?.id, eventId: job?.data?.eventId }, '[biz-mgmt-notify] job 已被取走（active）')
  })

  // job 执行完成（dispatch 内部按 outbox 状态流转，completed 不一定代表业管接口成功）
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, eventId: job?.data?.eventId }, '[biz-mgmt-notify] job 执行完成（看 outbox 表 status 判断业管是否真成功）')
  })

  // job 抛错（dispatch 内未耗尽重试次数时 throw，或 BullMQ 层错误）
  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, eventId: job?.data?.eventId, err: err.message }, '[biz-mgmt-notify] job 失败（将在 outbox 退避重试或置 failed）')
  })

  // Worker 自身错误（连接断开、Redis 不可达等，这是最可能导致「完全不消费」的原因）
  worker.on('error', (err) => {
    logger.error({ err: err.message, stack: err.stack }, '[biz-mgmt-notify] Worker 自身错误（连接/配置问题，job 不会被取走）')
  })

  return worker
}
