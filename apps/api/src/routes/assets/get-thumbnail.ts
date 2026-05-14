import type { FastifyPluginAsync } from 'fastify'
import { getTosObjectBuffer, signThumbnailUrl, verifyThumbnailSig } from '../../lib/storage.js'

// 模块级缩略图缓存：key = "storageKey:width"，value = WebP Buffer
const thumbnailCache = new Map<string, { data: Buffer; createdAt: number }>()
const THUMBNAIL_CACHE_MAX = 500

const route: FastifyPluginAsync = async (app) => {
  // GET /assets/thumbnail — 返回缩略图 WebP（无需鉴权，HMAC 签名验证）
  app.get<{ Querystring: { key: string; w?: string; exp: string; sig: string } }>(
    '/assets/thumbnail',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['key', 'exp', 'sig'],
          properties: {
            key: { type: 'string' },
            w: { type: 'string' },
            exp: { type: 'string' },
            sig: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { key, w, exp, sig } = request.query
      const width = Math.min(parseInt(w ?? '400', 10) || 400, 1200)
      const expNum = parseInt(exp, 10)

      if (!verifyThumbnailSig(key, width, expNum, sig)) {
        return reply.code(403).send({ error: 'Invalid or expired thumbnail URL' })
      }

      const cacheKey = `${key}:${width}`
      const cached = thumbnailCache.get(cacheKey)
      if (cached) {
        reply.header('Content-Type', 'image/webp')
        reply.header('Cache-Control', 'public, max-age=86400, immutable')
        reply.header('X-Cache', 'HIT')
        return reply.send(cached.data)
      }

      let rawBuffer: Buffer
      try {
        rawBuffer = await getTosObjectBuffer(key)
      } catch (err) {
        app.log.warn({ err, key }, 'Failed to fetch asset from S3 for thumbnail')
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

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
        // 降级：直接返回原始字节
        resultBuffer = rawBuffer
        contentType = 'image/jpeg'
      }

      // LRU 淘汰：超出上限时删除最旧的 100 条
      if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
        const oldest = [...thumbnailCache.entries()]
          .sort((a, b) => a[1].createdAt - b[1].createdAt)
          .slice(0, 100)
          .map(([k]) => k)
        for (const k of oldest) thumbnailCache.delete(k)
      }
      thumbnailCache.set(cacheKey, { data: resultBuffer, createdAt: Date.now() })

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=86400, immutable')
      reply.header('X-Cache', 'MISS')
      return reply.send(resultBuffer)
    },
  )
}

export default route
