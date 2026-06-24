// Task 1.4 e2e 测试专用：最小 worker 集合入口。
//
// 仅为端到端测试启动 image/transfer/open-api-callback 三个 worker，不导入 index.ts
// （index.ts 含单实例锁 + 视频/音乐/cron/poller 等无关 worker，会增加干扰和清理成本）。
//
// 三个 worker 的来源：
// - image worker：处理逻辑复制自 apps/worker/src/index.ts（内联闭包），保持与生产一致
// - transfer worker：e2e 简化版。真实 transfer.ts 有 SSRF 防护（validateExternalUrl 拦截
//   localhost/私网），测试的临时图片 URL 指向本地 mock 服务器会被拦。Task 1.4 验收核心是
//   「回调链路贯通」（dispatchBatchResult → callback queue → HMAC POST），transfer 的下载/TOS
//   上传是既有逻辑、非本次验收范围，故此处简化为「直接写 storage_url + 调 dispatchBatchResult」，
//   复用真实 dispatchBatchResult 与 callback worker，保留链路衔接的端到端覆盖
// - callback worker：直接 import 真实 open-api-callback.ts（单例导出，import 即启动）
//
// image worker 处理逻辑若 index.ts 变更需同步；dispatchBatchResult/callback worker 为真实实现。

import '../bootstrap.js'
import { Worker } from 'bullmq'
import { buildLogger } from '../logger.js'
import type { GenerationJobData, TransferJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { getAdapter } from '../adapters/factory.js'
import { completePipeline } from '../pipelines/complete.js'
import { failPipeline } from '../pipelines/fail.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { openApiCallbackWorker } from './open-api-callback.js'
import { getBullMQConnection } from '../lib/redis.js'

const logger = buildLogger()

// 对齐 index.ts 的 IMAGE_ADAPTER_TIMEOUT_MS
const IMAGE_ADAPTER_TIMEOUT_MS = 330_000
// 测试用 TOS 永久 URL 前缀（由测试设置 TOS_PUBLIC_URL，此处拼接 key）
const STORAGE_URL_KEY_SUFFIX = 'assets/image/'

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

// image worker 处理逻辑（复制自 index.ts，保持一致）
const imageWorker = new Worker<GenerationJobData>(
  'image-queue',
  async (job) => {
    const data = job.data
    const logCtx = { jobId: job.id, taskId: data.taskId, provider: data.provider, model: data.model }
    logger.info(logCtx, '[e2e image-job] 取到任务')

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

    await db
      .updateTable('task_batches')
      .set({ status: 'processing' })
      .where('id', '=', data.batchId)
      .where('status', '=', 'pending')
      .execute()

    try {
      const adapter = getAdapter(data.provider)
      const providerRequest = {
        model: data.model,
        prompt: data.prompt,
        params: data.params,
      }
      const result = await withTimeout(
        adapter.generateImage(providerRequest),
        IMAGE_ADAPTER_TIMEOUT_MS,
        `Image adapter timed out after ${IMAGE_ADAPTER_TIMEOUT_MS}ms`,
      )
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
        durationMs: 0,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.success ? null : result.errorMessage ?? '图片生成失败',
      })

      if (result.success && result.outputUrl) {
        logger.info({ ...logCtx, outputUrl: result.outputUrl }, '[e2e image-job] 进入 completePipeline')
        await completePipeline(data, result.outputUrl, data.estimatedCredits)
      } else {
        logger.warn({ ...logCtx, error: result.errorMessage }, '[e2e image-job] AI 返回失败，进入 failPipeline')
        await failPipeline(data, result.errorMessage ?? 'Unknown error')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ...logCtx, err: msg }, '[e2e image-job] 捕获异常，进入 failPipeline')
      await failPipeline(data, msg)
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
    lockDuration: 600_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
)

imageWorker.on('error', (err) => {
  logger.error({ err: err.message }, '[e2e] image worker error')
})

// transfer worker：e2e 简化版（替代真实 transfer.ts，绕过 SSRF/下载/TOS，保留 dispatchBatchResult 衔接）
// 真实 transfer.ts 的下载+TOS 上传是既有逻辑，非 Task 1.4 验收范围；此处仅模拟「转存成功」，
// 写 asset.storage_url + transfer_status=completed，并调真实 dispatchBatchResult 投回调队列
const transferWorker = new Worker<TransferJobData>(
  'transfer-queue',
  async (job) => {
    const { taskId, batchId, assetId } = job.data
    logger.info({ jobId: job.id, taskId, assetId }, '[e2e transfer-job] 取到任务（简化版）')

    const publicUrl = process.env.TOS_PUBLIC_URL ?? 'https://tos-e2e-mock.example.com'
    // 对齐真实 transfer.ts 的 key 格式 assets/image/<taskId>.jpg
    const storageUrl = `${publicUrl}/${STORAGE_URL_KEY_SUFFIX}${taskId}.jpg`

    const db = getDb()
    await db
      .updateTable('assets')
      .set({
        storage_url: storageUrl,
        transfer_status: 'completed',
      })
      .where('id', '=', assetId)
      .execute()

    // 开放接口任务：调真实 dispatchBatchResult 投回调队列（media.image_url = 转存后的 TOS URL）
    const oa = await db
      .selectFrom('task_batches')
      .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
      .where('id', '=', batchId)
      .executeTakeFirst()

    if (oa?.source === 'open_api') {
      await dispatchBatchResult({
        batchId,
        status: 'succeeded',
        serviceType: oa.service_type ?? 'image',
        media: { image_url: storageUrl },
        businessId: oa.business_id ?? '',
        taskId: oa.task_id ?? '',
        callbackUrl: oa.callback_url,
      })
      logger.info({ jobId: job.id, batchId, storageUrl }, '[e2e transfer-job] dispatchBatchResult 已投回调队列')
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
  },
)

transferWorker.on('error', (err) => {
  logger.error({ err: err.message }, '[e2e] transfer worker error')
})

logger.info('[e2e] image worker started')
logger.info('[e2e] transfer worker started (simplified)')
logger.info('[e2e] open-api-callback worker started (imported)')

// 关闭所有 worker，供测试 after 钩子调用
export async function close(): Promise<void> {
  await Promise.all([
    imageWorker.close(),
    transferWorker.close(),
    openApiCallbackWorker.close(),
  ])
}
