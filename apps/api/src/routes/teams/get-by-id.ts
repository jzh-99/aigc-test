import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /teams/:id — 团队信息 + 成员列表 + 积分余额
  app.get<{ Params: { id: string } }>('/teams/:id', {
    preHandler: teamRoleGuard('editor'),
    config: { rateLimit: false },
  }, async (request) => {
    const db = getDb()
    const team = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id', 'plan_tier', 'created_at', 'allow_member_topup'])
      .where('id', '=', request.params.id)
      .executeTakeFirstOrThrow()

    const members = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select([
        'users.id as user_id', 'users.account', 'users.username', 'users.avatar_url',
        'team_members.role', 'team_members.credit_quota', 'team_members.credit_used',
        'team_members.quota_period', 'team_members.quota_reset_at', 'team_members.joined_at',
        'team_members.priority_boost',
      ])
      .where('team_members.team_id', '=', request.params.id)
      .execute()

    const creditAccount = await db
      .selectFrom('credit_accounts')
      .select(['balance', 'frozen_credits', 'total_earned', 'total_spent'])
      .where('owner_type', '=', 'team')
      .where('team_id', '=', request.params.id)
      .executeTakeFirst()

    return { ...team, members, credits: creditAccount ?? { balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 } }
  })
}

export default route
