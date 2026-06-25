import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { ErrorCode } from '@aigc/types'
import type { GenerationJobData } from '@aigc/types'
import { getPubRedis } from '../lib/redis.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { buildCreationResultOutboxPayload, enqueueCreationResultOutbox } from '../lib/biz-mgmt-result-outbox.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

export async function failPipeline(
  jobData: GenerationJobData,
  errorMessage: string,
): Promise<void> {
  const db = getDb()
  const { taskId, batchId, userId, teamId, estimatedCredits } = jobData
  logger.info({ taskId, batchId, errorMessage }, '开始执行失败管线')

  await db.transaction().execute(async (trx: any) => {
    // 先对 task 行加行锁，防止 timeout-guardian 与正常失败流程并发执行
    const taskLock = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE
    `.execute(trx)

    const currentStatus = (taskLock.rows as Array<{ status: string }>)[0]?.status
    if (currentStatus === 'completed' || currentStatus === 'failed') {
      logger.warn({ taskId, batchId, currentStatus }, '任务已处理，跳过（幂等保护触发）')
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

    // 业管化后本地不再维护积分：移除 credit_accounts/credits_ledger/team_members 退还操作。
    // 业管 A 豆退款由创作结果 outbox(success=false) 通知业管处理。

    // Update batch counts + check terminal (with row lock)
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

  // 业管身份任务：写创作结果 outbox(success=false)，由 biz-mgmt-notify-queue 通知业管退款
  if (jobData.bizMgmtUserId && jobData.bizMgmtDeductRequestNo) {
    try {
      await enqueueCreationResultOutbox(buildCreationResultOutboxPayload({
        localUserId: userId,
        bizMgmtUserId: jobData.bizMgmtUserId,
        teamId,
        workspaceId: jobData.workspaceId ?? null,
        batchId,
        taskId,
        taskStatus: 'failed',
        pointsNum: estimatedCredits,
        requestNo: jobData.bizMgmtDeductRequestNo,
        workNo: jobData.bizMgmtWorkNo ?? taskId,
        module: 'image',
        message: errorMessage,
      }))
    } catch (outboxErr) {
      logger.error({ err: outboxErr instanceof Error ? outboxErr.message : String(outboxErr), taskId, batchId }, 'Failed to enqueue creation result outbox (will not block failure handling)')
    }
  }

  // 3. 分发终态通知（事务外）
  // 非开放接口任务 → 保持原 SSE 通道；开放接口任务 → 走回调队列（失败语义）
  const oa = await db.selectFrom('task_batches')
    .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
    .where('id', '=', batchId)
    .executeTakeFirst()

  if (oa?.source === 'open_api') {
    // 开放接口失败：统一对外文案「不符合创作规范」，不泄漏 errorMessage 内部文本
    await dispatchBatchResult({
      batchId,
      status: 'failed',
      serviceType: oa.service_type ?? 'image',
      media: {},
      businessId: oa.business_id ?? '',
      taskId: oa.task_id ?? '',
      callbackUrl: oa.callback_url,
      failureCode: ErrorCode.SYSTEM_FAILED,
    })
  } else {
    // 非开放接口：保持现有 SSE（与改造前完全一致）
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
  }
}
