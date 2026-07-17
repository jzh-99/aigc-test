import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import { buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken, signRefreshToken } from '../../lib/auth-tokens.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /auth/refresh — 使用 refresh token 换取新的 access token（令牌轮换）
  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = (request.cookies as Record<string, string | undefined>)?.refresh_token
    if (!refreshToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
      })
    }

    const db = getDb()
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    const stored = await db
      .selectFrom('refresh_tokens')
      .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
      .select([
        'users.id',
        'users.account',
        'users.role',
        'users.status',
        'refresh_tokens.id as token_id',
        'refresh_tokens.expires_at',
        'refresh_tokens.revoked_at',
      ])
      .where('refresh_tokens.token_hash', '=', tokenHash)
      .executeTakeFirst()

    if (!stored || new Date(String(stored.expires_at)) < new Date()) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
      })
    }

    // 令牌重用检测：若已撤销的 token 被再次使用，可能遭到盗用，撤销该用户所有 token
    if (stored.revoked_at) {
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('user_id', '=', stored.id)
        .where('revoked_at', 'is', null)
        .execute()

      reply.clearCookie('refresh_token', { path: '/api/v1/auth' })
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_REUSE_DETECTED', message: '检测到令牌重用，所有会话已失效，请重新登录' },
      })
    }

    if (stored.status !== 'active') {
      // 撤销 token，防止重复使用
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('id', '=', stored.token_id)
        .execute()

      reply.clearCookie('refresh_token', { path: '/api/v1/auth' })

      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: '您的账户已被停用，请联系团队管理员重新邀请' },
      })
    }

    // 原子令牌轮换：在同一事务中撤销旧 token 并创建新 token
    const newRefreshToken = signRefreshToken()
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex')

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('id', '=', stored.token_id)
        .execute()

      await trx.insertInto('refresh_tokens').values({
        user_id: stored.id,
        token_hash: newTokenHash,
        expires_at: sql`NOW() + INTERVAL '7 days'`,
      }).execute()
    })

    reply.setCookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const accessToken = signAccessToken({ id: stored.id, account: stored.account, role: stored.role })
    const profile = await buildUserProfile(db, stored.id)
    return { access_token: accessToken, user: profile }
  })
}

export default route
