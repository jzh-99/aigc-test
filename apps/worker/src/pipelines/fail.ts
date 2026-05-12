import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { GenerationJobData } from '@aigc/types'
import { getPubRedis } from '../lib/redis.js'

export async function failPipeline(
  jobData: GenerationJobData,
  errorMessage: string,
): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = jobData

  await db.transaction().execute(async (trx: any) => {
    // 先对 task 行加行锁，防止 timeout-guardian 与正常失败流程并发执行时
    // 两者同时读到旧状态，导致 frozen_credits 被重复扣减
    const taskLock = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE
    `.execute(trx)

    const currentStatus = (taskLock.rows as Array<{ status: string }>)[0]?.status
    if (currentStatus === 'completed' || currentStatus === 'failed') {
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

    // 1. 退还冻结积分：frozen -= estimatedCredits，balance 不变（从未从 balance 扣除）
    // 用 GREATEST 兜底：防止积分从未被冻结（或冻结步骤失败）时 frozen 变为负数
    // 若 frozen < estimatedCredits，只退实际有的部分，避免约束报错导致事务回滚死循环
    await trx
      .updateTable('credit_accounts')
      .set({
        frozen_credits: sql`GREATEST(frozen_credits - ${estimatedCredits}, 0)`,
      })
      .where('id', '=', creditAccountId)
      .execute()

    // Decrement member usage
    await trx
      .updateTable('team_members')
      .set({
        credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)`,
      })
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .execute()

    // Insert ledger entry for refund
    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: estimatedCredits,
        type: 'refund',
        task_id: taskId,
        batch_id: batchId,
        description: `Image generation failed: ${errorMessage.slice(0, 200)}`,
      })
      .execute()

    // 2. Update batch counts + check terminal (with row lock)
    await trx
      .updateTable('task_batches')
      .set({
        failed_count: sql`failed_count + 1`,
      })
      .where('id', '=', batchId)
      .execute()

    const batch = await sql`
      SELECT quantity, completed_count, failed_count, status
      FROM task_batches WHERE id = ${batchId} FOR UPDATE
    `.execute(trx)
    const batchRow = (batch.rows as any[])[0]

    const totalDone = batchRow.completed_count + batchRow.failed_count

    // #7: If batch is still 'pending' and this is the first finished task, mark processing
    if (batchRow.status === 'pending' && totalDone === 1) {
      await trx
        .updateTable('task_batches')
        .set({ status: 'processing' })
        .where('id', '=', batchId)
        .execute()
    }

    if (totalDone >= batchRow.quantity) {
      const batchStatus = batchRow.completed_count === 0
        ? 'failed'
        : 'partial_complete'
      await trx
        .updateTable('task_batches')
        .set({ status: batchStatus })
        .where('id', '=', batchId)
        .execute()
    }
  })

  // 3. Publish SSE event
  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
}
