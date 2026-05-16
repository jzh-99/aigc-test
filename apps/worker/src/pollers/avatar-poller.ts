import pino_ from 'pino'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { getPubRedis, getBullMQConnection } from '../lib/redis.js'
import { Queue } from 'bullmq'
import { buildSignedRequest } from '../lib/volcengine-visual-sign.js'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

let _transferQueue: Queue | null = null
function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getBullMQConnection() })
  }
  return _transferQueue
}

const pollErrorCounts = new Map<string, number>()
const MAX_CONSECUTIVE_POLL_ERRORS = 5
const MAX_AVATAR_AGE_MS = 20 * 60 * 1000 // 20 minutes

const OMNI_REQ_KEY = 'jimeng_realman_avatar_picture_omni_v15'
const OMNI_API_VERSION = '2022-08-31'

interface AvatarTaskRow {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  estimatedCredits: number
  externalTaskId: string
  processingStartedAt: string | null
}

async function checkAvatarTask(externalTaskId: string): Promise<{
  status: 'SUCCESS' | 'FAILURE' | 'IN_PROGRESS' | 'POLL_ERROR'
  videoUrl?: string
  failReason?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const { url, headers, body } = buildSignedRequest('CVGetResult', OMNI_API_VERSION, {
      req_key: OMNI_REQ_KEY,
      task_id: externalTaskId,
    })
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
    if (!res.ok) return { status: 'POLL_ERROR' }

    const json = (await res.json()) as {
      code: number
      data?: { status?: string; video_url?: string }
      message?: string
    }

    if (json.code !== 10000) {
      // Non-retryable errors
      if ([50411, 50412, 50413, 50514].includes(json.code)) {
        return { status: 'FAILURE', failReason: `审核未通过 (${json.code}): ${json.message}` }
      }
      return { status: 'POLL_ERROR' }
    }

    const taskStatus = json.data?.status
    if (taskStatus === 'done') {
      if (json.data?.video_url) return { status: 'SUCCESS', videoUrl: json.data.video_url }
      return { status: 'FAILURE', failReason: 'Task done but no video_url returned' }
    }
    if (taskStatus === 'not_found' || taskStatus === 'expired') {
      return { status: 'FAILURE', failReason: `任务状态: ${taskStatus}` }
    }
    // pre_processing, in_queue, generating
    return { status: 'IN_PROGRESS' }
  } catch {
    return { status: 'POLL_ERROR' }
  } finally {
    clearTimeout(timer)
  }
}

async function handleAvatarSuccess(task: AvatarTaskRow, videoUrl: string): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = task

  await db.transaction().execute(async (trx: any) => {
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({ status: 'completed', credits_cost: estimatedCredits, completed_at: new Date().toISOString() })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()

    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) return

    await trx.insertInto('assets').values({
      task_id: taskId, batch_id: batchId, user_id: userId,
      type: 'video', original_url: videoUrl, transfer_status: 'pending',
    }).execute()

    await trx.updateTable('credit_accounts').set({
      frozen_credits: sql`frozen_credits - ${estimatedCredits}`,
      total_spent: sql`total_spent + ${estimatedCredits}`,
      balance: sql`balance - ${estimatedCredits}`,
    }).where('id', '=', creditAccountId).execute()

    await trx.insertInto('credits_ledger').values({
      credit_account_id: creditAccountId, user_id: userId,
      amount: -estimatedCredits, type: 'confirm',
      task_id: taskId, batch_id: batchId,
      description: 'Avatar generation confirmed',
    }).execute()

    await trx.updateTable('task_batches').set({
      status: 'completed',
      completed_count: sql`completed_count + 1`,
      actual_credits: sql`actual_credits + ${estimatedCredits}`,
    }).where('id', '=', batchId).execute()
  })

  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))

  const assetRow = await db.selectFrom('assets').select('id').where('task_id', '=', taskId).executeTakeFirst()
  if (assetRow) {
    await getTransferQueue().add('transfer', { taskId, assetId: assetRow.id, originalUrl: videoUrl, assetType: 'video' }, {
      attempts: 10,
      backoff: { type: 'exponential', delay: 30_000 },
    })
  }

  logger.info({ taskId, batchId, videoUrl }, 'Avatar task completed')
}

async function handleAvatarFailure(task: AvatarTaskRow, errorMessage: string): Promise<void> {
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

    await trx.updateTable('credit_accounts').set({ frozen_credits: sql`frozen_credits - ${estimatedCredits}` }).where('id', '=', creditAccountId).execute()
    await trx.updateTable('team_members').set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()
    await trx.insertInto('credits_ledger').values({
      credit_account_id: creditAccountId, user_id: userId,
      amount: estimatedCredits, type: 'refund',
      task_id: taskId, batch_id: batchId,
      description: `Avatar generation failed: ${errorMessage.slice(0, 200)}`,
    }).execute()
    await trx.updateTable('task_batches').set({ status: 'failed', failed_count: sql`failed_count + 1` }).where('id', '=', batchId).execute()
  })

  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
  logger.warn({ taskId, batchId, errorMessage }, 'Avatar task failed')
}

async function pollAvatarTasks(): Promise<void> {
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
    ])
    .where('tasks.status', '=', 'processing')
    .where('task_batches.module', '=', 'avatar' as any)
    .where('tasks.external_task_id', 'is not', null)
    .execute() as AvatarTaskRow[]

  if (tasks.length === 0) return
  logger.debug({ count: tasks.length }, 'Polling avatar tasks')

  for (const task of tasks) {
    try {
      const ageMs = task.processingStartedAt
        ? Date.now() - new Date(task.processingStartedAt).getTime()
        : MAX_AVATAR_AGE_MS + 1

      if (ageMs > MAX_AVATAR_AGE_MS) {
        await handleAvatarFailure(task, '数字人生成超时（20分钟），请重新提交')
        continue
      }

      const result = await checkAvatarTask(task.externalTaskId)

      if (result.status === 'SUCCESS' && result.videoUrl) {
        pollErrorCounts.delete(task.taskId)
        await handleAvatarSuccess(task, result.videoUrl)
      } else if (result.status === 'FAILURE') {
        pollErrorCounts.delete(task.taskId)
        await handleAvatarFailure(task, result.failReason ?? '数字人生成失败')
      } else if (result.status === 'POLL_ERROR') {
        const count = (pollErrorCounts.get(task.taskId) ?? 0) + 1
        pollErrorCounts.set(task.taskId, count)
        if (count >= MAX_CONSECUTIVE_POLL_ERRORS) {
          pollErrorCounts.delete(task.taskId)
          await handleAvatarFailure(task, '生成过程中出现异常，请重新发起请求')
        }
      } else {
        pollErrorCounts.delete(task.taskId)
      }
    } catch (err) {
      logger.error({ taskId: task.taskId, err }, 'Error processing avatar task')
    }
  }
}

export function startAvatarPoller(): NodeJS.Timeout {
  const POLL_INTERVAL = 15_000

  setTimeout(() => {
    pollAvatarTasks().catch((err) => logger.error({ err }, 'Avatar poller error'))
  }, 30_000)

  const timer = setInterval(() => {
    pollAvatarTasks().catch((err) => logger.error({ err }, 'Avatar poller error'))
  }, POLL_INTERVAL)

  logger.info('Avatar poller started (every 15 seconds)')
  return timer
}
