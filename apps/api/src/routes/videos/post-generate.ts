import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { getVideoQueue } from '../../lib/queue.js'

// 视频生成允许的 params 键白名单
const ALLOWED_PARAM_KEYS = new Set([
  'aspect_ratio', 'resolution', 'duration', 'generate_audio',
  'camera_fixed', 'enable_upsample', 'watermark',
  'images', 'reference_images', 'reference_videos', 'reference_audios',
])

function sanitizeParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(k)) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 10).map(item => (typeof item === 'string' ? item : String(item)))
    }
  }
  return out
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: Record<string, unknown> }>('/videos/generate', {
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
          camera_fixed:     { type: 'boolean' },
          enable_upsample:  { type: 'boolean' },
          watermark:        { type: 'boolean' },
          images:           { type: 'array', items: { type: 'string' } },
          reference_images: { type: 'array', items: { type: 'string' } },
          reference_videos: { type: 'array', items: { type: 'string' } },
          reference_audios: { type: 'array', items: { type: 'string' } },
          video_studio_project_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      prompt, workspace_id: workspaceId, model, video_studio_project_id,
      aspect_ratio, resolution, duration, generate_audio, camera_fixed,
      enable_upsample, watermark, images, reference_images, reference_videos, reference_audios,
    } = request.body as any

    const params = sanitizeParams({
      aspect_ratio, resolution, duration, generate_audio, camera_fixed,
      enable_upsample, watermark, images, reference_images, reference_videos, reference_audios,
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
        'provider_models.credit_cost',
        'provider_models.params_pricing',
        'providers.code as providerCode',
      ])
      .where('provider_models.code', '=', model)
      .where('provider_models.is_active', '=', true)
      .where('providers.is_active', '=', true)
      .executeTakeFirst()

    if (!providerModel) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `模型 "${model}" 未找到或已停用` } })
    }

    // 按秒计费：unitPrice × duration，duration=-1（自动）时用 credit_cost 兜底
    const durationSec = typeof params.duration === 'number' && params.duration > 0 ? params.duration : null
    const resolutionStr = typeof params.resolution === 'string' ? params.resolution : undefined
    const { unitPrice } = resolveUnitPrice(providerModel.params_pricing, resolutionStr, providerModel.credit_cost)
    const estimatedCredits = durationSec !== null ? unitPrice * durationSec : providerModel.credit_cost

    // 冻结积分
    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, estimatedCredits)
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
            module: 'video',
            provider: providerModel.providerCode,
            model,
            prompt,
            params: JSON.stringify(params),
            quantity: 1,
            status: 'pending',
            estimated_credits: estimatedCredits,
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
      await refundCredits(teamId, creditAccountId, userId, estimatedCredits).catch(() => {})
      app.log.error({ err }, 'Failed to create video batch/task')
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' } })
    }
  })
}

export default route
