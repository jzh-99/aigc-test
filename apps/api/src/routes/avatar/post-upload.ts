import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { uploadToTos } from '../../lib/storage.js'
import { MAX_IMAGE_SIZE, MAX_AUDIO_SIZE, IMAGE_EXTS, AUDIO_EXTS, IMAGE_MIME, AUDIO_MIME } from './_shared.js'

// POST /avatar/upload — 上传图片或音频到 TOS，返回公网 URL 供火山引擎拉取
const route: FastifyPluginAsync = async (app) => {
  app.post('/avatar/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_AUDIO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    const isImage = IMAGE_EXTS.includes(ext)
    const isAudio = AUDIO_EXTS.includes(ext)
    if (!isImage && !isAudio) {
      return reply.badRequest('Unsupported file type. Images: jpg/png/webp; Audio: mp3/wav/m4a/aac')
    }
    if (isImage && data.file.bytesRead > MAX_IMAGE_SIZE) {
      return reply.badRequest('Image too large (max 10 MB)')
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const mimeMap = isImage ? IMAGE_MIME : AUDIO_MIME
    const contentType = mimeMap[ext] ?? 'application/octet-stream'
    const key = `uploads/avatar/${randomUUID()}.${ext}`
    const url = await uploadToTos(key, buffer, contentType)

    return { url }
  })
}

export default route
