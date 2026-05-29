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
        const batchId = batch.id
        const module = batch.module
        const batchStatus = batch.status

        // 只处理已完成或失败的 batch
        if (batchStatus !== 'completed' && batchStatus !== 'failed') {
          continue
        }

        if (module === 'image') {
          // 图片素材生成 → 同步到 assets
          await syncImageBatch(db, state, batch)
          syncedCount++
        } else if (module === 'video') {
          // 视频分镜生成 → 同步到 episodes.segments
          await syncVideoBatch(db, state, batch)
          syncedCount++
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

  for (const task of tasks) {
    // 通过 task.version_index 匹配 asset
    // batch 创建时 assetIds 顺序对应 version_index
    const assets = state.assets.items

    if (task.status === 'completed') {
      // 查找对应的 asset 产出
      const assetRecord = await db
        .selectFrom('assets')
        .select(['storage_url', 'original_url'])
        .where('task_id', '=', task.id)
        .executeTakeFirst()

      if (assetRecord) {
        const imageUrl = assetRecord.storage_url ?? assetRecord.original_url ?? null
        // 根据 version_index 更新对应 asset
        const targetAsset = assets[task.version_index]
        if (targetAsset && targetAsset.status === 'pending') {
          targetAsset.imageUrl = imageUrl
          targetAsset.status = 'completed'
          targetAsset.updatedAt = new Date().toISOString()
        }
      }
    } else if (task.status === 'failed') {
      const targetAsset = assets[task.version_index]
      if (targetAsset && targetAsset.status === 'pending') {
        targetAsset.status = 'failed'
        targetAsset.updatedAt = new Date().toISOString()
      }
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
