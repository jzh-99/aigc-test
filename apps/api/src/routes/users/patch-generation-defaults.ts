import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // PATCH /users/me/generation-defaults — 更新当前用户的生成默认参数
  app.patch<{ Body: Record<string, unknown> }>('/users/me/generation-defaults', {
    schema: {
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request) => {
    const db = getDb()
    await db
      .updateTable('users')
      .set({ generation_defaults: JSON.stringify(request.body) })
      .where('id', '=', request.user.id)
      .execute()
    return request.body
  })
}

export default route
