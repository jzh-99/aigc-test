import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { purgeCanvasProject } from '../../lib/project-purge.js'

// DELETE /canvases/:id/permanent — 永久删除画布（从回收站彻底清除）
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>('/canvases/:id/permanent', async (request, reply) => {
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
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权永久删除该画布' } })
    }

    await purgeCanvasProject(db, request.params.id)
    return reply.send({ success: true })
  })
}

export default route
