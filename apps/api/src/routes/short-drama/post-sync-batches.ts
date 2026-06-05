import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { releaseRedisLock } from '../../lib/distributed-lock.js'
import {
  acquireShortDramaProjectStateLock,
  applyShortDramaImageBatchSync,
  assertShortDramaProjectAccess,
  readShortDramaProjectState,
  syncShortDramaSegmentsFromState,
  type ShortDramaImageTaskRow,
} from './_shared.js'

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
      const db = getDb()

      const syncLock = await acquireShortDramaProjectStateLock(app.redis, projectId)
      if (!syncLock) {
        return reply.status(409).send({
          success: false,
          error: { code: 'STATE_LOCKED', message: '项目状态正在更新，请稍后重试' },
        })
      }

      try {
      const state = await readShortDramaProjectState(projectId)

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
        await syncShortDramaSegmentsFromState(project.id, state)
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
      } finally {
        await releaseRedisLock(app.redis, syncLock)
      }
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

  const assetIdMap = readAssetIdMap(batch)

  // 收集 completed task 的 storage_url：仅在 transfer 完成、文件落到 TOS 后才有值。
  // 故意不再退回 original_url —— AI 提供商的临时 CDN 地址会过期/跨域失败，
  // 写入会出现「已准备好但预览不可用」。transfer 未完成时让前端继续显示「生成中」。
  const completedTaskIds = tasks.filter(t => t.status === 'completed').map(t => t.id)
  const assetRows = completedTaskIds.length > 0
    ? await db
        .selectFrom('assets')
        .select(['task_id', 'storage_url'])
        .where('task_id', 'in', completedTaskIds)
        .execute()
    : []
  const storageUrlByTaskId = new Map<string, string | null>()
  for (const row of assetRows) {
    storageUrlByTaskId.set(row.task_id, row.storage_url ?? null)
  }

  const taskRows: ShortDramaImageTaskRow[] = tasks.map(task => ({
    taskId: task.id,
    versionIndex: task.version_index,
    status: String(task.status),
    storageUrl: task.status === 'completed' ? storageUrlByTaskId.get(task.id) ?? null : null,
  }))

  return applyShortDramaImageBatchSync(state, assetIdMap, taskRows)
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
