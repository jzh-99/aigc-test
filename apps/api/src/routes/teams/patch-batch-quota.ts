import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // PATCH /teams/:id/members/batch-quota — 批量更新多个成员的配额和周期
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
  }, async (request, reply) => {
    const { user_ids, credit_quota, quota_period } = request.body
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
      .where('user_id', 'in', user_ids)
      .where('role', '!=', 'owner')
      .execute()

    return { success: true, updated: user_ids.length }
  })
}

export default route
