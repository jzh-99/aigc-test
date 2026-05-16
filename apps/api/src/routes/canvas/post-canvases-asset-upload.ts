import type { FastifyPluginAsync } from 'fastify'
import { createWriteStream } from 'node:fs'
import { unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { signAssetUrl, uploadToTos } from '../../lib/storage.js'
import {
  CANVAS_UPLOAD_DIR,
  CANVAS_ENABLED_TEAM_TYPES,
  hasS3UploadConfig,
  uploadViaLocalTemp,
} from './_shared.js'

// POST /canvases/asset-upload — 上传图片/视频文件作为资产节点使用
const route: FastifyPluginAsync = async (app) => {
  // 确保临时上传目录存在
  await mkdir(CANVAS_UPLOAD_DIR, { recursive: true })

  app.post('/canvases/asset-upload', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const userId = request.user.id

    // 验证用户是否属于已开通画布功能的工作区
    const memberships = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .innerJoin('teams', 'teams.id', 'workspaces.team_id')
      .select('workspace_members.workspace_id')
      .where('workspace_members.user_id', '=', userId)
      .where('teams.team_type', 'in', CANVAS_ENABLED_TEAM_TYPES)
      .limit(1)
      .execute()

    if (memberships.length === 0) {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    const data = await (request as any).file({ limits: { fileSize: 50 * 1024 * 1024 } })
    if (!data) return reply.badRequest('No file provided')

    const mimeType: string = data.mimetype ?? ''
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
      return reply.badRequest('Only image, video, and audio files are supported')
    }

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? 'bin'
    const fileId = `${randomUUID()}.${ext}`
    const filePath = join(CANVAS_UPLOAD_DIR, fileId)

    // 先流式写入磁盘
    await pipeline(data.file, createWriteStream(filePath))

    try {
      let storageUrl: string

      if (hasS3UploadConfig()) {
        const key = `canvas-assets/${fileId}`
        try {
          const buf = await import('node:fs/promises').then((m) => m.readFile(filePath))
          storageUrl = await uploadToTos(key, buf, mimeType)
        } catch (err: any) {
          app.log.warn({ err: err?.message ?? String(err) }, 'S3 upload failed, fallback to external storage')
          storageUrl = await uploadViaLocalTemp(fileId, mimeType)
        }
      } else {
        storageUrl = await uploadViaLocalTemp(fileId, mimeType)
      }

      const signedUrl = await signAssetUrl(storageUrl)
      return reply.send({ url: signedUrl ?? storageUrl, storageUrl })
    } catch (err: any) {
      app.log.error({ err: err?.message ?? String(err) }, 'Canvas asset upload failed')
      return reply.status(502).send({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: err?.message ?? '上传服务暂时不可用，请稍后重试',
        },
      })
    } finally {
      // 无论成功失败都清理临时文件
      unlink(filePath).catch(() => {})
    }
  })
}

export default route
