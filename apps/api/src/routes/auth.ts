import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { LoginRequest, AcceptInviteRequest } from '@aigc/types'
import { buildUserProfile } from '../services/user-profile.js'
import rateLimit from '@fastify/rate-limit'

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_WINDOW = 10 * 60 // 10 minutes in seconds
const LOCKOUT_DURATION = 15 * 60 // 15 minutes in seconds
const BCRYPT_ROUNDS = 12
const MAX_PASSWORD_LENGTH = 72 // bcrypt truncates at 72 bytes

function signAccessToken(user: { id: string; email: string; role: string }): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn']
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret, { expiresIn })
}

function signRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // Rate limit auth endpoints: 10 attempts per minute per IP
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试` },
    }),
  })

  // Account lockout helpers using Redis
  const redis = (app as any).redis as import('ioredis').default

  async function checkAccountLocked(email: string): Promise<boolean> {
    const lockKey = `auth:locked:${email.toLowerCase()}`
    const locked = await redis.get(lockKey)
    return locked === '1'
  }

  async function recordFailedAttempt(email: string): Promise<void> {
    const attemptsKey = `auth:attempts:${email.toLowerCase()}`
    const count = await redis.incr(attemptsKey)
    if (count === 1) {
      await redis.expire(attemptsKey, LOCKOUT_WINDOW)
    }
    if (count >= MAX_LOGIN_ATTEMPTS) {
      const lockKey = `auth:locked:${email.toLowerCase()}`
      await redis.setex(lockKey, LOCKOUT_DURATION, '1')
      await redis.del(attemptsKey)
    }
  }

  async function clearFailedAttempts(email: string): Promise<void> {
    await redis.del(`auth:attempts:${email.toLowerCase()}`)
  }

  // POST /auth/login
  app.post<{ Body: LoginRequest }>('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 72 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body

    // Check account lockout
    if (await checkAccountLocked(email)) {
      return reply.status(429).send({
        success: false,
        error: { code: 'ACCOUNT_LOCKED', message: '登录失败次数过多，账户已临时锁定，请 15 分钟后再试' },
      })
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'username', 'password_hash', 'role', 'status'])
      .where('email', '=', email)
      .executeTakeFirst()

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await recordFailedAttempt(email)
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' },
      })
    }

    if (user.status !== 'active') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: '您的账户已被停用，请联系团队管理员重新邀请' },
      })
    }

    // Clear failed attempts on successful login
    await clearFailedAttempts(email)

    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role })
    const refreshToken = signRefreshToken()
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return { access_token: accessToken, user: profile }
  })

  // POST /auth/refresh
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
      .select(['users.id', 'users.email', 'users.role', 'users.status', 'refresh_tokens.id as token_id', 'refresh_tokens.expires_at', 'refresh_tokens.revoked_at'])
      .where('refresh_tokens.token_hash', '=', tokenHash)
      .executeTakeFirst()

    if (!stored || new Date(String(stored.expires_at)) < new Date()) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
      })
    }

    // Refresh token reuse detection: if a revoked token is presented,
    // an attacker may have stolen it. Revoke ALL tokens for this user.
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
      // Revoke the token so it can't be reused
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

    // Atomic token rotation: revoke old + create new in one transaction
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const accessToken = signAccessToken({ id: stored.id, email: stored.email, role: stored.role })
    const profile = await buildUserProfile(db, stored.id)
    return { access_token: accessToken, user: profile }
  })

  // POST /auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const refreshToken = (request.cookies as Record<string, string | undefined>)?.refresh_token
    if (refreshToken) {
      const db = getDb()
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('token_hash', '=', tokenHash)
        .execute()
    }

    reply.clearCookie('refresh_token', { path: '/api/v1/auth' })
    return { success: true }
  })

  // POST /auth/accept-invite
  app.post<{ Body: AcceptInviteRequest }>('/auth/accept-invite', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'email', 'password', 'username'],
        properties: {
          token: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          username: { type: 'string', minLength: 1, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { token, email, password, username } = request.body
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

    // Use transaction to prevent concurrent accept-invite race
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

      // Verify email matches the invited user
      const invitedUser = await trx
        .selectFrom('users')
        .select(['id', 'email'])
        .where('id', '=', inviteRow.user_id)
        .executeTakeFirst()

      if (!invitedUser || invitedUser.email.toLowerCase() !== email.toLowerCase()) {
        return { error: 'EMAIL_MISMATCH' as const }
      }

      const pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      // Update the pre-created user with real credentials
      await trx
        .updateTable('users')
        .set({ username, password_hash: pwHash, status: 'active' })
        .where('id', '=', inviteRow.user_id)
        .execute()

      // Mark this token as used + invalidate any other unused tokens for this user
      await trx
        .updateTable('email_verifications')
        .set({ used_at: sql`NOW()` })
        .where('user_id', '=', inviteRow.user_id)
        .where('used_at', 'is', null)
        .execute()

      return { userId: inviteRow.user_id }
    })

    if ('error' in result) {
      if (result.error === 'EMAIL_MISMATCH') {
        return reply.status(400).send({
          success: false,
          error: { code: 'EMAIL_MISMATCH', message: '邮箱与邀请不匹配，请使用被邀请的邮箱地址' },
        })
      }
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INVITE', message: '邀请链接无效或已过期' },
      })
    }

    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('id', '=', result.userId)
      .executeTakeFirstOrThrow()

    const accessToken = signAccessToken(user)
    const refreshTokenStr = signRefreshToken()
    const refreshHash = crypto.createHash('sha256').update(refreshTokenStr).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: refreshHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return reply.status(201).send({ access_token: accessToken, user: profile })
  })
}
