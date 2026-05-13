import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // DELETE /assets/trash/:id — 永久删除资产
  app.delete<{ Params: { id: string } }>(
    '/assets/trash/:id',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets')
        .select(['id', 'user_id'])
        .where('id', '=', id)
        .where('is_deleted', '=', true)
        .executeTakeFirst()

      if (!asset) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '资产不存在' } })

      if (asset.user_id !== userId && request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      }

      await db.deleteFrom('assets').where('id', '=', id).execute()

      return reply.status(204).send()
    }
  )
}

export default route
