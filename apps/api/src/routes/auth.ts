import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { LoginRequest, AcceptInviteRequest } from '@aigc/types'
import { buildUserProfile } from '../services/user-profile.js'

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_WINDOW = 10 * 60 // 10 minutes in seconds
const LOCKOUT_DURATION = 15 * 60 // 15 minutes in seconds
const BCRYPT_ROUNDS = 12
const MAX_PASSWORD_LENGTH = 72 // bcrypt truncates at 72 bytes

function signAccessToken(user: { id: string; account: string; role: string }): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn']
  return jwt.sign({ sub: user.id, email: user.account, role: user.role }, secret, { expiresIn })
}

function signRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // Account lockout helpers using Redis
  const redis = (app as any).redis as import('ioredis').default

  async function checkAccountLocked(identifier: string): Promise<boolean> {
    const lockKey = `auth:locked:${identifier.toLowerCase()}`
    const locked = await redis.get(lockKey)
    return locked === '1'
  }

  async function recordFailedAttempt(identifier: string): Promise<void> {
    const attemptsKey = `auth:attempts:${identifier.toLowerCase()}`
    const count = await redis.incr(attemptsKey)
    if (count === 1) {
      await redis.expire(attemptsKey, LOCKOUT_WINDOW)
    }
    if (count >= MAX_LOGIN_ATTEMPTS) {
      const lockKey = `auth:locked:${identifier.toLowerCase()}`
      await redis.setex(lockKey, LOCKOUT_DURATION, '1')
      await redis.del(attemptsKey)
    }
  }

  async function clearFailedAttempts(identifier: string): Promise<void> {
    await redis.del(`auth:attempts:${identifier.toLowerCase()}`)
  }

  // POST /auth/login
  app.post<{ Body: LoginRequest }>('/auth/login', {
    config: {
      // Stricter rate limit for login: 10 attempts per minute per IP
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (request: any) => request.ip,
        errorResponseBuilder: (_request: any, context: any) => ({
          statusCode: 429,
          success: false,
          error: { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试` },
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'password'],
        properties: {
          identifier: { type: 'string', minLength: 1, maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 72 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { identifier, password } = request.body

    // Check account lockout
    if (await checkAccountLocked(identifier)) {
      return reply.status(429).send({
        success: false,
        error: { code: 'ACCOUNT_LOCKED', message: '登录失败次数过多，账户已临时锁定，请 15 分钟后再试' },
      })
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'account', 'username', 'password_hash', 'role', 'status'])
      .where('account', '=', identifier.toLowerCase())
      .executeTakeFirst()

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await recordFailedAttempt(identifier)
      // If user exists but is suspended, reveal that rather than a generic credentials error
      if (user && user.status !== 'active') {
        return reply.status(403).send({
          success: false,
          error: { code: 'ACCOUNT_SUSPENDED', message: '您的账户已被停用，请联系管理员' },
        })
      }
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱/手机号或密码错误' },
      })
    }

    if (user.status !== 'active') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: '您的账户已被停用，请联系管理员' },
      })
    }

    // Clear failed attempts on successful login
    await clearFailedAttempts(identifier)

    // Revoke all older refresh tokens to enforce single session
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute()

    // Publish kick event to other devices
    const sessionVersion = Math.floor(Date.now() / 1000)
    await redis.set(`user:session_version:${user.id}`, sessionVersion.toString(), 'EX', 7 * 24 * 60 * 60)

    const accessToken = signAccessToken({ id: user.id, account: user.account, role: user.role })
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
      .select(['users.id', 'users.account', 'users.role', 'users.status', 'refresh_tokens.id as token_id', 'refresh_tokens.expires_at', 'refresh_tokens.revoked_at'])
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

    const accessToken = signAccessToken({ id: stored.id, account: stored.account, role: stored.role })
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

      // Verify identifier matches the invited user
      const invitedUser = await trx
        .selectFrom('users')
        .select(['id', 'email', 'phone', 'account'])
        .where('id', '=', inviteRow.user_id)
        .executeTakeFirst()

      if (!invitedUser) {
        return { error: 'INVALID_INVITE' as const }
      }

      // Check identifier match
      if (email && invitedUser.email?.toLowerCase() !== email.toLowerCase()) {
        return { error: 'IDENTIFIER_MISMATCH' as const }
      }
      if (phone && invitedUser.phone !== phone) {
        return { error: 'IDENTIFIER_MISMATCH' as const }
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

    // Revoke all older refresh tokens to enforce single session
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute()

    // Publish kick event to other devices
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return reply.status(201).send({ access_token: accessToken, user: profile })
  })
}
