import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // GET /users/me/generation-defaults — 获取当前用户的生成默认参数
  app.get('/users/me/generation-defaults', async (request) => {
    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select('generation_defaults')
      .where('id', '=', request.user.id)
      .executeTakeFirstOrThrow()
    return user.generation_defaults ?? {}
  })
}

export default route
