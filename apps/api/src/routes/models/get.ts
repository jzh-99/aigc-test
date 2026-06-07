import type { SystemVoiceDemoResponse, SystemVoiceItem } from '@aigc/types'
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl, uploadToTos } from '../../lib/storage.js'
import { generateMiniMaxTtsAudio } from '../../services/minimax-tts.js'
import { normalizeModelJsonFields } from '../../lib/model-json.js'

const MINIMAX_DEMO_TEXT = '欢迎来到toby AI，挑选一个你喜欢的音色，让我们开始创作之旅吧。'
const MINIMAX_DEMO_MODEL = 'speech-2.8-turbo'
const MINIMAX_DEMO_CONTENT_TYPE = 'audio/mpeg'

function parseProviderConfig(rawConfig: unknown): { api_base_url?: string } {
  if (typeof rawConfig === 'string') {
    try {
      return JSON.parse(rawConfig) as { api_base_url?: string }
    } catch {
      return {}
    }
  }

  if (rawConfig && typeof rawConfig === 'object') return rawConfig as { api_base_url?: string }
  return {}
}

async function buildSystemVoiceDemoResponse(voiceId: string, demoAudioUrl: string): Promise<SystemVoiceDemoResponse> {
  const signedUrl = await signAssetUrl(demoAudioUrl)
  return {
    voice_id: voiceId,
    demo_audio_url: signedUrl ?? demoAudioUrl,
  }
}

// 模型列表路由：支持按模块过滤，并根据团队配置决定模型是否启用
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { module?: string; workspace_id?: string } }>('/models', async (req) => {
    const db = getDb()
    // 兼容未登录场景（healthz 等公开路由），user 可能不存在
    const userId = (req as unknown as { user?: { id: string } }).user?.id
    const workspaceId = req.query.workspace_id

    let teamId: string | undefined
    if (workspaceId) {
      // 通过工作空间 ID 查找所属团队
      const ws = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      teamId = ws?.team_id
    } else if (userId) {
      // 通过用户 ID 查找所属团队（取第一个）
      const member = await db
        .selectFrom('team_members')
        .select('team_id')
        .where('user_id', '=', userId)
        .limit(1)
        .executeTakeFirst()
      teamId = member?.team_id
    }

    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .leftJoin('team_model_configs as tmc', (join) =>
        teamId
          ? join.onRef('tmc.model_id', '=', 'pm.id').on('tmc.team_id', '=', teamId)
          : join.onRef('tmc.model_id', '=', 'pm.id').onRef('tmc.team_id', '=', 'pm.id')
      )
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.category_references', 'pm.params_pricing',
        'pm.params_schema', 'pm.resolution', 'p.code as provider_code',
        'pm.is_active as global_is_active', 'tmc.is_active as team_is_active',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as never)
    }

    const rows = await query.execute()

    // 团队配置优先于全局配置：team_is_active 不为 null 时以团队配置为准
    return rows
      .filter((r) => {
        const effective = r.team_is_active !== null ? r.team_is_active : r.global_is_active
        return effective
      })
      .map((r) => normalizeModelJsonFields({
        id: r.id, code: r.code, name: r.name, description: r.description,
        module: r.module, category_references: r.category_references,
        params_pricing: r.params_pricing,
        params_schema: r.params_schema, resolution: r.resolution,
        is_active: true, provider_code: r.provider_code,
      }))
  })

  app.get<{ Querystring: { provider?: string; language?: string } }>('/models/system-voices', async (request) => {
    const db = getDb()
    let query = db
      .selectFrom('provider_system_voices as psv')
      .innerJoin('providers as p', 'p.id', 'psv.provider_id')
      .select([
        'psv.id',
        'psv.voice_id',
        'psv.name',
        'psv.language',
        'psv.demo_audio_url',
        'p.code as provider_code',
      ])
      .where('psv.is_active', '=', true)
      .where('p.is_active', '=', true)
      .orderBy('psv.language', 'asc')
      .orderBy('psv.name', 'asc')

    if (request.query.provider) {
      query = query.where('p.code', '=', request.query.provider)
    }
    if (request.query.language) {
      query = query.where('psv.language', '=', request.query.language)
    }

    const rows = await query.execute()
    const items: SystemVoiceItem[] = await Promise.all(rows.map(async (row) => ({
      id: row.id,
      voice_id: row.voice_id,
      name: row.name,
      language: row.language,
      demo_audio_url: row.demo_audio_url ? await signAssetUrl(row.demo_audio_url) : null,
      provider_code: row.provider_code,
    })))

    return items
  })

  app.get<{ Params: { id: string } }>('/models/system-voices/:id/demo', async (request, reply) => {
    const db = getDb()
    const voice = await db
      .selectFrom('provider_system_voices as psv')
      .innerJoin('providers as p', 'p.id', 'psv.provider_id')
      .select([
        'psv.id',
        'psv.voice_id',
        'psv.demo_audio_url',
        'psv.is_active',
        'p.code as provider_code',
        'p.config as provider_config',
      ])
      .where('psv.id', '=', request.params.id)
      .executeTakeFirst()

    if (!voice || !voice.is_active) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '系统音色不存在' } })
    }

    if (voice.demo_audio_url) {
      return buildSystemVoiceDemoResponse(voice.voice_id, voice.demo_audio_url)
    }

    if (voice.provider_code !== 'minimax') {
      return reply.status(400).send({ success: false, error: { code: 'UNSUPPORTED_PROVIDER', message: '当前音色暂不支持生成 Demo 音频' } })
    }

    const providerConfig = parseProviderConfig(voice.provider_config)
    if (!providerConfig.api_base_url) {
      return reply.status(500).send({ success: false, error: { code: 'PROVIDER_CONFIG_MISSING', message: 'MiniMax API 地址未配置' } })
    }

    const audioBuffer = await generateMiniMaxTtsAudio({
      apiBaseUrl: providerConfig.api_base_url,
      model: MINIMAX_DEMO_MODEL,
      voiceId: voice.voice_id,
      text: MINIMAX_DEMO_TEXT,
    })
    const storageUrl = await uploadToTos(
      `system-voices/demos/minimax/${encodeURIComponent(voice.voice_id)}.mp3`,
      audioBuffer,
      MINIMAX_DEMO_CONTENT_TYPE,
    )

    await db
      .updateTable('provider_system_voices')
      .set({ demo_audio_url: storageUrl })
      .where('id', '=', voice.id)
      .execute()

    return buildSystemVoiceDemoResponse(voice.voice_id, storageUrl)
  })
}

export default route
