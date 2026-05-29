import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { SHORT_DRAMA_VIDEO_MODEL } from '@aigc/types'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import {
  assertShortDramaProjectAccess,
  makeShortDramaSourceMetadata,
} from './_shared.js'

interface GenerateSegmentVideoBody {
  model?: string
}

export default async function postGenerateSegmentVideo(app: FastifyInstance): Promise<void> {
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

      // 查找 episode
      const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
      if (!episode) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `第 ${episodeNumber} 集不存在` },
        })
      }

      // 查找 segment
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

      // 解析 mentionRefs 中的 assetId → imageUrl
      const imageReferences: string[] = []
      for (const ref of segment.mentionRefs) {
        const asset = state.assets.items.find(a => a.id === ref.assetId)
        if (asset?.imageUrl) {
          imageReferences.push(asset.imageUrl)
        }
      }

      // 查找视频模型
      const modelCode = request.body.model ?? SHORT_DRAMA_VIDEO_MODEL
      const db = getDb()
      const modelRecord = await db
        .selectFrom('provider_models')
        .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
        .select([
          'provider_models.id as modelId',
          'provider_models.credit_cost',
          'provider_models.params_pricing',
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

      const { unitPrice } = resolveUnitPrice(modelRecord.params_pricing, null, modelRecord.credit_cost)
      const isSeedance = modelCode.startsWith('seedance-')
      const durationSeconds = segment.durationSeconds
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

      // 构建视频生成请求参数
      const aspectRatio = state.settings.aspectRatio
      const videoParams: Record<string, unknown> = {
        aspect_ratio: aspectRatio,
        duration: durationSeconds,
        generate_audio: true,
        source: 'short_drama',
      }
      if (imageReferences.length > 0) {
        videoParams.images = imageReferences
      }

      try {
        const batchResult = await db.transaction().execute(async (trx) => {
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
              status: 'processing',
              estimated_credits: totalCost,
              short_drama_project_id: project.id,
              short_drama_episode_id: String(episodeNumber),
              short_drama_segment_id: segmentId,
              source_module: sourceMetadata.source_module,
              source_feature: sourceMetadata.source_feature,
              source_project_id: sourceMetadata.source_project_id,
              source_episode_id: sourceMetadata.source_episode_id,
              source_segment_id: sourceMetadata.source_segment_id,
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
              status: 'processing',
              processing_started_at: new Date().toISOString(),
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          return { batch, task }
        })

        // 更新 segment 状态
        segment.status = 'pending'

        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()

        return reply.status(201).send({
          success: true,
          batchId: batchResult.batch.id,
          taskId: batchResult.task.id,
          estimatedCredits: totalCost,
        })
      } catch (err) {
        app.log.error({ err }, 'Failed to create segment video batch, refunding')
        try {
          await refundCredits(teamId, creditAccountId, userId, totalCost)
        } catch (refundErr) {
          app.log.error({ refundErr }, 'CRITICAL: Failed to refund after segment video failure')
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' },
        })
      }
    }
  )
}
