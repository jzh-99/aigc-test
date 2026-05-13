import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id/history — 画布历史批次列表（含任务+资产信息，游标分页）
const route: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string }
  }>('/canvases/:id/history', {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '30', 10) || 30, 100)
    const cursor = request.query.cursor

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

    // 解码游标（base64 JSON）
    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('task_batches')
      .select(['id', 'canvas_node_id', 'model', 'prompt', 'quantity', 'completed_count',
               'failed_count', 'status', 'actual_credits', 'created_at', 'module', 'provider'])
      .where('canvas_id', '=', id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limitN + 1) as any

    if (decodedCursor) {
      query = query.where((eb: any) =>
        eb.or([
          eb('created_at', '<', decodedCursor!.created_at),
          eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
        ])
      )
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = await Promise.all((hasMore ? rows.slice(0, limitN) : rows).map(async (batch: any) => {
      // 计算队列位置（仅 pending 状态）
      const queuePosition = batch.status === 'pending'
        ? Number((await db
            .selectFrom('task_batches')
            .select((eb: any) => eb.fn.countAll().as('count'))
            .where('is_deleted', '=', false)
            .where('status', '=', 'pending')
            .where('provider', '=', batch.provider)
            .where('created_at', '<', batch.created_at)
            .executeTakeFirst() as any)?.count ?? 0)
        : null
      const processing = await db
        .selectFrom('tasks')
        .select('processing_started_at')
        .where('batch_id', '=', batch.id)
        .where('processing_started_at', 'is not', null)
        .orderBy('processing_started_at', 'asc')
        .executeTakeFirst()
      const { provider: _provider, ...item } = batch
      return {
        ...item,
        queue_position: queuePosition,
        processing_started_at: processing?.processing_started_at ?? null,
      }
    }))

    // 编码下一页游标
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items, nextCursor })
  })
}

export default route
