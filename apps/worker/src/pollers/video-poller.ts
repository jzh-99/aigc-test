import pino_ from 'pino'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { getPubRedis, getRedis } from '../lib/redis.js'
import { Queue } from 'bullmq'

let _transferQueue: Queue | null = null
function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getRedis() })
  }
  return _transferQueue
}

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Track consecutive poll errors per task to detect persistent API failures
const pollErrorCounts = new Map<string, number>()
const MAX_CONSECUTIVE_POLL_ERRORS = 5
let pollTick = 0
const POLL_CONCURRENCY = 10

const VEO_API_URL = process.env.NANO_BANANA_API_URL ?? 'https://api.nanobanana.com'
const VEO_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
const MAX_VIDEO_AGE_MS = 60 * 60 * 1000 // 1 hour

interface VideoTaskRow {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  estimatedCredits: number
  externalTaskId: string
  processingStartedAt: string | null
  provider: string
  canvasId: string | null
  canvasNodeId: string | null
}

async function checkVeoTask(externalTaskId: string): Promise<{
  status: string
  videoUrl?: string
  failReason?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${VEO_API_URL}/v2/videos/generations/${externalTaskId}`, {
      headers: { Authorization: `Bearer ${VEO_API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) return { status: 'POLL_ERROR' }
    const data = (await res.json()) as { status: string; data?: { output?: string }; fail_reason?: string }
    return {
      status: data.status,
      videoUrl: data.data?.output,
      failReason: data.fail_reason,
    }
  } catch {
    return { status: 'POLL_ERROR' }
  } finally {
    clearTimeout(timer)
  }
}

async function checkVolcengineTask(externalTaskId: string): Promise<{
  status: string
  videoUrl?: string
  failReason?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const volcengineApiUrl = 'https://ark.cn-beijing.volces.com/api/v3'
    const volcengineApiKey = process.env.VOLCENGINE_API_KEY ?? ''
    const res = await fetch(`${volcengineApiUrl}/contents/generations/tasks/${externalTaskId}`, {
      headers: { Authorization: `Bearer ${volcengineApiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return { status: 'POLL_ERROR' }
    const data = (await res.json()) as {
      status: string
      content?: { video_url?: string }
      error?: { message?: string }
    }
    // Map Volcengine status to internal status
    const statusMap: Record<string, string> = {
      succeeded: 'SUCCESS',
      failed: 'FAILURE',
      expired: 'FAILURE',
      queued: 'NOT_START',
      running: 'IN_PROGRESS',
      cancelled: 'FAILURE',
    }
    return {
      status: statusMap[data.status] ?? 'POLL_ERROR',
      videoUrl: data.content?.video_url,
      failReason: data.error?.message,
    }
  } catch {
    return { status: 'POLL_ERROR' }
  } finally {
    clearTimeout(timer)
  }
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
      description: 'Video generation confirmed',
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

  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))

  // Write canvas_node_outputs if this task belongs to a canvas node
  if (task.canvasId && task.canvasNodeId) {
    const canvasId = task.canvasId
    const nodeId = task.canvasNodeId
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
        is_selected: true,
      })
      .execute()
    await getPubRedis().incr(`canvas:dirty:${canvasId}`)
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
      assetId: assetRow.id,
      originalUrl: videoUrl,
      assetType: 'video',
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
      description: `Video generation failed: ${errorMessage.slice(0, 200)}`,
    }).execute()

    await trx.updateTable('task_batches')
      .set({ status: 'failed', failed_count: sql`failed_count + 1` })
      .where('id', '=', batchId).execute()
  })

  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
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
      : await checkVeoTask(task.externalTaskId)

    if (result.status === 'SUCCESS' && result.videoUrl) {
      pollErrorCounts.delete(task.taskId)
      await handleVideoSuccess(task, result.videoUrl)
    } else if (result.status === 'FAILURE') {
      pollErrorCounts.delete(task.taskId)
      await handleVideoFailure(task, result.failReason ?? 'Video generation failed')
    } else if (result.status === 'POLL_ERROR') {
      const count = (pollErrorCounts.get(task.taskId) ?? 0) + 1
      pollErrorCounts.set(task.taskId, count)
      if (count >= MAX_CONSECUTIVE_POLL_ERRORS) {
        logger.warn({ taskId: task.taskId, count }, 'Video task exceeded max poll errors, failing task')
        pollErrorCounts.delete(task.taskId)
        await handleVideoFailure(task, '生成过程中出现异常，请重新发起请求')
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
      'task_batches.credit_account_id as creditAccountId',
      'task_batches.provider as provider',
      'task_batches.canvas_id as canvasId',
      'task_batches.canvas_node_id as canvasNodeId',
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
  const POLL_INTERVAL = 15_000

  // Delay first run by 30s to let service warm up
  const initialDelay = setTimeout(() => {
    pollVideoTasks().catch((err) => logger.error({ err }, 'Video poller error'))
  }, 30_000)

  const timer = setInterval(() => {
    pollVideoTasks().catch((err) => logger.error({ err }, 'Video poller error'))
  }, POLL_INTERVAL)

  logger.info('Video poller started (every 15 seconds)')
  return timer
}
