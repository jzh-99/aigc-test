import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

/**
 * GET /teams/:id — 团队信息 + 成员列表。
 *
 * 硬切换后本地积分系统已退役，A 豆余额由业管平台统一管理，本接口不再查询
 * credit_accounts，响应移除 credits 字段。成员列表中的 credit_quota / credit_used 等
 * 配额字段也已废弃（成员配额已移除），不再返回给前端。
 */
const route: FastifyPluginAsync = async (app) => {
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
        'team_members.role', 'team_members.joined_at', 'team_members.priority_boost',
      ])
      .where('team_members.team_id', '=', request.params.id)
      .execute()

    return { ...team, members }
  })
}

export default route
