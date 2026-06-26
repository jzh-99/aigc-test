import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

/**
 * GET /admin/teams — 列出所有团队（含成员数、工作区数、组长用户名）。
 *
 * 硬切换后本地积分系统已退役，A 豆余额由业管平台统一管理，本接口不再查询本地积分表，
 * 响应不再回传本地余额相关字段（如需余额请在业管后台或调用业管余额查询接口）。
 * 结构信息（成员数、工作区数、组长）保持不变。
 */
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/teams', async () => {
    const db = getDb()
    const teams = await db
      .selectFrom('teams')
      .select([
        'teams.id', 'teams.name', 'teams.owner_id', 'teams.plan_tier',
        'teams.team_type', 'teams.created_at', 'teams.allow_member_topup',
      ])
      .where('teams.is_deleted', '=', false)
      .orderBy('teams.created_at', 'asc')
      .execute()

    const memberCounts = await db
      .selectFrom('team_members')
      .select(['team_id', db.fn.count('user_id').as('member_count')])
      .groupBy('team_id')
      .execute()
    const countMap = new Map(memberCounts.map(m => [m.team_id, Number(m.member_count)]))

    const wsCounts = await db
      .selectFrom('workspaces')
      .select(['team_id', db.fn.count('id').as('workspace_count')])
      .where('is_deleted', '=', false)
      .groupBy('team_id')
      .execute()
    const wsCountMap = new Map(wsCounts.map(w => [w.team_id, Number(w.workspace_count)]))

    const ownerIds = [...new Set(teams.map(t => t.owner_id).filter(Boolean))]
    const ownerMap = new Map<string, string>()
    if (ownerIds.length > 0) {
      const owners = await db
        .selectFrom('users')
        .select(['id', 'username'])
        .where('id', 'in', ownerIds)
        .execute()
      for (const o of owners) ownerMap.set(o.id, o.username)
    }

    return {
      data: teams.map(t => ({
        ...t,
        member_count: countMap.get(t.id) ?? 0,
        workspace_count: wsCountMap.get(t.id) ?? 0,
        owner_username: ownerMap.get(t.owner_id) ?? null,
      })),
    }
  })
}

export default route
