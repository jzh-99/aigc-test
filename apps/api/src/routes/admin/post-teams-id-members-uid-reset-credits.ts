import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// POST /admin/teams/:id/members/:uid/reset-credits — 重置成员当期积分使用量
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; uid: string } }>('/admin/teams/:id/members/:uid/reset-credits', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()
    const member = await db
      .selectFrom('team_members')
      .select(['credit_used', 'quota_period'])
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .executeTakeFirst()
    if (!member) return reply.notFound('成员不存在')

    const updates: Record<string, unknown> = { credit_used: 0 }
    if (member.quota_period) {
      const now = new Date()
      updates.quota_reset_at = member.quota_period === 'weekly'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
        : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
    }
    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()
    return { success: true, credit_used: 0 }
  })
}

export default route
