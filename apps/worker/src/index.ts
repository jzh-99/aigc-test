import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { Worker, Queue } from 'bullmq'
import { buildLogger } from './logger.js'
import type { GenerationJobData } from '@aigc/types'
import { getDb } from '@aigc/db'
import { getAdapter } from './adapters/factory.js'
import { completePipeline } from './pipelines/complete.js'
import { failPipeline } from './pipelines/fail.js'
import { transferWorker } from './workers/transfer.js'
import { cronWorker, scheduleCronJobs } from './workers/cron-worker.js'
import { getRedis, getBullMQConnection, closeRedis } from './lib/redis.js'
import { startVideoPoller } from './pollers/video-poller.js'
import { startAvatarPoller } from './pollers/avatar-poller.js'
import { startActionImitationPoller } from './pollers/action-imitation-poller.js'

const logger = buildLogger()

// ─── 单实例锁：防止同一台机器上多个 worker 进程同时运行 ──────────────────────
// key 包含主机名，不同机器互不干扰，支持多机水平扩展
const WORKER_LOCK_KEY = `worker:singleton:lock:${hostname()}`
const LOCK_TTL_MS = 10_000 // 10 秒，心跳续期间隔的 2 倍
const LOCK_VALUE = String(process.pid)

async function acquireSingletonLock(): Promise<boolean> {
  const redis = getRedis()
  // SET NX EX：只有不存在时才设置，原子操作
  const result = await redis.set(WORKER_LOCK_KEY, LOCK_VALUE, 'PX', LOCK_TTL_MS, 'NX')
  return result === 'OK'
}

const lockAcquired = await acquireSingletonLock()
if (!lockAcquired) {
  const redis = getRedis()
  const existingPid = await redis.get(WORKER_LOCK_KEY)
  logger.error({ existingPid }, '另一个 worker 实例正在运行，当前进程退出。请先停止旧进程再重启。')
  process.exit(1)
}

// 心跳续期：每 5 秒续期一次，防止锁过期被其他进程抢占
const lockHeartbeat = setInterval(async () => {
  const redis = getRedis()
  const current = await redis.get(WORKER_LOCK_KEY)
  if (current === LOCK_VALUE) {
    await redis.pexpire(WORKER_LOCK_KEY, LOCK_TTL_MS)
  }
}, 5_000)

// ─── Image Worker ────────────────────────────────────────────────────────────

const imageWorker = new Worker<GenerationJobData>(
  'image-queue',
  async (job) => {
    const data = job.data
    const logCtx = { jobId: job.id, taskId: data.taskId, provider: data.provider, model: data.model }

    // ── 步骤 1：BullMQ 取到任务 ──────────────────────────────────────────────
    logger.info(logCtx, '[image-job] 步骤1 取到任务，开始处理')

    // ── 步骤 2：更新 task 状态为 processing ──────────────────────────────────
    const db = getDb()
    await db
      .updateTable('tasks')
      .set({
        status: 'processing',
        processing_started_at: new Date().toISOString(),
        queue_job_id: job.id ?? null,
      })
      .where('id', '=', data.taskId)
      .execute()
    logger.info(logCtx, '[image-job] 步骤2 task 状态已更新为 processing')

    try {
      // ── 步骤 3：调用 AI 前检查任务状态，防止超时退款后重连重复消费 ──────────
      const currentTask = await db
        .selectFrom('tasks')
        .select('status')
        .where('id', '=', data.taskId)
        .executeTakeFirst()

      if (!currentTask || currentTask.status !== 'processing') {
        logger.warn(
          { ...logCtx, currentStatus: currentTask?.status },
          '[image-job] 步骤3 任务已非 processing 状态（可能已超时退款），跳过 AI 调用',
        )
        return
      }

      // ── 步骤 3：获取适配器并调用 AI ─────────────────────────────────────────
      const adapter = getAdapter(data.provider)
      logger.info(
        { ...logCtx, estimatedCredits: data.estimatedCredits, hasImages: !!(data.params?.image) },
        '[image-job] 步骤3 开始调用 AI 适配器',
      )
      const aiStart = Date.now()
      const result = await adapter.generateImage({
        model: data.model,
        prompt: data.prompt,
        params: data.params,
      })
      const aiElapsed = Date.now() - aiStart
      logger.info(
        { ...logCtx, success: result.success, elapsedMs: aiElapsed, error: result.errorMessage },
        '[image-job] 步骤3 AI 适配器返回',
      )

      if (result.success && result.outputUrl) {
        // ── 步骤 4a：调用 completePipeline ────────────────────────────────────
        logger.info({ ...logCtx, outputUrl: result.outputUrl.slice(0, 80) }, '[image-job] 步骤4a 进入 completePipeline')
        await completePipeline(data, result.outputUrl, data.estimatedCredits)
        logger.info(logCtx, '[image-job] 步骤4a completePipeline 完成，SSE 已发布，transfer 已入队')
      } else {
        // ── 步骤 4b：调用 failPipeline ────────────────────────────────────────
        logger.warn({ ...logCtx, error: result.errorMessage }, '[image-job] 步骤4b AI 返回失败，进入 failPipeline')
        await failPipeline(data, result.errorMessage ?? 'Unknown error')
        logger.warn(logCtx, '[image-job] 步骤4b failPipeline 完成，积分已退还')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // ── 步骤 4c：异常兜底 ─────────────────────────────────────────────────
      logger.error({ ...logCtx, err: msg }, '[image-job] 步骤4c 捕获到异常，进入 failPipeline')
      await failPipeline(data, msg)
      logger.error(logCtx, '[image-job] 步骤4c failPipeline 完成')
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
    // AI 调用最长 5 分钟 + 图片下载时间，lockDuration 必须覆盖整个 job 执行周期
    // BullMQ 默认 30s 会导致长耗时 job 被误判为 stalled 并重新入队
    lockDuration: 600_000, // 10 分钟
  },
)

imageWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Image worker error')
})

logger.info('Worker service started — listening on image-queue')
logger.info('Transfer worker started — listening on transfer-queue')

// ─── Cron Jobs（BullMQ repeat）────────────────────────────────────────────────
// upsertJobScheduler 是幂等的，多台机器同时调用也只会存在一个调度
await scheduleCronJobs()
logger.info('Cron worker started — listening on cron-queue')

// ─── Video Poller ─────────────────────────────────────────────────────────────

const videoPollerTimer = startVideoPoller()

// ─── Avatar Poller ────────────────────────────────────────────────────────────

const avatarPollerTimer = startAvatarPoller()

// ─── Action Imitation Poller ──────────────────────────────────────────────────

const actionImitationPollerTimer = startActionImitationPoller()

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

const shutdown = async () => {
  logger.info('Shutting down workers...')
  clearInterval(lockHeartbeat)
  clearInterval(videoPollerTimer)
  clearInterval(avatarPollerTimer)
  clearInterval(actionImitationPollerTimer)
  // 释放单实例锁，让新进程可以立即启动
  const redis = getRedis()
  const current = await redis.get(WORKER_LOCK_KEY)
  if (current === LOCK_VALUE) await redis.del(WORKER_LOCK_KEY)
  // 并行等待所有 worker 完成当前 job，避免串行等待导致后续 worker 锁超时
  await Promise.all([imageWorker.close(), transferWorker.close(), cronWorker.close()])
  await closeRedis()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
