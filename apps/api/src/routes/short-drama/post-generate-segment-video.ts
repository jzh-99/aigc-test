import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { SHORT_DRAMA_VIDEO_MODEL, parseCategoryReferences } from '@aigc/types'
import { freezeCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { encryptProxyUrl } from '../../lib/storage.js'
import { getVideoQueue } from '../../lib/queue.js'
import {
  assertShortDramaProjectAccess,
  invalidateShortDramaEpisodeExports,
  makeShortDramaSourceMetadata,
  validateShortDramaDuration,
} from './_shared.js'

interface GenerateSegmentVideoBody {
  model?: string
  resolution?: string
}

const SEEDANCE_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12]
const SEEDANCE_2_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

export default async function postGenerateSegmentVideo(app: FastifyInstance): Promise<void> {
  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  function toPublicUrl(url: string): string {
    if (url.startsWith('http://')) {
      return `${BASE_URL}/api/v1/assets/proxy?token=${encryptProxyUrl(url)}`
    }
    if (url.startsWith('/')) {
      return `${BASE_URL}${url}`
    }
    return url
  }

  app.post<{
    Params: { id: string; episodeNumber: string; segmentId: string }
    Body: GenerateSegmentVideoBody
  }>(
    '/short-drama/projects/:id/episodes/:episodeNumber/segments/:segmentId/generate-video',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'episodeNumber', 'segmentId'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            episodeNumber: { type: 'string' },
            segmentId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            model: { type: 'string', maxLength: 100 },
            resolution: { type: 'string', enum: ['720p', '1080p'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, episodeNumber: epNumStr, segmentId } = request.params
      const userId = request.user.id
      const episodeNumber = parseInt(epNumStr, 10)

      if (isNaN(episodeNumber) || episodeNumber < 1) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: '集数必须是正整数' },
        })
      }

      const { project, workspace } = await assertShortDramaProjectAccess(projectId, userId, true)
      const state = project.state
      const teamId = workspace.team_id

      const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
      if (!episode) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `第 ${episodeNumber} 集不存在` },
        })
      }

      const segment = episode.segments.find(s => s.id === segmentId)
      if (!segment) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '分镜不存在' },
        })
      }

      if (segment.status === 'pending' || segment.status === 'generating') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_GENERATING', message: '该分镜已在生成中' },
        })
      }

      const modelCode = request.body.model ?? SHORT_DRAMA_VIDEO_MODEL
      const resolution = request.body.resolution ?? '720p'
      const isSeedance = modelCode.startsWith('seedance-')
      const isSeedance2 = modelCode === 'seedance-2.0' || modelCode === 'seedance-2.0-fast'
      const durationSeconds = segment.durationSeconds

      // 校验时长
      if (isSeedance) {
        const allowed = isSeedance2 ? SEEDANCE_2_ALLOWED_DURATIONS : SEEDANCE_ALLOWED_DURATIONS
        try {
          validateShortDramaDuration(durationSeconds, allowed)
        } catch (err) {
          const msg = err instanceof Error ? err.message : '时长不合法'
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_DURATION', message: msg },
          })
        }
      }

      // 解析 mentionRefs → 图片 URL
      const imageReferences: string[] = []
      for (const ref of segment.mentionRefs) {
        const asset = state.assets.items.find(a => a.id === ref.assetId)
        if (asset?.imageUrl) {
          imageReferences.push(toPublicUrl(asset.imageUrl))
        }
      }

      // 查找视频模型
      const db = getDb()
      const modelRecord = await db
        .selectFrom('provider_models')
        .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
        .select([
          'provider_models.id as modelId',
          'provider_models.credit_cost',
          'provider_models.params_pricing',
          'provider_models.category_references',
          'providers.code as providerCode',
        ])
        .where('provider_models.code', '=', modelCode)
        .where('provider_models.is_active', '=', true)
        .where('providers.is_active', '=', true)
        .executeTakeFirst()

      if (!modelRecord) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MODEL_NOT_FOUND', message: `视频模型 "${modelCode}" 未找到或已停用` },
        })
      }

      if (!parseCategoryReferences(modelRecord.category_references).multimodal) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MODEL_NOT_SUPPORTED', message: `视频模型 "${modelCode}" 不支持全能参考生成` },
        })
      }

      const { unitPrice } = resolveUnitPrice(modelRecord.params_pricing, resolution, modelRecord.credit_cost)
      const totalCost = isSeedance ? durationSeconds * unitPrice : unitPrice

      // 冻结积分
      let creditAccountId: string
      try {
        const result = await freezeCredits(teamId, userId, totalCost)
        creditAccountId = result.creditAccountId
      } catch (err) {
        const msg = err instanceof Error ? err.message : '积分不足'
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: msg },
        })
      }

      const sourceMetadata = makeShortDramaSourceMetadata({
        projectId: project.id,
        episodeId: String(episodeNumber),
        segmentId,
      })

      const aspectRatio = state.settings.aspectRatio
      const videoParams: Record<string, unknown> = {
        aspect_ratio: aspectRatio,
        duration: durationSeconds,
        resolution,
        generate_audio: true,
        source: 'short_drama',
        reference_images: imageReferences,
      }

      // 创建 batch + task (status=pending)
      let batchId: string
      let taskId: string
      try {
        const result = await db.transaction().execute(async (trx) => {
          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: teamId,
              workspace_id: project.workspace_id,
              credit_account_id: creditAccountId,
              idempotency_key: randomUUID(),
              module: 'video',
              provider: modelRecord.providerCode,
              model: modelCode,
              prompt: segment.prompt,
              params: JSON.stringify(videoParams),
              quantity: 1,
              status: 'pending',
              estimated_credits: totalCost,
              short_drama_project_id: project.id,
              short_drama_episode_id: String(episodeNumber),
              short_drama_segment_id: segmentId,
            } as any)
            .returning('id')
            .executeTakeFirstOrThrow()

          const task = await trx
            .insertInto('tasks')
            .values({
              batch_id: batch.id,
              user_id: userId,
              version_index: 0,
              estimated_credits: totalCost,
              status: 'pending',
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          return { batchId: batch.id, taskId: task.id }
        })
        batchId = result.batchId
        taskId = result.taskId
      } catch (err) {
        app.log.error({ err }, 'Failed to create segment video batch')
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败' },
        })
      }

      // 入队到 video-queue，由 worker 处理
      try {
        await getVideoQueue().add('video-submit', {
          taskId,
          batchId,
          userId,
          teamId,
          creditAccountId,
          provider: modelRecord.providerCode,
          model: modelCode,
          prompt: segment.prompt,
          params: videoParams,
          estimatedCredits: totalCost,
        })

        // 更新 segment 状态为 generating，并让该集旧导出失效
        segment.videoUrl = null
        segment.status = 'generating'
        invalidateShortDramaEpisodeExports(state, episodeNumber)
        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()

        app.log.info({ taskId, batchId }, 'Short drama video task enqueued')
      } catch (err) {
        app.log.error({ err, taskId, batchId }, 'Failed to enqueue video task')
        return reply.status(500).send({
          success: false,
          error: { code: 'QUEUE_ERROR', message: '任务入队失败' },
        })
      }

      return reply.status(201).send({
        success: true,
        batchId,
        taskId,
        estimatedCredits: totalCost,
      })
    }
  )
}
