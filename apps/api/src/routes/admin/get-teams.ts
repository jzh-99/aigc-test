import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/teams — 列出所有团队（含成员数、工作区数、积分余额、组长用户名）
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/teams', async () => {
    const db = getDb()
    const teams = await db
      .selectFrom('teams')
      .leftJoin('credit_accounts', (join) =>
        join
          .onRef('credit_accounts.team_id', '=', 'teams.id')
          .on('credit_accounts.owner_type', '=', 'team')
      )
      .select([
        'teams.id', 'teams.name', 'teams.owner_id', 'teams.plan_tier', 'teams.team_type', 'teams.created_at', 'teams.allow_member_topup',
        'credit_accounts.balance', 'credit_accounts.frozen_credits',
        'credit_accounts.total_earned', 'credit_accounts.total_spent',
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

    const teamIds = teams.map(t => t.id)
    const lifetimeMap = new Map<string, number>()
    if (teamIds.length > 0) {
      const rows = await db
        .selectFrom('credits_ledger')
        .innerJoin('credit_accounts', 'credit_accounts.id', 'credits_ledger.credit_account_id')
        .select(['credit_accounts.team_id', db.fn.sum('credits_ledger.amount').as('total')])
        .where('credits_ledger.type', '=', 'confirm')
        .where('credit_accounts.team_id', 'in', teamIds)
        .groupBy('credit_accounts.team_id')
        .execute()
      for (const r of rows) {
        if (r.team_id) lifetimeMap.set(r.team_id, Math.abs(Number(r.total ?? 0)))
      }
    }

    return {
      data: teams.map(t => ({
        ...t,
        balance: t.balance ?? 0,
        frozen_credits: t.frozen_credits ?? 0,
        total_earned: t.total_earned ?? 0,
        total_spent: t.total_spent ?? 0,
        lifetime_used: lifetimeMap.get(t.id) ?? 0,
        member_count: countMap.get(t.id) ?? 0,
        workspace_count: wsCountMap.get(t.id) ?? 0,
        owner_username: ownerMap.get(t.owner_id) ?? null,
      })),
    }
  })
}

export default route
