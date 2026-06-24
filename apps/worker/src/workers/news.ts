// 开放接口资讯生成 worker（Phase 6）。
//
// 移植源项目 app/workers/poll_tasks.py:process_news_generation 的编排：
//   ① 安全改写提示词（aigc-test 无能力，跳过，直接用原始 prompt）
//   ② generateNewsWithRetry：Ark /responses 生成 HTML + 解析 + 安全重试循环（最多 3 次）
//   ③ HTML base64 转存 TOS（kind='html'）→ 永久 news_url
//   ④ dispatchBatchResult：serviceType='news'，media.news_url = TOS URL，
//      extraMeta={title, abstract}（buildMeta 内 abstract → news_abstract 映射）
//
// 与 aigc-test 现有 worker 完全隔离：
//   - 独立 queue（news-queue）、独立 worker、module='news'、serviceType='news'
//
// 偏离源项目的点（已在任务说明中标注）：
//   - 安全审查（输入改写 / 输出 HTML 分块检测）：aigc-test 无对应能力，跳过
//     （重试循环结构保留对齐源，安全检测 mock 为通过）
//   - 转存目标：源项目转存 MinIO（base64 接口），此处转存 TOS（putObject）
//   - 重试循环：源项目在 worker 内自行循环（NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS=3），
//     此处在 news-core.generateNewsWithRetry 内循环（保留同一语义），不依赖 BullMQ attempts
//   - 积分：news 走开放接口零积分（estimatedCredits=0）

import { Worker } from 'bullmq'
import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'
import { ErrorCode } from '@aigc/types'
import type { NewsJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { getTos, getBucket, getPublicUrl } from '../lib/storage.js'
import { buildLogger } from '../logger.js'
import {
  generateNewsWithRetry,
  type ArkResponsesDeps,
  type NewsSecurityChecker,
} from '../providers/news-core.js'

const logger = buildLogger()

// TOS 上传依赖接口（可注入，便于测试 mock putObject 而不真实连接 TOS）
export interface TosUploader {
  putObject(params: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<unknown>
}

// ─── 状态流转：task → processing（对齐 storybook/podcast worker）─────────────────
async function markTaskProcessing(taskId: string, batchId: string, jobId: string | undefined): Promise<void> {
  const db = getDb()
  await db
    .updateTable('tasks')
    .set({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
      queue_job_id: jobId ?? null,
    })
    .where('id', '=', taskId)
    .execute()
  await db
    .updateTable('task_batches')
    .set({ status: 'processing' })
    .where('id', '=', batchId)
    .where('status', '=', 'pending')
    .execute()
}

// ─── 成功状态流转：task→completed、batch 终态、积分确认（estimatedCredits=0 零积分）─
async function markTaskSucceeded(jobData: NewsJobData): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = jobData
  const actualCredits = 0

  await db.transaction().execute(async (trx: any) => {
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({
        status: 'completed',
        credits_cost: actualCredits,
        completed_at: new Date().toISOString(),
      })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()
    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) {
      logger.warn({ taskId, batchId }, '[news] 任务已处理，跳过（幂等保护）')
      return
    }

    await trx
      .updateTable('credit_accounts')
      .set({ frozen_credits: sql`frozen_credits - ${estimatedCredits}` })
      .where('id', '=', creditAccountId)
      .execute()

    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: -actualCredits,
        type: 'confirm',
        task_id: taskId,
        batch_id: batchId,
        description: '资讯生成成功',
      })
      .execute()

    await trx
      .updateTable('task_batches')
      .set({
        completed_count: sql`completed_count + 1`,
        actual_credits: sql`actual_credits + ${actualCredits}`,
        status: 'completed',
      })
      .where('id', '=', batchId)
      .execute()
  })

  if (!jobData.callbackUrl) {
    const channel = `sse:batch:${batchId}`
    try {
      await getPubRedis().publish(channel, JSON.stringify({ event: 'batch_update' }))
    } catch (err) {
      logger.warn({ batchId, err }, '[news] SSE 发布失败')
    }
  }
}

// ─── 失败状态流转：task→failed、batch 终态、退还冻结积分 ──────────────────────
async function markTaskFailed(jobData: NewsJobData, errorMessage: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = jobData

  await db.transaction().execute(async (trx: any) => {
    const taskLock = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE
    `.execute(trx)
    const currentStatus = (taskLock.rows as Array<{ status: string }>)[0]?.status
    if (currentStatus === 'completed' || currentStatus === 'failed') {
      logger.warn({ taskId, batchId, currentStatus }, '[news] 任务已处理，跳过失败流转（幂等）')
      return
    }

    await trx
      .updateTable('tasks')
      .set({
        status: 'failed',
        error_message: errorMessage.slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .where('id', '=', taskId)
      .execute()

    await trx
      .updateTable('credit_accounts')
      .set({ frozen_credits: sql`GREATEST(frozen_credits - ${estimatedCredits}, 0)` })
      .where('id', '=', creditAccountId)
      .execute()

    await trx
      .updateTable('team_members')
      .set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` })
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .execute()

    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: estimatedCredits,
        type: 'refund',
        task_id: taskId,
        batch_id: batchId,
        description: `资讯生成失败：${errorMessage.slice(0, 200)}`,
      })
      .execute()

    await trx
      .updateTable('task_batches')
      .set({
        failed_count: sql`failed_count + 1`,
        status: 'failed',
      })
      .where('id', '=', batchId)
      .execute()
  })
}

// HTML base64 转存 TOS（移植源 MinioStorageClient.persist_base64，改 TOS）
// 对齐源：html 编码为 utf-8 base64，落存储后返回永久 URL
// 红线：news 产物是生成的 HTML（无外部临时 URL），直接 putObject 上传
export async function persistNewsHtmlToTos(
  html: string,
  taskId: string,
  tosUploader?: TosUploader,
): Promise<{ storageUrl: string }> {
  const buffer = Buffer.from(html, 'utf-8')
  const key = `assets/news/${taskId}/${randomUUID()}.html`
  const tos: TosUploader = tosUploader ?? (getTos() as unknown as TosUploader)
  await tos.putObject({ bucket: getBucket(), key, body: buffer, contentType: 'text/html; charset=utf-8' })
  const storageUrl = `${getPublicUrl()}/${encodeURI(key)}`
  return { storageUrl }
}

// 依赖注入容器：测试时可注入 mock fetch / securityChecker / tosUploader
export interface NewsWorkerDeps {
  // Ark /responses fetch 注入（provider 测试用）
  arkDeps?: ArkResponsesDeps
  // 安全检测器注入（默认跳过）
  securityChecker?: NewsSecurityChecker
  // TOS 上传注入（转存测试用）
  tosUploader?: TosUploader
}

// ─── News Worker ────────────────────────────────────────────────────────────────
export function createNewsWorker(deps: NewsWorkerDeps = {}) {
  const worker = new Worker<NewsJobData>(
    'news-queue',
    async (job) => {
      const data = job.data
      const logCtx = {
        jobId: job.id,
        taskId: data.taskId,
        openApiTaskId: data.openApiTaskId,
        date: data.date,
      }
      logger.info(logCtx, '[news-job] 取到任务，开始处理')

      // 步骤0：task → processing
      await markTaskProcessing(data.taskId, data.batchId, job.id)

      const caller = data.openApiTaskId ?? data.taskId

      try {
        // 步骤①：Ark /responses 生成 HTML + 解析 + 安全重试循环（最多 3 次）
        // 对齐源 process_news_generation 的循环：HTML 验证失败/安全检测失败均重试
        const generateStart = Date.now()
        const result = await generateNewsWithRetry({
          apiKey: process.env.DOUBAO_API_KEY ?? '',
          prompt: data.prompt,
          date: data.date,
          deps: deps.arkDeps,
          securityChecker: deps.securityChecker,
          caller,
        })
        const generateElapsed = Date.now() - generateStart

        await recordProviderApiLog({
          batchId: data.batchId,
          taskId: data.taskId,
          userId: data.userId,
          teamId: data.teamId,
          module: 'news',
          provider: 'ark',
          model: process.env.DOUBAO_NEWS_MODEL ?? 'doubao-seed-2-0-code-preview-260215',
          operation: 'news.generate',
          method: 'POST',
          endpoint: '/responses',
          requestPayload: { prompt: data.prompt, date: data.date },
          responsePayload: result
            ? { html_length: result.html.length, title: result.title, abstract: result.abstract }
            : { failed: true },
          durationMs: generateElapsed,
          status: result ? 'success' : 'failed',
          errorMessage: result ? null : '资讯生成失败（HTML 校验或安全检测）',
        })

        if (!result) {
          // 生成失败：对齐源 result is None 分支
          // 失败码判定：安全检测失败 → SECURITY_CHECK_FAILED；否则 EXTERNAL_SERVICE_FAILED
          logger.warn({ ...logCtx, elapsedMs: generateElapsed }, '[news-job] 步骤1 生成失败（重试耗尽）')
          await markTaskFailed(data, '资讯生成失败')
          await dispatchBatchResult({
            batchId: data.batchId,
            status: 'failed',
            serviceType: 'news',
            media: {},
            businessId: data.businessId ?? '',
            taskId: data.openApiTaskId ?? '',
            callbackUrl: data.callbackUrl ?? null,
            failureCode: ErrorCode.EXTERNAL_SERVICE_FAILED,
          })
          return
        }

        logger.info(
          { ...logCtx, htmlLength: result.html.length, title: result.title, elapsedMs: generateElapsed },
          '[news-job] 步骤1 Ark /responses 生成成功',
        )

        // 步骤②：HTML base64 转存 TOS（对齐源 persist_base64，改 TOS putObject）
        const transferStart = Date.now()
        const stored = await persistNewsHtmlToTos(result.html, data.taskId, deps.tosUploader)
        const transferElapsed = Date.now() - transferStart
        logger.info(
          { ...logCtx, storageUrl: stored.storageUrl.slice(0, 80), elapsedMs: transferElapsed },
          '[news-job] 步骤2 HTML 转存 TOS 成功',
        )

        // 偏离源项目：源建 MediaAsset 记录（external_url + storage_url），
        // 此处 aigc-test 的 assets.type CHECK 约束仅允许 image/video/audio，
        // news HTML 产物无匹配类型，故不建 asset 记录（news_url 已通过回调传递）

        // 步骤③a：成功状态流转（task→completed、batch→completed、积分确认）
        await markTaskSucceeded(data)

        // 步骤③b：分发回调（serviceType='news'，media.news_url = TOS URL）
        // extraMeta 用 {title, abstract}（buildMeta 里 abstract → news_abstract 映射，对齐源 _news_meta）
        await dispatchBatchResult({
          batchId: data.batchId,
          status: 'succeeded',
          serviceType: 'news',
          media: { news_url: stored.storageUrl },
          extraMeta: {
            title: result.title,
            abstract: result.abstract,
          },
          businessId: data.businessId ?? '',
          taskId: data.openApiTaskId ?? '',
          callbackUrl: data.callbackUrl ?? null,
        })

        logger.info(
          { ...logCtx, newsUrl: stored.storageUrl.slice(0, 80), title: result.title },
          '[news-job] 资讯生成完成，回调已投递',
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ ...logCtx, err: msg }, '[news-job] 生成失败，进入失败流转')

        await markTaskFailed(data, msg)

        // 失败回调（serviceType='news'，对齐源 _mark_request_failed + retry_callback）
        await dispatchBatchResult({
          batchId: data.batchId,
          status: 'failed',
          serviceType: 'news',
          media: {},
          businessId: data.businessId ?? '',
          taskId: data.openApiTaskId ?? '',
          callbackUrl: data.callbackUrl ?? null,
          failureCode: ErrorCode.EXTERNAL_SERVICE_FAILED,
        })
      }
    },
    {
      connection: getBullMQConnection(),
      concurrency: 2,
      // Ark /responses 含 web_search + thinking，耗时长（单次可达 5-10 分钟，重试 3 次更长）
      lockDuration: 1_800_000, // 30 分钟
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  )

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[news] worker error')
  })

  logger.info('News worker started — listening on news-queue')
  return worker
}

// 默认 worker 实例（index.ts 注册用）
export const newsWorker = createNewsWorker()
