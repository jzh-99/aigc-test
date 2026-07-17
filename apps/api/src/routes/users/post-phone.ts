import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { buildUserProfile } from '../../services/user-profile.js'

const PHONE_RE = /^1[3-9]\d{9}$/

function normalizePhone(phone: string) {
  return phone.trim().replace(/\s+/g, '')
}

const route: FastifyPluginAsync = async (app) => {
  // POST /users/me/phone — 校验验证码并换绑手机号
  app.post<{ Body: { phone: string; code: string } }>('/users/me/phone', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'code'],
        properties: {
          phone: { type: 'string', minLength: 11, maxLength: 20 },
          code: { type: 'string', minLength: 4, maxLength: 10 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const phone = normalizePhone(request.body.phone)
    const code = request.body.code.trim()
    if (!PHONE_RE.test(phone)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PHONE', message: '请输入有效的手机号' },
      })
    }

    const redisKey = `users:phone-bind:code:${request.user.id}:${phone}`
    const expectedCode = await app.redis.get(redisKey)
    if (!expectedCode || expectedCode !== code) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CODE', message: '验证码无效或已过期' },
      })
    }

    const db = getDb()
    const current = await db
      .selectFrom('users')
      .select(['id', 'phone'])
      .where('id', '=', request.user.id)
      .executeTakeFirstOrThrow()

    if (current.phone === phone) {
      return reply.status(400).send({
        success: false,
        error: { code: 'PHONE_UNCHANGED', message: '新手机号与当前手机号一致' },
      })
    }

    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('phone', '=', phone)
      .executeTakeFirst()

    if (existing && existing.id !== request.user.id) {
      return reply.status(409).send({
        success: false,
        error: { code: 'PHONE_EXISTS', message: '该手机号已绑定其他账号' },
      })
    }

    await db
      .updateTable('users')
      .set({ phone, account: phone })
      .where('id', '=', request.user.id)
      .execute()

    await app.redis.del(redisKey)
    return buildUserProfile(db, request.user.id)
  })
}

export default route
