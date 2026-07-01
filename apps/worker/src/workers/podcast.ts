// 开放接口播客生成 worker（Phase 5）。
//
// 移植源项目 app/workers/poll_tasks.py:process_podcast_generation 的编排：
//   ① 内容预处理：text → 直接用；file/url → 透传 TOS/外部 URL
//   ② podcast-tts provider：WebSocket 连接字节 sami 生成音频（返回临时 audio_url）
//   ③ 音频转存 TOS：复用 music-storage.transferMusicUrl（kind='audio'）
//   ④ dispatchBatchResult：serviceType='podcast'，media.audio_url = TOS URL
//
// 与 aigc-test 现有 music worker 完全隔离：
//   - 独立 queue（podcast-queue）、独立 worker、module='podcast'、serviceType='podcast'
//   - sami WebSocket 帧协议是全新移植，不复用 mureka HTTP 流程
//
// 偏离源项目的点（已在任务说明中标注）：
//   - 安全审查（输入改写 / 输出音频检测 / 对话文本分块检测）：aigc-test 无对应能力，跳过
//   - 转存目标：源项目转存 MinIO，此处转存 TOS（对齐 aigc-test 统一存储）
//   - 重试循环：源项目 PODCAST_GENERATION_MAX_ATTEMPTS 多次重试；此处依赖 BullMQ 的
//     attempts 重试机制（worker 层不自行重试，避免与 BullMQ 重复）
//   - 积分：podcast 走开放接口零积分（estimatedCredits=0）

import { Worker } from 'bullmq'
import { sql } from 'kysely'
import { ErrorCode } from '@aigc/types'
import type { PodcastJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { podcastConfig } from '@aigc/nacos-config'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { transferMusicUrl } from '../lib/music-storage.js'
import { buildLogger } from '../logger.js'
import {
  generatePodcast,
  createWsConnectDeps,
  type PodcastTtsConfig,
  type ConnectDeps,
} from '../providers/podcast-tts.js'
import { resolvePodcastContent } from '../providers/podcast-content.js'

const logger = buildLogger()

// sami 配置（从 Nacos getter 读取，对齐源 config.py 的 PODCAST_* 配置）
function buildPodcastTtsConfig(): PodcastTtsConfig {
  return {
    wsUrl: podcastConfig.wsUrl,
    appId: podcastConfig.appId,
    accessKey: podcastConfig.accessKey,
    resourceId: podcastConfig.resourceId,
    appKey: podcastConfig.appKey,
    timeoutSeconds: podcastConfig.timeoutSeconds,
  }
}

// ─── 状态流转：task → processing（对齐 storybook worker）─────────────────────────
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
async function markTaskSucceeded(jobData: PodcastJobData): Promise<void> {
  const db = getDb()
  const { taskId, batchId } = jobData
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
      logger.warn({ taskId, batchId }, '[podcast] 任务已处理，跳过（幂等保护）')
      return
    }

    // 业管化后本地不再维护积分：移除 credit_accounts/credits_ledger 操作。

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
      logger.warn({ batchId, err }, '[podcast] SSE 发布失败')
    }
  }
}

// ─── 失败状态流转：task→failed、batch 终态、退还冻结积分 ──────────────────────
async function markTaskFailed(jobData: PodcastJobData, errorMessage: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId } = jobData

  await db.transaction().execute(async (trx: any) => {
    const taskLock = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE
    `.execute(trx)
    const currentStatus = (taskLock.rows as Array<{ status: string }>)[0]?.status
    if (currentStatus === 'completed' || currentStatus === 'failed') {
      logger.warn({ taskId, batchId, currentStatus }, '[podcast] 任务已处理，跳过失败流转（幂等）')
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

// 依赖注入容器：测试时可注入 mock connectDeps / transferMusicUrl
export interface PodcastWorkerDeps {
  connectDeps?: ConnectDeps
  // 音频转存函数，签名对齐 transferMusicUrl
  transferAudio?: (
    url: string,
    kind: 'audio',
    ownerId: string,
  ) => Promise<{ storageUrl: string }>
}

// ─── Podcast Worker ────────────────────────────────────────────────────────────
export function createPodcastWorker(deps: PodcastWorkerDeps = {}) {
  const connectDeps = deps.connectDeps ?? createWsConnectDeps()
  const transferAudio =
    deps.transferAudio ??
    (async (url: string, kind: 'audio', ownerId: string) => {
      const stored = await transferMusicUrl(url, kind, ownerId)
      return { storageUrl: stored.storageUrl }
    })

  const worker = new Worker<PodcastJobData>(
    'podcast-queue',
    async (job) => {
      const data = job.data
      const logCtx = {
        jobId: job.id,
        taskId: data.taskId,
        openApiTaskId: data.openApiTaskId,
        contentType: data.contentType,
      }
      logger.info(logCtx, '[podcast-job] 取到任务，开始处理')

      // 步骤0：task → processing
      await markTaskProcessing(data.taskId, data.batchId, job.id)

      const caller = data.openApiTaskId ?? data.taskId

      try {
        // 步骤①：内容预处理（text/file/url 分流，对齐源 prepare_podcast_content）
        const resolved = resolvePodcastContent({
          contentType: data.contentType,
          content: data.content,
          sourceFileUrl: data.sourceFileUrl,
        })
        logger.info(
          { ...logCtx, contentIsUrl: resolved.isUrl, contentLength: resolved.content.length },
          '[podcast-job] 步骤1 内容预处理完成',
        )

        // 步骤②：WebSocket TTS 生成（移植源 PodcastProvider.generate）
        const config = buildPodcastTtsConfig()
        if (!config.wsUrl || !config.appId || !config.accessKey) {
          throw new Error('PODCAST_WS_URL / PODCAST_APP_ID / PODCAST_ACCESS_KEY 未配置')
        }
        const ttsStart = Date.now()
        const ttsResult = await generatePodcast({
          config,
          taskId: data.openApiTaskId ?? data.taskId,
          contentType: data.contentType,
          content: resolved.content,
          speakers: data.speakers,
          connectDeps,
        })
        const ttsElapsed = Date.now() - ttsStart

        await recordProviderApiLog({
          batchId: data.batchId,
          taskId: data.taskId,
          userId: data.userId,
          teamId: data.teamId,
          module: 'podcast',
          provider: 'sami',
          model: 'podcast-tts',
          operation: 'podcast.generate',
          method: 'WS',
          endpoint: config.wsUrl.slice(0, 100),
          requestPayload: {
            content_type: data.contentType,
            speakers: data.speakers,
            content_length: resolved.content.length,
          },
          responsePayload: {
            received_audio_stream: ttsResult.receivedAudioStream,
            round_texts_count: ttsResult.roundTexts.length,
            audio_url: ttsResult.audioUrl.slice(0, 80),
          },
          durationMs: ttsElapsed,
          status: 'success',
          errorMessage: null,
        })
        logger.info(
          { ...logCtx, temporaryAudioUrl: ttsResult.audioUrl.slice(0, 80), elapsedMs: ttsElapsed },
          '[podcast-job] 步骤2 WebSocket TTS 生成成功',
        )

        // 步骤③：音频转存 TOS（复用 transferMusicUrl，kind='audio'）
        const transferStart = Date.now()
        const stored = await transferAudio(ttsResult.audioUrl, 'audio', data.taskId)
        const transferElapsed = Date.now() - transferStart
        logger.info(
          { ...logCtx, storageUrl: stored.storageUrl.slice(0, 80), elapsedMs: transferElapsed },
          '[podcast-job] 步骤3 音频转存 TOS 成功',
        )

        // 建 asset 记录（对齐源 MediaAsset：external_url + storage_url）
        const db = getDb()
        await db
          .insertInto('assets')
          .values({
            task_id: data.taskId,
            batch_id: data.batchId,
            user_id: data.userId,
            type: 'audio',
            original_url: ttsResult.audioUrl,
            storage_url: stored.storageUrl,
            transfer_status: 'completed',
          })
          .execute()

        // 步骤④a：成功状态流转（task→completed、batch→completed、积分确认）
        await markTaskSucceeded(data)

        // 步骤④b：分发回调（serviceType='podcast'，media.audio_url = TOS URL）
        await dispatchBatchResult({
          batchId: data.batchId,
          status: 'succeeded',
          serviceType: 'podcast',
          media: { audio_url: stored.storageUrl },
          extraMeta: {
            received_audio_stream: ttsResult.receivedAudioStream,
            round_texts_count: ttsResult.roundTexts.length,
          },
          businessId: data.businessId ?? '',
          taskId: data.openApiTaskId ?? '',
          callbackUrl: data.callbackUrl ?? null,
        })

        logger.info({ ...logCtx, audioUrl: stored.storageUrl.slice(0, 80) }, '[podcast-job] 播客生成完成，回调已投递')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ ...logCtx, err: msg }, '[podcast-job] 生成失败，进入失败流转')

        await markTaskFailed(data, msg)

        // 失败回调（serviceType='podcast'，对齐源 _mark_request_failed + retry_callback）
        await dispatchBatchResult({
          batchId: data.batchId,
          status: 'failed',
          serviceType: 'podcast',
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
      // WebSocket TTS 耗时长（单 job 可能 3-5 分钟），lockDuration 覆盖整个执行周期
      lockDuration: 600_000, // 10 分钟
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  )

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[podcast] worker error')
  })

  logger.info('Podcast worker started — listening on podcast-queue')
  return worker
}

// 默认 worker 实例（index.ts 注册用）
export const podcastWorker = createPodcastWorker()
