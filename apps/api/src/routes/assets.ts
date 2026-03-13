import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../lib/storage.js'

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // GET /assets — list assets for a workspace, ordered by created_at DESC
  app.get<{ Querystring: { workspace_id?: string; type?: string; date?: string; cursor?: string; limit?: string } }>(
    '/assets',
    async (request, reply) => {
      const db = getDb()
      const { workspace_id, type, date, cursor, limit: limitStr } = request.query
      const userId = request.user.id

      if (!workspace_id) {
        return reply.badRequest('workspace_id is required')
      }

      // Verify workspace membership
      if (request.user.role !== 'admin') {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', workspace_id)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!wsMember) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' },
          })
        }
      }

      const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200)

      let decodedCursor: { created_at: string; id: string } | null = null
      if (cursor) {
        try {
          decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
        } catch {
          return reply.badRequest('Invalid cursor')
        }
      }

      let query = db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select([
          'a.id',
          'a.type',
          'a.storage_url',
          'a.original_url',
          'a.created_at',
          'b.id as batch_id',
          'b.prompt',
          'b.model',
        ])
        .where('b.workspace_id', '=', workspace_id)
        .where('a.is_deleted', '=', false)
        .where('a.transfer_status', '=', 'completed')
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(limit + 1)

      if (type) {
        query = query.where('a.type', '=', type)
      }

      // Filter by local date (YYYY-MM-DD) using UTC date of created_at
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        query = query
          .where('a.created_at', '>=', new Date(`${date}T00:00:00.000Z`) as any)
          .where('a.created_at', '<',  new Date(`${date}T24:00:00.000Z`) as any)
      }

      if (decodedCursor) {
        query = query.where((eb: any) =>
          eb.or([
            eb('a.created_at', '<', decodedCursor!.created_at),
            eb.and([
              eb('a.created_at', '=', decodedCursor!.created_at),
              eb('a.id', '<', decodedCursor!.id),
            ]),
          ]),
        )
      }

      const rows = await query.execute()

      const hasMore = rows.length > limit
      const assets = hasMore ? rows.slice(0, limit) : rows

      // Sign URLs
      const signed = await Promise.all(
        assets.map(async (a: any) => ({
          id: a.id,
          type: a.type,
          storage_url: a.storage_url ? await signAssetUrl(a.storage_url) : null,
          original_url: a.original_url ?? null,
          created_at: a.created_at.toISOString?.() ?? String(a.created_at),
          batch: { id: a.batch_id, prompt: a.prompt, model: a.model },
        })),
      )

      const nextCursor = hasMore && assets.length > 0
        ? Buffer.from(
            JSON.stringify({
              created_at: assets[assets.length - 1].created_at.toISOString?.() ?? String(assets[assets.length - 1].created_at),
              id: assets[assets.length - 1].id,
            }),
          ).toString('base64')
        : null

      return reply.send({ data: signed, cursor: nextCursor })
    },
  )

  // DELETE /assets/:id — soft-delete an asset
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

      // Authorization: must own the asset, be a workspace member, or be admin
      if (asset.user_id !== userId && request.user.role !== 'admin') {
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
        .set({ is_deleted: true })
        .where('id', '=', id)
        .execute()

      return reply.status(204).send()
    },
  )
}
