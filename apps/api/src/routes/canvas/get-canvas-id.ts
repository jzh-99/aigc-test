import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id — 加载画布（含 structure_data）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const canvas = await db
      .selectFrom('canvases')
      .selectAll()
      .where('id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    // 鉴权：必须是工作区成员
    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    return reply.send(canvas)
  })
}

export default route
