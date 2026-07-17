import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { uploadToTos } from '../../lib/storage.js'
import {
  MAX_IMAGE_SIZE, MAX_VIDEO_SIZE, MAX_AUDIO_SIZE,
  IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, ALL_EXTS, MIME_MAP,
} from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /videos/upload — 上传图片/视频/音频到 TOS，返回公网 URL 供 Seedance 多模态使用
  app.post('/videos/upload', async (request, reply) => {
    const maxSize = Math.max(MAX_IMAGE_SIZE, MAX_VIDEO_SIZE, MAX_AUDIO_SIZE)
    const data = await (request as any).file({ limits: { fileSize: maxSize } })
    if (!data) return reply.badRequest('未检测到文件，请重新选择后上传')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    if (!ALL_EXTS.includes(ext)) {
      const allowed = `图片（${IMAGE_EXTS.join('/')}）、视频（${VIDEO_EXTS.join('/')}）、音频（${AUDIO_EXTS.join('/')}）`
      return reply.badRequest(`不支持的文件格式「.${ext}」，请上传 ${allowed} 格式的文件`)
    }

    const isImage = IMAGE_EXTS.includes(ext)
    const isVideo = VIDEO_EXTS.includes(ext)
    const isAudio = AUDIO_EXTS.includes(ext)
    const maxAllowed = isImage ? MAX_IMAGE_SIZE : isVideo ? MAX_VIDEO_SIZE : MAX_AUDIO_SIZE
    if (data.file.bytesRead > maxAllowed) {
      const mb = Math.round(maxAllowed / 1024 / 1024)
      const typeLabel = isImage ? '图片' : isVideo ? '视频' : '音频'
      return reply.badRequest(`${typeLabel}文件过大，最大支持 ${mb} MB，请压缩后重新上传`)
    }

    // 读取文件流为 Buffer，上传到 TOS
    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const contentType = MIME_MAP[ext] ?? 'application/octet-stream'
    const key = `uploads/videos/${randomUUID()}.${ext}`
    const url = await uploadToTos(key, buffer, contentType)

    return { url }
  })
}

export default route
