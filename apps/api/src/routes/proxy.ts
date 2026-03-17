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
          upstream = await fetch(url)
        } catch {
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

      // Pass-through (original behaviour)
      let upstream: Response
      try {
        upstream = await fetch(url)
      } catch {
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      if (!upstream.ok) {
        return reply.code(upstream.status).send({ error: 'Upstream error' })
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      const contentLength = upstream.headers.get('content-length')

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      if (contentLength) reply.header('Content-Length', contentLength)

      return reply.send(upstream.body)
    },
  )
}
