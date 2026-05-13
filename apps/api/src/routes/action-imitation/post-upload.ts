import type { FastifyPluginAsync } from 'fastify'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { UPLOAD_DIR, MAX_VIDEO_SIZE, VIDEO_EXTS } from './_shared.js'

// POST /action-imitation/upload — 上传驱动视频，返回 temp_id + 公开 URL 供火山引擎拉取
const route: FastifyPluginAsync = async (app) => {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  app.post('/action-imitation/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_VIDEO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    if (!VIDEO_EXTS.includes(ext)) {
      return reply.badRequest('Unsupported file type. Video: mp4/mov/webm')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)
    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/action-imitation/uploads/${id}` }
  })
}

export default route
