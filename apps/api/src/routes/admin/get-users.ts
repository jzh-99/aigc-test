import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/users — 列出所有用户（含积分使用量、团队信息）
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/users', async () => {
    const db = getDb()
    const users = await db
      .selectFrom('users')
      .select(['id', 'account', 'username', 'avatar_url', 'role', 'status', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute()

    const userIds = users.map(u => u.id)
    const creditUsageMap = new Map<string, { total_quota: number | null; total_used: number }>()
    const lifetimeUsageMap = new Map<string, number>()

    if (userIds.length > 0) {
      const memberRows = await db
        .selectFrom('team_members')
        .select(['user_id', 'credit_quota', 'credit_used'])
        .where('user_id', 'in', userIds)
        .execute()

      for (const m of memberRows) {
        const existing = creditUsageMap.get(m.user_id)
        const used = (m.credit_used ?? 0)
        const quota = m.credit_quota
        if (existing) {
          existing.total_used += used
          if (quota !== null && quota !== undefined) {
            existing.total_quota = (existing.total_quota ?? 0) + quota
          }
        } else {
          creditUsageMap.set(m.user_id, { total_quota: quota ?? null, total_used: used })
        }
      }

      const ledgerRows = await db
        .selectFrom('credits_ledger')
        .select(['user_id', db.fn.sum('amount').as('total')])
        .where('user_id', 'in', userIds)
        .where('type', '=', 'confirm')
        .groupBy('user_id')
        .execute()
      for (const r of ledgerRows) {
        lifetimeUsageMap.set(r.user_id, Math.abs(Number(r.total ?? 0)))
      }
    }

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
        credit_used: creditUsageMap.get(u.id)?.total_used ?? 0,
        credit_quota: creditUsageMap.get(u.id)?.total_quota ?? null,
        lifetime_used: lifetimeUsageMap.get(u.id) ?? 0,
        teams: teamMap.get(u.id) ?? [],
        team_id: teamIdMap.get(u.id) ?? null,
        priority_boost: priorityBoostMap.get(u.id) ?? false,
      })),
    }
  })
}

export default route
