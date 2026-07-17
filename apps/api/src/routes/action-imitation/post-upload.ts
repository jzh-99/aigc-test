import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { uploadToTos } from '../../lib/storage.js'
import { MAX_VIDEO_SIZE, VIDEO_EXTS, VIDEO_MIME } from './_shared.js'

// POST /action-imitation/upload — 上传驱动视频到 TOS，返回公网 URL 供火山引擎拉取
const route: FastifyPluginAsync = async (app) => {
  app.post('/action-imitation/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_VIDEO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    if (!VIDEO_EXTS.includes(ext)) {
      return reply.badRequest('Unsupported file type. Video: mp4/mov/webm')
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const contentType = VIDEO_MIME[ext] ?? 'video/mp4'
    const key = `uploads/action-imitation/${randomUUID()}.${ext}`
    const url = await uploadToTos(key, buffer, contentType)

    return { url }
  })
}

export default route
