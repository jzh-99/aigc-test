import type { FastifyInstance } from 'fastify'

// Only proxy URLs from allowed storage hosts to prevent SSRF
function isAllowedUrl(url: string): boolean {
  const storageUrl = process.env.EXTERNAL_STORAGE_URL ?? ''
  if (!storageUrl) return false
  try {
    const allowed = new URL(storageUrl)
    const target = new URL(url)
    return target.hostname === allowed.hostname && target.port === allowed.port
  } catch {
    return false
  }
}

// Fetch with a timeout to avoid hanging connections blocking the event loop
async function fetchWithTimeout(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers })
  } finally {
    clearTimeout(timer)
  }
}

const PROXY_TIMEOUT_MS = 20_000 // 20 seconds — external storage SLA

export async function proxyRoutes(app: FastifyInstance) {
  // In-memory thumbnail cache: key = "url:width", value = WebP Buffer
  const thumbCache = new Map<string, { data: Buffer; createdAt: number }>()
  const THUMB_CACHE_MAX = 500

  // GET /api/v1/assets/proxy?url=<encoded_storage_url>[&w=<width>]
  // When &w is provided, returns a resized WebP thumbnail instead of the original.
  app.get<{ Querystring: { url: string; w?: string } }>(
    '/assets/proxy',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string' },
            w: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { url, w } = request.query
      const width = w ? Math.min(parseInt(w, 10) || 400, 1200) : null

      if (!isAllowedUrl(url)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      // Serve resized WebP thumbnail
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
        } catch (err: any) {
          if (err?.name === 'AbortError') {
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
          const sharp = (await import('sharp')).default
          resultBuffer = await sharp(rawBuffer)
            .resize(width, null, { withoutEnlargement: true, fit: 'inside' })
            .webp({ quality: 82 })
            .toBuffer()
          contentType = 'image/webp'
        } catch {
          resultBuffer = rawBuffer
          contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
        }

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

      // Pass-through — forward Range header so browsers can efficiently load video metadata
      const upstreamHeaders: Record<string, string> = {}
      const rangeHeader = request.headers['range']
      if (rangeHeader) upstreamHeaders['Range'] = rangeHeader

      let upstream: Response
      try {
        upstream = await fetchWithTimeout(url, PROXY_TIMEOUT_MS, upstreamHeaders)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
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
      // Partial responses must not be cached indefinitely
      reply.header('Cache-Control', contentRange ? 'no-store' : 'public, max-age=31536000, immutable')

      return reply.send(upstream.body)
    },
  )
}
