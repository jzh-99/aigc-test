import { getDb } from '@aigc/db'
import { signAssetUrl } from './storage.js'

/**
 * 获取批次快照（含任务列表和资产信息）
 * @param batchId 批次 ID
 * @returns 批次快照对象，不存在时返回 null
 */
export async function getBatchSnapshot(batchId: string) {
  const db = getDb()

  const batch = await db
    .selectFrom('task_batches')
    .selectAll()
    .where('id', '=', batchId)
    .executeTakeFirst()

  if (!batch) return null

  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute()

  const assets = await db
    .selectFrom('assets')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute()

  // 以 task_id 为 key 建立资产映射，方便 O(1) 查找
  const assetByTask: Map<string, any> = new Map(assets.map((a: any) => [a.task_id, a]))

  return {
    id: batch.id,
    module: batch.module,
    provider: batch.provider,
    model: batch.model,
    prompt: batch.prompt,
    params: batch.params,
    quantity: batch.quantity,
    completed_count: batch.completed_count,
    failed_count: batch.failed_count,
    status: batch.status,
    estimated_credits: batch.estimated_credits,
    actual_credits: batch.actual_credits,
    created_at: batch.created_at.toISOString?.() ?? String(batch.created_at),
    tasks: await Promise.all(tasks.map(async (t: any) => {
      const asset = assetByTask.get(t.id)
      return {
        id: t.id,
        version_index: t.version_index,
        status: t.status,
        estimated_credits: t.estimated_credits,
        credits_cost: t.credits_cost,
        error_message: t.error_message,
        processing_started_at: t.processing_started_at?.toISOString?.() ?? t.processing_started_at ?? null,
        completed_at: t.completed_at?.toISOString?.() ?? t.completed_at ?? null,
        asset: asset
          ? {
              id: asset.id,
              type: asset.type,
              original_url: asset.original_url,
              // storage_url 为空（transfer 未完成）时用 original_url 兜底，确保前端能立即展示图片
              storage_url: (await signAssetUrl(asset.storage_url)) ?? asset.original_url ?? null,
              transfer_status: asset.transfer_status,
              file_size: asset.file_size,
              width: asset.width,
              height: asset.height,
            }
          : null,
      }
    })),
  }
}

/**
 * 判断批次状态是否为终态（不再变化）
 * @param status 批次状态字符串
 */
export function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'partial_complete'
}
