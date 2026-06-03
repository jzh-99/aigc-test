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

        if (module === 'image') {
          try {
            const changed = await syncImageBatch(db, state, batch)
            if (changed) syncedCount++
          } catch (err) {
            app.log.warn({ err, batchId: batch.id }, 'Failed to sync image batch, skipping')
          }
          continue
        }

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
        if (targetAsset.status !== 'completed' || targetAsset.imageUrl !== imageUrl) {
          targetAsset.imageUrl = imageUrl
          targetAsset.status = 'completed'
          targetAsset.updatedAt = new Date().toISOString()
          changed = true
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

  // 只有当前片段绑定的最新视频任务可以回写；避免导出轮询时历史 video batch 覆盖片段视频。
  if (segment.videoBatchId && segment.videoBatchId !== batch.id) return false

  // 旧数据没有 videoBatchId 时，只允许补齐缺失视频；已经完成且有 URL 的片段不再被历史 batch 重写。
  if (!segment.videoBatchId && segment.status === 'completed' && segment.videoUrl) return false

  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .execute()

  const task = tasks[0]
  if (!task) return false

  let changed = false

  if (task.status === 'pending' || task.status === 'processing') {
    const nextStatus = task.status === 'processing' ? 'generating' : 'pending'
    if (
      segment.status !== 'completed' &&
      segment.status !== 'failed' &&
      (segment.status !== nextStatus || segment.videoBatchId !== batch.id || segment.videoTaskId !== task.id)
    ) {
      segment.status = nextStatus
      segment.videoBatchId = batch.id
      segment.videoTaskId = task.id
      episode.updatedAt = new Date().toISOString()
      changed = true
    }
  } else if (task.status === 'completed') {
    // 查找视频产出
    const assetRecord = await db
      .selectFrom('assets')
      .select(['storage_url', 'original_url'])
      .where('task_id', '=', task.id)
      .executeTakeFirst()

    if (assetRecord) {
      const newVideoUrl = assetRecord.storage_url ?? assetRecord.original_url ?? null
      // 只有当数据真的变化时才标记为 changed，避免无效更新
      if (segment.videoUrl !== newVideoUrl || segment.status !== 'completed') {
        segment.videoUrl = newVideoUrl
        segment.status = 'completed'
        segment.videoBatchId = batch.id
        segment.videoTaskId = task.id
        episode.updatedAt = new Date().toISOString()
        changed = true
      }
    }
  } else if (task.status === 'failed') {
    if (segment.status !== 'failed') {
      segment.status = 'failed'
      segment.videoBatchId = batch.id
      segment.videoTaskId = task.id
      episode.updatedAt = new Date().toISOString()
      changed = true
    }
  }

  if (changed) {
    const hasGenerating = episode.segments.some(
      (s: any) => s.status === 'pending' || s.status === 'generating'
    )
    const allDone = episode.segments.every(
      (s: any) => s.status === 'completed' || s.status === 'failed'
    )
    if (hasGenerating) {
      episode.status = 'generating'
    } else if (allDone) {
      const allCompleted = episode.segments.every((s: any) => s.status === 'completed')
      episode.status = allCompleted ? 'completed' : 'failed'
    } else {
      episode.status = 'idle'
    }

    const allEpisodesCompleted = state.episodes.items.length > 0 &&
      state.episodes.items.every((ep: any) => ep.status === 'completed')
    const hasEpisodeGenerating = state.episodes.items.some(
      (ep: any) => ep.status === 'generating' || ep.segments.some((s: any) => s.status === 'pending' || s.status === 'generating')
    )
    const hasEpisodeFailed = state.episodes.items.some((ep: any) => ep.status === 'failed')
    state.episodes.status = allEpisodesCompleted
      ? 'completed'
      : hasEpisodeGenerating
        ? 'generating'
        : hasEpisodeFailed
          ? 'failed'
          : state.episodes.status
  }

  return changed
}
