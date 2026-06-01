import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { SHORT_DRAMA_IMAGE_MODEL } from '@aigc/types'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { getImageQueue } from '../../lib/queue.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import {
  assertShortDramaProjectAccess,
  makeShortDramaSourceMetadata,
} from './_shared.js'

interface GenerateAssetsBody {
  assetIds: string[]
  scope: 'global' | 'episode'
  episodeId?: string
}

function buildAssetImagePrompt(asset: { kind: string; name: string; description: string }): string {
  const basePrompt = `${asset.name}：${asset.description}`.trim()

  if (asset.kind === 'character') {
    return [
      basePrompt,
      '人物形象要求：正面半身或胸像，单人出镜，白色纯净背景，光线均匀，五官清晰。',
      '禁止：多人合影、剧情场景、文字标注、边框、图表、装饰物、手持道具、额外物品、复杂背景。',
    ].join('\n')
  }

  if (asset.kind === 'scene') {
    return [
      basePrompt,
      '场景形象要求：只展示环境空间和地点氛围，不出现任何人物、人体、脸部、背影或人群。',
      '禁止：角色入镜、人物肖像、手部特写、文字标注、关系图、剧情分镜拼图。',
    ].join('\n')
  }

  return basePrompt
}

export default async function postGenerateAssets(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: GenerateAssetsBody }>(
    '/short-drama/projects/:id/assets/generate',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['assetIds', 'scope'],
          properties: {
            assetIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
            scope: { type: 'string', enum: ['global', 'episode'] },
            episodeId: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params
      const { assetIds, scope, episodeId } = request.body
      const userId = request.user.id

      if (scope === 'episode' && !episodeId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'scope 为 episode 时必须提供 episodeId' },
        })
      }

      const { project, workspace } = await assertShortDramaProjectAccess(projectId, userId, true)
      const state = project.state
      const teamId = workspace.team_id

      // 查找目标 assets
      const targetAssets = state.assets.items.filter(a => assetIds.includes(a.id))
      if (targetAssets.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: '未找到指定的素材' },
        })
      }

      // 查找图片生成模型
      const db = getDb()
      const modelCode = SHORT_DRAMA_IMAGE_MODEL
      const providerModel = await db
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

      if (!providerModel) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MODEL_NOT_FOUND', message: `图片模型 "${modelCode}" 未找到或已停用` },
        })
      }

      const { unitPrice } = resolveUnitPrice(providerModel.params_pricing, null, providerModel.credit_cost)
      const totalCost = unitPrice * targetAssets.length

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

      // 创建 batch + tasks，入队
      const targetPrompts = targetAssets.map(buildAssetImagePrompt)
      const sourceMetadata = makeShortDramaSourceMetadata({
        projectId: project.id,
        episodeId: episodeId ?? undefined,
      })

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
              module: 'image',
              provider: providerModel.providerCode,
              model: modelCode,
              prompt: targetPrompts.join(' | '),
              params: JSON.stringify({
                scope,
                source: 'short_drama',
                assetIdMap: targetAssets.map((a, i) => ({ versionIndex: i, assetId: a.id })),
              }),
              quantity: targetAssets.length,
              status: 'pending',
              estimated_credits: totalCost,
              short_drama_project_id: project.id,
              short_drama_episode_id: episodeId ?? null,
              source_module: sourceMetadata.source_module,
              source_feature: sourceMetadata.source_feature,
              source_project_id: sourceMetadata.source_project_id,
              source_episode_id: sourceMetadata.source_episode_id,
            } as any)
            .returning('id')
            .executeTakeFirstOrThrow()

          const taskValues = targetAssets.map((asset, i) => ({
            batch_id: batch.id,
            user_id: userId,
            version_index: i,
            estimated_credits: unitPrice,
            status: 'pending' as const,
          }))

          const tasks = await trx
            .insertInto('tasks')
            .values(taskValues)
            .returningAll()
            .execute()

          return { batch, tasks }
        })

        // 更新 state 中 asset 状态
        const batchId = batchResult.batch.id
        for (const asset of targetAssets) {
          const stateAsset = state.assets.items.find(a => a.id === asset.id)
          if (stateAsset) {
            stateAsset.status = 'pending'
            stateAsset.imageUrl = null
            stateAsset.updatedAt = new Date().toISOString()
          }
        }

        // 保存 state（在入队前，避免入队成功但 state 未更新）
        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()

        // 入队 BullMQ（最后执行，前面步骤失败会退款）
        const jobPayloads = batchResult.tasks.map((task: any, i: number) => ({
          name: 'generate',
          data: {
            taskId: task.id,
            batchId: batchResult.batch.id,
            userId,
            teamId,
            creditAccountId,
            provider: providerModel.providerCode,
            model: modelCode,
            prompt: targetPrompts[i],
            params: { aspect_ratio: state.settings.aspectRatio },
            estimatedCredits: unitPrice,
          },
          opts: { priority: 10 },
        }))
        await getImageQueue().addBulk(jobPayloads)

        return reply.status(201).send({
          success: true,
          batchId,
          assetCount: targetAssets.length,
          estimatedCredits: totalCost,
        })
      } catch (err) {
        app.log.error({ err }, 'Failed to create asset generation batch, refunding')
        try {
          await refundCredits(teamId, creditAccountId, userId, totalCost)
        } catch (refundErr) {
          app.log.error({ refundErr }, 'CRITICAL: Failed to refund credits after asset batch failure')
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' },
        })
      }
    }
  )
}
