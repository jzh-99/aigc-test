import type { FastifyPluginAsync } from 'fastify'
import { queryCurrentBizMgmtLedger } from '../../services/biz-mgmt-a-bean.js'

/**
 * GET /credits/biz-mgmt/ledger — 查询当前选中业管会员的 A 豆流水。
 *
 * 权威约束：流水来自业管 AIHUB_POINTS_CHANGE_QUERY，直接返回业管数据，
 * 不读取本地 credits_ledger。未选择业管身份时返回 400。
 */
const route: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { changeType?: string; pageNum?: number; pageSize?: number }
  }>('/credits/biz-mgmt/ledger', async (request, reply) => {
    try {
      return await queryCurrentBizMgmtLedger({
        localUserId: request.user.id,
        changeType: request.query.changeType,
        pageNum: Number(request.query.pageNum ?? 1),
        pageSize: Number(request.query.pageSize ?? 20),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '业管 A 豆流水查询失败'
      return reply.status(400).send({
        success: false,
        error: { code: 'BIZ_MGMT_IDENTITY_REQUIRED', message },
      })
    }
  })
}

export default route
