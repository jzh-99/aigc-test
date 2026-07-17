import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasAccess } from './_shared.js'

// GET /canvas-agent/sessions/:canvasId — 获取画布 Agent 会话
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { canvasId: string } }>('/canvas-agent/sessions/:canvasId', async (request, reply) => {
    const { canvasId } = request.params
    const userId = request.user.id
    const hasAccess = await assertCanvasAccess(canvasId, userId)
    if (!hasAccess) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const session = await getDb()
      .selectFrom('canvas_agent_sessions')
      .select('session')
      .where('canvas_id', '=', canvasId)
      .executeTakeFirst()

    return reply.send({ success: true, session: session?.session ?? null })
  })
}

export default route
