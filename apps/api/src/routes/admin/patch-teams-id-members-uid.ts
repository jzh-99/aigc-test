import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// PATCH /admin/teams/:id/members/:uid — 管理员更新成员配额和周期
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string; uid: string }
    Body: { credit_quota?: number | null; quota_period?: string | null }
  }>('/admin/teams/:id/members/:uid', {
    config: { rateLimit: false },
    schema: {
      body: {
        type: 'object',
        properties: {
          credit_quota: { type: ['number', 'null'], minimum: 0, maximum: 1000000 },
          quota_period: { type: ['string', 'null'], enum: ['weekly', 'monthly', null] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { credit_quota, quota_period } = request.body
    if (credit_quota === undefined && quota_period === undefined) {
      return reply.badRequest('At least one of credit_quota or quota_period is required')
    }
    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (credit_quota !== undefined) updates.credit_quota = credit_quota
    if (quota_period !== undefined) {
      updates.quota_period = quota_period
      if (quota_period) {
        const now = new Date()
        updates.quota_reset_at = quota_period === 'weekly'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
          : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
      } else {
        updates.quota_reset_at = null
      }
    }
    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()
    return { success: true }
  })
}

export default route
