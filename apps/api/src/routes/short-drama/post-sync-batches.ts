import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { assertShortDramaProjectAccess } from './_shared.js'

const SYNCABLE_BATCH_STATUSES = ['pending', 'processing', 'completed', 'partial_complete', 'failed'] as const

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

      // 查询该项目所有可同步的 batch，按创建时间倒序，确保最新的 batch 最后处理
      const batches = await db
        .selectFrom('task_batches')
        .selectAll()
        .where('short_drama_project_id', '=', projectId)
        .where('status', 'in', SYNCABLE_BATCH_STATUSES)
        .orderBy('created_at', 'asc') // 旧的先处理，新的后处理，确保新数据覆盖旧数据
        .execute()

      if (batches.length === 0) {
        return reply.send({ success: true, synced: 0, state })
      }

      let syncedCount = 0

      for (const batch of batches) {
        const module = batch.module
        const batchStatus = batch.status

        if (module === 'image') {
          try {
            const changed = await syncImageBatch(db, state, batch)
            if (changed) syncedCount++
          } catch (err) {
            app.log.warn({ err, batchId: batch.id }, 'Failed to sync image batch, skipping')
          }
          continue
        }

        if (batchStatus !== 'completed' && batchStatus !== 'partial_complete' && batchStatus !== 'failed') continue

        try {
          if (module === 'video') {
            const changed = await syncVideoBatch(db, state, batch)
            if (changed) syncedCount++
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

async function syncImageBatch(
  db: ReturnType<typeof getDb>,
  state: any,
  batch: any
): Promise<boolean> {
  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .execute()

  // 从 batch.params 中读取 assetIdMap 映射
  const assetIdMap = readAssetIdMap(batch)
  let changed = false

  for (const task of tasks) {
    // 通过 assetIdMap 精确匹配 assetId
    const mapping = assetIdMap.find(m => m.versionIndex === task.version_index)
    if (!mapping) continue

    const targetAsset = state.assets.items.find((a: any) => a.id === mapping.assetId)
    if (!targetAsset) continue

    if (task.status === 'completed') {
      const assetRecord = await db
        .selectFrom('assets')
        .select(['storage_url', 'original_url'])
        .where('task_id', '=', task.id)
        .executeTakeFirst()

      if (assetRecord) {
        const imageUrl = assetRecord.storage_url ?? assetRecord.original_url ?? null
        // 始终更新状态和时间戳，确保前端能通过 updatedAt 变化刷新图片缓存
        // 由于 batch 按创建时间升序处理，最新的 batch 会最后执行
        if (targetAsset.status !== 'completed' || targetAsset.imageUrl !== imageUrl) {
          targetAsset.imageUrl = imageUrl
          targetAsset.status = 'completed'
          targetAsset.updatedAt = new Date().toISOString()
          changed = true
        } else if (targetAsset.status === 'completed') {
          // 即使 URL 相同，也更新时间戳，让前端能通过 ?t= 参数刷新缓存
          const currentUpdatedAt = new Date(targetAsset.updatedAt).getTime()
          const newUpdatedAt = new Date().toISOString()
          // 只有当时间戳真的不同时才更新（避免同一次 sync 中重复更新）
          if (new Date(newUpdatedAt).getTime() > currentUpdatedAt) {
            targetAsset.updatedAt = newUpdatedAt
            changed = true
          }
        }
      }
    } else if (task.status === 'failed') {
      if (targetAsset.status !== 'completed' && targetAsset.status !== 'failed') {
        targetAsset.status = 'failed'
        targetAsset.updatedAt = new Date().toISOString()
        changed = true
      }
    } else {
      const nextStatus = task.status === 'processing' ? 'generating' : 'pending'
      if (targetAsset.status !== 'completed' && targetAsset.status !== 'failed' && targetAsset.status !== nextStatus) {
        targetAsset.status = nextStatus
        targetAsset.updatedAt = new Date().toISOString()
        changed = true
      }
    }
  }

  const requiredAssets = state.assets.items.filter((asset: any) => asset.kind === 'character' || asset.kind === 'scene')
  const hasPendingAsset = requiredAssets.some((asset: any) => asset.status === 'pending' || asset.status === 'generating')
  const hasFailedAsset = requiredAssets.some((asset: any) => asset.status === 'failed')
  const allAssetsReady = requiredAssets.length > 0 && requiredAssets.every(
    (asset: any) => asset.status === 'completed' && !!asset.imageUrl
  )
  const nextAssetsStatus = allAssetsReady
    ? 'completed'
    : hasPendingAsset
      ? 'generating'
      : hasFailedAsset
        ? 'failed'
        : 'idle'

  if (state.assets.status !== nextAssetsStatus) {
    state.assets.status = nextAssetsStatus
    changed = true
  }

  return changed
}

async function syncVideoBatch(
  db: ReturnType<typeof getDb>,
  state: any,
  batch: any
): Promise<boolean> {
  const episodeId = batch.short_drama_episode_id
  const segmentId = batch.short_drama_segment_id

  if (!episodeId || !segmentId) return false

  const episodeNumber = parseInt(episodeId, 10)
  const episode = state.episodes.items.find(
    (ep: any) => ep.episodeNumber === episodeNumber
  )
  if (!episode) return false

  const segment = episode.segments.find((s: any) => s.id === segmentId)
  if (!segment) return false

  // 已完成/失败的 segment 不重复覆盖
  if (segment.status === 'completed' || segment.status === 'failed') return false

  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .execute()

  const task = tasks[0]
  if (!task) return false

  let changed = false

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
      changed = true
    }
  } else if (task.status === 'failed') {
    segment.status = 'failed'
    changed = true
  }

  // 检查 episode 所有 segment 是否都完成
  if (changed) {
    const allDone = episode.segments.every(
      (s: any) => s.status === 'completed' || s.status === 'failed'
    )
    if (allDone) {
      const allCompleted = episode.segments.every((s: any) => s.status === 'completed')
      episode.status = allCompleted ? 'completed' : 'failed'
      episode.updatedAt = new Date().toISOString()
    }
  }

  return changed
}
