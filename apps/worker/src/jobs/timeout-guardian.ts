import { getDb } from '@aigc/db'
import { Queue } from 'bullmq'
import pino_ from 'pino'
import { sql } from 'kysely'
import type { GenerationJobData } from '@aigc/types'
import { failPipeline } from '../pipelines/fail.js'
import { getRedis } from '../lib/redis.js'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

let _imageQueue: Queue | null = null
function getImageQueue(): Queue {
  if (!_imageQueue) {
    _imageQueue = new Queue('image-queue', { connection: getRedis() })
  }
  return _imageQueue
}

const TIMEOUT_MS = 6 * 60 * 1000 // 6 minutes (slightly longer than API timeout to allow completion)
const MAX_RETRIES = 0 // Disabled: no retries, fail immediately on timeout

export async function runTimeoutGuardian(): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - TIMEOUT_MS).toISOString()

  // Find stuck tasks: pending or processing for >6 minutes
  const stuckTasks = await db
    .selectFrom('tasks')
    .innerJoin('task_batches', 'task_batches.id', 'tasks.batch_id')
    .select([
      'tasks.id as taskId',
      'tasks.batch_id as batchId',
      'tasks.user_id as userId',
      'tasks.retry_count',
      'tasks.estimated_credits',
      'tasks.queue_job_id',
      'tasks.status',
      'task_batches.provider',
      'task_batches.model',
      'task_batches.module as module',
      'task_batches.prompt',
      'task_batches.params',
      'task_batches.team_id as teamId',
      'task_batches.credit_account_id as creditAccountId',
    ])
    .where((eb: any) =>
      eb.or([
        // Pending tasks: use batch created_at as reference
        eb.and([
          eb('tasks.status', '=', 'pending'),
          eb('task_batches.created_at', '<', cutoff),
        ]),
        // Processing tasks: use processing_started_at
        eb.and([
          eb('tasks.status', '=', 'processing'),
          eb('tasks.processing_started_at', '<', cutoff),
        ]),
      ]),
    )
    .execute()

  if (stuckTasks.length === 0) return

  logger.info({ count: stuckTasks.length }, 'Found stuck tasks')

  for (const task of stuckTasks) {
    // Video tasks are managed by the video poller (which has its own 15-min timeout)
    // Re-enqueueing them to imageQueue would incorrectly process them as image tasks
    if ((task as any).module === 'video') {
      logger.debug({ taskId: task.taskId }, 'Skipping video task in timeout guardian (handled by video poller)')
      continue
    }

    if (!task.teamId || !task.creditAccountId) {
      logger.warn({ taskId: task.taskId }, 'Stuck task missing teamId or creditAccountId, marking failed')
      await db
        .updateTable('tasks')
        .set({ status: 'failed', error_message: 'Missing team/credit context', completed_at: new Date().toISOString() })
        .where('id', '=', task.taskId)
        .execute()
      continue
    }

    const jobData: GenerationJobData = {
      taskId: task.taskId,
      batchId: task.batchId,
      userId: task.userId,
      teamId: task.teamId,
      creditAccountId: task.creditAccountId,
      provider: task.provider,
      model: task.model,
      prompt: task.prompt,
      params: (typeof task.params === 'string' ? JSON.parse(task.params) : task.params) as Record<string, unknown>,
      estimatedCredits: task.estimated_credits,
    }

    // No retry: directly fail stuck tasks and refund credits
    logger.warn({ taskId: task.taskId }, 'Task timed out, failing immediately (no retry)')
    try {
      await failPipeline(jobData, 'Task timed out')
    } catch (err) {
      logger.error({ taskId: task.taskId, error: err }, 'failPipeline threw during timeout handling — credits may be frozen')
    }
  }
}
