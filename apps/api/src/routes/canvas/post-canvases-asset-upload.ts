import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { getStorageRuntimeInfo, signAssetUrl, uploadToTos } from '../../lib/storage.js'
import { CANVAS_ENABLED_TEAM_TYPES } from './_shared.js'

function getMultipartFieldValue(field: unknown): string | undefined {
  if (!field || typeof field !== 'object') return undefined
  const value = (field as { value?: unknown }).value
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getAssetType(mimeType: string): 'image' | 'video' | 'audio' {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'image'
}

// POST /canvases/asset-upload — 上传图片/视频/音频文件作为画布资产使用
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

    const data = await (request as any).file({ limits: { fileSize: 50 * 1024 * 1024 } })
    if (!data) return reply.badRequest('No file provided')

    const canvasId = getMultipartFieldValue(data.fields?.canvas_id)
    const canvasNodeId = getMultipartFieldValue(data.fields?.canvas_node_id)

    let canvasContext: { workspaceId: string; teamId: string } | null = null
    if (canvasId) {
      const canvas = await db
        .selectFrom('canvases')
        .innerJoin('workspaces', 'workspaces.id', 'canvases.workspace_id')
        .innerJoin('teams', 'teams.id', 'workspaces.team_id')
        .select(['canvases.workspace_id as workspaceId', 'workspaces.team_id as teamId', 'teams.team_type as teamType'])
        .where('canvases.id', '=', canvasId)
        .where('canvases.is_deleted', '=', false)
        .executeTakeFirst()

      if (!canvas) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })
      }
      if (!CANVAS_ENABLED_TEAM_TYPES.includes(canvas.teamType as any)) {
        return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
      }

      const member = await db
        .selectFrom('workspace_members')
        .select('role')
        .where('workspace_id', '=', canvas.workspaceId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })
      }

      canvasContext = { workspaceId: canvas.workspaceId, teamId: canvas.teamId }
    } else {
      // 无画布上下文时保持旧行为：只验证用户属于任意已开通画布功能的工作区。
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
    }

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
      let assetRecord: { assetId: string; batchId: string; taskId: string } | null = null

      if (canvasContext && canvasId) {
        const creditAccount = await db
          .selectFrom('credit_accounts')
          .select('id')
          .where('owner_type', '=', 'team')
          .where('team_id', '=', canvasContext.teamId)
          .executeTakeFirst()

        if (!creditAccount) {
          return reply.status(500).send({ success: false, error: { code: 'CREDIT_ACCOUNT_MISSING', message: '未找到团队A豆账户' } })
        }

        assetRecord = await db.transaction().execute(async (trx) => {
          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: canvasContext.teamId,
              workspace_id: canvasContext.workspaceId,
              credit_account_id: creditAccount.id,
              idempotency_key: `canvas_upload_${userId}_${Date.now()}_${randomUUID()}`,
              module: 'agent',
              provider: 'upload',
              model: 'manual-upload',
              prompt: data.filename || '上传素材',
              params: JSON.stringify({ filename: data.filename, mime_type: mimeType, size: buffer.length }),
              quantity: 1,
              completed_count: 1,
              status: 'completed',
              estimated_credits: 0,
              actual_credits: 0,
              is_hidden: true,
              canvas_id: canvasId,
              canvas_node_id: canvasNodeId ?? null,
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          const task = await trx
            .insertInto('tasks')
            .values({
              batch_id: batch.id,
              user_id: userId,
              version_index: 0,
              estimated_credits: 0,
              credits_cost: 0,
              status: 'completed',
              processing_started_at: new Date(),
              completed_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          const asset = await trx
            .insertInto('assets')
            .values({
              task_id: task.id,
              batch_id: batch.id,
              user_id: userId,
              type: getAssetType(mimeType),
              storage_url: storageUrl,
              original_url: storageUrl,
              transfer_status: 'completed',
              file_size: buffer.length,
              metadata: JSON.stringify({ filename: data.filename, mime_type: mimeType }),
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          return { assetId: asset.id, batchId: batch.id, taskId: task.id }
        })
      }

      return reply.send({ url: signedUrl ?? storageUrl, storageUrl, asset: assetRecord })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '上传服务暂时不可用，请稍后重试'
      app.log.error({ err, storage: getStorageRuntimeInfo() }, 'Canvas asset upload failed')
      return reply.status(502).send({
        success: false,
        error: { code: 'UPLOAD_FAILED', message },
      })
    }
  })
}

export default route
