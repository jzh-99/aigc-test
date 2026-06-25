// 开放接口绘本生成 worker（Phase 4）。
//
// 移植源项目 app/workers/poll_tasks.py:process_storybook_generation 的两步流程：
//   ① polish_prompt：Ark chat/completions 把用户 prompt 润色成 N 页分镜描述
//      （N=pages），返回 {title, summary, scenes, scenes_detail}
//   ② generate_group_images：seedream /images/generations 批量组图
//      （sequential_image_generation: auto + max_images: pages），返回 N 张临时 URL
//   ③ 逐张转存 TOS：下载每张临时图片 + putObject 到 TOS，得到永久 images_url 数组
//   ④ dispatchBatchResult：serviceType='storybook'，media.images_url = TOS URL 数组
//
// 业务逻辑（两步 + 转存）抽离到 storybook-core.ts，本文件只做 BullMQ 编排 + DB 状态流转，
// 便于单元测试（import core 不触发 new Worker 副作用）。
//
// 与 aigc-test 现有 picture_book（SaaS 多步交互式）完全隔离：
//   - 独立 queue（storybook-queue）、独立 worker、不依赖 canvas/picture_book 表
//   - 两步流程直接移植源项目 StorybookProvider（无现成 adapter 可复用：
//     volcengine-image.ts 的 generateImage 只返单张，无组图方法）
//
// 偏离源项目的点（已在任务说明中标注）：
//   - 安全审查（ensure_images_safe）：aigc-test 无对应能力，跳过
//   - 转存目标：源项目转存 MinIO，此处转存 TOS（对齐 aigc-test 统一存储）
//   - 积分：storybook 走开放接口零积分（estimatedCredits=0），不调 completePipeline
//     （complete.ts 的 image 分支会建单 asset + 投 transfer，与绘本多图批量语义冲突）

import { Worker } from 'bullmq'
import { sql } from 'kysely'
import { ErrorCode } from '@aigc/types'
import type { StorybookJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { buildLogger } from '../logger.js'
import {
  polishPrompt,
  generateGroupImages,
  transferImageToTos,
} from './storybook-core.js'

const logger = buildLogger()

// 绘本组图模型（seedream，支持 sequential_image_generation）
const STORYBOOK_IMAGE_MODEL = process.env.DOUBAO_STORYBOOK_IMAGE_MODEL ?? 'seedream-4.5'

// ─── 状态流转：task → processing（对齐 image worker）──────────────────────────
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
async function markTaskSucceeded(jobData: StorybookJobData): Promise<void> {
  const db = getDb()
  const { taskId, batchId } = jobData
  const actualCredits = 0

  await db.transaction().execute(async (trx: any) => {
    // task → completed（幂等：跳过已终态）
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
      logger.warn({ taskId, batchId }, '[storybook] 任务已处理，跳过（幂等保护）')
      return
    }

    // 业管化后本地不再维护积分：移除 credit_accounts/credits_ledger 操作。

    // batch 计数 + 终态判定（quantity=1，完成即终态）
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

  // 非开放接口任务（理论上 storybook 只走开放接口，此处兜底发 SSE 保持一致）
  if (!jobData.callbackUrl) {
    const channel = `sse:batch:${batchId}`
    try {
      await getPubRedis().publish(channel, JSON.stringify({ event: 'batch_update' }))
    } catch (err) {
      logger.warn({ batchId, err }, '[storybook] SSE 发布失败')
    }
  }
}

// ─── 失败状态流转：task→failed、batch 终态、退还冻结积分 ──────────────────────
async function markTaskFailed(jobData: StorybookJobData, errorMessage: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId } = jobData

  await db.transaction().execute(async (trx: any) => {
    const taskLock = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE
    `.execute(trx)
    const currentStatus = (taskLock.rows as Array<{ status: string }>)[0]?.status
    if (currentStatus === 'completed' || currentStatus === 'failed') {
      logger.warn({ taskId, batchId, currentStatus }, '[storybook] 任务已处理，跳过失败流转（幂等）')
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

    // 业管化后本地不再退还积分：移除 credit_accounts/team_members/credits_ledger 操作。

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

// ─── Storybook Worker ────────────────────────────────────────────────────────
export const storybookWorker = new Worker<StorybookJobData>(
  'storybook-queue',
  async (job) => {
    const data = job.data
    const logCtx = {
      jobId: job.id,
      taskId: data.taskId,
      openApiTaskId: data.openApiTaskId,
      pages: data.pages,
    }
    logger.info(logCtx, '[storybook-job] 取到任务，开始处理')

    // 步骤0：task → processing
    await markTaskProcessing(data.taskId, data.batchId, job.id)

    // 火山 API Key（统一用 VOLCENGINE_API_KEY，与 volcengine-image adapter 一致）
    const apiKey = process.env.VOLCENGINE_API_KEY ?? ''
    if (!apiKey) {
      throw new Error('VOLCENGINE_API_KEY 未配置')
    }
    const caller = data.openApiTaskId ?? data.taskId

    try {
      // 步骤①：润色分镜
      const outline = await polishPrompt({
        apiKey,
        prompt: data.prompt,
        age: data.age,
        category: data.category,
        style: data.style,
        pages: data.pages,
        caller,
        taskId: data.taskId,
      })

      // 记录润色供应商调用日志（对齐 image worker 的 recordProviderApiLog）
      await recordProviderApiLog({
        batchId: data.batchId,
        taskId: data.taskId,
        userId: data.userId,
        teamId: data.teamId,
        module: 'storybook',
        provider: 'volcengine',
        model: STORYBOOK_IMAGE_MODEL,
        operation: 'storybook.polish',
        method: 'POST',
        endpoint: '/chat/completions',
        requestPayload: { model: STORYBOOK_IMAGE_MODEL, pages: data.pages },
        responsePayload: { title: outline.title, summary: outline.summary },
        durationMs: 0,
        status: 'success',
        errorMessage: null,
      })

      // 步骤②：组图（用 seedream 模型）
      const tempImageUrls = await generateGroupImages({
        apiKey,
        model: STORYBOOK_IMAGE_MODEL,
        userPrompt: data.prompt,
        scenesDetail: outline.scenesDetail,
        pages: data.pages,
        caller,
        taskId: data.taskId,
      })

      await recordProviderApiLog({
        batchId: data.batchId,
        taskId: data.taskId,
        userId: data.userId,
        teamId: data.teamId,
        module: 'storybook',
        provider: 'volcengine',
        model: STORYBOOK_IMAGE_MODEL,
        operation: 'storybook.group_images',
        method: 'POST',
        endpoint: '/images/generations',
        requestPayload: { model: STORYBOOK_IMAGE_MODEL, pages: data.pages },
        responsePayload: { image_count: tempImageUrls.length },
        durationMs: 0,
        status: 'success',
        errorMessage: null,
      })

      // 步骤③：逐张转存 TOS（按模型返回顺序，保证 images_url 顺序对应绘本页码）
      const db = getDb()
      const storageKeyPrefix = `assets/storybook/${data.taskId}`
      const tosUrls: string[] = []
      for (let i = 0; i < tempImageUrls.length; i++) {
        const sourceUrl = tempImageUrls[i]
        logger.info({ ...logCtx, page: i + 1, sourceUrl: sourceUrl.slice(0, 80) }, '[storybook] 步骤3 转存到 TOS')
        const { storageUrl } = await transferImageToTos(sourceUrl, i, storageKeyPrefix)
        tosUrls.push(storageUrl)

        // 建 asset 记录（对齐源 MinioStorageClient.transfer 后建 MediaAsset）
        await db
          .insertInto('assets')
          .values({
            task_id: data.taskId,
            batch_id: data.batchId,
            user_id: data.userId,
            type: 'image',
            original_url: sourceUrl,
            storage_url: storageUrl,
            transfer_status: 'completed',
          })
          .execute()
      }

      // 步骤④a：成功状态流转（task→completed、batch→completed、积分确认）
      await markTaskSucceeded(data)

      // 步骤④b：分发回调（serviceType='storybook'，media.images_url = TOS URL 数组）
      // 对齐源 build_async_callback_payload 的 _storybook_meta：images_url 为数组
      await dispatchBatchResult({
        batchId: data.batchId,
        status: 'succeeded',
        serviceType: 'storybook',
        media: { images_url: tosUrls },
        businessId: data.businessId ?? '',
        taskId: data.openApiTaskId ?? '',
        callbackUrl: data.callbackUrl ?? null,
      })

      logger.info(
        { ...logCtx, imageCount: tosUrls.length },
        '[storybook-job] 绘本生成完成，回调已投递',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ...logCtx, err: msg }, '[storybook-job] 生成失败，进入失败流转')

      // 失败状态流转（task→failed、退还积分）
      await markTaskFailed(data, msg)

      // 失败回调（serviceType='storybook'，对齐源 _mark_request_failed + retry_callback）
      await dispatchBatchResult({
        batchId: data.batchId,
        status: 'failed',
        serviceType: 'storybook',
        media: { images_url: [] },
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
    // 组图耗时长（单 job 可能 10 分钟），lockDuration 必须覆盖整个执行周期
    lockDuration: 900_000, // 15 分钟
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
)

storybookWorker.on('error', (err) => {
  logger.error({ err: err.message }, '[storybook] worker error')
})

logger.info('Storybook worker started — listening on storybook-queue')
