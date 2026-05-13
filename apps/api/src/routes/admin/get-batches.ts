import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/batches — 所有生成记录（向后兼容）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { team_id?: string; workspace_id?: string; cursor?: string; limit?: string } }>(
    '/admin/batches',
    async (request, reply) => {
      const db = getDb()
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

      let query = db
        .selectFrom('task_batches')
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit + 1)

      if (request.query.team_id) query = query.where('team_id', '=', request.query.team_id)
      if (request.query.workspace_id) query = query.where('workspace_id', '=', request.query.workspace_id)
      if (request.query.cursor) {
        const cursorDate = new Date(request.query.cursor)
        if (isNaN(cursorDate.getTime())) return reply.badRequest('Invalid cursor')
        query = query.where('created_at', '<', cursorDate as any)
      }

      const rows = await query.execute()
      const hasMore = rows.length > limit
      const data = hasMore ? rows.slice(0, limit) : rows

      return {
        data,
        cursor: hasMore ? String(data[data.length - 1].created_at) : null,
      }
    },
  )
}

export default route
