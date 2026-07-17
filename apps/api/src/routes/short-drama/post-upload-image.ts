import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { uploadToTos } from '../../lib/storage.js'
import { assertShortDramaProjectAccess } from './_shared.js'

// 支持的图片类型和对应 MIME
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

// 最大 10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

export default async function postUploadImage(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/short-drama/projects/:id/assets/upload-image',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params
      const userId = request.user.id

      // 权限校验
      await assertShortDramaProjectAccess(projectId, userId, true)

      // 读取 multipart 文件
      const data = await (request as any).file({ limits: { fileSize: MAX_IMAGE_SIZE } })
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: '未提供文件' },
        })
      }

      // 校验文件类型
      const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTS.includes(ext)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TYPE', message: '仅支持 JPG/PNG/WEBP 格式' },
        })
      }

      // 读取文件内容
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)

      // 二次校验大小（防止 bytesRead 超出限制）
      if (buffer.length > MAX_IMAGE_SIZE) {
        return reply.status(400).send({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: '图片大小不能超过 10MB' },
        })
      }

      // 上传到 TOS
      const contentType = IMAGE_MIME[ext] ?? 'application/octet-stream'
      const key = `uploads/short-drama/${projectId}/${randomUUID()}.${ext}`
      const url = await uploadToTos(key, buffer, contentType)

      return { url }
    }
  )
}
