import type { FastifyPluginAsync } from 'fastify'
import type { TopUpCreditsRequest } from '@aigc/types'

/**
 * POST /admin/teams/:id/credits — 调整 A 豆（正数充值，负数扣减）。
 *
 * 【已退役】本地积分系统硬切换后，团队 A 豆余额由业管平台统一管理，本地不再维护
 * credit_accounts / credits_ledger。管理员如需调整某会员的 A 豆，请在业管后台操作，
 * 或通过业管订购同步接口（subscribe_sync outbox）走充值流程。
 *
 * 保留路由与请求 schema 以兼容旧前端调用，但统一返回 410 提示该能力已迁移至业管，
 * 不再读写任何本地积分表。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TopUpCreditsRequest }>('/admin/teams/:id/credits', {
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: -1000000, maximum: 1000000 },
          description: { type: 'string', maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    return reply.code(410).send({
      success: false,
      error: {
        code: 'LOCAL_CREDITS_RETIRED',
        message: '团队 A 豆余额由业管平台统一管理，本地管理员充值/扣减已退役，请在业管后台操作。',
      },
    })
  })
}

export default route
