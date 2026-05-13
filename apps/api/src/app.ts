import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { buildLogger, buildAccessLogger } from './logger.js'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { jwtAuthPlugin } from './plugins/jwt-auth.js'
import { generateRoutes } from './routes/generate.js'
import { batchRoutes } from './routes/batches.js'
import { teamRoutes } from './routes/teams.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { adminRoutes } from './routes/admin.js'
import { assetRoutes } from './routes/assets.js'
import { videoRoutes } from './routes/videos.js'
import multipart from '@fastify/multipart'
import { aiAssistantRoutes } from './routes/ai-assistant.js'
import { avatarRoutes } from './routes/avatar.js'
import { actionImitationRoutes } from './routes/action-imitation.js'
import { canvasRoutes } from './routes/canvas.js'
import { canvasAgentRoutes } from './routes/canvas-agent.js'
import { videoStudioRoutes } from './routes/video-studio.js'
import { companyARoutes } from './routes/company-a.js'
import { paymentRoutes } from './routes/payment.js'
import autoload from '@fastify/autoload'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const logger = buildLogger()
  const accessLogger = buildAccessLogger()

  const app = Fastify({
    logger: logger as unknown as boolean,
    bodyLimit: 100 * 1024 * 1024, // 100 MB — supports up to 10 reference images at 20 MB each (base64 overhead ~33%)
  })

  // HTTP 请求日志单独写 access 文件
  app.addHook('onResponse', (request, reply, done) => {
    accessLogger.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: Math.round(reply.elapsedTime),
      reqId: request.id,
    })
    done()
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

  // Global rate limit: 1200 requests per minute per client identity.
  // Fine-grained routes (e.g. login/generate) define stricter per-route limits.
  // Keyed by Authorization header user-id when present, falling back to IP — prevents NAT/proxy users from sharing a bucket
  await app.register(rateLimit, {
    global: true,
    max: 1200,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => {
      // If an Authorization header is present, key by the bearer token prefix (first 16 chars are unique per user)
      // This stops multiple users behind the same NAT from colliding in the same bucket
      const auth = request.headers.authorization
      if (auth?.startsWith('Bearer ')) {
        // Use first 16 chars of the token as a per-user discriminator (not the full token for security)
        const tokenPrefix = auth.slice(7, 23)
        return `${request.ip}:${tokenPrefix}`
      }
      return request.ip
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试` },
    }),
  })

  // Plugins
  await app.register(jwtAuthPlugin)

  // Swagger UI（仅开发环境，必须在 autoload 之前注册）
  if (process.env.NODE_ENV !== 'production') {
    await app.register(import('@fastify/swagger'), {
      openapi: {
        info: { title: 'AIGC API', version: '1.0.0', description: 'AIGC 创作平台 API 文档' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    })
    await app.register(import('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
    })
  }

  // autoload 自动扫描 routes/ 子目录，加载已迁移为单文件格式的路由
  // ignoreFilter 排除 routes/ 根目录下的旧单文件（如 auth.ts），只加载子目录中的文件（如 healthz/get.ts）
  await app.register(autoload, {
    dir: join(__dirname, 'routes'),
    dirNameRoutePrefix: false,
    forceESM: true,
    prefix: '/api/v1',
    autoHooks: true,
    cascadeHooks: false,
    ignoreFilter: (filePath: string) => {
      // 将路径统一为正斜杠，取相对于 routes/ 目录的部分
      const normalized = filePath.replace(/\\/g, '/')
      const routesDir = join(__dirname, 'routes').replace(/\\/g, '/')
      const relative = normalized.startsWith(routesDir)
        ? normalized.slice(routesDir.length + 1)
        : normalized
      // 排除 routes/ 根目录下的文件（路径中不含 /，即直接子文件）
      return !relative.includes('/')
    },
  })

  // Routes — all prefixed with /api/v1（旧格式路由，待逐步迁移）
  await app.register(
    async (v1) => {
      await v1.register(generateRoutes)
      await v1.register(batchRoutes)
      await v1.register(teamRoutes)
      await v1.register(workspaceRoutes)
      await v1.register(adminRoutes)
      await v1.register(assetRoutes)
      await v1.register(videoRoutes)
      await v1.register(aiAssistantRoutes)
      await v1.register(avatarRoutes)
      await v1.register(actionImitationRoutes)
      await v1.register(canvasRoutes)
      await v1.register(canvasAgentRoutes)
      await v1.register(videoStudioRoutes)
      await v1.register(companyARoutes)
      await v1.register(paymentRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
