import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import type { Redis } from 'ioredis'

// 健康检查路由：检测数据库和 Redis 连接状态
const route: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async (_request, reply) => {
    const db = getDb()
    const redis: Redis = (app as unknown as { redis: Redis }).redis

    let dbStatus = 'ok'
    try {
      await db.selectFrom('users').select('id').limit(1).execute()
    } catch {
      dbStatus = 'error'
    }

    let redisStatus = 'ok'
    try {
      await redis.ping()
    } catch {
      redisStatus = 'error'
    }

    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok'
    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'degraded',
      db: dbStatus,
      redis: redisStatus,
    })
  })
}

export default route
