cat << 'INNER_EOF' > /root/autodl-tmp/aigc-test/apps/api/src/routes/auth-events.ts
import type { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'

export async function authEventsRoutes(app: FastifyInstance): Promise<void> {
  const redis = (app as any).redis as import('ioredis').default
  const secret = process.env.JWT_SECRET

  // We explicitly handle auth here because EventSource cannot send Authorization headers
  app.get<{ Querystring: { token: string } }>('/auth/events', async (request, reply) => {
    let userId: string | undefined = undefined

    // 1. Try Authorization header first
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      userId = request.user?.id
    } 
    // 2. Try token from query param (for EventSource)
    else if (request.query.token && secret) {
      try {
        const payload = jwt.verify(request.query.token, secret) as { sub: string }
        userId = payload.sub
      } catch (e) {
        return reply.status(401).send({ error: 'Invalid token' })
      }
    }

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('Access-Control-Allow-Origin', (request.headers.origin as string) ?? '*')
    reply.raw.flushHeaders()
    reply.hijack()

    const subscriber = redis.duplicate()
    const channel = `user:kick:${userId}`
    await subscriber.subscribe(channel)

    subscriber.on('message', (chan, message) => {
      if (chan === channel) {
        reply.raw.write(`event: kick\ndata: ${message}\n\n`)
      }
    })

    reply.raw.write(': ping\n\n')

    const pingInterval = setInterval(() => {
      reply.raw.write(': ping\n\n')
    }, 30000)

    request.raw.on('close', async () => {
      clearInterval(pingInterval)
      await subscriber.unsubscribe(channel)
      subscriber.quit()
    })
  })
}
INNER_EOF
