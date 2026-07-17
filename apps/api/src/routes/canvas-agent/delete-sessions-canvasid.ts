import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasAccess } from './_shared.js'

// DELETE /canvas-agent/sessions/:canvasId — 清除画布 Agent 会话
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { canvasId: string } }>('/canvas-agent/sessions/:canvasId', async (request, reply) => {
    const { canvasId } = request.params
    const userId = request.user.id
    const hasAccess = await assertCanvasAccess(canvasId, userId)
    if (!hasAccess) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    await getDb()
      .deleteFrom('canvas_agent_sessions')
      .where('canvas_id', '=', canvasId)
      .execute()

    return reply.send({ success: true })
  })
}

export default route
