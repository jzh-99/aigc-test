import { getDb } from '@aigc/db'
import { Queue } from 'bullmq'
import pino from 'pino'
import { sql } from 'kysely'
import type { GenerationJobData } from '@aigc/types'
import { failPipeline } from '../pipelines/fail.js'
import { getRedis } from '../lib/redis.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

let _imageQueue: Queue | null = null
function getImageQueue(): Queue {
  if (!_imageQueue) {
    _imageQueue = new Queue('image-queue', { connection: getRedis() })
  }
  return _imageQueue
}

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 3

export async function runTimeoutGuardian(): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - TIMEOUT_MS).toISOString()

  // Find stuck tasks: pending or processing for >5 minutes
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

    if (task.retry_count < MAX_RETRIES) {
      // #11: Optimistic lock — only update if still in expected status
      const result = await db
        .updateTable('tasks')
        .set({
          status: 'pending',
          retry_count: sql`retry_count + 1`,
          processing_started_at: null,
          queue_job_id: null,
        })
        .where('id', '=', task.taskId)
        .where('status', '=', task.status as any)
        .execute()

      // If no rows updated, task status changed concurrently — skip
      if (Number((result as any)[0]?.numUpdatedRows ?? (result as any).numUpdatedRows ?? 1) === 0) {
        logger.info({ taskId: task.taskId }, 'Task status changed concurrently, skipping retry')
        continue
      }

      logger.info({ taskId: task.taskId, retry: task.retry_count + 1 }, 'Retrying stuck task')

      // Remove old BullMQ job if exists
      if (task.queue_job_id) {
        try {
          const oldJob = await getImageQueue().getJob(task.queue_job_id)
          if (oldJob) await oldJob.remove()
        } catch {
          // Ignore removal errors
        }
      }

      // Re-enqueue
      await getImageQueue().add('generate', jobData)
    } else {
      // Max retries exceeded — fail (with error handling to prevent credit leaks)
      logger.warn({ taskId: task.taskId, retries: task.retry_count }, 'Task exceeded max retries, failing')
      try {
        await failPipeline(jobData, `Task timed out after ${MAX_RETRIES} retries`)
      } catch (err) {
        logger.error({ taskId: task.taskId, error: err }, 'failPipeline threw during timeout handling — credits may be frozen')
      }
    }
  }
}
