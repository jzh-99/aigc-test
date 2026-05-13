import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { purgeVideoStudioProject, restoreProjectAssets, softDeleteProjectAssets } from '../../lib/project-purge.js'
import { assertProjectAccess } from './_shared.js'

// DELETE/POST /video-studio/projects/:id — 软删除、恢复、永久删除项目
const route: FastifyPluginAsync = async (app) => {
  // DELETE /video-studio/projects/:id — 软删除项目
  app.delete<{ Params: { id: string } }>(
    '/video-studio/projects/:id',
    async (request, reply) => {
      const db = getDb()
      const access = await assertProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: 'not found' })

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('video_studio_projects')
          .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
          .where('id', '=', request.params.id)
          .where('is_deleted', '=', false)
          .execute()
        await softDeleteProjectAssets(trx, 'video_studio_project_id', request.params.id)
      })

      return reply.send({ success: true })
    },
  )

  // POST /video-studio/projects/:id/restore — 恢复已删除项目
  app.post<{ Params: { id: string } }>('/video-studio/projects/:id/restore', async (request, reply) => {
    const db = getDb()
    const access = await assertProjectAccess(request.params.id, request.user.id, true)
    if (!access) return reply.status(404).send({ error: 'not found' })

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('video_studio_projects')
        .set({ is_deleted: false, deleted_at: null, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', true)
        .execute()
      await restoreProjectAssets(trx, 'video_studio_project_id', request.params.id)
    })

    return reply.send({ success: true })
  })

  // DELETE /video-studio/projects/:id/permanent — 永久删除项目
  app.delete<{ Params: { id: string } }>('/video-studio/projects/:id/permanent', async (request, reply) => {
    const db = getDb()
    const access = await assertProjectAccess(request.params.id, request.user.id, true)
    if (!access) return reply.status(404).send({ error: 'not found' })

    await purgeVideoStudioProject(db, request.params.id)
    return reply.send({ success: true })
  })
}

export default route
