import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import rateLimit from '@fastify/rate-limit'
import { uploadToTos } from '../../lib/storage.js'
import { MAX_VIDEO_SIZE, VIDEO_EXTS, VIDEO_MIME } from './_shared.js'

// POST /ai-assistant/upload — 上传视频到 TOS，返回公网 URL 供豆包/Gemini 拉取
const route: FastifyPluginAsync = async (app) => {
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

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const contentType = VIDEO_MIME[ext] ?? 'video/mp4'
    const key = `uploads/ai-assistant/${randomUUID()}.${ext}`
    const url = await uploadToTos(key, buffer, contentType)

    // 返回 url 供 post-chat 直接使用，temp_id 保留兼容旧字段名
    return { temp_id: key, url }
  })
}

export default route
