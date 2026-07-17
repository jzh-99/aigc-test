import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'

const route: FastifyPluginAsync = async (app) => {
  // POST /users/me/password — 修改当前用户密码
  app.post<{ Body: { current_password: string; new_password: string } }>('/users/me/password', {
    schema: {
      body: {
        type: 'object',
        required: ['current_password', 'new_password'],
        properties: {
          current_password: { type: 'string', minLength: 1 },
          new_password: { type: 'string', minLength: 8, maxLength: 72 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { current_password, new_password } = request.body
    if (new_password.length < 8) {
      return reply.badRequest('新密码长度至少为 8 个字符')
    }
    if (!/[a-zA-Z]/.test(new_password) || !/\d/.test(new_password)) {
      return reply.badRequest('新密码必须包含字母和数字')
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'password_hash'])
      .where('id', '=', request.user.id)
      .executeTakeFirstOrThrow()

    const valid = await bcrypt.compare(current_password, user.password_hash)
    if (!valid) {
      return reply.status(400).send({
        success: false,
        error: { code: 'WRONG_PASSWORD', message: '当前密码不正确' },
      })
    }

    const newHash = await bcrypt.hash(new_password, 12)
    await db
      .updateTable('users')
      .set({ password_hash: newHash, password_change_required: false })
      .where('id', '=', user.id)
      .execute()

    return { success: true }
  })
}

export default route
