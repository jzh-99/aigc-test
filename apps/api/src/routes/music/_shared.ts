// music 模块共享辅助函数；autoload 会忽略以 _ 开头的文件。

import type { FastifyBaseLogger, FastifyReply } from 'fastify'
import { getDb } from '@aigc/db'
import { sql, type Selectable } from 'kysely'
import type { Database } from '@aigc/db'
import type {
  MusicMode,
  MusicModel,
  ParamsPricingRule,
  MusicSseEvent,
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
  resolveMusicPricingKey,
} from '@aigc/types'
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
type LoggerLike = Pick<FastifyBaseLogger, 'error'>

export const MAX_VOICE_CLONE_AUDIO_SIZE = 10 * 1024 * 1024
export const MIN_VOICE_CLONE_AUDIO_DURATION_SECONDS = 15
export const MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE = '任务投递失败，请稍后重试'

const AUDIO_EXTS = ['mp3', 'm4a'] as const
const AUDIO_MIME_BY_EXT: Record<(typeof AUDIO_EXTS)[number], string[]> = {
  mp3: ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
}

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

export class MusicValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicValidationError'
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
}

export interface WorkspaceAccess {
  teamId: string
  role: 'admin' | 'editor' | 'viewer' | null
}

export interface ResolvedMusicCredits {
  providerModelId: string | null
  providerCode: string
  providerId: string | null
  estimatedCredits: number
  unitPrices: Record<string, number>
}

export interface ValidatedVoiceCloneAudioUpload {
  ext: (typeof AUDIO_EXTS)[number]
  contentType: string
}

export interface MusicTrackCursor {
  createdAt: Date
  id: string | null
}

export interface MusicQueueDeliveryFailureTarget {
  batchId: string
  taskId: string
  trackId?: string
  voiceCloneId?: string
  errorMessage?: string
}

export interface MusicSseCleanupOptions {
  requestRaw: {
    on: (event: string, listener: () => void) => unknown
    off?: (event: string, listener: () => void) => unknown
    removeListener?: (event: string, listener: () => void) => unknown
  }
  raw: {
    end: () => unknown
  }
  subscriber: {
    unsubscribe: (channel: string) => Promise<unknown>
    quit: () => Promise<unknown>
  }
  channel: string
  logger: LoggerLike
  heartbeat?: NodeJS.Timeout | null
}

export type MusicSseCleanup = ((cleanupOptions?: { endRaw?: boolean }) => void) & {
  isCleaned: () => boolean
  setHeartbeat: (nextHeartbeat: NodeJS.Timeout) => void
}

const CREDIT_REJECTION_MESSAGES = new Set([
  '未找到A豆账户',
  'A豆余额不足',
  '个人积分配额已用尽，请联系团队负责人增加配额',
])

function countTextLength(value: string): number {
  return [...value].length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validationError(message: string): never {
  throw new MusicValidationError(message)
}

function routeError(statusCode: number, code: string, message: string): never {
  throw new MusicRouteError(statusCode, code, message)
}

function normalizeRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string') validationError(message)
  const normalized = value.trim()
  if (!normalized) validationError(message)
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
  if (typeof value !== 'string') validationError('voice_clone_id 必须是字符串')
  const normalized = value.trim()
  return normalized || null
}

function normalizeMime(value: string | undefined): string {
  return String(value ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function hasPrefix(buffer: Buffer, prefix: number[]): boolean {
  if (buffer.length < prefix.length) return false
  return prefix.every((byte, index) => buffer[index] === byte)
}

function detectAudioMagic(buffer: Buffer): (typeof AUDIO_EXTS)[number] | null {
  if (buffer.length < 4) return null
  if (hasPrefix(buffer, [0x49, 0x44, 0x33])) return 'mp3'
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brandText = buffer.subarray(8, Math.min(buffer.length, 32)).toString('ascii')
    if (/(M4A|M4B|mp4|isom|iso2)/.test(brandText)) return 'm4a'
  }
  return null
}

function id3v2Size(buffer: Buffer): number {
  if (buffer.length < 10 || buffer.subarray(0, 3).toString('ascii') !== 'ID3') return 0
  return 10
    + ((buffer[6] & 0x7f) << 21)
    + ((buffer[7] & 0x7f) << 14)
    + ((buffer[8] & 0x7f) << 7)
    + (buffer[9] & 0x7f)
}

function parseMp3DurationSeconds(buffer: Buffer): number | null {
  const bitrates: Record<number, number[]> = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  }
  const sampleRates: Record<number, number[]> = {
    0b11: [44100, 48000, 32000],
    0b10: [22050, 24000, 16000],
    0b00: [11025, 12000, 8000],
  }
  let offset = id3v2Size(buffer)
  let duration = 0
  let frames = 0

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }

    const versionBits = (buffer[offset + 1] >> 3) & 0x03
    const layerBits = (buffer[offset + 1] >> 1) & 0x03
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03
    const padding = (buffer[offset + 2] >> 1) & 0x01
    if (versionBits === 0b01 || layerBits !== 0b01 || bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
      offset += 1
      continue
    }

    const mpegVersion = versionBits === 0b11 ? 1 : 2
    const bitrate = (bitrates[mpegVersion]?.[bitrateIndex] ?? 0) * 1000
    const sampleRate = sampleRates[versionBits]?.[sampleRateIndex] ?? 0
    if (!bitrate || !sampleRate) {
      offset += 1
      continue
    }

    const samplesPerFrame = mpegVersion === 1 ? 1152 : 576
    const frameSize = Math.floor(((mpegVersion === 1 ? 144 : 72) * bitrate) / sampleRate) + padding
    if (frameSize <= 4 || offset + frameSize > buffer.length) break
    duration += samplesPerFrame / sampleRate
    frames += 1
    offset += frameSize
  }

  return frames > 0 ? duration : null
}

function parseM4aDurationSeconds(buffer: Buffer): number | null {
  const stack: Array<{ start: number; end: number }> = [{ start: 0, end: buffer.length }]
  while (stack.length) {
    const range = stack.pop()
    if (!range) continue
    let offset = range.start
    while (offset + 8 <= range.end) {
      let size = buffer.readUInt32BE(offset)
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
      let headerSize = 8
      if (size === 1 && offset + 16 <= range.end) {
        const largeSize = buffer.readBigUInt64BE(offset + 8)
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null
        size = Number(largeSize)
        headerSize = 16
      } else if (size === 0) {
        size = range.end - offset
      }
      const boxEnd = offset + size
      if (size < headerSize || boxEnd > range.end) break

      if ((type === 'mvhd' || type === 'mdhd') && offset + headerSize + 20 <= boxEnd) {
        const version = buffer[offset + headerSize]
        const bodyOffset = offset + headerSize + 4
        if (version === 0 && bodyOffset + 16 <= boxEnd) {
          const timescale = buffer.readUInt32BE(bodyOffset + 8)
          const duration = buffer.readUInt32BE(bodyOffset + 12)
          if (timescale > 0 && duration > 0) return duration / timescale
        } else if (version === 1 && bodyOffset + 28 <= boxEnd) {
          const timescale = buffer.readUInt32BE(bodyOffset + 16)
          const duration = buffer.readBigUInt64BE(bodyOffset + 20)
          if (timescale > 0 && duration > 0n) return Number(duration) / timescale
        }
      }

      if (['moov', 'trak', 'mdia'].includes(type)) stack.push({ start: offset + headerSize, end: boxEnd })
      offset = boxEnd
    }
  }
  return null
}

export function getVoiceCloneAudioDurationSeconds(buffer: Buffer, ext: (typeof AUDIO_EXTS)[number]): number | null {
  return ext === 'mp3' ? parseMp3DurationSeconds(buffer) : parseM4aDurationSeconds(buffer)
}

export function assertVoiceCloneAudioDuration(buffer: Buffer, ext: (typeof AUDIO_EXTS)[number]): number {
  const duration = getVoiceCloneAudioDurationSeconds(buffer, ext)
  if (duration == null) {
    routeError(400, 'BAD_REQUEST', '无法识别音频时长，请上传有效的 mp3/m4a 文件')
  }
  if (duration < MIN_VOICE_CLONE_AUDIO_DURATION_SECONDS) {
    routeError(400, 'BAD_REQUEST', `音色克隆音频至少需要 ${MIN_VOICE_CLONE_AUDIO_DURATION_SECONDS} 秒有效人声，请上传更长的人声音频`)
  }
  return duration
}

export function validateVoiceCloneAudioUpload(
  filename: string | undefined,
  buffer: Buffer,
  mimetype: string | undefined,
): ValidatedVoiceCloneAudioUpload {
  const ext = String(filename ?? '').split('.').pop()?.toLowerCase() as (typeof AUDIO_EXTS)[number] | undefined
  if (!ext || !AUDIO_EXTS.includes(ext)) {
    routeError(400, 'BAD_REQUEST', `不支持的音频格式，请上传 ${AUDIO_EXTS.join('/')} 文件`)
  }
  if (buffer.length === 0) routeError(400, 'BAD_REQUEST', '音频文件不能为空')
  if (buffer.length > MAX_VOICE_CLONE_AUDIO_SIZE) {
    routeError(413, 'PAYLOAD_TOO_LARGE', '音频文件过大，最大支持 10 MB')
  }

  const contentType = normalizeMime(mimetype)
  if (!AUDIO_MIME_BY_EXT[ext].includes(contentType)) {
    routeError(400, 'BAD_REQUEST', '音频 MIME 类型与文件扩展名不匹配')
  }

  const detected = detectAudioMagic(buffer)
  if (!detected || detected !== ext) {
    routeError(400, 'BAD_REQUEST', '请上传有效的 mp3/m4a 文件')
  }

  return { ext, contentType }
}

function normalizeCursorDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function encodeMusicTrackCursor(row: { id: string; created_at: Date | string }): string {
  const createdAt = normalizeCursorDate(row.created_at)
  if (!createdAt) validationError('cursor 不是有效时间')
  return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id: row.id })).toString('base64url')
}

export function decodeMusicTrackCursor(cursor: string): MusicTrackCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
      created_at?: unknown
      createdAt?: unknown
      id?: unknown
    }
    const createdAt = normalizeCursorDate(decoded.created_at ?? decoded.createdAt)
    if (createdAt && typeof decoded.id === 'string' && decoded.id.trim()) {
      return { createdAt, id: decoded.id }
    }
  } catch {
    // 兼容旧版直接传 ISO 时间字符串的 cursor。
  }

  const legacyDate = normalizeCursorDate(cursor)
  if (!legacyDate) validationError('cursor 不是有效时间')
  return { createdAt: legacyDate, id: null }
}

export function createMusicSseCleanup(options: MusicSseCleanupOptions): MusicSseCleanup {
  let cleaned = false
  let heartbeat = options.heartbeat ?? null
  const onClose = () => cleanup()

  const cleanup = (cleanupOptions: { endRaw?: boolean } = {}) => {
    if (cleaned) return
    cleaned = true
    if (heartbeat) clearInterval(heartbeat)
    options.requestRaw.off?.('close', onClose)
      ?? options.requestRaw.removeListener?.('close', onClose)
    options.subscriber
      .unsubscribe(options.channel)
      .catch((error) => options.logger.error({ err: error, channel: options.channel }, 'Music SSE unsubscribe failed'))
    options.subscriber
      .quit()
      .catch((error) => options.logger.error({ err: error, channel: options.channel }, 'Music SSE Redis close failed'))
    if (cleanupOptions.endRaw !== false) setImmediate(() => options.raw.end())
  }

  cleanup.isCleaned = () => cleaned
  cleanup.setHeartbeat = (nextHeartbeat: NodeJS.Timeout) => {
    if (cleaned) {
      clearInterval(nextHeartbeat)
      return
    }
    heartbeat = nextHeartbeat
  }
  options.requestRaw.on('close', onClose)
  return cleanup
}

export async function markMusicQueueDeliveryFailed(
  db: Db,
  target: MusicQueueDeliveryFailureTarget,
): Promise<void> {
  const errorMessage = target.errorMessage ?? MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE
  await db.transaction().execute(async (trx: any) => {
    await trx
      .updateTable('task_batches')
      .set({
        status: 'failed',
        failed_count: 1,
        updated_at: sql`now()`,
      })
      .where('id', '=', target.batchId)
      .execute()

    await trx
      .updateTable('tasks')
      .set({
        status: 'failed',
        error_message: errorMessage,
        completed_at: sql`now()`,
      })
      .where('id', '=', target.taskId)
      .execute()

    if (target.trackId) {
      await trx
        .updateTable('music_tracks')
        .set({
          status: 'failed',
          error_message: errorMessage,
          updated_at: sql`now()`,
        })
        .where('id', '=', target.trackId)
        .execute()
    }

    if (target.voiceCloneId) {
      await trx
        .updateTable('music_voice_clones')
        .set({
          status: 'failed',
          error_message: errorMessage,
          updated_at: sql`now()`,
        })
        .where('id', '=', target.voiceCloneId)
        .execute()
    }
  })
}

function normalizeLimitedText(
  value: unknown,
  requiredMessage: string,
  tooLongMessage: string,
  maxLength: number,
): string {
  const normalized = normalizeRequiredString(value, requiredMessage)
  if (countTextLength(normalized) > maxLength) validationError(tooLongMessage)
  return normalized
}

function normalizeOptionalLimitedText(value: unknown, tooLongMessage: string, maxLength: number): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (countTextLength(normalized) > maxLength) validationError(tooLongMessage)
  return normalized
}

function normalizeMode(value: unknown): MusicMode {
  if (typeof value === 'string' && MUSIC_MODE_VALUES.includes(value as MusicMode)) return value as MusicMode
  validationError('mode 只允许 inspiration/custom')
}

function normalizeTrackType(value: unknown): MusicTrackType {
  if (typeof value === 'string' && MUSIC_TRACK_TYPE_VALUES.includes(value as MusicTrackType)) return value as MusicTrackType
  validationError('type 只允许 song/instrumental')
}

function normalizeModel(value: unknown): MusicModel {
  if (isMusicModel(value)) return value
  validationError(`model 只允许 ${MUSIC_MODEL_VALUES.join('/')}`)
}

function normalizeVoiceGender(value: unknown): MusicVoiceGender {
  if (value == null || value === '') return 'auto'
  if (isMusicVoiceGender(value)) return value
  validationError('voice_gender 只允许 auto/male/female')
}

function normalizeStyles(value: unknown): string[] {
  if (value == null) return []
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、\n]/)
      : null

  if (!rawItems) validationError('styles 必须是字符串或字符串数组')

  const seen = new Set<string>()
  const styles: string[] = []
  for (const item of rawItems) {
    if (typeof item !== 'string') validationError('styles 只允许字符串')
    const style = item.trim()
    if (!style || seen.has(style)) continue
    if (countTextLength(style) > 24) validationError('styles 单项不能超过 24 字')
    seen.add(style)
    styles.push(style)
    if (styles.length > 12) validationError('styles 最多 12 项')
  }
  return styles
}

function normalizeMusicTitleForRequest(value: string): string {
  try {
    return normalizeMusicTitle(value)
  } catch (error) {
    // 工具函数无 logger 上下文：统一转换为业务校验异常抛出，由路由外层 catch + sendMusicRouteError 记录日志
    validationError(error instanceof Error ? error.message : '标题不合法')
  }
}

function normalizeVoiceCloneDescriptionForRequest(value: string | null): string | null {
  try {
    return normalizeVoiceCloneDescription(value)
  } catch (error) {
    // 工具函数无 logger 上下文：统一转换为业务校验异常抛出，由路由外层 catch + sendMusicRouteError 记录日志
    validationError(error instanceof Error ? error.message : '描述不合法')
  }
}

export function sendMusicRouteError(
  reply: FastifyReply,
  error: unknown,
  logger?: FastifyBaseLogger,
  logMessage = 'Music request failed',
) {
  if (error instanceof MusicRouteError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message },
    })
  }
  if (error instanceof MusicValidationError) {
    return reply.status(400).send({
      success: false,
      error: { code: 'BAD_REQUEST', message: error.message },
    })
  }

  logger?.error({ err: error }, logMessage)
  return reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: '请求处理失败，请稍后重试' },
  })
}

export function getExpectedCreditErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  return CREDIT_REJECTION_MESSAGES.has(error.message) ? error.message : null
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function normalizeLyricsSections(value: unknown): MusicTrackResponse['lyrics_sections'] {
  return Array.isArray(value) ? value as MusicTrackResponse['lyrics_sections'] : []
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
  if (!isRecord(body)) validationError('请求体不能为空')
  if (Object.prototype.hasOwnProperty.call(body, 'voice_id')) {
    validationError('voice_id 不是内部音色克隆记录 ID，请使用 voice_clone_id')
  }

  const mode = normalizeMode(body.mode)
  const trackType = normalizeTrackType(body.track_type ?? body.type)
  const model = normalizeModel(body.model)
  const workspaceId = normalizeRequiredString(body.workspace_id, 'workspace_id 不能为空')
  const voiceGender = normalizeVoiceGender(body.voice_gender)
  const voiceCloneId = normalizeOptionalId(body.voice_clone_id)
  if (voiceCloneId && voiceGender !== 'auto') {
    validationError('音色和音色性别不能同时选择')
  }
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
      voice_gender: voiceCloneId ? 'auto' : voiceGender,
      voice_clone_id: voiceGender === 'auto' ? voiceCloneId : null,
      params,
      canvas_id: normalizeOptionalString(body.canvas_id) ?? undefined,
      canvas_node_id: normalizeOptionalString(body.canvas_node_id) ?? undefined,
    }
  }

  if (trackType === 'instrumental') {
    validationError('custom 模式不支持 instrumental')
  }

  return {
    idempotency_key: normalizeOptionalString(body.idempotency_key) ?? undefined,
    workspace_id: workspaceId,
    mode,
    track_type: trackType,
    model,
    prompt: normalizeOptionalLimitedText(body.prompt, `灵感描述不能超过 ${MUSIC_PROMPT_MAX_LENGTH} 字`, MUSIC_PROMPT_MAX_LENGTH),
    title: normalizeMusicTitleForRequest(normalizeRequiredString(body.title, '标题不能为空')),
    lyrics: normalizeLimitedText(
      body.lyrics,
      '歌词不能为空',
      `歌词不能超过 ${MUSIC_LYRICS_MAX_LENGTH} 字`,
      MUSIC_LYRICS_MAX_LENGTH,
    ),
    styles: normalizeStyles(body.styles),
    voice_gender: voiceCloneId ? 'auto' : voiceGender,
    voice_clone_id: voiceGender === 'auto' ? voiceCloneId : null,
    params,
    canvas_id: normalizeOptionalString(body.canvas_id) ?? undefined,
    canvas_node_id: normalizeOptionalString(body.canvas_node_id) ?? undefined,
  }
}

export function validateVoiceClonePayload(body: unknown): ValidatedVoiceClonePayload {
  if (!isRecord(body)) validationError('请求体不能为空')
  return {
    name: normalizeRequiredString(body.name, '音色名称不能为空'),
    description: normalizeVoiceCloneDescriptionForRequest(normalizeOptionalString(body.description)),
    gender: normalizeVoiceGender(body.gender),
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
    lyrics_sections: normalizeLyricsSections(row.lyrics_sections),
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
    duration_seconds: row.duration_seconds,
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

export function createMusicTrackSsePayload(
  event: 'status' | 'stream_url' | 'completed' | 'failed',
  track: MusicTrackResponse,
): MusicSseEvent {
  if (event === 'stream_url') {
    return { event, stream_url: track.stream_url ?? '', track }
  }
  if (event === 'completed') {
    return { event, track }
  }
  if (event === 'failed') {
    return { event, error_message: track.error_message ?? '音乐生成失败', track }
  }
  return { event, status: track.status, track }
}

export function buildMusicAdjacentResponse<T extends { id: string }>(
  previous: T | null,
  next: T | null,
): {
  previous_id: string | null
  next_id: string | null
  previous: T | null
  next: T | null
} {
  return {
    previous_id: previous?.id ?? null,
    next_id: next?.id ?? null,
    previous,
    next,
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

export async function canReadMusicWorkspace(
  db: Db,
  workspaceId: string,
  userId: string,
  userRole: 'admin' | 'member' = 'member',
): Promise<boolean> {
  if (userRole === 'admin') {
    const workspace = await db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    return Boolean(workspace)
  }

  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select('workspace_members.id')
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_deleted', '=', false)
    .executeTakeFirst()
  return Boolean(member)
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
    .innerJoin('providers', 'providers.code', 'provider_models.provider_code')
    .select([
      'provider_models.id as modelId',
      'provider_models.params_pricing',
      'provider_models.provider_code as providerCode',
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

function resolveMusicBusinessModePrice(paramsPricing: unknown, pricingKey: string): number {
  if (!Array.isArray(paramsPricing)) {
    throw new MusicRouteError(500, 'MUSIC_PRICE_NOT_CONFIGURED', '音乐价格配置缺失')
  }
  const matched = paramsPricing.find((rule): rule is ParamsPricingRule =>
    typeof rule === 'object' &&
    rule !== null &&
    (rule as ParamsPricingRule).resolution === pricingKey &&
    typeof (rule as ParamsPricingRule).unit_price === 'number',
  )
  if (!matched) {
    throw new MusicRouteError(500, 'MUSIC_PRICE_NOT_CONFIGURED', '音乐价格配置缺失')
  }
  return matched.unit_price
}

export async function resolveMusicCredits(
  db: Db,
  teamId: string,
  model: MusicModel,
  trackType: MusicTrackType,
  mode: MusicMode,
): Promise<ResolvedMusicCredits> {
  const providerModel = await getActiveProviderModel(db, teamId, 'music', model)
  const pricingKey = resolveMusicPricingKey(mode, trackType)
  const estimatedCredits = resolveMusicBusinessModePrice(providerModel.params_pricing, pricingKey)

  return {
    providerModelId: providerModel.modelId,
    providerCode: providerModel.providerCode,
    providerId: providerModel.providerId,
    estimatedCredits,
    unitPrices: { [pricingKey]: estimatedCredits },
  }
}

export async function resolveVoiceCloneCredits(
  db: Db,
  _teamId: string,
): Promise<ResolvedMusicCredits> {
  const rawCredits = Number.parseInt(process.env.MUSIC_VOICE_CLONE_CREDITS ?? '5', 10)
  const fallbackUnitPrice = Number.isFinite(rawCredits) && rawCredits >= 0 ? rawCredits : 5
  const costConfig = await db
    .selectFrom('system_cost_configs')
    .select('credit_cost')
    .where('key', '=', 'music_voice_clone')
    .executeTakeFirst()
  const configuredUnitPrice = costConfig?.credit_cost
  const unitPrice = typeof configuredUnitPrice === 'number' && Number.isFinite(configuredUnitPrice) && configuredUnitPrice >= 0
    ? configuredUnitPrice
    : fallbackUnitPrice

  return {
    providerModelId: null,
    providerCode: 'mureka',
    providerId: null,
    estimatedCredits: unitPrice,
    unitPrices: { voice_clone: unitPrice },
  }
}
