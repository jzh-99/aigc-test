import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// PATCH /admin/teams/:id — 更新团队设置（team_type、allow_member_topup）
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string }
    Body: { team_type?: 'standard' | 'company_a' | 'avatar_enabled'; allow_member_topup?: boolean }
  }>('/admin/teams/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          team_type: { type: 'string', enum: ['standard', 'company_a', 'avatar_enabled'] },
          allow_member_topup: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const { team_type, allow_member_topup } = request.body

    const team = await db.selectFrom('teams').select('id').where('id', '=', id).executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在' } })

    const updates: Record<string, unknown> = {}
    if (team_type !== undefined) updates.team_type = team_type
    if (allow_member_topup !== undefined) updates.allow_member_topup = allow_member_topup

    if (Object.keys(updates).length > 0) {
      await db.updateTable('teams').set(updates as any).where('id', '=', id).execute()
    }

    return reply.send({ success: true })
  })
}

export default route
