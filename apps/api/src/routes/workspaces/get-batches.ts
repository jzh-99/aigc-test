import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { workspaceGuard } from '../../plugins/guards.js'
import { normalizeBatchSource } from '../batches/source-filter.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /workspaces/:id/batches — 工作区生成记录（游标分页）
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string; source?: string } }>('/workspaces/:id/batches', {
    preHandler: workspaceGuard('editor'),
  }, async (request, reply) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    // 解析并验证 source 参数
    let source
    try {
      source = normalizeBatchSource(request.query.source)
    } catch {
      return reply.badRequest('Invalid batch source')
    }

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .where('workspace_id', '=', request.params.id)
      .where('source', '=', source)
      .orderBy('created_at', 'desc')
      .limit(limit + 1)

    if (request.query.cursor) {
      query = query.where('created_at', '<', request.query.cursor as any)
    }

    const rows = await query.execute()
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows

    return {
      data,
      cursor: hasMore ? String(data[data.length - 1].created_at) : null,
    }
  })
}

export default route
