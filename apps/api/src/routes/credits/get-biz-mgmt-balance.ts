import type { FastifyPluginAsync } from 'fastify'
import { getCurrentBizMgmtIdentity } from '../../services/biz-mgmt-a-bean.js'
import { refreshBizMgmtBalanceCache } from '../../services/biz-mgmt-balance-cache.js'

/**
 * GET /credits/biz-mgmt/balance — 实时查询当前选中业管会员的 A 豆余额。
 *
 * 权威约束：余额来自业管 MEMBER-1004，每次现查，不写本地表、不读本地缓存。
 * 未选择业管身份时返回 400 提示先选身份。
 */
const route: FastifyPluginAsync = async (app) => {
  app.get('/credits/biz-mgmt/balance', async (request, reply) => {
    try {
      const identity = await getCurrentBizMgmtIdentity(request.user.id)
      const cache = await refreshBizMgmtBalanceCache(app.redis, identity.bizMgmtUserId)
      return { balance: cache.balance, updated_at: cache.updatedAt }
    } catch (err) {
      // 未选择身份属于业务校验错误，返回 400 让前端引导用户选身份
      const message = err instanceof Error ? err.message : '业管 A 豆余额查询失败'
      return reply.status(400).send({
        success: false,
        error: { code: 'BIZ_MGMT_IDENTITY_REQUIRED', message },
      })
    }
  })
}

export default route
