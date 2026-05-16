import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import bcrypt from 'bcryptjs'

// PATCH /admin/users/:id/password — 管理员修改任意用户密码
const route: FastifyPluginAsync = async (app) => {
  app.patch<{ Params: { id: string }; Body: { new_password: string; unlock_account?: boolean } }>(
    '/admin/users/:id/password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['new_password'],
          properties: {
            new_password: { type: 'string', minLength: 8, maxLength: 72 },
            unlock_account: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { new_password, unlock_account } = request.body

      if (!/[a-zA-Z]/.test(new_password) || !/\d/.test(new_password)) {
        return reply.badRequest('密码必须包含字母和数字')
      }

      const db = getDb()
      const user = await db
        .selectFrom('users').select(['id', 'account'])
        .where('id', '=', id).executeTakeFirst()
      if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } })

      const passwordHash = await bcrypt.hash(new_password, 12)
      await db.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', id).execute()

      // 撤销所有 refresh token，强制重新登录
      await db.updateTable('refresh_tokens').set({ revoked_at: sql`NOW()` })
        .where('user_id', '=', id).where('revoked_at', 'is', null).execute()

      if (unlock_account) {
        const redis = (app as any).redis as import('ioredis').default
        await redis.del(`auth:locked:${user.account.toLowerCase()}`)
        await redis.del(`auth:attempts:${user.account.toLowerCase()}`)
      }

      return { success: true }
    },
  )
}

export default route
