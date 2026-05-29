import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { SHORT_DRAMA_VIDEO_MODEL } from '@aigc/types'
import { freezeCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { encryptProxyUrl } from '../../lib/storage.js'
import {
  assertShortDramaProjectAccess,
  makeShortDramaSourceMetadata,
  validateShortDramaDuration,
} from './_shared.js'

interface GenerateSegmentVideoBody {
  model?: string
}

const VOLCENGINE_MODEL_ID: Record<string, string> = {
  'seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
  'seedance-2.0': 'doubao-seedance-2-0-260128',
  'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
  'seedance-1.0-lite': 'doubao-seedance-1-0-lite-250428',
}

const SEEDANCE_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12]
const SEEDANCE_2_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

export default async function postGenerateSegmentVideo(app: FastifyInstance): Promise<void> {
  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''
  const volcengineApiUrl = 'https://ark.cn-beijing.volces.com/api/v3'
  const volcengineApiKey = process.env.VOLCENGINE_API_KEY ?? ''

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

      const { unitPrice, resolvedModel } = resolveUnitPrice(modelRecord.params_pricing, null, modelRecord.credit_cost)
      const actualModel = resolvedModel ?? modelCode
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
        generate_audio: true,
        source: 'short_drama',
      }

      // 创建 batch + task
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
              status: 'processing',
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
              status: 'processing',
              processing_started_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          return { batchId: batch.id, taskId: task.id }
        })
        batchId = result.batchId
        taskId = result.taskId
      } catch (err) {
        app.log.error({ err }, 'Failed to create segment video batch, refunding')
        try {
          await db.updateTable('credit_accounts')
            .set({ frozen_credits: sql`frozen_credits - ${totalCost}` })
            .where('id', '=', creditAccountId).execute()
        } catch (refundErr) {
          app.log.error({ refundErr }, 'CRITICAL: Failed to refund after batch creation failure')
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' },
        })
      }

      // 调用火山引擎视频生成 API
      let externalTaskId: string | null = null
      let lastError = ''

      const volcengineBody: Record<string, unknown> = {
        model: VOLCENGINE_MODEL_ID[actualModel] ?? actualModel,
        content: [{ type: 'text', text: segment.prompt }],
        duration: durationSeconds,
        generate_audio: true,
        watermark: false,
      }
      if (aspectRatio) volcengineBody.ratio = aspectRatio
      if (imageReferences.length > 0) {
        for (const img of imageReferences) {
          ;(volcengineBody.content as any[]).push({
            type: 'image_url',
            image_url: { url: img },
            role: 'first_frame',
          })
        }
      }

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 30_000)
        let res: Response
        try {
          res = await fetch(`${volcengineApiUrl}/contents/generations/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${volcengineApiKey}` },
            body: JSON.stringify(volcengineBody),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Volcengine API ${res.status}: ${errText}`)
        }

        const json = (await res.json()) as { id: string }
        if (!json.id) throw new Error('Volcengine API did not return task id')
        externalTaskId = json.id
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        app.log.error({ taskId, batchId, err: lastError }, 'Volcengine video API failed')
      }

      // API 调用失败 → 标记失败并退款
      if (!externalTaskId) {
        await db.transaction().execute(async (trx: any) => {
          await trx.updateTable('tasks')
            .set({ status: 'failed', error_message: lastError.slice(0, 1000), completed_at: new Date() })
            .where('id', '=', taskId).execute()

          await trx.updateTable('task_batches')
            .set({ status: 'failed', failed_count: sql`failed_count + 1` })
            .where('id', '=', batchId).execute()

          await trx.updateTable('credit_accounts')
            .set({ frozen_credits: sql`frozen_credits - ${totalCost}` })
            .where('id', '=', creditAccountId).execute()

          await trx.updateTable('team_members')
            .set({ credit_used: sql`GREATEST(credit_used - ${totalCost}, 0)` })
            .where('team_id', '=', teamId).where('user_id', '=', userId).execute()

          await trx.insertInto('credits_ledger').values({
            credit_account_id: creditAccountId,
            user_id: userId,
            amount: totalCost,
            type: 'refund',
            task_id: taskId,
            batch_id: batchId,
            description: `Short drama video failed: ${lastError.slice(0, 200)}`,
          }).execute()
        })

        return reply.status(502).send({
          success: false,
          error: { code: 'VIDEO_API_ERROR', message: `视频生成服务暂时不可用：${lastError.slice(0, 300)}` },
        })
      }

      // 回写 external_task_id
      await db.updateTable('tasks')
        .set({ external_task_id: externalTaskId })
        .where('id', '=', taskId)
        .execute()

      // 更新 segment 状态
      segment.status = 'generating'

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
        batchId,
        taskId,
        externalTaskId,
        estimatedCredits: totalCost,
      })
    }
  )
}
