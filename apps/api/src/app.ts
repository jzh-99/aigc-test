import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Redis from 'ioredis'
import { jwtAuthPlugin } from './plugins/jwt-auth.js'
import { healthzRoutes } from './routes/healthz.js'
import { generateRoutes } from './routes/generate.js'
import { sseRoutes } from './routes/sse.js'
import { batchRoutes } from './routes/batches.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { teamRoutes } from './routes/teams.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { adminRoutes } from './routes/admin.js'
import { proxyRoutes } from './routes/proxy.js'
import { assetRoutes } from './routes/assets.js'
import { videoRoutes } from './routes/videos.js'
import multipart from '@fastify/multipart'
import { aiAssistantRoutes } from './routes/ai-assistant.js'
import { avatarRoutes } from './routes/avatar.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    bodyLimit: 100 * 1024 * 1024, // 100 MB — supports up to 10 reference images at 20 MB each (base64 overhead ~33%)
  })

  await app.register(sensible)
  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } })

  // CORS — restrict to allowed origins
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map(s => s.trim())
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // managed by Next.js for frontend
  })

  // Attach Redis client
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  app.decorate('redis', redis)

  app.addHook('onClose', async () => {
    await redis.quit()
  })

  // Global rate limit: 200 requests per minute per IP (applies to all routes)
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试` },
    }),
  })

  // Plugins
  await app.register(jwtAuthPlugin)

  // Routes — all prefixed with /api/v1
  await app.register(
    async (v1) => {
      await v1.register(authRoutes)
      await v1.register(userRoutes)
      await v1.register(healthzRoutes)
      await v1.register(generateRoutes)
      await v1.register(sseRoutes)
      await v1.register(batchRoutes)
      await v1.register(teamRoutes)
      await v1.register(workspaceRoutes)
      await v1.register(adminRoutes)
      await v1.register(proxyRoutes)
      await v1.register(assetRoutes)
      await v1.register(videoRoutes)
      await v1.register(aiAssistantRoutes)
      await v1.register(avatarRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
