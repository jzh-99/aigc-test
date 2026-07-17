import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'

// GET /admin/workspaces/:id/batches — 列出工作区批次（含用户信息和缩略图）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/admin/workspaces/:id/batches',
    async (request) => {
      const db = getDb()
      const wsId = request.params.id
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

      let query = db
        .selectFrom('task_batches')
        .selectAll()
        .where('workspace_id', '=', wsId)
        .where('is_deleted', '=', false)
        .orderBy('created_at', 'desc')
        .limit(limit + 1)

      if (request.query.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(request.query.cursor, 'base64').toString('utf-8'))
          query = query.where((eb: any) =>
            eb.or([
              eb('created_at', '<', decoded.created_at),
              eb.and([
                eb('created_at', '=', decoded.created_at),
                eb('id', '<', decoded.id),
              ]),
            ]),
          )
        } catch {
          // 忽略无效 cursor
        }
      }

      const rows = await query.execute()
      const hasMore = rows.length > limit
      const batches = hasMore ? rows.slice(0, limit) : rows

      const userIds = [...new Set(batches.map((b: any) => b.user_id))]
      const userMap = new Map<string, { id: string; username: string }>()
      if (userIds.length > 0) {
        const users = await db
          .selectFrom('users')
          .select(['id', 'username'])
          .where('id', 'in', userIds)
          .execute()
        for (const u of users) userMap.set(u.id, { id: u.id, username: u.username })
      }

      const batchIds = batches.map((b: any) => b.id)
      const thumbnailMap = new Map<string, string[]>()
      if (batchIds.length > 0) {
        const assets = await db
          .selectFrom('assets')
          .select(['batch_id', 'storage_url', 'original_url'])
          .where('batch_id', 'in', batchIds)
          .where('is_deleted', '=', false)
          .execute()
        for (const a of assets) {
          const rawUrl = (a as any).storage_url ?? (a as any).original_url
          if (!rawUrl) continue
          const signedUrl = await signAssetUrl(rawUrl)
          if (!signedUrl) continue
          const list = thumbnailMap.get((a as any).batch_id) ?? []
          list.push(signedUrl)
          thumbnailMap.set((a as any).batch_id, list)
        }
      }

      const nextCursor = hasMore && batches.length > 0
        ? Buffer.from(JSON.stringify({
            created_at: batches[batches.length - 1].created_at,
            id: batches[batches.length - 1].id,
          })).toString('base64')
        : null

      return {
        data: batches.map((b: any) => ({
          id: b.id,
          module: b.module,
          provider: b.provider,
          model: b.model,
          prompt: b.prompt,
          params: b.params,
          quantity: b.quantity,
          completed_count: b.completed_count,
          failed_count: b.failed_count,
          status: b.status,
          estimated_credits: b.estimated_credits,
          actual_credits: b.actual_credits,
          created_at: b.created_at?.toISOString?.() ?? String(b.created_at),
          tasks: [],
          thumbnail_urls: thumbnailMap.get(b.id) ?? [],
          user: userMap.get(b.user_id) ?? undefined,
        })),
        cursor: nextCursor,
      }
    },
  )
}

export default route
