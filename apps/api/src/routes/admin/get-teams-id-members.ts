import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/teams/:id/members — 列出团队成员（含积分配额和使用量）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/admin/teams/:id/members', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()
    const teamId = request.params.id

    const team = await db.selectFrom('teams').select('id').where('id', '=', teamId).executeTakeFirst()
    if (!team) return reply.notFound('Team not found')

    const members = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select([
        'users.id', 'users.username', 'users.account', 'users.avatar_url',
        'team_members.role', 'team_members.credit_quota', 'team_members.credit_used',
        'team_members.joined_at',
      ])
      .where('team_members.team_id', '=', teamId)
      .orderBy('team_members.joined_at', 'asc')
      .execute()

    return { data: members }
  })
}

export default route
