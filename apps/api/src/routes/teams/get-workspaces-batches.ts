import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /teams/:id/workspaces — 团队下所有工作区（团队 owner 管理视图）
  app.get<{ Params: { id: string } }>('/teams/:id/workspaces', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request) => {
    const db = getDb()
    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'description', 'created_at'])
      .where('team_id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute()

    const memberCounts = await db
      .selectFrom('workspace_members')
      .select(['workspace_id', db.fn.count('id').as('count')])
      .where('workspace_id', 'in', workspaces.map(w => w.id))
      .groupBy('workspace_id')
      .execute()

    const countMap = Object.fromEntries(memberCounts.map(r => [r.workspace_id, Number(r.count)]))
    return { data: workspaces.map(w => ({ ...w, member_count: countMap[w.id] ?? 0 })) }
  })

  // GET /teams/:id/batches — 团队所有生成记录（游标分页）
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/teams/:id/batches', {
    preHandler: teamRoleGuard('owner'),
  }, async (request) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .where('team_id', '=', request.params.id)
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

  // PATCH /teams/:id/allow-member-topup — owner 切换成员充值权限
  app.patch<{ Params: { id: string }; Body: { allow: boolean } }>('/teams/:id/allow-member-topup', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['allow'],
        properties: { allow: { type: 'boolean' } },
      },
    },
  }, async (request) => {
    const db = getDb()
    await db.updateTable('teams')
      .set({ allow_member_topup: request.body.allow })
      .where('id', '=', request.params.id)
      .execute()
    return { success: true }
  })
}

export default route
