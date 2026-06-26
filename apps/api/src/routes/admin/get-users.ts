import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

/**
 * GET /admin/users — 列出所有用户（含团队信息）。
 *
 * 硬切换后本地积分系统已退役、成员配额已移除，本接口不再查询本地积分/配额表，
 * 响应不再回传本地余额与配额相关字段（如需消耗与余额请查询业管）。
 * 账号、角色、团队归属信息保持不变。
 */
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/users', async () => {
    const db = getDb()
    const users = await db
      .selectFrom('users')
      .select(['id', 'account', 'username', 'avatar_url', 'role', 'status', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute()

    const userIds = users.map(u => u.id)

    const teamMap = new Map<string, string[]>()
    const teamIdMap = new Map<string, string>()
    const priorityBoostMap = new Map<string, boolean>()
    if (userIds.length > 0) {
      const teamRows = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', 'team_members.team_id', 'team_members.priority_boost', 'teams.name'])
        .where('team_members.user_id', 'in', userIds)
        .where('teams.is_deleted', '=', false)
        .execute()
      for (const r of teamRows) {
        const list = teamMap.get(r.user_id) ?? []
        list.push(r.name)
        teamMap.set(r.user_id, list)
        if (!teamIdMap.has(r.user_id)) {
          teamIdMap.set(r.user_id, r.team_id)
          priorityBoostMap.set(r.user_id, r.priority_boost ?? false)
        }
      }
    }

    return {
      data: users.map(u => ({
        ...u,
        teams: teamMap.get(u.id) ?? [],
        team_id: teamIdMap.get(u.id) ?? null,
        priority_boost: priorityBoostMap.get(u.id) ?? false,
      })),
    }
  })
}

export default route
