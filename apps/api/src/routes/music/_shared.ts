// music 模块共享辅助函数；autoload 会忽略以 _ 开头的文件。

import { getDb } from '@aigc/db'
import type { Selectable } from 'kysely'
import type { Database } from '@aigc/db'
import type {
  MusicMode,
  MusicModel,
  MusicTrackType,
  MusicVoiceGender,
  MusicVoiceCloneResponse,
  MusicTrackResponse,
} from '@aigc/types'
import {
  isMusicModel,
  isMusicVoiceGender,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_MODE_VALUES,
  MUSIC_MODEL_VALUES,
  MUSIC_PROMPT_MAX_LENGTH,
  MUSIC_TRACK_TYPE_VALUES,
  normalizeMusicTitle,
  normalizeVoiceCloneDescription,
} from '@aigc/types'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { signAssetUrl } from '../../lib/storage.js'

type Db = ReturnType<typeof getDb>
type MusicTrackRow = Selectable<Database['music_tracks']> & {
  estimated_credits?: number | null
  credits_cost?: number | null
  completed_at?: Date | string | null
}
type MusicVoiceCloneRow = Selectable<Database['music_voice_clones']> & {
  gender?: MusicVoiceGender | null
  completed_at?: Date | string | null
}
type UrlSigner = (url: string | null | undefined) => Promise<string | null>

export class MusicRouteError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MusicRouteError'
  }
}

export interface ValidatedMusicGeneratePayload {
  idempotency_key?: string
  workspace_id: string
  mode: MusicMode
  track_type: MusicTrackType
  model: MusicModel
  prompt: string | null
  lyrics: string | null
  title: string | null
  styles: string[]
  voice_gender: MusicVoiceGender
  voice_clone_id: string | null
  params: Record<string, unknown>
  canvas_id?: string
  canvas_node_id?: string
}

export interface ValidatedVoiceClonePayload {
  name: string
  description: string | null
  gender: MusicVoiceGender
  model: MusicModel
}

export interface WorkspaceAccess {
  teamId: string
  role: 'admin' | 'editor' | 'viewer' | null
}

export interface ResolvedMusicCredits {
  providerModelId: string
  providerCode: string
  providerId: string
  estimatedCredits: number
  unitPrices: Record<string, number>
}

function countTextLength(value: string): number {
  return [...value].length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function normalizeOptionalId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('voice_clone_id 必须是字符串')
  const normalized = value.trim()
  return normalized || null
}

function normalizeLimitedText(
  value: unknown,
  requiredMessage: string,
  tooLongMessage: string,
  maxLength: number,
): string {
  const normalized = normalizeRequiredString(value, requiredMessage)
  if (countTextLength(normalized) > maxLength) throw new Error(tooLongMessage)
  return normalized
}

function normalizeOptionalLimitedText(value: unknown, tooLongMessage: string, maxLength: number): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (countTextLength(normalized) > maxLength) throw new Error(tooLongMessage)
  return normalized
}

function normalizeMode(value: unknown): MusicMode {
  if (typeof value === 'string' && MUSIC_MODE_VALUES.includes(value as MusicMode)) return value as MusicMode
  throw new Error('mode 只允许 inspiration/custom')
}

function normalizeTrackType(value: unknown): MusicTrackType {
  if (typeof value === 'string' && MUSIC_TRACK_TYPE_VALUES.includes(value as MusicTrackType)) return value as MusicTrackType
  throw new Error('type 只允许 song/instrumental')
}

function normalizeModel(value: unknown): MusicModel {
  if (isMusicModel(value)) return value
  throw new Error(`model 只允许 ${MUSIC_MODEL_VALUES.join('/')}`)
}

function normalizeVoiceGender(value: unknown): MusicVoiceGender {
  if (value == null || value === '') return 'auto'
  if (isMusicVoiceGender(value)) return value
  throw new Error('voice_gender 只允许 auto/male/female')
}

function normalizeStyles(value: unknown): string[] {
  if (value == null) return []
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、\n]/)
      : null

  if (!rawItems) throw new Error('styles 必须是字符串或字符串数组')

  const seen = new Set<string>()
  const styles: string[] = []
  for (const item of rawItems) {
    if (typeof item !== 'string') throw new Error('styles 只允许字符串')
    const style = item.trim()
    if (!style || seen.has(style)) continue
    if (countTextLength(style) > 24) throw new Error('styles 单项不能超过 24 字')
    seen.add(style)
    styles.push(style)
    if (styles.length > 12) throw new Error('styles 最多 12 项')
  }
  return styles
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

async function signUrlOrNull(url: string | null | undefined, signer: UrlSigner): Promise<string | null> {
  if (!url) return null
  return signer(url)
}

async function resolvePlaybackUrl(
  publicUrl: string | null | undefined,
  storageUrl: string | null | undefined,
  signer: UrlSigner,
): Promise<string | null> {
  return (await signUrlOrNull(storageUrl, signer)) ?? publicUrl ?? null
}

export function validateMusicGeneratePayload(body: unknown): ValidatedMusicGeneratePayload {
  if (!isRecord(body)) throw new Error('请求体不能为空')
  if (Object.prototype.hasOwnProperty.call(body, 'voice_id')) {
    throw new Error('voice_id 不是内部音色克隆记录 ID，请使用 voice_clone_id')
  }

  const mode = normalizeMode(body.mode)
  const trackType = normalizeTrackType(body.track_type ?? body.type)
  const model = normalizeModel(body.model)
  const workspaceId = normalizeRequiredString(body.workspace_id, 'workspace_id 不能为空')
  const voiceGender = normalizeVoiceGender(body.voice_gender)
  const voiceCloneId = normalizeOptionalId(body.voice_clone_id)
  const params = {}

  if (mode === 'inspiration') {
    const prompt = normalizeLimitedText(
      body.prompt,
      '灵感描述不能为空',
      `灵感描述不能超过 ${MUSIC_PROMPT_MAX_LENGTH} 字`,
      MUSIC_PROMPT_MAX_LENGTH,
    )

    return {
      idempotency_key: normalizeOptionalString(body.idempotency_key) ?? undefined,
      workspace_id: workspaceId,
      mode,
      track_type: trackType,
      model,
      prompt,
      lyrics: normalizeOptionalLimitedText(body.lyrics, `歌词不能超过 ${MUSIC_LYRICS_MAX_LENGTH} 字`, MUSIC_LYRICS_MAX_LENGTH),
      title: normalizeOptionalString(body.title),
      styles: normalizeStyles(body.styles),
      voice_gender: voiceGender,
      voice_clone_id: voiceCloneId,
      params,
      canvas_id: normalizeOptionalString(body.canvas_id) ?? undefined,
      canvas_node_id: normalizeOptionalString(body.canvas_node_id) ?? undefined,
    }
  }

  if (trackType === 'instrumental') {
    throw new Error('custom 模式不支持 instrumental')
  }

  return {
    idempotency_key: normalizeOptionalString(body.idempotency_key) ?? undefined,
    workspace_id: workspaceId,
    mode,
    track_type: trackType,
    model,
    prompt: normalizeOptionalLimitedText(body.prompt, `灵感描述不能超过 ${MUSIC_PROMPT_MAX_LENGTH} 字`, MUSIC_PROMPT_MAX_LENGTH),
    title: normalizeMusicTitle(normalizeRequiredString(body.title, '标题不能为空')),
    lyrics: normalizeLimitedText(
      body.lyrics,
      '歌词不能为空',
      `歌词不能超过 ${MUSIC_LYRICS_MAX_LENGTH} 字`,
      MUSIC_LYRICS_MAX_LENGTH,
    ),
    styles: normalizeStyles(body.styles),
    voice_gender: voiceGender,
    voice_clone_id: voiceCloneId,
    params,
    canvas_id: normalizeOptionalString(body.canvas_id) ?? undefined,
    canvas_node_id: normalizeOptionalString(body.canvas_node_id) ?? undefined,
  }
}

export function validateVoiceClonePayload(body: unknown): ValidatedVoiceClonePayload {
  if (!isRecord(body)) throw new Error('请求体不能为空')
  return {
    name: normalizeRequiredString(body.name, '音色名称不能为空'),
    description: normalizeVoiceCloneDescription(normalizeOptionalString(body.description)),
    gender: normalizeVoiceGender(body.gender),
    model: normalizeModel(body.model ?? 'mureka-8'),
  }
}

export async function mapMusicTrackResponse(
  row: MusicTrackRow,
  voice?: { name?: string | null } | null,
  signer: UrlSigner = signAssetUrl,
): Promise<MusicTrackResponse & Record<string, unknown>> {
  const coverStorageUrl = await signUrlOrNull(row.cover_storage_url, signer)
  const audioStorageUrl = await signUrlOrNull(row.audio_storage_url, signer)
  const flacStorageUrl = await signUrlOrNull(row.flac_storage_url, signer)
  const wavStorageUrl = await signUrlOrNull(row.wav_storage_url, signer)

  return {
    id: row.id,
    batch_id: row.batch_id ?? '',
    task_id: row.task_id ?? '',
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    mode: row.mode,
    track_type: row.type,
    model: row.model as MusicModel,
    status: row.status,
    title: row.title,
    prompt: row.prompt,
    lyrics: row.lyrics,
    styles: row.styles ?? [],
    voice_clone_id: row.voice_clone_id,
    voice_gender: row.voice_gender,
    voice_name: voice?.name ?? null,
    cover_url: await resolvePlaybackUrl(row.cover_url, row.cover_storage_url, signer),
    cover_storage_url: coverStorageUrl,
    stream_url: row.stream_url,
    audio_url: await resolvePlaybackUrl(row.audio_url, row.audio_storage_url, signer),
    audio_storage_url: audioStorageUrl,
    flac_url: await resolvePlaybackUrl(row.flac_url, row.flac_storage_url, signer),
    flac_storage_url: flacStorageUrl,
    wav_url: await resolvePlaybackUrl(row.wav_url, row.wav_storage_url, signer),
    wav_storage_url: wavStorageUrl,
    duration_seconds: null,
    error_message: row.error_message,
    estimated_credits: row.estimated_credits ?? 0,
    credits_cost: row.credits_cost ?? null,
    created_at: toIsoString(row.created_at) ?? '',
    updated_at: toIsoString(row.updated_at) ?? '',
    completed_at: toIsoString(row.completed_at),
  }
}

export async function mapMusicVoiceCloneResponse(
  row: MusicVoiceCloneRow,
  signer: UrlSigner = signAssetUrl,
): Promise<MusicVoiceCloneResponse> {
  return {
    id: row.id,
    voice_id: row.voice_id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    name: row.name,
    gender: row.gender ?? 'auto',
    description: row.description,
    status: row.status,
    demo_audio_url: await resolvePlaybackUrl(row.source_audio_url, row.source_audio_storage_url, signer),
    error_message: row.error_message,
    created_at: toIsoString(row.created_at) ?? '',
    updated_at: toIsoString(row.updated_at) ?? '',
    completed_at: toIsoString(row.completed_at),
  }
}

export async function assertWorkspaceAccess(
  db: Db,
  workspaceId: string,
  userId: string,
  userRole: 'admin' | 'member' = 'member',
): Promise<WorkspaceAccess> {
  const wsMember = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .innerJoin('team_members', (join) =>
      join
        .onRef('team_members.team_id', '=', 'workspaces.team_id')
        .onRef('team_members.user_id', '=', 'workspace_members.user_id'),
    )
    .select(['workspaces.team_id', 'workspace_members.role'])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_deleted', '=', false)
    .executeTakeFirst()

  if (!wsMember && userRole !== 'admin') {
    throw new MusicRouteError(403, 'FORBIDDEN', '你不是此工作区的成员')
  }
  if (wsMember?.role === 'viewer' && userRole !== 'admin') {
    throw new MusicRouteError(403, 'FORBIDDEN', '查看者无权生成音乐')
  }

  const teamId = wsMember?.team_id ?? (await db
    .selectFrom('workspaces')
    .select('team_id')
    .where('id', '=', workspaceId)
    .where('is_deleted', '=', false)
    .executeTakeFirst())?.team_id

  if (!teamId) throw new MusicRouteError(404, 'NOT_FOUND', '工作区未找到')
  return { teamId, role: wsMember?.role ?? null }
}

export async function assertVoiceCloneReadyForWorkspace(
  db: Db,
  workspaceId: string,
  voiceCloneId: string | null | undefined,
) {
  if (!voiceCloneId) return null
  const voice = await db
    .selectFrom('music_voice_clones')
    .select(['id', 'name', 'voice_id', 'external_voice_id', 'workspace_id', 'status'])
    .where('id', '=', voiceCloneId)
    .where('workspace_id', '=', workspaceId)
    .where('status', '=', 'ready')
    .executeTakeFirst()

  if (!voice || !voice.voice_id) {
    throw new MusicRouteError(404, 'VOICE_NOT_READY', '音色不存在或尚未就绪')
  }
  return voice
}

async function getActiveProviderModel(db: Db, teamId: string, module: 'music' | 'music_voice_clone', model: string) {
  const providerModel = await db
    .selectFrom('provider_models')
    .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
    .select([
      'provider_models.id as modelId',
      'provider_models.credit_cost',
      'provider_models.params_pricing',
      'providers.code as providerCode',
      'providers.id as providerId',
    ])
    .where('provider_models.code', '=', model)
    .where('provider_models.module', '=', module)
    .where('provider_models.is_active', '=', true)
    .where('providers.is_active', '=', true)
    .executeTakeFirst()

  if (!providerModel) {
    throw new MusicRouteError(404, 'NOT_FOUND', `模型 "${model}" 未找到或已停用`)
  }

  const teamModelConfig = await db
    .selectFrom('team_model_configs')
    .select('is_active')
    .where('team_id', '=', teamId)
    .where('model_id', '=', providerModel.modelId)
    .executeTakeFirst()

  if (teamModelConfig && !teamModelConfig.is_active) {
    throw new MusicRouteError(403, 'MODEL_DISABLED', `模型 "${model}" 在当前团队中已被禁用`)
  }

  return providerModel
}

export async function resolveMusicCredits(
  db: Db,
  teamId: string,
  model: MusicModel,
  trackType: MusicTrackType,
  mode: MusicMode,
): Promise<ResolvedMusicCredits> {
  const providerModel = await getActiveProviderModel(db, teamId, 'music', model)
  const resolutions = [
    ...(mode === 'inspiration' && trackType === 'song' ? ['lyrics'] : []),
    trackType,
    'cover',
    'transfer',
  ]
  const unitPrices = Object.fromEntries(
    resolutions.map((resolution) => [
      resolution,
      resolveUnitPrice(providerModel.params_pricing, resolution, providerModel.credit_cost).unitPrice,
    ]),
  )
  const estimatedCredits = Object.values(unitPrices).reduce((sum, price) => sum + price, 0)

  return {
    providerModelId: providerModel.modelId,
    providerCode: providerModel.providerCode,
    providerId: providerModel.providerId,
    estimatedCredits,
    unitPrices,
  }
}

export async function resolveVoiceCloneCredits(
  db: Db,
  teamId: string,
  model: MusicModel,
): Promise<ResolvedMusicCredits> {
  const voiceCloneModel = `${model}-voice-clone`
  const providerModel = await getActiveProviderModel(db, teamId, 'music_voice_clone', voiceCloneModel)
  const unitPrice = resolveUnitPrice(providerModel.params_pricing, 'voice_clone', providerModel.credit_cost).unitPrice

  return {
    providerModelId: providerModel.modelId,
    providerCode: providerModel.providerCode,
    providerId: providerModel.providerId,
    estimatedCredits: unitPrice,
    unitPrices: { voice_clone: unitPrice },
  }
}
