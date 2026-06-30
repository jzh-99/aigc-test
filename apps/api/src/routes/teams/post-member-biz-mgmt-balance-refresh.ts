import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'
import { refreshBizMgmtBalanceCache } from '../../services/biz-mgmt-balance-cache.js'

/**
 * POST /teams/:id/members/:uid/biz-mgmt-balance/refresh
 *
 * 团队 owner 手动刷新某个成员的 A 豆余额展示缓存。
 * 余额权威仍在业管 MEMBER-1004；Redis 只保存展示快照与更新时间，不参与真实扣减事务。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; uid: string } }>(
    '/teams/:id/members/:uid/biz-mgmt-balance/refresh',
    {
      preHandler: teamRoleGuard('owner'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const db = getDb()
      const member = await db
        .selectFrom('team_members')
        .innerJoin('users', 'users.id', 'team_members.user_id')
        .leftJoin('biz_mgmt_member_bindings', (join) =>
          join
            .onRef('biz_mgmt_member_bindings.local_user_id', '=', 'team_members.user_id')
            .onRef('biz_mgmt_member_bindings.team_id', '=', 'team_members.team_id'),
        )
        .select([
          'users.id as user_id',
          'users.username',
          'biz_mgmt_member_bindings.biz_mgmt_user_id',
        ])
        .where('team_members.team_id', '=', request.params.id)
        .where('team_members.user_id', '=', request.params.uid)
        .executeTakeFirst()

      if (!member) return reply.notFound('成员不存在')
      if (!member.biz_mgmt_user_id) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_MEMBER_NOT_SYNCED',
            message: '该成员尚未同步业管会员身份，暂不能查询 A 豆余额',
          },
        })
      }

      try {
        const cache = await refreshBizMgmtBalanceCache(app.redis, member.biz_mgmt_user_id)
        return {
          user_id: member.user_id,
          balance: cache.balance,
          updated_at: cache.updatedAt,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '业管 A 豆余额查询失败'
        return reply.status(502).send({
          success: false,
          error: { code: 'BIZ_MGMT_BALANCE_REFRESH_FAILED', message },
        })
      }
    },
  )
}

export default route
