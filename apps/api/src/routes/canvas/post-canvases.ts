import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { resolveCanvasWorkspaceForUser } from './_shared.js'

// POST /canvases — 创建新画布
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { name?: string; workspace_id?: string } }>('/canvases', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const { name = '未命名画布', workspace_id } = request.body ?? {}

    const wsId = await resolveCanvasWorkspaceForUser(db, userId, workspace_id)
    if (!wsId) {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    const canvas = await db
      .insertInto('canvases')
      .values({
        workspace_id: wsId,
        user_id: userId,
        name,
        structure_data: JSON.stringify({ nodes: [], edges: [] }),
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return reply.status(201).send(canvas)
  })
}

export default route
