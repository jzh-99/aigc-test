import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/trash — 列出 7 天内软删除的团队和工作区
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/trash', async () => {
    const db = getDb()
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const teams = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id', 'deleted_at'])
      .where('is_deleted', '=', true)
      .where('deleted_at', '>=', cutoff as any)
      .orderBy('deleted_at', 'desc')
      .execute()

    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'team_id', 'deleted_at'])
      .where('is_deleted', '=', true)
      .where('deleted_at', '>=', cutoff as any)
      // 只显示父团队未被删除的工作区（团队级删除在 teams 标签页展示）
      .where((eb) =>
        eb.not(eb.exists(
          eb.selectFrom('teams')
            .select('id')
            .whereRef('teams.id', '=', 'workspaces.team_id')
            .where('teams.is_deleted', '=', true)
        ))
      )
      .orderBy('deleted_at', 'desc')
      .execute()

    const ownerIds = [...new Set(teams.map(t => t.owner_id))]
    const ownerMap = new Map<string, string>()
    if (ownerIds.length > 0) {
      const owners = await db.selectFrom('users').select(['id', 'username']).where('id', 'in', ownerIds).execute()
      for (const o of owners) ownerMap.set(o.id, o.username)
    }

    const teamIds = [...new Set(workspaces.map(w => w.team_id))]
    const teamNameMap = new Map<string, string>()
    if (teamIds.length > 0) {
      const teamRows = await db.selectFrom('teams').select(['id', 'name']).where('id', 'in', teamIds).execute()
      for (const t of teamRows) teamNameMap.set(t.id, t.name)
    }

    return {
      teams: teams.map(t => ({ ...t, owner_username: ownerMap.get(t.owner_id) ?? null, deleted_at: t.deleted_at })),
      workspaces: workspaces.map(w => ({ ...w, team_name: teamNameMap.get(w.team_id) ?? null })),
    }
  })
}

export default route
