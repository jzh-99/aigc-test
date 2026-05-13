import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { LoginRequest } from '@aigc/types'
import { buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken, signRefreshToken } from '../../lib/auth-tokens.js'

// 账户锁定相关常量
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_WINDOW = 10 * 60 // 10 分钟（秒）
const LOCKOUT_DURATION = 15 * 60 // 15 分钟（秒）

// 检查账户是否被锁定
async function checkAccountLocked(redis: import('ioredis').default, identifier: string): Promise<boolean> {
  const lockKey = `auth:locked:${identifier.toLowerCase()}`
  const locked = await redis.get(lockKey)
  return locked === '1'
}

// 记录登录失败次数，超过阈值则锁定账户
async function recordFailedAttempt(redis: import('ioredis').default, identifier: string): Promise<void> {
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

// 登录成功后清除失败记录
async function clearFailedAttempts(redis: import('ioredis').default, identifier: string): Promise<void> {
  await redis.del(`auth:attempts:${identifier.toLowerCase()}`)
}

const route: FastifyPluginAsync = async (app) => {
  // POST /auth/login — 用户登录，含频率限制与账户锁定保护
  app.post<{ Body: LoginRequest }>('/auth/login', {
    config: {
      // 登录接口更严格的频率限制：每 IP 每分钟最多 10 次
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
    const redis = (app as any).redis as import('ioredis').default

    // 检查账户是否被锁定
    if (await checkAccountLocked(redis, identifier)) {
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
      await recordFailedAttempt(redis, identifier)
      // 用户存在但已停用时，返回更明确的错误
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

    // 登录成功，清除失败记录
    await clearFailedAttempts(redis, identifier)

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
    const refreshToken = signRefreshToken()
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshToken, {
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
