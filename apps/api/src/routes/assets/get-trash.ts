import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /assets/trash — 列出工作区软删除资产（7 天内）
  app.get<{ Querystring: { workspace_id?: string } }>(
    '/assets/trash',
    async (request, reply) => {
      const db = getDb()
      const { workspace_id } = request.query
      const userId = request.user.id

      if (!workspace_id) return reply.badRequest('workspace_id is required')

      if (request.user.role !== 'admin') {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', workspace_id)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!wsMember) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' } })
      }

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const assets = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.deleted_at', 'b.prompt'])
        .where('b.workspace_id', '=', workspace_id)
        .where('a.is_deleted', '=', true)
        .where('a.deleted_at', '>=', cutoff as any)
        .orderBy('a.deleted_at', 'desc')
        .execute()

      const signed = await Promise.all(
        assets.map(async (a: any) => ({
          id: a.id,
          type: a.type,
          storage_url: a.storage_url ? await signAssetUrl(a.storage_url) : null,
          original_url: a.original_url ?? null,
          deleted_at: a.deleted_at,
          prompt: a.prompt,
        }))
      )

      return { data: signed }
    }
  )
}

export default route
