import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertCanvasAccess } from './_shared.js'

// PUT /canvas-agent/sessions/:canvasId — 保存/更新画布 Agent 会话
const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { canvasId: string }
    Body: { session: unknown }
  }>('/canvas-agent/sessions/:canvasId', {
    schema: {
      body: {
        type: 'object',
        required: ['session'],
        properties: {
          session: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { canvasId } = request.params
    const userId = request.user.id
    const hasAccess = await assertCanvasAccess(canvasId, userId)
    if (!hasAccess) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    await getDb()
      .insertInto('canvas_agent_sessions')
      .values({
        canvas_id: canvasId,
        session: JSON.stringify(request.body.session),
      })
      .onConflict((oc) => oc.column('canvas_id').doUpdateSet({
        session: JSON.stringify(request.body.session) as any,
        updated_at: sql`now()`,
      }))
      .execute()

    return reply.send({ success: true })
  })
}

export default route
