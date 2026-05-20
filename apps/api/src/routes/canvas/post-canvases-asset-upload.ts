import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { signAssetUrl, uploadToTos } from '../../lib/storage.js'
import { CANVAS_ENABLED_TEAM_TYPES } from './_shared.js'

// POST /canvases/asset-upload — 上传图片/视频文件作为资产节点使用
const route: FastifyPluginAsync = async (app) => {
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

    // 读取流为 Buffer，直接上传到 TOS/S3，与 worker 转存逻辑一致
    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    try {
      const key = `canvas-assets/${fileId}`
      const storageUrl = await uploadToTos(key, buffer, mimeType)
      const signedUrl = await signAssetUrl(storageUrl)
      return reply.send({ url: signedUrl ?? storageUrl, storageUrl })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '上传服务暂时不可用，请稍后重试'
      app.log.error({ err: message }, 'Canvas asset upload failed')
      return reply.status(502).send({
        success: false,
        error: { code: 'UPLOAD_FAILED', message },
      })
    }
  })
}

export default route
