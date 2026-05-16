import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { AcceptInviteRequest } from '@aigc/types'
import { buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken, signRefreshToken } from '../../lib/auth-tokens.js'

// bcrypt 最大处理字节数
const MAX_PASSWORD_LENGTH = 72
const BCRYPT_ROUNDS = 12

const route: FastifyPluginAsync = async (app) => {
  // POST /auth/accept-invite — 接受邀请并完成账户注册
  app.post<{ Body: AcceptInviteRequest }>('/auth/accept-invite', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password', 'username'],
        properties: {
          token: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          phone: { type: 'string', maxLength: 20 },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          username: { type: 'string', minLength: 1, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { token, email, phone, password, username } = request.body
    const redis = (app as any).redis as import('ioredis').default

    if (!email && !phone) {
      return reply.badRequest('必须提供邮箱或手机号')
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return reply.badRequest(`密码长度不能超过 ${MAX_PASSWORD_LENGTH} 个字符`)
    }
    if (password.length < 8) {
      return reply.badRequest('密码长度至少为 8 个字符')
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return reply.badRequest('密码必须包含字母和数字')
    }

    const db = getDb()
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // 使用事务防止并发 accept-invite 竞态条件
    const result = await db.transaction().execute(async (trx) => {
      const invite = await sql<{ id: string; user_id: string; expires_at: string; used_at: string | null }>`
        SELECT id, user_id, expires_at, used_at
        FROM email_verifications
        WHERE token_hash = ${tokenHash} AND type = 'verify_email'
        FOR UPDATE
      `.execute(trx)

      const inviteRow = invite.rows[0]
      if (!inviteRow || inviteRow.used_at || new Date(String(inviteRow.expires_at)) < new Date()) {
        return { error: 'INVALID_INVITE' as const }
      }

      // 验证标识符与被邀请用户匹配
      const invitedUser = await trx
        .selectFrom('users')
        .select(['id', 'email', 'phone', 'account'])
        .where('id', '=', inviteRow.user_id)
        .executeTakeFirst()

      if (!invitedUser) {
        return { error: 'INVALID_INVITE' as const }
      }

      // 检查标识符是否匹配
      if (email && invitedUser.email?.toLowerCase() !== email.toLowerCase()) {
        return { error: 'IDENTIFIER_MISMATCH' as const }
      }
      if (phone && invitedUser.phone !== phone) {
        return { error: 'IDENTIFIER_MISMATCH' as const }
      }

      const pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      // 用真实凭据更新预创建的用户
      await trx
        .updateTable('users')
        .set({ username, password_hash: pwHash, status: 'active' })
        .where('id', '=', inviteRow.user_id)
        .execute()

      // 标记 token 已使用，并使该用户其他未使用的 token 失效
      await trx
        .updateTable('email_verifications')
        .set({ used_at: sql`NOW()` })
        .where('user_id', '=', inviteRow.user_id)
        .where('used_at', 'is', null)
        .execute()

      return { userId: inviteRow.user_id }
    })

    if ('error' in result) {
      if (result.error === 'IDENTIFIER_MISMATCH') {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDENTIFIER_MISMATCH', message: '邮箱/手机号与邀请不匹配，请使用被邀请的账号' },
        })
      }
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INVITE', message: '邀请链接无效或已过期' },
      })
    }

    const user = await db
      .selectFrom('users')
      .select(['id', 'account', 'role'])
      .where('id', '=', result.userId)
      .executeTakeFirstOrThrow()

    // 撤销旧 refresh token，强制单会话
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute()

    // 更新 session 版本，踢出其他设备
    const sessionVersion = Math.floor(Date.now() / 1000)
    await redis.set(`user:session_version:${user.id}`, sessionVersion.toString(), 'EX', 7 * 24 * 60 * 60)

    const accessToken = signAccessToken({ id: user.id, account: user.account, role: user.role })
    const refreshTokenStr = signRefreshToken()
    const refreshHash = crypto.createHash('sha256').update(refreshTokenStr).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: refreshHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return reply.status(201).send({ access_token: accessToken, user: profile })
  })
}

export default route
