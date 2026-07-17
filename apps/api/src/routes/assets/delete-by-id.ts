import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // DELETE /assets/:id — 软删除资产
  app.delete<{ Params: { id: string } }>(
    '/assets/:id',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.user_id', 'b.workspace_id'])
        .where('a.id', '=', id)
        .where('a.is_deleted', '=', false)
        .executeTakeFirst()

      if (!asset) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '资产未找到' },
        })
      }

      // 鉴权：必须是资产所有者、工作区成员或管理员
      const isOwner = asset.user_id != null && asset.user_id === userId
      if (!isOwner && request.user.role !== 'admin') {
        if (asset.workspace_id) {
          const wsMember = await db
            .selectFrom('workspace_members')
            .select('role')
            .where('workspace_id', '=', asset.workspace_id)
            .where('user_id', '=', userId)
            .executeTakeFirst()
          if (!wsMember) {
            return reply.status(403).send({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Not authorized' },
            })
          }
        } else {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized' },
          })
        }
      }

      await db
        .updateTable('assets')
        .set({ is_deleted: true, deleted_at: new Date() })
        .where('id', '=', id)
        .execute()

      return reply.status(204).send()
    },
  )
}

export default route
