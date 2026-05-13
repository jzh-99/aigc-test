import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { buildLogger, buildAccessLogger } from './logger.js'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { jwtAuthPlugin } from './plugins/jwt-auth.js'
import multipart from '@fastify/multipart'
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

  // Attach Redis client（普通命令）
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  app.decorate('redis', redis)

  // 专用 Pub/Sub 订阅连接：subscribe 模式下连接不能复用做普通命令，单独维护
  const redisSub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  app.decorate('redisSub', redisSub)

  app.addHook('onClose', async () => {
    await redis.quit()
    await redisSub.quit()
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

  // 用 Fastify 原生 scoped plugin 挂载 /api/v1 前缀
  // autoload v5 的 prefix 选项与 dirNameRoutePrefix:false 组合时不生效，改用此方式
  await app.register(async (instance) => {
    await instance.register(autoload, {
      dir: join(__dirname, 'routes'),
      dirNameRoutePrefix: false,
      forceESM: true,
      autoHooks: true,
      cascadeHooks: false,
      ignorePattern: /^_/,
    })
  }, { prefix: '/api/v1' })

  return app
}
