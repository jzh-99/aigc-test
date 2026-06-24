import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { Queue } from 'bullmq'
import type { GenerationJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

let _transferQueue: Queue | null = null
function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getBullMQConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _transferQueue
}

export async function completePipeline(
  jobData: GenerationJobData,
  outputUrl: string,
  actualCredits: number,
): Promise<void> {
  // #9: Validate actualCredits
  if (actualCredits < 0) actualCredits = 0
  if (actualCredits > jobData.estimatedCredits * 3) actualCredits = jobData.estimatedCredits

  const db = getDb()
  const { taskId, batchId, userId, teamId, creditAccountId, estimatedCredits } = jobData

  const assetId = await db.transaction().execute<string>(async (trx: any) => {
    logger.info({ taskId, batchId }, '开始执行完成管线')

    // 1. Insert asset row
    const assetResult = await trx
      .insertInto('assets')
      .values({
        task_id: taskId,
        batch_id: batchId,
        user_id: userId,
        type: 'image',
        original_url: outputUrl,
        transfer_status: 'pending',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    logger.info({ assetId: assetResult.id, taskId }, '资产记录已创建')

    // 2. Confirm credits: frozen -= estimated, balance -= actual, total_spent += actual
    await trx
      .updateTable('credit_accounts')
      .set({
        frozen_credits: sql`frozen_credits - ${estimatedCredits}`,
        total_spent: sql`total_spent + ${actualCredits}`,
        balance: sql`balance - ${actualCredits}`,
      })
      .where('id', '=', creditAccountId)
      .execute()

    // Adjust member credit_used if actual differs from estimated
    if (actualCredits !== estimatedCredits) {
      const delta = actualCredits - estimatedCredits
      await trx
        .updateTable('team_members')
        .set({
          credit_used: sql`credit_used + ${delta}`,
        })
        .where('team_id', '=', teamId)
        .where('user_id', '=', userId)
        .execute()
    }

    // 3. Insert ledger entry for confirm
    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: -actualCredits,
        type: 'confirm',
        task_id: taskId,
        batch_id: batchId,
        description: '图片生成成功',
      })
      .execute()

    // 4. Update task status (idempotent — skip if already completed)
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

    // If no rows updated, task was already processed — skip remaining
    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) {
      logger.warn({ taskId, batchId }, '任务已处理，跳过后续逻辑（幂等保护触发）')
      return assetResult.id
    }
    logger.info({ taskId, batchId }, '任务状态已更新为 completed')

    // 5. Update batch counts + check terminal (with row lock)
    await trx
      .updateTable('task_batches')
      .set({
        completed_count: sql`completed_count + 1`,
        actual_credits: sql`actual_credits + ${actualCredits}`,
      })
      .where('id', '=', batchId)
      .execute()

    const batch = await sql`
      SELECT quantity, completed_count, failed_count
      FROM task_batches WHERE id = ${batchId} FOR UPDATE
    `.execute(trx)
    const batchRow = (batch.rows as any[])[0]

    const totalDone = batchRow.completed_count + batchRow.failed_count
    if (totalDone >= batchRow.quantity) {
      const batchStatus = batchRow.failed_count === 0
        ? 'completed'
        : batchRow.completed_count === 0
          ? 'failed'
          : 'partial_complete'
      await trx
        .updateTable('task_batches')
        .set({ status: batchStatus })
        .where('id', '=', batchId)
        .execute()
    } else if (batchRow.completed_count === 1 && batchRow.failed_count === 0) {
      // First task completing — mark batch as processing
      await trx
        .updateTable('task_batches')
        .set({ status: 'processing' })
        .where('id', '=', batchId)
        .where('status', '=', 'pending')
        .execute()
    }

    return assetResult.id
  })

  // 6. 分发终态通知（事务外）
  // 非开放接口任务 → 保持原 SSE 通道（sse:batch:<id>），零改动
  // 开放接口任务 → 图片由 transfer.ts 转存 TOS 后发最终回调（此处留空），
  //                其余 service_type 即终态，直接走开放接口回调队列
  const oa = await db.selectFrom('task_batches')
    .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
    .where('id', '=', batchId)
    .executeTakeFirst()

  if (oa?.source === 'open_api') {
    if (oa.service_type === 'image') {
      // 图片：complete 阶段产物仍是临时 URL，需经 transfer 转 TOS 才是最终 URL，
      // 最终回调由 transfer.ts 转存成功后触发（见 transfer.ts 接入点）
      logger.info({ batchId, taskId }, '图片开放接口任务，回调交由 transfer 触发')
    } else {
      // 非图片开放接口任务：complete 即终态，直接发回调
      // media 视业务补充（song/video/news 等的产物 URL 由各自 pipeline 填充）
      await dispatchBatchResult({
        batchId,
        status: 'succeeded',
        serviceType: oa.service_type ?? 'image',
        media: {},
        businessId: oa.business_id ?? '',
        taskId: oa.task_id ?? '',
        callbackUrl: oa.callback_url,
      })
    }
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

  // 6b. Canvas output tracking: write canvas_node_outputs + increment dirty version
  if (jobData.canvasId && jobData.canvasNodeId) {
    const canvasId = jobData.canvasId
    const nodeId = jobData.canvasNodeId
    const paramsSnapshot = JSON.stringify({ prompt: jobData.prompt, model: jobData.model, params: jobData.params })

    // Deselect all previous outputs for this node, then insert new selected one
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
        output_urls: sql`ARRAY[${outputUrl}]::text[]`,
        params_snapshot: sql`${paramsSnapshot}::jsonb`,
        is_selected: true,
      })
      .execute()

    // Increment Redis dirty version so the poller detects a change
    const redis = getPubRedis()
    const dirtyKey = `canvas:dirty:${canvasId}`
    await redis.incr(dirtyKey)
    await redis.expire(dirtyKey, 60 * 60 * 24)
  }

  // 7. Enqueue transfer job
  try {
    const transferJob = await getTransferQueue().add('transfer', {
      taskId,
      batchId,
      assetId,
      originalUrl: outputUrl,
    }, {
      attempts: 10,
      backoff: { type: 'exponential', delay: 30_000 }, // 30s → 1m → 2m → ... 最大约 30m，总覆盖 ~2.5h
    })
    logger.info({ transferJobId: transferJob?.id, assetId }, '[transfer] 入队成功')
  } catch (transferErr) {
    logger.error({ err: String(transferErr), assetId }, '[transfer] 入队失败')
  }
}
