import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // DELETE /teams/:id/workspaces/:wsId — 软删除工作区（级联软删除 task_batches）
  app.delete<{ Params: { id: string; wsId: string } }>('/teams/:id/workspaces/:wsId', {
    preHandler: teamRoleGuard('owner'),
  }, async (request, reply) => {
    const db = getDb()
    const { id: teamId, wsId } = request.params

    const workspace = await db
      .selectFrom('workspaces')
      .select(['id', 'name'])
      .where('id', '=', wsId)
      .where('team_id', '=', teamId)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!workspace) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区不存在' } })

    const now = new Date()

    // 级联软删除 task_batches
    await db
      .updateTable('task_batches')
      .set({ is_deleted: true, deleted_at: now })
      .where('workspace_id', '=', wsId)
      .where('is_deleted', '=', false)
      .execute()

    // 软删除工作区
    await db
      .updateTable('workspaces')
      .set({ is_deleted: true, deleted_at: now })
      .where('id', '=', wsId)
      .execute()

    return { success: true }
  })
}

export default route
