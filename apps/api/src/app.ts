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
    // tag 中文映射表
    const TAG_LABELS: Record<string, string> = {
      auth: '认证',
      users: '用户',
      teams: '团队',
      workspaces: '工作区',
      models: '模型',
      generate: '图片生成',
      batches: '任务批次',
      assets: '素材',
      canvas: '画布',
      'canvas-agent': '画布 AI 助手',
      'ai-assistant': 'AI 助手',
      avatar: '头像生成',
      'action-imitation': '动作模仿',
      'video-studio': '视频工作室',
      videos: '视频',
      payment: '支付',
      sse: 'SSE 推送',
      admin: '管理后台',
      'company-a': '外部图库',
      proxy: '资源代理',
      healthz: '健康检查',
      'client-errors': '客户端错误上报',
    }

    // HTTP 方法 → 操作动词
    const METHOD_VERB: Record<string, string> = {
      GET: '查询',
      POST: '创建',
      PUT: '替换',
      PATCH: '更新',
      DELETE: '删除',
    }

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
      // 自动为没有 schema.tags/summary 的路由补全分组和摘要
      transform({ schema, url, route }) {
        // /docs 内部路由没有 schema，直接透传
        if (!schema) return { schema, url }
        const s = schema as Record<string, unknown>

        // 非 /api/v1 路由（如 /docs 内部路由）不处理
        if (!url.startsWith('/api/v1/')) return { schema, url }

        // 从 /api/v1/<module>/... 提取模块名
        const match = url.match(/^\/api\/v1\/([^/]+)/)
        const module = match?.[1] ?? 'other'
        const tagLabel = TAG_LABELS[module] ?? module

        const tags: string[] = Array.isArray(s.tags) && s.tags.length > 0
          ? (s.tags as string[])
          : [tagLabel]

        // 没有 summary 时自动生成：「操作动词 + 路径末段」
        const autoSummary = (() => {
          const method = (route.method as string | string[])
          const verb = METHOD_VERB[(Array.isArray(method) ? method[0] : method).toUpperCase()] ?? method
          // 取路径最后一段（去掉 :param 前缀的冒号）
          const lastSeg = url.split('/').filter(Boolean).pop() ?? ''
          const label = lastSeg.startsWith(':') ? lastSeg.slice(1) : lastSeg
          return `${verb} ${label}`
        })()

        const summary = typeof s.summary === 'string' && s.summary.length > 0
          ? s.summary
          : autoSummary

        return { schema: { ...s, tags, summary }, url }
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
