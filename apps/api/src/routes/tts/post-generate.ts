import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { confirmCredits, freezeCredits, refundCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { signAssetUrl, uploadToTos } from '../../lib/storage.js'
import { generateMiniMaxTtsAudio, shouldUseMiniMaxStreaming } from '../../services/minimax-tts.js'

const MAX_TTS_TEXT_LENGTH = 10000
const TTS_CONTENT_TYPE = 'audio/mpeg'

interface TtsGenerateBody {
  idempotency_key?: string
  workspace_id: string
  model: string
  text: string
  voice_id: string
  voice_source_id?: string
  speed?: number
  volume?: number
  pitch?: number
  emotion?: string
  canvas_id?: string
  canvas_node_id?: string
}

interface ProviderConfig {
  api_base_url?: string
}

function parseProviderConfig(rawConfig: unknown): ProviderConfig {
  if (typeof rawConfig === 'string') {
    try {
      return JSON.parse(rawConfig) as ProviderConfig
    } catch {
      return {}
    }
  }
  if (rawConfig && typeof rawConfig === 'object') return rawConfig as ProviderConfig
  return {}
}

function countTextCharacters(text: string): number {
  return Array.from(text).length
}

function normalizeTtsNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TtsGenerateBody }>('/tts/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['workspace_id', 'model', 'text', 'voice_id'],
        properties: {
          idempotency_key: { type: 'string', maxLength: 128 },
          workspace_id: { type: 'string', format: 'uuid' },
          model: { type: 'string', minLength: 1, maxLength: 100 },
          text: { type: 'string', minLength: 1, maxLength: MAX_TTS_TEXT_LENGTH },
          voice_id: { type: 'string', minLength: 1, maxLength: 255 },
          voice_source_id: { type: 'string', format: 'uuid' },
          speed: { type: 'number', minimum: 0.5, maximum: 2 },
          volume: { type: 'number', minimum: 1, maximum: 10 },
          pitch: { type: 'number', minimum: -12, maximum: 12 },
          emotion: { type: 'string', maxLength: 64 },
          canvas_id: { type: 'string', format: 'uuid' },
          canvas_node_id: { type: 'string', maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const {
      workspace_id: workspaceId,
      model,
      text,
      voice_id: voiceId,
      voice_source_id: voiceSourceId,
      emotion,
      canvas_id: canvasId,
      canvas_node_id: canvasNodeId,
    } = request.body

    const characterCount = countTextCharacters(text)
    if (characterCount > MAX_TTS_TEXT_LENGTH) {
      return reply.status(400).send({ success: false, error: { code: 'TEXT_TOO_LONG', message: '文本不能超过 10000 字' } })
    }

    const speed = normalizeTtsNumber(request.body.speed, 1, 0.5, 2)
    const volume = normalizeTtsNumber(request.body.volume, 1, 1, 10)
    const pitch = normalizeTtsNumber(request.body.pitch, 0, -12, 12)
    const stream = shouldUseMiniMaxStreaming(text)
    const params = {
      voice_id: voiceId,
      voice_source_id: voiceSourceId,
      speed,
      volume,
      pitch,
      emotion: emotion || undefined,
      stream,
      character_count: characterCount,
    }

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
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '查看者无权生成音频' } })
    }

    const teamId = wsMember?.team_id ?? (await db.selectFrom('workspaces').select('team_id').where('id', '=', workspaceId).executeTakeFirst())?.team_id
    if (!teamId) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区未找到' } })

    const providerModel = await db
      .selectFrom('provider_models')
      .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
      .select([
        'provider_models.id as modelId',
        'provider_models.params_pricing',
        'providers.code as providerCode',
        'providers.config as providerConfig',
        'providers.id as providerId',
      ])
      .where('provider_models.code', '=', model)
      .where('provider_models.module', '=', 'tts')
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
      return reply.status(403).send({ success: false, error: { code: 'MODEL_DISABLED', message: `模型 "${model}" 在当前团队中已被禁用` } })
    }

    const voice = await db
      .selectFrom('provider_system_voices')
      .select(['id', 'voice_id'])
      .where('provider_id', '=', providerModel.providerId)
      .where('voice_id', '=', voiceId)
      .where('is_active', '=', true)
      .executeTakeFirst()

    if (!voice) {
      return reply.status(404).send({ success: false, error: { code: 'VOICE_NOT_FOUND', message: '音色不存在或已停用' } })
    }

    const providerConfig = parseProviderConfig(providerModel.providerConfig)
    if (!providerConfig.api_base_url) {
      return reply.status(500).send({ success: false, error: { code: 'PROVIDER_CONFIG_MISSING', message: 'TTS 服务地址未配置' } })
    }

    const { unitPrice, resolvedModel } = resolveUnitPrice(providerModel.params_pricing, 'default')
    const actualModel = resolvedModel ?? model
    const estimatedCredits = Math.max(1, Math.ceil(characterCount / 1000)) * unitPrice

    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, estimatedCredits, 'TTS 语音合成冻结')
      creditAccountId = result.creditAccountId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'A豆余额不足'
      return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message } })
    }

    let batchId: string | null = null
    let taskId: string | null = null

    try {
      const audioBuffer = await generateMiniMaxTtsAudio({
        apiBaseUrl: providerConfig.api_base_url,
        model: actualModel,
        voiceId,
        text,
        speed,
        volume,
        pitch,
        emotion: emotion || undefined,
        stream,
        auditContext: {
          userId,
          teamId,
          workspaceId,
        },
      })
      const storageUrl = await uploadToTos(`tts/${userId}/${Date.now()}-${voice.id}.mp3`, audioBuffer, TTS_CONTENT_TYPE)

      const created = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .insertInto('task_batches')
          .values({
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: creditAccountId,
            idempotency_key: request.body.idempotency_key ?? `tts_${userId}_${Date.now()}`,
            source: 'generation',
            module: 'tts',
            provider: providerModel.providerCode,
            model,
            prompt: text,
            params: JSON.stringify(params),
            quantity: 1,
            completed_count: 1,
            status: 'completed',
            estimated_credits: estimatedCredits,
            actual_credits: estimatedCredits,
            ...(canvasId && canvasNodeId ? { canvas_id: canvasId, canvas_node_id: canvasNodeId } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        const task = await trx
          .insertInto('tasks')
          .values({
            batch_id: batch.id,
            user_id: userId,
            version_index: 0,
            estimated_credits: estimatedCredits,
            credits_cost: estimatedCredits,
            status: 'completed',
            processing_started_at: new Date(),
            completed_at: new Date(),
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        await trx
          .insertInto('assets')
          .values({
            task_id: task.id,
            batch_id: batch.id,
            user_id: userId,
            type: 'audio',
            storage_url: storageUrl,
            original_url: storageUrl,
            transfer_status: 'completed',
            metadata: JSON.stringify({ character_count: characterCount, voice_id: voiceId }),
          })
          .execute()

        let canvasOutputId: string | null = null
        if (canvasId && canvasNodeId) {
          const outputUrls = sql<string>`ARRAY[${sql`${storageUrl}`}]`
          const output = await trx
            .insertInto('canvas_node_outputs')
            .values({
              canvas_id: canvasId,
              node_id: canvasNodeId,
              batch_id: batch.id,
              output_urls: outputUrls,
              is_selected: true,
            })
            .returning('id')
            .execute()
          canvasOutputId = output[0]?.id ?? null
        }

        return { batch, task, canvasOutputId }
      })

      batchId = created.batch.id
      taskId = created.task.id
      await confirmCredits(creditAccountId, userId, estimatedCredits, taskId, batchId, 'TTS 语音合成确认')

      return reply.status(201).send({
        id: created.batch.id,
        module: 'tts',
        provider: providerModel.providerCode,
        model,
        prompt: text,
        params,
        quantity: 1,
        completed_count: 1,
        failed_count: 0,
        status: 'completed',
        estimated_credits: estimatedCredits,
        actual_credits: estimatedCredits,
        created_at: created.batch.created_at.toISOString?.() ?? String(created.batch.created_at),
        output_url: await signAssetUrl(storageUrl),
        output_id: created.canvasOutputId,
        tasks: [{
          id: created.task.id,
          version_index: 0,
          status: 'completed',
          estimated_credits: estimatedCredits,
          credits_cost: estimatedCredits,
          error_message: null,
          processing_started_at: created.task.processing_started_at?.toISOString?.() ?? null,
          completed_at: created.task.completed_at?.toISOString?.() ?? null,
          asset: null,
        }],
      })
    } catch (err) {
      app.log.error({ err }, 'TTS generation failed')
      await refundCredits(teamId, creditAccountId, userId, estimatedCredits, taskId ?? undefined, batchId ?? undefined, 'TTS 语音合成退款').catch(() => {})
      const message = err instanceof Error ? err.message : '音频生成失败'
      return reply.status(502).send({ success: false, error: { code: 'TTS_GENERATION_FAILED', message: `${message}（积分已退回）` } })
    }
  })
}

export default route
