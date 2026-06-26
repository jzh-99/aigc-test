import type { FastifyPluginAsync } from 'fastify'
import {
  queryCurrentBizMgmtBalance,
  queryCurrentBizMgmtLedger,
} from '../../services/biz-mgmt-a-bean.js'

/**
 * GET /payment/ledger 与 /payment/balance — 兼容旧前端的余额/流水入口。
 *
 * 硬切换后本地积分系统已退役，credit_accounts / credits_ledger 不再是权威数据。
 * 本路由转发到业管 A 豆查询服务（MEMBER-1004 / AIHUB_POINTS_CHANGE_QUERY），
 * 余额与流水都以业管为准，本地不维护、不缓存。未选择业管身份时返回 400 引导选身份。
 *
 * 注意：team_id / account 参数仅用于保持旧契约兼容，业管以当前选中会员身份查询，
 * 不区分团队/个人账户（业管侧只有会员账户）。
 */
const route: FastifyPluginAsync = async (app) => {
  // GET /payment/ledger?page=1&limit=20&changeType=... — 查询业管 A 豆流水
  app.get<{ Querystring: { account?: string; team_id?: string; page?: string; limit?: string; changeType?: string } }>(
    '/payment/ledger',
    async (request, reply) => {
      const { page = '1', limit: limitStr = '20', changeType } = request.query
      try {
        const data = await queryCurrentBizMgmtLedger({
          localUserId: request.user.id,
          changeType,
          pageNum: Number(page),
          pageSize: Number(limitStr),
        })
        return data
      } catch (err) {
        const message = err instanceof Error ? err.message : '业管 A 豆流水查询失败'
        return reply.status(400).send({
          success: false,
          error: { code: 'BIZ_MGMT_IDENTITY_REQUIRED', message },
        })
      }
    },
  )

  // GET /payment/balance?team_id=xxx — 查询业管 A 豆余额
  app.get<{ Querystring: { team_id?: string } }>('/payment/balance', async (request, reply) => {
    try {
      const balance = await queryCurrentBizMgmtBalance(request.user.id)
      // 旧契约返回 team_balance / personal_balance；业管只有一个会员余额，
      // 两字段返回同值以保持兼容，前端应迁移到 /credits/biz-mgmt/balance。
      return {
        team_balance: balance,
        personal_balance: balance,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '业管 A 豆余额查询失败'
      return reply.status(400).send({
        success: false,
        error: { code: 'BIZ_MGMT_IDENTITY_REQUIRED', message },
      })
    }
  })
}

export default route
