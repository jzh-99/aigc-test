import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { assertShortDramaProjectAccess } from './_shared.js'

export default async function postSyncBatches(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/short-drama/projects/:id/sync',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params
      const userId = request.user.id

      const { project } = await assertShortDramaProjectAccess(projectId, userId, false)
      const state = project.state
      const db = getDb()

      // 查询该项目所有 pending/processing/completed/failed 的 batch
      const batches = await db
        .selectFrom('task_batches')
        .selectAll()
        .where('short_drama_project_id', '=', projectId)
        .where('status', 'in', ['pending', 'processing', 'completed', 'failed'])
        .execute()

      if (batches.length === 0) {
        return reply.send({ success: true, synced: 0, state })
      }

      let syncedCount = 0

      for (const batch of batches) {
        const module = batch.module
        const batchStatus = batch.status

        if (module === 'image' && (batchStatus === 'pending' || batchStatus === 'processing')) {
          const changed = syncImageBatchProgress(state, batch)
          if (changed) syncedCount++
          continue
        }

        if (batchStatus !== 'completed' && batchStatus !== 'failed') {
          continue
        }

        try {
          if (module === 'image') {
            await syncImageBatch(db, state, batch)
            syncedCount++
          } else if (module === 'video') {
            await syncVideoBatch(db, state, batch)
            syncedCount++
          }
        } catch (err) {
          app.log.warn({ err, batchId: batch.id }, 'Failed to sync batch, skipping')
        }
      }

      if (syncedCount > 0) {
        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()
      }

      return reply.send({ success: true, synced: syncedCount, state })
    }
  )
}

function readAssetIdMap(batch: any): Array<{ versionIndex: number; assetId: string }> {
  try {
    const params = typeof batch.params === 'string' ? JSON.parse(batch.params) : batch.params
    if (Array.isArray(params?.assetIdMap)) {
      return params.assetIdMap
    }
  } catch { /* ignore parse errors */ }

  return []
}

function syncImageBatchProgress(state: any, batch: any): boolean {
  const assetIdMap = readAssetIdMap(batch)
  const nextStatus = batch.status === 'processing' ? 'generating' : 'pending'
  let changed = false

  for (const mapping of assetIdMap) {
    const targetAsset = state.assets.items.find((a: any) => a.id === mapping.assetId)
    if (!targetAsset || targetAsset.status === 'completed' || targetAsset.status === 'failed') continue

    if (targetAsset.status !== nextStatus) {
      targetAsset.status = nextStatus
      targetAsset.updatedAt = new Date().toISOString()
      changed = true
    }
  }

  return changed
}

async function syncImageBatch(
  db: ReturnType<typeof getDb>,
  state: any,
  batch: any
): Promise<void> {
  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .execute()

  // 从 batch.params 中读取 assetIdMap 映射
  const assetIdMap = readAssetIdMap(batch)

  for (const task of tasks) {
    // 通过 assetIdMap 精确匹配 assetId
    const mapping = assetIdMap.find(m => m.versionIndex === task.version_index)
    if (!mapping) continue

    const targetAsset = state.assets.items.find((a: any) => a.id === mapping.assetId)
    if (!targetAsset || (targetAsset.status !== 'pending' && targetAsset.status !== 'generating')) continue

    if (task.status === 'completed') {
      const assetRecord = await db
        .selectFrom('assets')
        .select(['storage_url', 'original_url'])
        .where('task_id', '=', task.id)
        .executeTakeFirst()

      if (assetRecord) {
        targetAsset.imageUrl = assetRecord.storage_url ?? assetRecord.original_url ?? null
        targetAsset.status = 'completed'
        targetAsset.updatedAt = new Date().toISOString()
      }
    } else if (task.status === 'failed') {
      targetAsset.status = 'failed'
      targetAsset.updatedAt = new Date().toISOString()
    }
  }
}

async function syncVideoBatch(
  db: ReturnType<typeof getDb>,
  state: any,
  batch: any
): Promise<void> {
  const episodeId = batch.short_drama_episode_id
  const segmentId = batch.short_drama_segment_id

  if (!episodeId || !segmentId) return

  const episodeNumber = parseInt(episodeId, 10)
  const episode = state.episodes.items.find(
    (ep: any) => ep.episodeNumber === episodeNumber
  )
  if (!episode) return

  const segment = episode.segments.find((s: any) => s.id === segmentId)
  if (!segment) return

  // 已完成/失败的 segment 不重复覆盖
  if (segment.status === 'completed' || segment.status === 'failed') return

  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .execute()

  const task = tasks[0]
  if (!task) return

  if (task.status === 'completed') {
    // 查找视频产出
    const assetRecord = await db
      .selectFrom('assets')
      .select(['storage_url', 'original_url'])
      .where('task_id', '=', task.id)
      .executeTakeFirst()

    if (assetRecord) {
      segment.videoUrl = assetRecord.storage_url ?? assetRecord.original_url ?? null
      segment.status = 'completed'
    }
  } else if (task.status === 'failed') {
    segment.status = 'failed'
  }

  // 检查 episode 所有 segment 是否都完成
  const allDone = episode.segments.every(
    (s: any) => s.status === 'completed' || s.status === 'failed'
  )
  if (allDone) {
    const allCompleted = episode.segments.every((s: any) => s.status === 'completed')
    episode.status = allCompleted ? 'completed' : 'failed'
    episode.updatedAt = new Date().toISOString()
  }
}
