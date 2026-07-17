import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// POST /canvases/:id/node-outputs/:nodeId/select — 设置节点的选中输出
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string; nodeId: string }
    Body: { output_id?: string }
  }>('/canvases/:id/node-outputs/:nodeId/select', {
    config: {
      rateLimit: {
        max: 300,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id, nodeId } = request.params
    const { output_id } = request.body ?? {}

    if (!output_id) {
      return reply.badRequest('output_id is required')
    }

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权修改该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    const target = await db
      .selectFrom('canvas_node_outputs')
      .select('id')
      .where('id', '=', output_id)
      .where('canvas_id', '=', id)
      .where('node_id', '=', nodeId)
      .executeTakeFirst()

    if (!target) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '目标输出不存在' } })
    }

    // 事务：先取消所有选中，再设置目标为选中
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('canvas_node_outputs')
        .set({ is_selected: false })
        .where('canvas_id', '=', id)
        .where('node_id', '=', nodeId)
        .execute()

      await trx
        .updateTable('canvas_node_outputs')
        .set({ is_selected: true })
        .where('id', '=', output_id)
        .where('canvas_id', '=', id)
        .where('node_id', '=', nodeId)
        .execute()
    })

    return reply.send({ success: true, selected_output_id: output_id })
  })
}

export default route
