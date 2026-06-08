import type { FastifyPluginAsync } from 'fastify'
import { randomInt } from 'node:crypto'
import { getDb } from '@aigc/db'

const PHONE_RE = /^1[3-9]\d{9}$/
const CODE_TTL_SECONDS = 5 * 60
const SEND_INTERVAL_SECONDS = 60

function normalizePhone(phone: string) {
  return phone.trim().replace(/\s+/g, '')
}

const route: FastifyPluginAsync = async (app) => {
  // POST /users/me/phone-code — 发送手机号换绑验证码
  app.post<{ Body: { phone: string } }>('/users/me/phone-code', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '10 minutes',
        keyGenerator: (request: any) => `phone-bind:${request.user?.id ?? request.ip}`,
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
        required: ['phone'],
        properties: {
          phone: { type: 'string', minLength: 11, maxLength: 20 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const phone = normalizePhone(request.body.phone)
    if (!PHONE_RE.test(phone)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PHONE', message: '请输入有效的手机号' },
      })
    }

    const db = getDb()
    const existing = await db
      .selectFrom('users')
      .select(['id', 'phone'])
      .where('phone', '=', phone)
      .executeTakeFirst()

    if (existing && existing.id !== request.user.id) {
      return reply.status(409).send({
        success: false,
        error: { code: 'PHONE_EXISTS', message: '该手机号已绑定其他账号' },
      })
    }
    if (existing?.id === request.user.id) {
      return reply.status(400).send({
        success: false,
        error: { code: 'PHONE_UNCHANGED', message: '新手机号与当前手机号一致' },
      })
    }

    const redis = app.redis
    const throttleKey = `users:phone-bind:sent:${request.user.id}`
    const alreadySent = await redis.get(throttleKey)
    if (alreadySent) {
      return reply.status(429).send({
        success: false,
        error: { code: 'RATE_LIMITED', message: '验证码已发送，请稍后再试' },
      })
    }

    const code = String(randomInt(100000, 1000000))
    await redis.setex(`users:phone-bind:code:${request.user.id}:${phone}`, CODE_TTL_SECONDS, code)
    await redis.setex(throttleKey, SEND_INTERVAL_SECONDS, '1')

    // TODO: 接入真实短信服务后在这里发送 code。
    request.log.info({ userId: request.user.id, phone, code }, '手机号换绑验证码已生成')

    return {
      success: true,
      expires_in: CODE_TTL_SECONDS,
      dev_code: process.env.NODE_ENV === 'production' ? undefined : code,
    }
  })
}

export default route
