import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { Queue } from 'bullmq'
import type { GenerationJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

let _transferQueue: Queue | null = null
function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getBullMQConnection() })
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
        description: 'Image generation confirmed',
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
      return assetResult.id
    }

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

  // 6. Publish SSE event (outside transaction)
  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))

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
