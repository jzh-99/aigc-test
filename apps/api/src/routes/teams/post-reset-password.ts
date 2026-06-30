import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'
import { generateOneTimePassword } from '../../services/biz-mgmt-member-sync.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/:uid/reset-password — 团队所有者重置成员密码。
  // 密码由后端生成并只在本次响应返回明文；入库前立即 bcrypt 哈希，避免前端提交任意密码。
  app.post<{ Params: { id: string; uid: string } }>('/teams/:id/members/:uid/reset-password', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()
    const member = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select(['team_members.role', 'users.id', 'users.account'])
      .where('team_members.team_id', '=', request.params.id)
      .where('team_members.user_id', '=', request.params.uid)
      .executeTakeFirst()

    if (!member) return reply.notFound('Member not found')
    if (member.role === 'owner') {
      return reply.status(403).send({
        success: false,
        error: { code: 'CANNOT_RESET_OWNER_PASSWORD', message: '无法在团队页重置组长密码' },
      })
    }

    const oneTimePassword = generateOneTimePassword()
    const passwordHash = await bcrypt.hash(oneTimePassword, 12)

    await db
      .updateTable('users')
      .set({ password_hash: passwordHash, password_change_required: true })
      .where('id', '=', request.params.uid)
      .execute()

    // 重置后撤销旧 refresh token，避免旧会话继续使用；用户下次登录后会被引导修改密码。
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', request.params.uid)
      .where('revoked_at', 'is', null)
      .execute()

    const redis = (app as any).redis as import('ioredis').default | undefined
    if (redis) {
      await redis.del(`auth:locked:${member.account.toLowerCase()}`)
      await redis.del(`auth:attempts:${member.account.toLowerCase()}`)
    }

    return { success: true, one_time_password: oneTimePassword }
  })
}

export default route
