import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'
import { readBizMgmtBalanceCache } from '../../services/biz-mgmt-balance-cache.js'

/**
 * GET /teams/:id — 团队信息 + 成员列表。
 *
 * 硬切换后本地积分系统已退役，A 豆余额由业管平台统一管理，本接口不再查询
 * credit_accounts，响应移除 credits 字段。成员列表中的 credit_quota / credit_used 等
 * 配额字段也已废弃（成员配额已移除），不再返回给前端。
 *
 * 成员 A 豆余额只读取 Redis 展示缓存（由登录/余额查询/手动刷新写入），不回源业管、
 * 不落 PostgreSQL，也不作为生成扣减或余额不足判断依据。
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
      .leftJoin('biz_mgmt_member_bindings', (join) =>
        join
          .onRef('biz_mgmt_member_bindings.local_user_id', '=', 'team_members.user_id')
          .onRef('biz_mgmt_member_bindings.team_id', '=', 'team_members.team_id'),
      )
      .select([
        'users.id as user_id', 'users.account', 'users.username', 'users.avatar_url',
        'team_members.role', 'team_members.joined_at', 'team_members.priority_boost',
        'biz_mgmt_member_bindings.biz_mgmt_user_id',
      ])
      .where('team_members.team_id', '=', request.params.id)
      .execute()

    const membersWithBalance = await Promise.all(members.map(async (member) => {
      const cache = await readBizMgmtBalanceCache(app.redis, member.biz_mgmt_user_id)
      return {
        ...member,
        a_bean_balance: cache?.balance ?? null,
        a_bean_balance_updated_at: cache?.updatedAt ?? null,
      }
    }))

    return { ...team, members: membersWithBalance }
  })
}

export default route
