import type { FastifyPluginAsync } from 'fastify'
import { getTosObjectBuffer, extractStorageKey } from '../../lib/storage.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /assets/fetch?key=<storageKey> — 需要 JWT 鉴权，服务端读取 TOS 内容返回原始字节
  // 用途：前端将历史图片作为参考图时，通过此接口绕过 TOS 预签名 URL 的跨域限制
  app.get<{ Querystring: { key: string } }>(
    '/assets/fetch',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { key } = request.query

      const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
      if (!publicUrl) {
        return reply.code(503).send({ error: 'Storage not configured' })
      }

      // 前端传入的 key 可能是百分号编码态（含 %20 等）。extractStorageKey 内部会
      // decodeURIComponent 还原成 TOS 真实存储的原始 key。校验归属与取对象必须使用
      // 同一个（还原后的）key，否则半编码 key 会导致 getTosObjectBuffer NoSuchKey。
      const fullUrl = `${publicUrl}/${key}`
      const resolvedKey = extractStorageKey(fullUrl)
      if (!resolvedKey) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      // 防止路径穿越：用还原后的原始 key 校验，避免 %2e%2e 等编码绕过
      if (resolvedKey.includes('..') || resolvedKey.startsWith('/')) {
        return reply.code(400).send({ error: 'Invalid key' })
      }

      let buffer: Buffer
      try {
        buffer = await getTosObjectBuffer(resolvedKey)
      } catch (err) {
        app.log.warn({ err, key: resolvedKey }, 'Failed to fetch asset from TOS')
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      // 根据文件扩展名推断 Content-Type
      const ext = resolvedKey.split('.').pop()?.toLowerCase()
      const contentType =
        ext === 'mp4' ? 'video/mp4' :
        ext === 'webp' ? 'image/webp' :
        ext === 'png' ? 'image/png' :
        'image/jpeg'

      reply.header('Content-Type', contentType)
      // 内容不变，可长期缓存
      reply.header('Cache-Control', 'private, max-age=3600')
      return reply.send(buffer)
    },
  )
}

export default route
