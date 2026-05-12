import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import type { Redis } from 'ioredis'

export async function healthzRoutes(app: FastifyInstance): Promise<void> {
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
