import type { FastifyPluginAsync } from 'fastify'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import rateLimit from '@fastify/rate-limit'
import { UPLOAD_DIR, MAX_VIDEO_SIZE, VIDEO_EXTS, BASE_URL } from './_shared.js'

// POST /ai-assistant/upload — 上传视频文件，返回 temp_id + 公开 URL 供 Gemini 拉取
const route: FastifyPluginAsync = async (app) => {
  await mkdir(UPLOAD_DIR, { recursive: true })

  // AI assistant 限流：每用户每小时 50 次
  await app.register(rateLimit, {
    max: 50,
    timeWindow: '1 hour',
    keyGenerator: (request) => {
      const userId = request.user?.id || request.ip
      return `ai-assistant:${userId}`
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `AI助手使用次数已达上限（50次/小时），请 ${Math.ceil(context.ttl / 60000)} 分钟后再试`,
      },
    }),
  })

  app.post('/ai-assistant/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_VIDEO_SIZE } })

    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? 'mp4'
    if (!VIDEO_EXTS.includes(ext)) {
      return reply.badRequest('Only video files are supported (mp4, mov, webm, avi)')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)

    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/ai-assistant/uploads/${id}` }
  })
}

export default route
