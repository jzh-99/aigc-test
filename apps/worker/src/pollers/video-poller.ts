import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { getPubRedis, getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'
import { Queue } from 'bullmq'
import { buildLogger } from '../logger.js'
import { recordProviderPollAudit } from '../lib/provider-poll-audit.js'
import {
  classifyVideoPollHttpError,
  MAX_CONSECUTIVE_VIDEO_POLL_ERRORS,
  parseVolcengineTaskResponse,
  VIDEO_POLL_INTERVAL_MS,
  type VideoPollStatus,
  type VideoPollResult,
} from './video-poller-result.js'

let _transferQueue: Queue | null = null
function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _transferQueue
}

const logger = buildLogger()

// Track consecutive poll errors per task to detect persistent API failures
const pollErrorCounts = new Map<string, number>()
let pollTick = 0
const POLL_CONCURRENCY = 10
const VIDEO_POLL_REQUEST_TIMEOUT_MS = 30_000

const VEO_API_URL = process.env.NANO_BANANA_API_URL ?? ''
const VEO_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
const CTYUN_EDGE_API_URL = (process.env.CTYUN_EDGE_API_BASE_URL || 'https://ai.ctaigw.cn/v1').replace(/\/$/, '')
const CTYUN_EDGE_API_KEY = process.env.CTYUN_EDGE_API_KEY ?? ''
const MAX_VIDEO_AGE_MS = 60 * 60 * 1000 // 1 hour
const VEO_STATUS_MAP: Record<string, VideoPollStatus> = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  NOT_START: 'NOT_START',
  IN_PROGRESS: 'IN_PROGRESS',
}

function isAbortOrTimeoutMessage(message?: string | null): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return normalized.includes('aborted') || normalized.includes('abort') || normalized.includes('timeout')
}

interface VideoTaskRow {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  workspaceId: string | null
  creditAccountId: string
  estimatedCredits: number
  externalTaskId: string
  processingStartedAt: string | null
  provider: string
  canvasId: string | null
  canvasNodeId: string | null
  params: unknown
}

async function checkVeoTask(externalTaskId: string): Promise<VideoPollResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VIDEO_POLL_REQUEST_TIMEOUT_MS)
  const endpoint = `/v2/videos/generations/${externalTaskId}`
  const startedAt = Date.now()
  try {
    const res = await fetch(`${VEO_API_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${VEO_API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      return {
        ...classifyVideoPollHttpError(res.status, errorBody),
        endpoint,
        responseStatus: res.status,
        responsePayload: { body: errorBody },
        durationMs: Date.now() - startedAt,
      }
    }
    const data = (await res.json()) as { status: string; data?: { output?: string }; fail_reason?: string }
    return {
      status: VEO_STATUS_MAP[data.status] ?? 'POLL_ERROR',
      videoUrl: data.data?.output,
      failReason: data.fail_reason,
      endpoint,
      responseStatus: res.status,
      responsePayload: data,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'POLL_ERROR', errorMessage: message, retryable: true, endpoint, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

async function checkVolcengineTask(externalTaskId: string): Promise<VideoPollResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VIDEO_POLL_REQUEST_TIMEOUT_MS)
  const endpoint = `/contents/generations/tasks/${externalTaskId}`
  const startedAt = Date.now()
  try {
    const volcengineApiUrl = 'https://ark.cn-beijing.volces.com/api/v3'
    const volcengineApiKey = process.env.VOLCENGINE_API_KEY ?? ''
    const res = await fetch(`${volcengineApiUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${volcengineApiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      return {
        ...classifyVideoPollHttpError(res.status, errorBody),
        endpoint,
        responseStatus: res.status,
        responsePayload: { body: errorBody },
        durationMs: Date.now() - startedAt,
      }
    }
    const data = await res.json()
    return {
      ...parseVolcengineTaskResponse(data),
      endpoint,
      responseStatus: res.status,
      responsePayload: data,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'POLL_ERROR', errorMessage: message, retryable: true, endpoint, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

async function checkCtyunEdgeTask(externalTaskId: string): Promise<VideoPollResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VIDEO_POLL_REQUEST_TIMEOUT_MS)
  const endpoint = `/contents/generations/tasks/${externalTaskId}`
  const startedAt = Date.now()
  try {
    const res = await fetch(`${CTYUN_EDGE_API_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${CTYUN_EDGE_API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      return {
        ...classifyVideoPollHttpError(res.status, errorBody),
        endpoint,
        responseStatus: res.status,
        responsePayload: { body: errorBody },
        durationMs: Date.now() - startedAt,
      }
    }
    const data = await res.json()
    return {
      ...parseVolcengineTaskResponse(data),
      endpoint,
      responseStatus: res.status,
      responsePayload: data,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'POLL_ERROR', errorMessage: message, retryable: true, endpoint, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

async function auditVideoPoll(task: VideoTaskRow, result: VideoPollResult): Promise<void> {
  await recordProviderPollAudit({
    auditKey: `${task.taskId}:video.query`,
    batchId: task.batchId,
    taskId: task.taskId,
    userId: task.userId,
    teamId: task.teamId,
    workspaceId: task.workspaceId,
    module: 'video',
    provider: task.provider,
    model: null,
    operation: 'video.query',
    method: 'GET',
    endpoint: result.endpoint ?? `${task.provider}:query`,
    requestPayload: result.requestPayload ?? null,
    responseStatus: result.responseStatus ?? result.httpStatus ?? null,
    responsePayload: result.responsePayload ?? result,
    externalTaskId: task.externalTaskId,
    durationMs: result.durationMs ?? null,
    status: ['FAILURE', 'POLL_ERROR', 'POLL_AUTH_ERROR'].includes(result.status) ? 'failed' : 'success',
    errorMessage: result.errorMessage ?? result.failReason ?? null,
    pollStatus: result.status,
    keyFields: {
      status: result.status,
      video_url: result.videoUrl ?? null,
      fail_reason: result.failReason ?? null,
      http_status: result.httpStatus ?? result.responseStatus ?? null,
      error_message: result.errorMessage ?? null,
    },
    final: result.status === 'SUCCESS' || result.status === 'FAILURE' || result.status === 'POLL_AUTH_ERROR',
  })
}

async function handleVideoSuccess(task: VideoTaskRow, videoUrl: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = task

  await db.transaction().execute(async (trx: any) => {
    // Idempotency guard
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({ status: 'completed', credits_cost: estimatedCredits, completed_at: new Date().toISOString() })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()

    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) return

    // Insert video asset
    await trx
      .insertInto('assets')
      .values({ task_id: taskId, batch_id: batchId, user_id: userId, type: 'video', original_url: videoUrl, transfer_status: 'pending' })
      .execute()

    // Confirm credits
    await trx.updateTable('credit_accounts')
      .set({
        frozen_credits: sql`frozen_credits - ${estimatedCredits}`,
        total_spent: sql`total_spent + ${estimatedCredits}`,
        balance: sql`balance - ${estimatedCredits}`,
      })
      .where('id', '=', creditAccountId).execute()

    await trx.insertInto('credits_ledger').values({
      credit_account_id: creditAccountId,
      user_id: userId,
      amount: -estimatedCredits,
      type: 'confirm',
      task_id: taskId,
      batch_id: batchId,
      description: '视频生成成功',
    }).execute()

    // Update batch to completed
    await trx.updateTable('task_batches')
      .set({
        status: 'completed',
        completed_count: sql`completed_count + 1`,
        actual_credits: sql`actual_credits + ${estimatedCredits}`,
      })
      .where('id', '=', batchId).execute()
  })

  // Publish SSE event
  const channel = `sse:batch:${batchId}`
  const publishPayload = JSON.stringify({ event: 'batch_update' })
  logger.info({ batchId, channel }, '准备发布 SSE 事件')
  try {
    const result = await getPubRedis().publish(channel, publishPayload)
    logger.info({ batchId, publishResult: result }, 'SSE 事件发布成功')
  } catch (err) {
    logger.error({ batchId, err }, 'SSE 事件发布失败')
    throw err
  }

  // Write canvas_node_outputs if this task belongs to a canvas node
  if (task.canvasId && task.canvasNodeId) {
    const canvasId = task.canvasId
    const nodeId = task.canvasNodeId
    const params = task.params as { duration?: unknown } | null | undefined
    const duration = typeof params?.duration === 'number' && Number.isFinite(params.duration) && params.duration > 0 ? params.duration : undefined
    const paramsSnapshot = JSON.stringify({
      params: task.params,
      ...(duration !== undefined ? { duration } : {}),
    })
    await db.updateTable('canvas_node_outputs')
      .set({ is_selected: false })
      .where('canvas_id', '=', canvasId)
      .where('node_id', '=', nodeId)
      .execute()
    await db.insertInto('canvas_node_outputs')
      .values({
        canvas_id: canvasId,
        node_id: nodeId,
        batch_id: batchId,
        output_urls: sql`ARRAY[${videoUrl}]::text[]`,
        params_snapshot: sql`${paramsSnapshot}::jsonb`,
        is_selected: true,
      })
      .execute()
    const redis = getPubRedis()
    const dirtyKey = `canvas:dirty:${canvasId}`
    await redis.incr(dirtyKey)
    await redis.expire(dirtyKey, 60 * 60 * 24)
  }

  // Enqueue transfer job — same as image pipeline
  const assetRow = await db
    .selectFrom('assets')
    .select('id')
    .where('task_id', '=', taskId)
    .executeTakeFirst()
  if (assetRow) {
    await getTransferQueue().add('transfer', {
      taskId,
      batchId,
      assetId: assetRow.id,
      originalUrl: videoUrl,
      assetType: 'video',
    }, {
      attempts: 10,
      backoff: { type: 'exponential', delay: 30_000 }, // 30s → 1m → 2m → ... 最大约 30m，总覆盖 ~2.5h
    })
  }

  logger.info({ taskId, batchId, videoUrl }, 'Video task completed')
}

async function handleVideoFailure(task: VideoTaskRow, errorMessage: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = task

  await db.transaction().execute(async (trx: any) => {
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({ status: 'failed', error_message: errorMessage.slice(0, 1000), completed_at: new Date().toISOString() })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()

    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) return

    // Refund credits
    await trx.updateTable('credit_accounts')
      .set({ frozen_credits: sql`frozen_credits - ${estimatedCredits}` })
      .where('id', '=', creditAccountId).execute()

    await trx.updateTable('team_members')
      .set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` })
      .where('team_id', '=', teamId).where('user_id', '=', userId).execute()

    await trx.insertInto('credits_ledger').values({
      credit_account_id: creditAccountId,
      user_id: userId,
      amount: estimatedCredits,
      type: 'refund',
      task_id: taskId,
      batch_id: batchId,
      description: `视频生成失败：${errorMessage.slice(0, 200)}`,
    }).execute()

    await trx.updateTable('task_batches')
      .set({ status: 'failed', failed_count: sql`failed_count + 1` })
      .where('id', '=', batchId).execute()
  })

  // Publish SSE event
  const channel = `sse:batch:${batchId}`
  const publishPayload = JSON.stringify({ event: 'batch_update' })
  logger.info({ batchId, channel }, '准备发布 SSE 事件')
  try {
    const result = await getPubRedis().publish(channel, publishPayload)
    logger.info({ batchId, publishResult: result }, 'SSE 事件发布成功')
  } catch (err) {
    logger.error({ batchId, err }, 'SSE 事件发布失败')
    throw err
  }
  logger.warn({ taskId, batchId, errorMessage }, 'Video task failed')
}

async function processVideoTask(task: VideoTaskRow, tick: number): Promise<void> {
  try {
    const ageMs = task.processingStartedAt
      ? Date.now() - new Date(task.processingStartedAt).getTime()
      : MAX_VIDEO_AGE_MS + 1

    if (ageMs > MAX_VIDEO_AGE_MS) {
      if (task.provider === 'volcengine') {
        try {
          const volcengineApiKey = process.env.VOLCENGINE_API_KEY ?? ''
          await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${task.externalTaskId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${volcengineApiKey}` },
            signal: AbortSignal.timeout(10_000),
          })
        } catch (cancelErr) {
          logger.warn({ taskId: task.taskId, cancelErr }, 'Failed to cancel volcengine task on timeout')
        }
      }
      await handleVideoFailure(task, 'Video generation timed out after 1 hour')
      return
    }

    // Age-based poll skipping: reduce API calls for older tasks
    const skipThisTick =
      ageMs >= 10 * 60_000 ? tick % 8 !== 0 :
      ageMs >= 2 * 60_000  ? tick % 4 !== 0 :
      false
    if (skipThisTick) return

    const result = task.provider === 'volcengine'
      ? await checkVolcengineTask(task.externalTaskId)
      : task.provider === 'ctyun-edge'
        ? await checkCtyunEdgeTask(task.externalTaskId)
        : await checkVeoTask(task.externalTaskId)
    await auditVideoPoll(task, result)

    if (result.status === 'SUCCESS' && result.videoUrl) {
      pollErrorCounts.delete(task.taskId)
      await handleVideoSuccess(task, result.videoUrl)
    } else if (result.status === 'FAILURE') {
      pollErrorCounts.delete(task.taskId)
      await handleVideoFailure(task, result.failReason ?? 'Video generation failed')
    } else if (result.status === 'POLL_AUTH_ERROR') {
      pollErrorCounts.delete(task.taskId)
      logger.error({
        taskId: task.taskId,
        batchId: task.batchId,
        provider: task.provider,
        externalTaskId: task.externalTaskId,
        httpStatus: result.httpStatus,
        errorMessage: result.errorMessage,
      }, 'Video task poll auth failed, failing task')
      await handleVideoFailure(task, result.failReason ?? '视频状态查询鉴权失败，请检查服务配置')
    } else if (result.status === 'POLL_ERROR') {
      const count = (pollErrorCounts.get(task.taskId) ?? 0) + 1
      pollErrorCounts.set(task.taskId, count)
      const pollErrorLogPayload = {
        taskId: task.taskId,
        batchId: task.batchId,
        provider: task.provider,
        externalTaskId: task.externalTaskId,
        count,
        max: MAX_CONSECUTIVE_VIDEO_POLL_ERRORS,
        httpStatus: result.httpStatus,
        retryable: result.retryable,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
      }
      const isNoisyRetryableTimeout = result.retryable !== false && isAbortOrTimeoutMessage(result.errorMessage)
      const shouldWarn = !isNoisyRetryableTimeout
      if (shouldWarn) {
        logger.warn(pollErrorLogPayload, 'Video task poll error')
      } else {
        logger.debug(pollErrorLogPayload, 'Video task poll retryable timeout')
      }
      if (count >= MAX_CONSECUTIVE_VIDEO_POLL_ERRORS && result.retryable === false) {
        logger.warn({ taskId: task.taskId, count }, 'Video task exceeded max poll errors, failing task')
        pollErrorCounts.delete(task.taskId)
        await handleVideoFailure(task, '生成过程中出现异常，请重新发起请求')
      } else if (count === MAX_CONSECUTIVE_VIDEO_POLL_ERRORS || count % MAX_CONSECUTIVE_VIDEO_POLL_ERRORS === 0) {
        logger.warn({
          taskId: task.taskId,
          batchId: task.batchId,
          count,
          errorMessage: result.errorMessage,
        }, 'Video task poll errors reached threshold but remain retryable')
      }
    } else {
      // NOT_START, IN_PROGRESS: still in progress, reset error count
      pollErrorCounts.delete(task.taskId)
    }
  } catch (err) {
    logger.error({ taskId: task.taskId, err }, 'Error processing video task')
  }
}

async function pollVideoTasks(): Promise<void> {
  const db = getDb()

  const tasks = await db
    .selectFrom('tasks')
    .innerJoin('task_batches', 'tasks.batch_id', 'task_batches.id')
    .select([
      'tasks.id as taskId',
      'tasks.external_task_id as externalTaskId',
      'tasks.batch_id as batchId',
      'tasks.estimated_credits as estimatedCredits',
      'tasks.processing_started_at as processingStartedAt',
      'task_batches.team_id as teamId',
      'task_batches.user_id as userId',
      'task_batches.workspace_id as workspaceId',
      'task_batches.credit_account_id as creditAccountId',
      'task_batches.provider as provider',
      'task_batches.canvas_id as canvasId',
      'task_batches.canvas_node_id as canvasNodeId',
      'task_batches.params as params',
    ])
    .where('tasks.status', '=', 'processing')
    .where('task_batches.module', '=', 'video')
    .where('tasks.external_task_id', 'is not', null)
    .execute() as VideoTaskRow[]

  if (tasks.length === 0) return

  pollTick++
  logger.debug({ count: tasks.length, tick: pollTick }, 'Polling video tasks')

  // Process in parallel chunks to cap concurrent outbound requests
  for (let i = 0; i < tasks.length; i += POLL_CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + POLL_CONCURRENCY).map((t) => processVideoTask(t, pollTick)))
  }
}

export function startVideoPoller(): NodeJS.Timeout {
  // Delay first run by 30s to let service warm up
  const initialDelay = setTimeout(() => {
    pollVideoTasks().catch((err) => logger.error({ err }, 'Video poller error'))
  }, 30_000)

  const timer = setInterval(() => {
    pollVideoTasks().catch((err) => logger.error({ err }, 'Video poller error'))
  }, VIDEO_POLL_INTERVAL_MS)

  logger.info('Video poller started (every 15 seconds)')
  return timer
}
