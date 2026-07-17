import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import {
  parseCategoryReferences,
  validateCategoryReferenceLimits,
  calculateVideoEstimatedCredits,
  type VideoCategory,
  type VideoReferenceCounts,
} from '@aigc/types'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { getVideoQueue } from '../../lib/queue.js'
import { resolveBatchSource } from '../../lib/batch-source.js'

// 视频生成允许的 params 键白名单
const ALLOWED_PARAM_KEYS = new Set([
  'aspect_ratio', 'resolution', 'duration', 'generate_audio',
  'enable_upsample', 'watermark',
  'images', 'reference_images', 'reference_videos', 'reference_audios',
  'video_category', 'reference_video_durations',
])

interface VideoGenerateBody {
  prompt: string
  workspace_id: string
  model: string
  aspect_ratio?: string
  resolution?: string
  duration?: number
  generate_audio?: boolean
  enable_upsample?: boolean
  watermark?: boolean
  images?: string[]
  reference_images?: string[]
  reference_videos?: string[]
  reference_video_durations?: number[]
  reference_audios?: string[]
  video_category?: VideoCategory
  canvas_id?: string
  canvas_node_id?: string
  video_studio_project_id?: string
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function resolveRequestCategory(body: VideoGenerateBody): { category: VideoCategory; counts: VideoReferenceCounts } | { error: string } {
  const framesCount = countArray(body.images)
  const referenceCounts: VideoReferenceCounts = {
    image: countArray(body.reference_images),
    video: countArray(body.reference_videos),
    audio: countArray(body.reference_audios),
    text: 0,
  }
  const hasReferences = referenceCounts.image > 0 || referenceCounts.video > 0 || referenceCounts.audio > 0

  if (framesCount > 0 && hasReferences) return { error: '同一次请求不能同时使用首尾帧和全能参考素材' }
  if (body.video_category === 'frames') return { category: 'frames', counts: { image: framesCount, video: 0, audio: 0, text: 0 } }
  if (body.video_category === 'multimodal') return { category: 'multimodal', counts: referenceCounts }
  if (framesCount > 0) return { category: 'frames', counts: { image: framesCount, video: 0, audio: 0, text: 0 } }
  return { category: 'multimodal', counts: referenceCounts }
}

function sanitizeParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(k)) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    } else if (Array.isArray(v)) {
      if (k === 'reference_video_durations') {
        out[k] = v
          .slice(0, 10)
          .map(item => Number(item))
          .filter(item => Number.isFinite(item) && item > 0)
        continue
      }
      out[k] = v.slice(0, 10).map(item => (typeof item === 'string' ? item : String(item)))
    }
  }
  return out
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: VideoGenerateBody }>('/videos/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt', 'workspace_id', 'model'],
        properties: {
          prompt:       { type: 'string', minLength: 1, maxLength: 15000 },
          workspace_id: { type: 'string', format: 'uuid' },
          model:        { type: 'string', minLength: 1, maxLength: 100 },
          // 视频参数（前端直接放顶层）
          aspect_ratio:     { type: 'string' },
          resolution:       { type: 'string' },
          duration:         { type: 'number' },
          generate_audio:   { type: 'boolean' },
          enable_upsample:  { type: 'boolean' },
          watermark:        { type: 'boolean' },
          images:           { type: 'array', items: { type: 'string' } },
          reference_images: { type: 'array', items: { type: 'string' } },
          reference_videos: { type: 'array', items: { type: 'string' } },
          reference_video_durations: { type: 'array', items: { type: 'number', minimum: 0 } },
          reference_audios: { type: 'array', items: { type: 'string' } },
          video_category: { type: 'string', enum: ['multimodal', 'frames'] },
          canvas_id: { type: 'string', format: 'uuid' },
          canvas_node_id: { type: 'string', maxLength: 128 },
          video_studio_project_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      prompt, workspace_id: workspaceId, model, video_studio_project_id,
      canvas_id: canvasId, canvas_node_id: canvasNodeId,
      aspect_ratio, resolution, duration, generate_audio,
      enable_upsample, watermark, images, reference_images, reference_videos, reference_video_durations, reference_audios,
      video_category,
    } = request.body

    const params = sanitizeParams({
      aspect_ratio, resolution, duration, generate_audio,
      enable_upsample, watermark, images, reference_images, reference_videos, reference_video_durations, reference_audios,
      video_category,
    })

    const db = getDb()
    const userId = request.user.id

    // 验证工作区成员身份
    const wsMember = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.team_id', 'workspace_members.role'])
      .where('workspace_members.workspace_id', '=', workspaceId)
      .where('workspace_members.user_id', '=', userId)
      .executeTakeFirst()

    if (!wsMember && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' } })
    }
    if (wsMember?.role === 'viewer' && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '查看者无权生成视频' } })
    }

    let teamId: string
    if (wsMember) {
      teamId = wsMember.team_id
    } else {
      const ws = await db.selectFrom('workspaces').select('team_id').where('id', '=', workspaceId).executeTakeFirst()
      if (!ws) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区未找到' } })
      teamId = ws.team_id
    }

    // 查找模型
    const providerModel = await db
      .selectFrom('provider_models')
      .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
      .select([
        'provider_models.id as modelId',
        'provider_models.params_pricing',
        'provider_models.category_references',
        'providers.code as providerCode',
      ])
      .where('provider_models.code', '=', model)
      .where('provider_models.is_active', '=', true)
      .where('providers.is_active', '=', true)
      .executeTakeFirst()

    if (!providerModel) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `模型 "${model}" 未找到或已停用` } })
    }

    const teamModelConfig = await db
      .selectFrom('team_model_configs')
      .select('is_active')
      .where('team_id', '=', teamId)
      .where('model_id', '=', providerModel.modelId)
      .executeTakeFirst()

    if (teamModelConfig && !teamModelConfig.is_active) {
      return reply.status(403).send({
        success: false,
        error: { code: 'MODEL_DISABLED', message: `模型 "${model}" 在当前团队中已被禁用` },
      })
    }

    const categoryReferences = parseCategoryReferences(providerModel.category_references)
    const requestCategory = resolveRequestCategory(request.body)

    if ('error' in requestCategory) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_VIDEO_REFERENCES', message: requestCategory.error } })
    }

    const validation = validateCategoryReferenceLimits(categoryReferences, requestCategory.category, requestCategory.counts)
    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_VIDEO_REFERENCES', message: validation.message ?? '视频参考素材数量不符合模型限制' },
      })
    }

    // 按秒计费：生成时长 + 参考视频总时长；duration=-1（自动）时用默认秒数预估
    const durationSec = typeof params.duration === 'number' && params.duration > 0 ? params.duration : null
    const referenceVideoDurations = Array.isArray(params.reference_video_durations)
      ? params.reference_video_durations.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
      : []
    const resolutionStr = typeof params.resolution === 'string' ? params.resolution : undefined
    const { unitPrice } = resolveUnitPrice(providerModel.params_pricing, resolutionStr)
    const estimatedCredits = calculateVideoEstimatedCredits({
      generatedDuration: durationSec,
      referenceVideoDurations,
      unitPrice,
    })

    // 冻结积分
    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, estimatedCredits, '视频生成冻结')
      creditAccountId = result.creditAccountId
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit error'
      return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: msg } })
    }

    // 写入 DB：batch + task（status=pending），然后入队
    try {
      const { batch, task } = await db.transaction().execute(async (trx: any) => {
        const batchRow = await trx
          .insertInto('task_batches')
          .values({
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: creditAccountId,
            idempotency_key: `${userId}-${Date.now()}`,
            source: resolveBatchSource({
              module: 'video',
              canvasId,
              canvasNodeId,
              videoStudioProjectId: video_studio_project_id,
            }),
            module: 'video',
            provider: providerModel.providerCode,
            model,
            prompt,
            params: JSON.stringify(params),
            quantity: 1,
            status: 'pending',
            estimated_credits: estimatedCredits,
            ...(canvasId && canvasNodeId ? { canvas_id: canvasId, canvas_node_id: canvasNodeId } : {}),
            ...(video_studio_project_id ? { video_studio_project_id } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        const taskRow = await trx
          .insertInto('tasks')
          .values({
            batch_id: batchRow.id,
            user_id: userId,
            version_index: 0,
            estimated_credits: estimatedCredits,
            status: 'pending',
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        return { batch: batchRow, task: taskRow }
      })

      // 入队 video-queue，worker 负责调 AI 提交任务
      await getVideoQueue().add('video-submit', {
        taskId: task.id,
        batchId: batch.id,
        userId,
        teamId,
        creditAccountId,
        provider: providerModel.providerCode,
        model,
        prompt,
        params,
        estimatedCredits,
      })

      return reply.status(201).send({
        id: batch.id,
        module: 'video',
        provider: providerModel.providerCode,
        model,
        prompt,
        params,
        quantity: 1,
        completed_count: 0,
        failed_count: 0,
        status: 'pending',
        estimated_credits: estimatedCredits,
        actual_credits: 0,
        created_at: batch.created_at.toISOString?.() ?? String(batch.created_at),
        tasks: [{
          id: task.id,
          version_index: 0,
          status: 'pending',
          estimated_credits: estimatedCredits,
          credits_cost: null,
          error_message: null,
          processing_started_at: null,
          completed_at: null,
          asset: null,
        }],
      })
    } catch (err) {
      await refundCredits(teamId, creditAccountId, userId, estimatedCredits, undefined, undefined, '视频生成退款').catch(() => {})
      app.log.error({ err }, 'Failed to create video batch/task')
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' } })
    }
  })
}

export default route
