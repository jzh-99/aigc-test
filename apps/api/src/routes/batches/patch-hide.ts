import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // PATCH /batches/:id/hide — hide a batch from history
  app.patch<{ Params: { id: string } }>('/batches/:id/hide', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const userId = request.user.id

    const batch = await db
      .selectFrom('task_batches')
      .select(['id', 'user_id', 'workspace_id'])
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (!batch) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '记录未找到' } })

    if (batch.user_id !== userId && request.user.role !== 'admin') {
      if (batch.workspace_id) {
        const wsMember = await db.selectFrom('workspace_members').select('role')
          .where('workspace_id', '=', batch.workspace_id).where('user_id', '=', userId).executeTakeFirst()
        if (!wsMember) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      } else {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      }
    }

    await db.updateTable('task_batches').set({ is_hidden: true }).where('id', '=', id).execute()
    return { success: true }
  })
}

export default route
