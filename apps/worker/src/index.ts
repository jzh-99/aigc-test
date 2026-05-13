import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })
config({ path: path.resolve(__dirname, '../../../prompts.env'), override: false })

import { Worker, Queue } from 'bullmq'
import { buildLogger } from './logger.js'
import type { GenerationJobData, TransferJobData } from '@aigc/types'
import { getDb } from '@aigc/db'
import { getAdapter } from './adapters/factory.js'
import { completePipeline } from './pipelines/complete.js'
import { failPipeline } from './pipelines/fail.js'
import { runTimeoutGuardian } from './jobs/timeout-guardian.js'
import { runPurgeOldRecords } from './jobs/purge-old-records.js'
import { runPurgeDeletedProjects } from './jobs/purge-deleted-projects.js'
import { transferWorker } from './workers/transfer.js'
import { getRedis, getPubRedis, getBullMQConnection, closeRedis } from './lib/redis.js'
import { startVideoPoller } from './pollers/video-poller.js'
import { startAvatarPoller } from './pollers/avatar-poller.js'
import { startActionImitationPoller } from './pollers/action-imitation-poller.js'

const logger = buildLogger()

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

// ─── Timeout Guardian ──────────────────────────────────────────────────────────

const GUARDIAN_INTERVAL = 5 * 60 * 1000 // 5 minutes
// Delay first run by 1 minute to let workers warm up
setTimeout(() => {
  runTimeoutGuardian().catch((err) => logger.error({ err }, 'Timeout guardian error'))
}, 60_000)
const guardianTimer = setInterval(() => {
  runTimeoutGuardian().catch((err) => logger.error({ err }, 'Timeout guardian error'))
}, GUARDIAN_INTERVAL)

logger.info('Timeout guardian scheduled (every 5 minutes)')

// ─── Purge Old Records ────────────────────────────────────────────────────────

const PURGE_INTERVAL = 24 * 60 * 60 * 1000 // once a day
// Delay first run by 5 minutes
setTimeout(() => {
  runPurgeOldRecords().catch((err) => logger.error({ err }, 'Purge old records error'))
  runPurgeDeletedProjects().catch((err) => logger.error({ err }, 'Purge deleted projects error'))
}, 5 * 60 * 1000)
const purgeTimer = setInterval(() => {
  runPurgeOldRecords().catch((err) => logger.error({ err }, 'Purge old records error'))
  runPurgeDeletedProjects().catch((err) => logger.error({ err }, 'Purge deleted projects error'))
}, PURGE_INTERVAL)

// ─── Video Poller ─────────────────────────────────────────────────────────────

const videoPollerTimer = startVideoPoller()

// ─── Avatar Poller ────────────────────────────────────────────────────────────

const avatarPollerTimer = startAvatarPoller()

// ─── Action Imitation Poller ──────────────────────────────────────────────────

const actionImitationPollerTimer = startActionImitationPoller()

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

const shutdown = async () => {
  logger.info('Shutting down workers...')
  clearInterval(guardianTimer)
  clearInterval(purgeTimer)
  clearInterval(videoPollerTimer)
  clearInterval(avatarPollerTimer)
  clearInterval(actionImitationPollerTimer)
  await imageWorker.close()
  await transferWorker.close()
  await closeRedis()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
