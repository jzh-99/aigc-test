import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { restoreProjectAssets } from '../../lib/project-purge.js'

// POST /canvases/:id/restore — 从回收站恢复画布
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>('/canvases/:id/restore', async (request, reply) => {
    const db = getDb()
    const canvas = await db
      .selectFrom('canvases')
      .select(['workspace_id', 'user_id'])
      .where('id', '=', request.params.id)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member || (canvas.user_id !== request.user.id && member.role !== 'admin')) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权恢复该画布' } })
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('canvases')
        .set({ is_deleted: false, deleted_at: null, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .execute()
      await restoreProjectAssets(trx, 'canvas_id', request.params.id)
    })

    return reply.send({ success: true })
  })
}

export default route
