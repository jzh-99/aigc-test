import type { FastifyPluginAsync } from 'fastify'
import { teamRoleGuard } from '../../plugins/guards.js'

/**
 * PATCH /teams/:id/members/batch-quota — 批量更新多个成员的配额和周期。
 *
 * 【已退役】本地积分系统硬切换后成员配额已移除，A 豆余额与消耗由业管平台统一管理，
 * 本地不再维护 team_members 的配额字段。保留路由与请求 schema 以兼容旧前端调用，
 * 统一返回 410 提示该能力已退役，不再读写任何本地配额字段。
 */
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string }
    Body: { user_ids: string[]; credit_quota?: number | null; quota_period?: string | null }
  }>('/teams/:id/members/batch-quota', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
    schema: {
      body: {
        type: 'object',
        required: ['user_ids'],
        properties: {
          user_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 200 },
          credit_quota: { type: ['number', 'null'], minimum: 0, maximum: 1000000 },
          quota_period: { type: ['string', 'null'], enum: ['weekly', 'monthly', null] },
        },
        additionalProperties: false,
      },
    },
  }, async (_request, reply) => {
    return reply.code(410).send({
      success: false,
      error: {
        code: 'LOCAL_CREDITS_RETIRED',
        message: '成员配额已移除，A 豆余额与消耗由业管平台统一管理，本地批量配额管理已退役。',
      },
    })
  })
}

export default route
