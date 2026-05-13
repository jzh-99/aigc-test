import type { FastifyPluginAsync } from 'fastify'
import { createReadStream } from 'node:fs'
import { unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { UPLOAD_DIR, MAX_FILE_AGE_MS, VIDEO_MIME, SAFE_ID } from './_shared.js'

// GET /action-imitation/uploads/:id — 公开提供临时视频文件（无需鉴权），供火山引擎拉取
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/action-imitation/uploads/:id', async (request, reply) => {
    const { id } = request.params
    if (!SAFE_ID.test(id)) return reply.status(404).send()

    const filePath = join(UPLOAD_DIR, id)
    try {
      const s = await stat(filePath)
      if (Date.now() - s.mtimeMs > MAX_FILE_AGE_MS) {
        await unlink(filePath).catch(() => {})
        return reply.status(404).send()
      }
      const ext = id.split('.').pop()!
      const mime = VIDEO_MIME[ext] ?? 'application/octet-stream'
      reply.header('Content-Type', mime)
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
