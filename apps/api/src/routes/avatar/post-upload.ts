import type { FastifyPluginAsync } from 'fastify'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { UPLOAD_DIR, MAX_AUDIO_SIZE, IMAGE_EXTS, AUDIO_EXTS } from './_shared.js'

// POST /avatar/upload — 上传图片或音频，返回 temp_id + 公开 URL 供火山引擎拉取
const route: FastifyPluginAsync = async (app) => {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  app.post('/avatar/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_AUDIO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    const isImage = IMAGE_EXTS.includes(ext)
    const isAudio = AUDIO_EXTS.includes(ext)
    if (!isImage && !isAudio) {
      return reply.badRequest('Unsupported file type. Images: jpg/png/webp; Audio: mp3/wav/m4a/aac')
    }
    // 图片大小单独校验（音频限制已在 file() 中设置）
    if (isImage && data.file.bytesRead > 10 * 1024 * 1024) {
      return reply.badRequest('Image too large (max 10 MB)')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)
    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/avatar/uploads/${id}` }
  })
}

export default route
