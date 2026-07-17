import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { readShortDramaProjectState } from './_shared.js'
import { saveShortDramaProjectState } from './_text-generation.js'
import { resetShortDramaTextTaskState, TEXT_TASK_STUCK_THRESHOLD_MS } from './_text-task.js'

/**
 * 进程启动时扫描所有僵死的 text 任务并重置。
 *
 * 背景：文本生成由 API 同步执行，进程在生成中途重启会留下 status=processing 且
 * updated_at 不再刷新的 task_batches(text) 记录，对应 state 字段也卡在 generating。
 * /sync 只查"用户当前打开的项目"，启动扫描补齐"用户未打开的项目"。
 *
 * 判定：module='text' AND status='processing' AND updated_at < now()-10min（心跳超时）。
 * 重置：复用 resetShortDramaTextTaskState（先检查"已有结果"避免覆盖），重置后标记 batch failed；
 *       若已有结果但 batch 仍 processing（进程死前没更新 batch）→ 补标 completed。
 */
export async function scanAndResetStuckShortDramaTextTasks(app: FastifyInstance): Promise<number> {
  const db = getDb()
  const stuckBatches = await db
    .selectFrom('task_batches')
    .selectAll()
    .where('module', '=', 'text')
    .where('status', '=', 'processing')
    .where('updated_at', '<', new Date(Date.now() - TEXT_TASK_STUCK_THRESHOLD_MS))
    .execute()

  let resetCount = 0
  for (const batch of stuckBatches) {
    if (!batch.short_drama_project_id) continue
    try {
      const state = await readShortDramaProjectState(batch.short_drama_project_id)
      const params = typeof batch.params === 'string' ? JSON.parse(batch.params) : batch.params
      const changed = resetShortDramaTextTaskState(
        state,
        params.textType,
        params.episodeNumber ?? undefined,
      )
      if (changed) {
        await saveShortDramaProjectState(batch.short_drama_project_id, state, 0)
        await db
          .updateTable('task_batches')
          .set({ status: 'failed', failed_count: 1 })
          .where('id', '=', batch.id)
          .execute()
        resetCount++
      } else {
        await db
          .updateTable('task_batches')
          .set({ status: 'completed', completed_count: 1 })
          .where('id', '=', batch.id)
          .execute()
      }
    } catch (err) {
      app.log.warn({ err, batchId: batch.id }, '启动扫描重置僵死文本任务失败，跳过')
    }
  }
  return resetCount
}
