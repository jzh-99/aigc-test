import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id/assets — 画布资产库（游标分页，可按类型过滤）
const route: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string; type?: string }
  }>('/canvases/:id/assets', {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
    const cursor = request.query.cursor
    const type = request.query.type

    const canvas = await db
      .selectFrom('canvases').select('workspace_id').where('id', '=', id).where('is_deleted', '=', false).executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members').select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id).executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    // 解码游标
    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('assets as a')
      .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
      .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.created_at',
               'b.id as batch_id', 'b.canvas_node_id', 'b.prompt', 'b.model'])
      .where('b.canvas_id', '=', id)
      .where('a.is_deleted', '=', false)
      .where((eb: any) => eb.or([
        eb('a.transfer_status', '=', 'completed'),
        eb('a.original_url', 'is not', null),
      ]))
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limitN + 1) as any

    if (type) query = query.where('a.type', '=', type)

    if (decodedCursor) {
      query = query.where((eb: any) =>
        eb.or([
          eb('a.created_at', '<', decodedCursor!.created_at),
          eb.and([eb('a.created_at', '=', decodedCursor!.created_at), eb('a.id', '<', decodedCursor!.id)]),
        ])
      )
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = hasMore ? rows.slice(0, limitN) : rows

    // 对存储 URL 签名
    const signedItems = await Promise.all(
      items.map(async (item: any) => ({
        ...item,
        storage_url: await signAssetUrl(item.storage_url),
        original_url: item.original_url ? await signAssetUrl(item.original_url) : null,
      }))
    )

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items: signedItems, nextCursor })
  })
}

export default route
