import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // POST /assets/trash/:id/restore — 恢复软删除资产
  app.post<{ Params: { id: string } }>(
    '/assets/trash/:id/restore',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.user_id', 'b.workspace_id'])
        .where('a.id', '=', id)
        .where('a.is_deleted', '=', true)
        .executeTakeFirst()

      if (!asset) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '资产不存在' } })

      if (asset.user_id !== userId && request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      }

      await db
        .updateTable('assets')
        .set({ is_deleted: false, deleted_at: null })
        .where('id', '=', id)
        .execute()

      return { success: true }
    }
  )
}

export default route
