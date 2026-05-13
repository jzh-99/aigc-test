import type { FastifyPluginAsync } from 'fastify'
import { createReadStream } from 'node:fs'
import { unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CANVAS_UPLOAD_DIR, CANVAS_UPLOAD_MAX_AGE_MS, SAFE_CANVAS_ID } from './_shared.js'

// GET /canvases/uploads/:id — 公开临时文件服务（无需认证），供外部存储拉取
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/canvases/uploads/:id', async (request, reply) => {
    const { id } = request.params
    // 安全校验：只允许合法文件名，防止路径穿越
    if (!SAFE_CANVAS_ID.test(id)) return reply.status(404).send()
    const filePath = join(CANVAS_UPLOAD_DIR, id)
    try {
      const s = await stat(filePath)
      // 超过最大存活时间则删除并返回 404
      if (Date.now() - s.mtimeMs > CANVAS_UPLOAD_MAX_AGE_MS) {
        await unlink(filePath).catch(() => {})
        return reply.status(404).send()
      }
      const ext = id.split('.').pop()!
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
        gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      }
      reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream')
      reply.header('Content-Length', s.size)
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Robots-Tag', 'noindex')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send()
    }
  })
}

export default route
