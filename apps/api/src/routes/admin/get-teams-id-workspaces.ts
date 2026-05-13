import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

// GET /admin/teams/:id/workspaces — 列出团队工作区（含成员数和批次统计）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/admin/teams/:id/workspaces', async (request, reply) => {
    const db = getDb()
    const teamId = request.params.id

    const team = await db.selectFrom('teams').select('id').where('id', '=', teamId).executeTakeFirst()
    if (!team) return reply.notFound('Team not found')

    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'created_at'])
      .where('team_id', '=', teamId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute()

    const wsIds = workspaces.map(w => w.id)
    const wsMemberMap = new Map<string, number>()
    const wsBatchMap = new Map<string, { total: number; completed: number; failed: number }>()

    if (wsIds.length > 0) {
      const wsMemberCounts = await db
        .selectFrom('workspace_members')
        .select(['workspace_id', db.fn.count('user_id').as('count')])
        .where('workspace_id', 'in', wsIds)
        .groupBy('workspace_id')
        .execute()
      for (const m of wsMemberCounts) wsMemberMap.set(m.workspace_id, Number(m.count))

      const batchStats = await sql<{ workspace_id: string; total: string; completed: string; failed: string }>`
        SELECT
          workspace_id,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM task_batches
        WHERE workspace_id = ANY(${wsIds}::uuid[]) AND is_deleted = false
        GROUP BY workspace_id
      `.execute(db)
      for (const s of batchStats.rows) {
        wsBatchMap.set(s.workspace_id, {
          total: Number(s.total),
          completed: Number(s.completed),
          failed: Number(s.failed),
        })
      }
    }

    return {
      data: workspaces.map(w => ({
        ...w,
        member_count: wsMemberMap.get(w.id) ?? 0,
        batch_total: wsBatchMap.get(w.id)?.total ?? 0,
        batch_completed: wsBatchMap.get(w.id)?.completed ?? 0,
        batch_failed: wsBatchMap.get(w.id)?.failed ?? 0,
      })),
    }
  })
}

export default route
