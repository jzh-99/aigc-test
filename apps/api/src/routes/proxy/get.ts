import type { FastifyPluginAsync } from 'fastify'
import { decryptProxyUrl } from '../../lib/storage.js'

// 只允许代理配置的存储主机 URL，防止 SSRF（服务端请求伪造）攻击
function isAllowedUrl(url: string): boolean {
  const allowedHosts: Array<{ hostname: string; port: string }> = []

  for (const envVar of ['EXTERNAL_STORAGE_URL', 'EXTERNAL_STORAGE_BASE', 'COMPANY_A_IMAGE_BASE']) {
    const raw = process.env[envVar] ?? ''
    if (!raw) continue
    try {
      const parsed = new URL(raw)
      allowedHosts.push({ hostname: parsed.hostname, port: parsed.port })
    } catch {
      // 忽略无效的环境变量 URL
    }
  }

  if (allowedHosts.length === 0) return false

  try {
    const target = new URL(url)
    return allowedHosts.some(
      (h) => target.hostname === h.hostname && target.port === h.port,
    )
  } catch {
    return false
  }
}

// 带超时的 fetch，避免挂起连接阻塞事件循环
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers })
  } finally {
    clearTimeout(timer)
  }
}

// 图片代理超时：20 秒
const PROXY_TIMEOUT_MS = 20_000
// 视频/音频代理超时：2 分钟（文件较大）
const PROXY_VIDEO_TIMEOUT_MS = 120_000

// 资源代理路由：支持图片缩略图（WebP）和视频/音频透传
const route: FastifyPluginAsync = async (app) => {
  // 内存缩略图缓存：key = "url:width"，value = WebP Buffer
  const thumbCache = new Map<string, { data: Buffer; createdAt: number }>()
  const THUMB_CACHE_MAX = 500

  // GET /api/v1/assets/proxy?token=<encrypted>[&w=<width>]
  // token: AES-256-GCM 加密的 URL（由 storage.ts 中的 encryptProxyUrl 生成）
  // 传入 &w 时返回缩放后的 WebP 缩略图，否则透传原始资源
  app.get<{ Querystring: { token: string; w?: string } }>(
    '/assets/proxy',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
            w: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, w } = request.query
      const width = w ? Math.min(parseInt(w, 10) || 400, 1200) : null

      // 解密 token 还原真实 URL
      const url = decryptProxyUrl(token)
      if (!url) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      // SSRF 防护：只允许访问已配置的存储主机
      if (!isAllowedUrl(url)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      // 返回缩放后的 WebP 缩略图
      if (width) {
        const cacheKey = `${url}:${width}`
        const cached = thumbCache.get(cacheKey)
        if (cached) {
          reply.header('Content-Type', 'image/webp')
          reply.header('Cache-Control', 'public, max-age=86400, immutable')
          reply.header('X-Cache', 'HIT')
          return reply.send(cached.data)
        }

        let upstream: Response
        try {
          upstream = await fetchWithTimeout(url, PROXY_TIMEOUT_MS)
        } catch (err: unknown) {
          if ((err as { name?: string })?.name === 'AbortError') {
            return reply.code(504).send({ error: 'Gateway timeout' })
          }
          return reply.code(502).send({ error: 'Failed to fetch asset' })
        }
        if (!upstream.ok) {
          return reply.code(upstream.status).send({ error: 'Upstream error' })
        }

        const rawBuffer = Buffer.from(await upstream.arrayBuffer())

        let resultBuffer: Buffer
        let contentType: string
        try {
          // 动态导入 sharp，避免在不支持的环境中启动失败
          const sharp = (await import('sharp')).default
          resultBuffer = await sharp(rawBuffer)
            .resize(width, null, { withoutEnlargement: true, fit: 'inside' })
            .webp({ quality: 82 })
            .toBuffer()
          contentType = 'image/webp'
        } catch {
          // sharp 处理失败时降级返回原始内容
          resultBuffer = rawBuffer
          contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
        }

        // 缓存满时淘汰最旧的 100 条
        if (thumbCache.size >= THUMB_CACHE_MAX) {
          const oldest = [...thumbCache.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, 100)
            .map(([k]) => k)
          for (const k of oldest) thumbCache.delete(k)
        }
        thumbCache.set(cacheKey, { data: resultBuffer, createdAt: Date.now() })

        reply.header('Content-Type', contentType)
        reply.header('Cache-Control', 'public, max-age=86400, immutable')
        reply.header('X-Cache', 'MISS')
        return reply.send(resultBuffer)
      }

      // 透传模式：转发 Range 头，支持浏览器高效加载视频元数据
      const upstreamHeaders: Record<string, string> = {}
      const rangeHeader = request.headers['range']
      if (rangeHeader) upstreamHeaders['Range'] = rangeHeader

      // 透传模式使用更长超时（可能传输大型视频/音频文件）
      let upstream: Response
      try {
        upstream = await fetchWithTimeout(url, PROXY_VIDEO_TIMEOUT_MS, upstreamHeaders)
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return reply.code(504).send({ error: 'Gateway timeout' })
        }
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      if (!upstream.ok && upstream.status !== 206) {
        return reply.code(upstream.status).send({ error: 'Upstream error' })
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      const contentLength = upstream.headers.get('content-length')
      const contentRange = upstream.headers.get('content-range')
      const acceptRanges = upstream.headers.get('accept-ranges')

      reply.code(upstream.status)
      reply.header('Content-Type', contentType)
      if (contentLength) reply.header('Content-Length', contentLength)
      if (contentRange) reply.header('Content-Range', contentRange)
      if (acceptRanges) reply.header('Accept-Ranges', acceptRanges)
      // 分片响应不可长期缓存，完整响应可永久缓存（内容不变）
      reply.header(
        'Cache-Control',
        contentRange ? 'no-store' : 'public, max-age=31536000, immutable',
      )

      // 先缓冲上游响应再发送，确保上游 socket 失败时能返回受控的 502
      let body: Buffer
      try {
        body = Buffer.from(await upstream.arrayBuffer())
      } catch (err) {
        request.log.warn({ err, url }, 'Failed to read proxied asset body')
        return reply.code(502).send({ error: 'Failed to read asset' })
      }

      return reply.send(body)
    },
  )
}

export default route
