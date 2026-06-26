import type { FastifyPluginAsync } from 'fastify'

/**
 * POST /admin/teams/:id/members/:uid/reset-credits — 重置成员当期积分使用量。
 *
 * 【已退役】本地积分系统硬切换后成员配额已移除，团队 A 豆余额与消耗均由业管平台统一
 * 管理，本地不再维护 team_members.credit_used / quota_reset_at 等配额字段。保留路由以
 * 兼容旧前端，统一返回 410 提示该能力已迁移至业管，不再读写任何本地积分/配额字段。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; uid: string } }>('/admin/teams/:id/members/:uid/reset-credits', {
    config: { rateLimit: false },
  }, async (_request, reply) => {
    return reply.code(410).send({
      success: false,
      error: {
        code: 'LOCAL_CREDITS_RETIRED',
        message: '成员配额已移除，A 豆余额与消耗由业管平台统一管理，本地重置配额已退役。',
      },
    })
  })
}

export default route
