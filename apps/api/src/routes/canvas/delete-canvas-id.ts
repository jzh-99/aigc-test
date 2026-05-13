import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { softDeleteProjectAssets } from '../../lib/project-purge.js'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// DELETE /canvases/:id — 软删除画布（仅创建者或工作区管理员可操作）
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const canvas = await db
      .selectFrom('canvases')
      .select(['workspace_id', 'user_id'])
      .where('id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    // 只有创建者或工作区管理员可以删除
    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member || (canvas.user_id !== request.user.id && member.role !== 'admin')) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权删除该画布' } })
    }

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('canvases')
        .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .execute()
      await softDeleteProjectAssets(trx, 'canvas_id', request.params.id)
    })
    return reply.send({ success: true })
  })
}

export default route
