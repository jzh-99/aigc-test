import './bootstrap.js'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { Worker, Queue } from 'bullmq'
import { buildLogger } from './logger.js'
import type { GenerationJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { getAdapter } from './adapters/factory.js'
import { completePipeline } from './pipelines/complete.js'
import { failPipeline } from './pipelines/fail.js'
import { getRedis, getBullMQConnection, closeRedis } from './lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from './lib/queue-options.js'
import { loadNacosConfig, systemConfig } from '@aigc/nacos-config'

const logger = buildLogger()

// ─── 单实例锁：防止同一台机器上多个 worker 进程同时运行 ──────────────────────
// key 包含主机名，不同机器互不干扰，支持多机水平扩展
const WORKER_LOCK_KEY = `worker:singleton:lock:${hostname()}`
const LOCK_TTL_MS = 10_000 // 10 秒，心跳续期间隔的 2 倍
const LOCK_VALUE = String(process.pid)
// 图片任务总兜底超时改走 systemConfig（Nacos 可热更），不再顶层常量。
// 取值须 < timeout-guardian 的 IMAGE_GUARDIAN_TIMEOUT_MS（默认 360s）。

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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

// ─── Nacos 远程配置加载 ──────────────────────────────────────────────────────
// 方案 B：AI 供应商配置只认 Nacos。启动时会先清理本地 AI env，再从 Nacos 拉取并写回；
// Nacos 不可用或 dataId 拉取失败会阻断启动，避免 .env 旧值兜底。
// 具体供应商 key 是否为空，由实际调用的 adapter/service 做精确校验。
await loadNacosConfig()

// 这些模块在顶层会创建 BullMQ Worker。必须等单实例锁和 Nacos 初始化成功后再加载，
// 否则锁失败/配置失败的进程也会短暂启动消费者，甚至留下后台副作用。
const [
  { transferWorker },
  { videoSubmitWorker },
  { storyboardWorker },
  { musicWorker },
  { musicVoiceCloneWorker },
  { cronWorker, scheduleCronJobs },
  { shortDramaExportWorker },
  { openApiCallbackWorker },
  { storybookWorker },
  { podcastWorker },
  { newsWorker },
  { startBizMgmtNotifyWorker },
  { startVideoPoller },
  { startAvatarPoller },
  { startActionImitationPoller },
] = await Promise.all([
  import('./workers/transfer.js'),
  import('./workers/video-submit.js'),
  import('./workers/storyboard.js'),
  import('./workers/music.js'),
  import('./workers/music-voice-clone.js'),
  import('./workers/cron-worker.js'),
  import('./workers/short-drama-export.js'),
  import('./workers/open-api-callback.js'),
  import('./workers/storybook.js'),
  import('./workers/podcast.js'),
  import('./workers/news.js'),
  import('./workers/biz-mgmt-notify.js'),
  import('./pollers/video-poller.js'),
  import('./pollers/avatar-poller.js'),
  import('./pollers/action-imitation-poller.js'),
])

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

    await db
      .updateTable('task_batches')
      .set({ status: 'processing' })
      .where('id', '=', data.batchId)
      .where('status', '=', 'pending')
      .execute()
    logger.info(logCtx, '[image-job] 步骤2 batch 状态已更新为 processing')

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
      const providerRequest = {
        model: data.model,
        prompt: data.prompt,
        params: data.params,
      }
      const imageTimeoutMs = systemConfig.imageAdapterTimeoutMs
      const result = await withTimeout(
        adapter.generateImage(providerRequest),
        imageTimeoutMs,
        `Image adapter timed out after ${imageTimeoutMs}ms`,
      )
      const aiElapsed = Date.now() - aiStart
      await recordProviderApiLog({
        batchId: data.batchId,
        taskId: data.taskId,
        userId: data.userId,
        teamId: data.teamId,
        module: 'image',
        provider: data.provider,
        model: data.model,
        operation: 'image.generate',
        method: 'POST',
        endpoint: '/images/generations',
        requestPayload: result.requestPayload ?? providerRequest,
        responsePayload: result,
        durationMs: aiElapsed,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.success ? null : result.errorMessage ?? '图片生成失败',
      })
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
    stalledInterval: 30_000, // 每 30 秒检查一次 stalled job，重启后快速恢复
    maxStalledCount: 2,
  },
)

imageWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Image worker error')
})

// ─── 启动时恢复 stalled/active job ──────────────────────────────────────────
// Worker 重启后，之前正在执行的 job lock 可能还没过期，手动将它们标记为 failed 并重试
async function recoverStalledJobs() {
  const queues = [
    new Queue('image-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    new Queue('transfer-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    new Queue('video-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    new Queue('storyboard-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  ]

  for (const queue of queues) {
    try {
      const activeJobs = await queue.getJobs(['active'])
      if (activeJobs.length > 0) {
        logger.info({ queue: queue.name, count: activeJobs.length }, '发现残留 active job，正在恢复')
        for (const job of activeJobs) {
          try {
            await job.moveToFailed(new Error('worker restarted — auto retry'), 'worker-restart', true)
            await job.retry()
          } catch {
            // job 可能已经被其他逻辑处理，忽略
          }
        }
        logger.info({ queue: queue.name, count: activeJobs.length }, 'active job 已全部重新入队')
      }
    } catch (err) {
      logger.error({ queue: queue.name, err }, '恢复 stalled job 失败')
    } finally {
      await queue.close()
    }
  }
}

await recoverStalledJobs()

// ─── Cron Jobs（BullMQ repeat）────────────────────────────────────────────────
// upsertJobScheduler 是幂等的，多台机器同时调用也只会存在一个调度
await scheduleCronJobs()

// ─── 业务管理平台通知 Worker（outbox 派发）─────────────────────────────────
// 消费 biz-mgmt-notify-queue，按 outbox 事件类型调业管接口（创作结果同步/会员副卡同步），
// 失败按指数退避重试，成功与失败记录都保留在 biz_mgmt_outbox_events。
const bizMgmtNotifyWorker = startBizMgmtNotifyWorker()

// ─── Video Poller ─────────────────────────────────────────────────────────────

const videoPollerTimer = startVideoPoller()

// ─── Avatar Poller ────────────────────────────────────────────────────────────

const avatarPollerTimer = startAvatarPoller()

// ─── Action Imitation Poller ──────────────────────────────────────────────────

const actionImitationPollerTimer = startActionImitationPoller()

logger.info({
  queues: [
    'image-queue',
    'transfer-queue',
    'video-queue',
    'storyboard-queue',
    'music-queue',
    'music-voice-clone-queue',
    'open-api-callback-queue',
    'storybook-queue',
    'podcast-queue',
    'news-queue',
    'cron-queue',
    'biz-mgmt-notify-queue',
  ],
  pollers: ['video', 'avatar', 'action-imitation'],
}, 'Worker service started')

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
  await Promise.all([
    imageWorker.close(),
    transferWorker.close(),
    videoSubmitWorker.close(),
    storyboardWorker.close(),
    musicWorker.close(),
    musicVoiceCloneWorker.close(),
    cronWorker.close(),
    shortDramaExportWorker.close(),
    openApiCallbackWorker.close(),
    storybookWorker.close(),
    podcastWorker.close(),
    newsWorker.close(),
    bizMgmtNotifyWorker.close(),
  ])
  await closeRedis()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
