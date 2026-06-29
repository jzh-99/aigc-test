import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { LoginRequest } from '@aigc/types'
import { ensurePersonalAccountScope } from '../../services/account-scope.js'
import { buildAuthResponse, buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken, signRefreshToken } from '../../lib/auth-tokens.js'
import {
  syncBizMgmtMembersForLocalUser,
  fetchBizMgmtMembersByPhone,
  purgeLocalUserCascade,
} from '../../services/biz-mgmt-member-sync.js'

// 账户锁定相关常量
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_WINDOW = 10 * 60 // 10 分钟（秒）
const LOCKOUT_DURATION = 15 * 60 // 15 分钟（秒）

// 手机号识别正则：11 位、首位为 1。业管先行登录只对手机号生效，邮箱走旧逻辑。
const PHONE_RE = /^1\d{10}$/

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

    // ────────────────────────────────────────────────────────────────────────
    // 业管先行登录流程（见计划 Critical Login Invariant + 2026-06-26 澄清）：
    //
    // 业管是账号唯一判官。手机号登录必须【无条件先查业管】判存亡：
    //  1. 业管查无会员（空数组）或接口故障（throw）→ 一律视为"用户不存在"。
    //     若本地存在该手机号 user，先 purgeLocalUserCascade 物理删除其全部业务数据，
    //     再返回 401 BIZ_MGMT_NOT_FOUND。
  //  2. 业管有会员（≥1 个 status=1）→ 查本地 users.phone：
  //       本地无 → 拒绝（建 user 责任在 check-biz-mgmt，跳过 check 视为异常）
  //       本地有 → bcrypt 校验密码
    //  3. 登录成功后异步刷新业管绑定（setImmediate，不 await，不阻塞登录性能）。
    //
    // 邮箱登录（identifier 非手机号）走旧的本地先行逻辑，不触发业管查询，
    // 保证 SSO / 邀请等链路不受影响。
    // ────────────────────────────────────────────────────────────────────────

    let user: {
      id: string
      account: string
      username: string
      password_hash: string
      role: string
      status: string
      phone: string | null
    } | undefined

    if (PHONE_RE.test(identifier)) {
      // ── 手机号登录：业管先行 ──────────────────────────────────────────────

      // 【无条件先查业管】try/catch 包裹：故障等同查无，统一走拒绝分支
      let bizMgmtMembers: Awaited<ReturnType<typeof fetchBizMgmtMembersByPhone>>
      try {
        bizMgmtMembers = await fetchBizMgmtMembersByPhone(identifier)
      } catch (err) {
        // 业管接口故障：按用户要求"一律拒绝+清理"，等同查无。
        // 用 request.log.error 记录，生产环境进 api-err.log（PM2）或 docker logs（容器），
        // 结构化 JSON 带 identifier 便于排查。
        request.log.error({ err, identifier }, '业管会员查询失败（post-login），按查无处理')
        bizMgmtMembers = []
      }

      if (bizMgmtMembers.length === 0) {
        // 分支①②：业管查无（或故障）。
        // 若本地存在该手机号 user，物理清理其全部业务数据，避免本地残留孤儿账号。
        const existingUser = await db
          .selectFrom('users')
          .select(['id'])
          .where('phone', '=', identifier)
          .executeTakeFirst()
        if (existingUser) {
          // 分支②：本地有孤儿 user，清理后拒绝
          await purgeLocalUserCascade(existingUser.id)
        }
        // 分支①②统一返回 BIZ_MGMT_NOT_FOUND，前端切回手机号步提示"用户不存在"
        return reply.status(401).send({
          success: false,
          error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
        })
      }

      // 业管有会员：查本地 users.phone。建 user 责任已在 check-biz-mgmt 完成，
      // 此处本地无 user 说明用户跳过了 check（异常路径），拒绝登录防止绕过。
      user = await db
        .selectFrom('users')
        .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
        .where('phone', '=', identifier)
        .executeTakeFirst()

      if (!user) {
        // 跳过 check 直调 login（本地无 user）：拒绝
        return reply.status(401).send({
          success: false,
          error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
        })
      }
      // 本地有 user，继续走下方 bcrypt 密码校验
    } else {
      // ── 邮箱登录：本地先行（旧逻辑，保持兼容）──────────────────────────────
      user = await db
        .selectFrom('users')
        .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
        .where((eb) =>
          eb.or([
            eb('account', '=', identifier.toLowerCase()),
            eb('phone', '=', identifier),
          ]),
        )
        .executeTakeFirst()
    }

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

    // 业管会员同步：改为异步触发，不阻塞登录响应。
    // 关键不变量：每次手机号登录成功后都要刷新业管绑定，发现用户新增的管理/公司账号；
    // 但业管查询耗时不应拖慢登录，故用 setImmediate 移出请求关键路径，失败只记日志。
    if (user.phone) {
      setImmediate(() => {
        syncBizMgmtMembersForLocalUser(user!.id, user!.phone!).catch((err) => {
          // 异步同步失败不影响已完成的登录，只记日志便于排查
          request.log.error({ err, userId: user!.id }, '业管会员异步同步失败（不影响登录）')
        })
      })
    }

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

    await ensurePersonalAccountScope(db, user.id)
    const profile = await buildUserProfile(db, user.id)
    const authBody = buildAuthResponse(accessToken, profile)
    return authBody
  })
}

export default route
