import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// DELETE /admin/trash/teams/:id — 永久删除团队及所有关联数据
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>('/admin/trash/teams/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams').select('id')
      .where('id', '=', id).where('is_deleted', '=', true).executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在或未被删除' } })

    const wsIds = (await db.selectFrom('workspaces').select('id').where('team_id', '=', id).execute()).map(w => w.id)

    if (wsIds.length > 0) {
      const batchIds = (await db.selectFrom('task_batches').select('id').where('workspace_id', 'in', wsIds).execute()).map(b => b.id)

      if (batchIds.length > 0) {
        await db.deleteFrom('assets').where('batch_id', 'in', batchIds).execute()
        await db.deleteFrom('tasks').where('batch_id', 'in', batchIds).execute()
        await db.deleteFrom('task_batches').where('id', 'in', batchIds).execute()
      }

      await db.deleteFrom('workspace_members').where('workspace_id', 'in', wsIds).execute()
      await db.deleteFrom('workspaces').where('id', 'in', wsIds).execute()
    }

    await db.deleteFrom('team_members').where('team_id', '=', id).execute()
    await db.deleteFrom('teams').where('id', '=', id).execute()

    return { success: true }
  })
}

export default route
