import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'

// 构建批次列表查询（供 get-hidden.ts 复用）
export function buildBatchListQuery(db: ReturnType<typeof getDb>, isHidden: boolean) {
  return db
    .selectFrom('task_batches')
    .select([
      'id', 'module', 'provider', 'model', 'prompt', 'params', 'quantity',
      'completed_count', 'failed_count', 'status', 'estimated_credits',
      'actual_credits', 'created_at', 'user_id', 'workspace_id',
    ])
    .where('is_deleted', '=', false)
    .where('is_hidden', '=', isHidden)
    .where('canvas_id', 'is', null)
    .where('video_studio_project_id', 'is', null)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
}

const route: FastifyPluginAsync = async (app) => {
  // GET /batches/hidden — list hidden batches (same pagination as GET /batches)
  app.get<{ Querystring: { workspace_id?: string; cursor?: string; limit?: string } }>(
    '/batches/hidden',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const limit = Math.min(parseInt(request.query.limit ?? '10', 10) || 10, 50)
      const cursor = request.query.cursor

      let decodedCursor: { created_at: string; id: string } | null = null
      if (cursor) {
        try {
          decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
        } catch {
          return reply.badRequest('Invalid cursor')
        }
      }

      let query = buildBatchListQuery(db, true).limit(limit + 1)

      const workspaceId = request.query.workspace_id
      if (workspaceId) {
        if (request.user.role !== 'admin') {
          const wsMember = await db.selectFrom('workspace_members').select('role')
            .where('workspace_id', '=', workspaceId).where('user_id', '=', userId).executeTakeFirst()
          if (!wsMember) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' } })
        }
        query = query.where('workspace_id', '=', workspaceId)
      } else {
        if (request.user.role !== 'admin') query = query.where('user_id', '=', userId)
      }

      if (decodedCursor) {
        query = query.where((eb: any) =>
          eb.or([
            eb('created_at', '<', decodedCursor!.created_at),
            eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
          ]),
        )
      }

      const rows = await query.execute()
      const hasMore = rows.length > limit
      const batches = hasMore ? rows.slice(0, limit) : rows

      const batchIds = batches.map((b: any) => b.id)
      const thumbnailMap = new Map<string, string[]>()
      if (batchIds.length > 0) {
        const assets = await db.selectFrom('assets').select(['batch_id', 'storage_url', 'original_url', 'type'])
          .where('batch_id', 'in', batchIds).where('is_deleted', '=', false).execute()
        const signed = await Promise.all(assets.map(async (a) => ({
          batch_id: (a as any).batch_id,
          url: (a as any).storage_url ? await signAssetUrl((a as any).storage_url) : ((a as any).original_url ?? null),
          type: (a as any).type,
        })))
        for (const s of signed) {
          if (!s.url) continue
          const list = thumbnailMap.get(s.batch_id) ?? []
          if (list.length < 4) { list.push(s.url); thumbnailMap.set(s.batch_id, list) }
        }
      }

      const nextCursor = hasMore && batches.length > 0
        ? Buffer.from(JSON.stringify({
            created_at: batches[batches.length - 1].created_at.toISOString?.() ?? String(batches[batches.length - 1].created_at),
            id: batches[batches.length - 1].id,
          })).toString('base64')
        : null

      return reply.send({
        data: batches.map((b: any) => ({
          id: b.id, module: b.module, provider: b.provider, model: b.model,
          prompt: b.prompt, params: b.params ?? {}, quantity: b.quantity,
          completed_count: b.completed_count, failed_count: b.failed_count,
          status: b.status, estimated_credits: b.estimated_credits, actual_credits: b.actual_credits,
          created_at: b.created_at.toISOString?.() ?? String(b.created_at),
          tasks: [], thumbnail_urls: thumbnailMap.get(b.id) ?? [],
        })),
        cursor: nextCursor,
      })
    },
  )
}

export default route
