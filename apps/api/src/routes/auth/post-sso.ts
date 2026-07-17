import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import { buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken, signRefreshToken } from '../../lib/auth-tokens.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /auth/sso — 用合作方签发的短期 SSO token 换取完整会话
  // 合作方后端使用相同的 JWT_SECRET 签名：{ sub: userId, email: account, role }，有效期 <= 5 分钟
  app.post('/auth/sso', async (request, reply) => {
    const { token } = request.body as { token?: string }
    if (!token) return reply.badRequest('token is required')

    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET is not set')

    let payload: { sub: string; email: string; role: string; iat: number }
    try {
      payload = jwt.verify(token, secret) as typeof payload
    } catch (err) {
      const isExpired = err instanceof jwt.TokenExpiredError
      return reply.status(401).send({
        success: false,
        error: { code: isExpired ? 'SSO_TOKEN_EXPIRED' : 'SSO_TOKEN_INVALID', message: 'SSO token 无效或已过期' },
      })
    }

    // 强制短有效期：SSO token 必须在签发后 5 分钟内使用
    if (!payload.iat || Date.now() / 1000 - payload.iat > 5 * 60) {
      return reply.status(401).send({
        success: false,
        error: { code: 'SSO_TOKEN_EXPIRED', message: 'SSO token 已过期，请重新跳转' },
      })
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'account', 'role', 'status'])
      .where('id', '=', payload.sub)
      .executeTakeFirst()

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      })
    }

    if (user.status !== 'active') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: '您的账户已被停用，请联系管理员' },
      })
    }

    // 与普通登录相同的会话建立流程
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute()

    const sessionVersion = Math.floor(Date.now() / 1000)
    const redis = (app as any).redis as import('ioredis').default
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
    return { access_token: accessToken, user: profile }
  })
}

export default route
