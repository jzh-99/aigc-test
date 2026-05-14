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

      // 防止路径穿越：key 不能包含 .. 或以 / 开头
      if (key.includes('..') || key.startsWith('/')) {
        return reply.code(400).send({ error: 'Invalid key' })
      }

      // 验证 key 确实属于本存储（通过 extractStorageKey 反向校验）
      const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
      if (!publicUrl) {
        return reply.code(503).send({ error: 'Storage not configured' })
      }
      const fullUrl = `${publicUrl}/${key}`
      if (!extractStorageKey(fullUrl)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      let buffer: Buffer
      try {
        buffer = await getTosObjectBuffer(key)
      } catch (err) {
        app.log.warn({ err, key }, 'Failed to fetch asset from TOS')
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      // 根据文件扩展名推断 Content-Type
      const ext = key.split('.').pop()?.toLowerCase()
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
