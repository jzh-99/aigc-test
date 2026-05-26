import { recordProviderApiLog, type ProviderApiLogInput } from '@aigc/db'
import type { MusicLyricsSection, MusicModel, MusicVoiceGender } from '@aigc/types'
import { buildLogger } from '../logger.js'
import { downloadMusicFile } from './music-storage.js'
import { recordProviderPollAudit } from './provider-poll-audit.js'

const logger = buildLogger()
const MUREKA_VOICE_CLONE_MAX_BYTES = 10 * 1024 * 1024

export interface MurekaClientOptions {
  baseUrl?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  auditContext?: MurekaAuditContext
}

export interface MurekaAuditContext {
  batchId?: string | null
  taskId?: string | null
  userId?: string | null
  teamId?: string | null
  workspaceId?: string | null
  module?: string
}

export interface MurekaLyricsRequest {
  prompt: string
  model: MusicModel
}

export interface MurekaSongRequest {
  lyrics: string
  model: MusicModel
  prompt?: string | null
  title?: string | null
  voiceId?: string | null
  styles?: string[]
}

export interface MurekaInstrumentalRequest {
  prompt: string
  model: MusicModel
}

export interface MurekaVoiceCloneRequest {
  audioUrl: string
  name: string
  description?: string | null
  gender?: MusicVoiceGender
}

export interface MurekaMediaResult {
  id?: string | null
  task_id?: string | null
  status?: string | null
  title?: string | null
  lyrics?: string | null
  url?: string | null
  flac_url?: string | null
  wav_url?: string | null
  stream_url?: string | null
  duration?: number | null
  lyrics_sections?: MusicLyricsSection[]
  error_message?: string | null
}

export interface MurekaVoiceCloneResult {
  id?: string | null
  task_id?: string | null
  status?: string | null
  voice_id?: string | null
  error_message?: string | null
}

type JsonRecord = Record<string, unknown>

export class MurekaApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'MurekaApiError'
  }
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl ?? process.env.MUREKA_API_URL ?? '').trim().replace(/\/+$/, '')
  if (!normalized) throw new MurekaApiError('MUREKA_API_URL 未配置')
  return normalized
}

function resolveApiKey(apiKey: string | undefined): string {
  const normalized = (apiKey ?? process.env.MUREKA_API_KEY ?? '').trim()
  if (!normalized) throw new MurekaApiError('MUREKA_API_KEY 未配置')
  return normalized
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}
}

function firstRecord(data: unknown): JsonRecord {
  const record = asRecord(data)
  if (Array.isArray(record.data)) return asRecord(record.data[0])
  if (record.data) return asRecord(record.data)
  if (record.result) return asRecord(record.result)
  return record
}

function firstChoiceRecord(record: JsonRecord): JsonRecord {
  return Array.isArray(record.choices) ? asRecord(record.choices[0]) : {}
}

function textField(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function numberField(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function parseLyricsSections(value: unknown): MusicLyricsSection[] {
  if (!Array.isArray(value)) return []
  return value.map((section) => {
    const sectionRecord = asRecord(section)
    const lines = Array.isArray(sectionRecord.lines) ? sectionRecord.lines : []
    return {
      section_type: textField(sectionRecord, ['section_type', 'sectionType']) ?? '',
      start: numberField(sectionRecord, ['start']) ?? 0,
      end: numberField(sectionRecord, ['end']) ?? 0,
      lines: lines.map((line) => {
        const lineRecord = asRecord(line)
        const words = Array.isArray(lineRecord.words) ? lineRecord.words : []
        return {
          start: numberField(lineRecord, ['start']) ?? 0,
          end: numberField(lineRecord, ['end']) ?? 0,
          text: textField(lineRecord, ['text']) ?? '',
          words: words.map((word) => {
            const wordRecord = asRecord(word)
            return {
              start: numberField(wordRecord, ['start']) ?? 0,
              end: numberField(wordRecord, ['end']) ?? 0,
              text: textField(wordRecord, ['text']) ?? '',
            }
          }).filter((word) => word.text),
        }
      }).filter((line) => line.text),
    }
  }).filter((section) => section.lines.length > 0)
}

function responseTraceId(data: unknown): string | null {
  const record = asRecord(data)
  const nestedError = asRecord(record.error)
  return textField(record, ['trace_id', 'traceId']) ?? textField(nestedError, ['trace_id', 'traceId'])
}

function responseErrorMessage(data: unknown): string | null {
  const record = firstRecord(data)
  const nestedError = asRecord(record.error)
  return textField(record, ['message', 'error', 'detail']) ?? textField(nestedError, ['message', 'detail'])
}

function parseLyrics(data: unknown): string {
  const record = firstRecord(data)
  const lyrics = textField(record, ['lyrics', 'text', 'content'])
  if (!lyrics) throw new MurekaApiError('Mureka 歌词响应缺少 lyrics')
  return lyrics
}

function parseMediaResult(data: unknown): MurekaMediaResult {
  const record = firstRecord(data)
  const choice = firstChoiceRecord(record)
  return {
    id: textField(record, ['id']) ?? textField(choice, ['id']),
    task_id: textField(record, ['task_id', 'taskId']),
    status: textField(record, ['status']),
    title: textField(record, ['title']) ?? textField(choice, ['title']),
    lyrics: textField(record, ['lyrics']) ?? textField(choice, ['lyrics']),
    url: textField(choice, ['url', 'audio_url']) ?? textField(record, ['url', 'audio_url']),
    flac_url: textField(choice, ['flac_url', 'flacUrl']) ?? textField(record, ['flac_url', 'flacUrl']),
    wav_url: textField(choice, ['wav_url', 'wavUrl']) ?? textField(record, ['wav_url', 'wavUrl']),
    stream_url: textField(choice, ['stream_url', 'streamUrl']) ?? textField(record, ['stream_url', 'streamUrl']),
    duration: numberField(choice, ['duration']) ?? numberField(record, ['duration']),
    lyrics_sections: parseLyricsSections(choice.lyrics_sections ?? choice.lyricsSections),
    error_message: textField(record, ['failed_reason', 'failedReason', 'error_message', 'error'])
      ?? textField(choice, ['failed_reason', 'failedReason', 'error_message', 'error']),
  }
}

function summarizeMediaResponse(data: unknown): Record<string, unknown> {
  const record = firstRecord(data)
  const choice = firstChoiceRecord(record)
  return {
    topLevelKeys: Object.keys(record).slice(0, 30),
    id: textField(record, ['id']),
    status: textField(record, ['status']),
    failedReason: textField(record, ['failed_reason', 'failedReason']),
    choicesCount: Array.isArray(record.choices) ? record.choices.length : 0,
    firstChoiceKeys: Object.keys(choice).slice(0, 30),
    firstChoiceId: textField(choice, ['id']),
    hasChoiceUrl: Boolean(textField(choice, ['url', 'audio_url'])),
    hasChoiceFlacUrl: Boolean(textField(choice, ['flac_url', 'flacUrl'])),
    hasChoiceWavUrl: Boolean(textField(choice, ['wav_url', 'wavUrl'])),
    hasChoiceStreamUrl: Boolean(textField(choice, ['stream_url', 'streamUrl'])),
    choiceDuration: numberField(choice, ['duration']),
    lyricsSectionsCount: Array.isArray(choice.lyrics_sections) ? choice.lyrics_sections.length : 0,
    hasTopLevelUrl: Boolean(textField(record, ['url', 'audio_url'])),
    hasTopLevelFlacUrl: Boolean(textField(record, ['flac_url', 'flacUrl'])),
    hasTopLevelWavUrl: Boolean(textField(record, ['wav_url', 'wavUrl'])),
    hasTopLevelStreamUrl: Boolean(textField(record, ['stream_url', 'streamUrl'])),
  }
}

function parseVoiceCloneResult(data: unknown): MurekaVoiceCloneResult {
  const record = firstRecord(data)
  const voiceId = textField(record, ['voice_id', 'voiceId', 'vocal_id', 'vocalId', 'id'])
  return {
    id: textField(record, ['id']),
    task_id: textField(record, ['task_id', 'taskId']),
    status: textField(record, ['status']),
    voice_id: voiceId,
    error_message: textField(record, ['error_message', 'error']),
  }
}

function isDoneStatus(status: string | null | undefined): boolean {
  return ['succeeded', 'success', 'completed', 'done', 'ready'].includes((status ?? '').toLowerCase())
}

function isFailedStatus(status: string | null | undefined): boolean {
  return ['failed', 'error', 'canceled', 'cancelled'].includes((status ?? '').toLowerCase())
}

export class MurekaClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly auditContext: MurekaAuditContext

  constructor(options: MurekaClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.apiKey = resolveApiKey(options.apiKey)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.auditContext = options.auditContext ?? {}
  }

  async generateLyrics(request: MurekaLyricsRequest): Promise<string> {
    const data = await this.postJson('/v1/lyrics/generate', {
      model: request.model,
      prompt: request.prompt,
      stream: true,
    })
    return parseLyrics(data)
  }

  async generateSong(request: MurekaSongRequest): Promise<MurekaMediaResult> {
    const data = await this.postJson('/v1/song/generate', {
      model: request.model,
      lyrics: request.lyrics,
      prompt: request.prompt ?? undefined,
      title: request.title ?? undefined,
      vocal_id: request.voiceId ?? undefined,
      styles: request.styles?.length ? request.styles : undefined,
      n: 1,
      stream: true,
    })
    logger.info(summarizeMediaResponse(data), 'Mureka 生成歌曲接口响应摘要')
    return parseMediaResult(data)
  }

  async generateInstrumental(request: MurekaInstrumentalRequest): Promise<MurekaMediaResult> {
    const data = await this.postJson('/v1/instrumental/generate', {
      model: request.model,
      prompt: request.prompt,
      n: 1,
      stream: true,
    })
    logger.info(summarizeMediaResponse(data), 'Mureka 生成纯音乐接口响应摘要')
    return parseMediaResult(data)
  }

  async cloneVoice(request: MurekaVoiceCloneRequest): Promise<MurekaVoiceCloneResult> {
    const audio = await downloadMusicFile(request.audioUrl, 'source-audio', {
      maxBytes: MUREKA_VOICE_CLONE_MAX_BYTES,
      fetchImpl: this.fetchImpl,
    })
    const form = new FormData()
    form.set('description', request.description ?? request.name)
    form.set('file', new Blob([new Uint8Array(audio.buffer)], { type: audio.contentType }), `voice-clone.${audio.extension}`)
    const data = await this.requestJson('/v1/song/vocal-clone', { method: 'POST', body: form })
    return parseVoiceCloneResult(data)
  }

  async pollSongResult(
    taskId: string,
    options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (result: MurekaMediaResult) => void | Promise<void> } = {},
  ): Promise<MurekaMediaResult> {
    return this.poll(`/v1/song/query/${encodeURIComponent(taskId)}`, (data) => {
      logger.info({ taskId, ...summarizeMediaResponse(data) }, 'Mureka 查询歌曲接口响应摘要')
      return parseMediaResult(data)
    }, options)
  }

  async pollInstrumentalResult(
    taskId: string,
    options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (result: MurekaMediaResult) => void | Promise<void> } = {},
  ): Promise<MurekaMediaResult> {
    return this.poll(`/v1/instrumental/query/${encodeURIComponent(taskId)}`, (data) => {
      logger.info({ taskId, ...summarizeMediaResponse(data) }, 'Mureka 查询纯音乐接口响应摘要')
      return parseMediaResult(data)
    }, options)
  }

  async pollVoiceCloneResult(taskId: string, options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<MurekaVoiceCloneResult> {
    return this.poll(`/v1/song/vocal-clone/${encodeURIComponent(taskId)}`, parseVoiceCloneResult, options)
  }

  private async poll<T extends { status?: string | null; error_message?: string | null }>(
    path: string,
    parser: (data: unknown) => T,
    options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (result: T) => void | Promise<void> },
  ): Promise<T> {
    const intervalMs = options.intervalMs ?? 3000
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000)
    while (Date.now() < deadline) {
      const result = parser(await this.getJson(path))
      await options.onUpdate?.(result)
      if (isDoneStatus(result.status)) return result
      if (isFailedStatus(result.status)) throw new MurekaApiError(result.error_message ?? 'Mureka 任务失败')
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new MurekaApiError('Mureka 任务轮询超时')
  }

  private async postJson(path: string, body: JsonRecord): Promise<unknown> {
    return this.requestJson(path, { method: 'POST', body: JSON.stringify(body) })
  }

  private async getJson(path: string): Promise<unknown> {
    return this.requestJson(path, { method: 'GET' })
  }

  private operationForPath(path: string): string {
    if (path === '/v1/lyrics/generate') return 'lyrics.generate'
    if (path === '/v1/song/generate') return 'song.generate'
    if (path === '/v1/instrumental/generate') return 'instrumental.generate'
    if (path.startsWith('/v1/song/query/')) return 'song.query'
    if (path.startsWith('/v1/instrumental/query/')) return 'instrumental.query'
    if (path === '/v1/song/vocal-clone') return 'voice-clone.submit'
    if (path.startsWith('/v1/song/vocal-clone/')) return 'voice-clone.query'
    return path.replace(/^\/+/, '').replaceAll('/', '.')
  }

  private parseRequestPayload(init: RequestInit): unknown {
    if (!init.body) return null
    if (typeof init.body === 'string') {
      try {
        return JSON.parse(init.body)
      } catch {
        return init.body
      }
    }
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      const entries: Record<string, unknown> = {}
      for (const [key, value] of init.body.entries()) {
        entries[key] = value instanceof Blob
          ? { type: 'blob', size: value.size, content_type: value.type }
          : value
      }
      return entries
    }
    return { type: 'unserializable_body' }
  }

  private externalTaskIdFromResponse(data: unknown): string | null {
    const record = firstRecord(data)
    const choice = firstChoiceRecord(record)
    return textField(record, ['task_id', 'taskId', 'id']) ?? textField(choice, ['id'])
  }

  private shouldAudit(): boolean {
    return Boolean(this.auditContext.batchId || this.auditContext.taskId || this.auditContext.userId)
  }

  private async recordAudit(input: ProviderApiLogInput): Promise<void> {
    if (!this.shouldAudit()) return
    await recordProviderApiLog(input)
  }

  private isPollQueryPath(path: string): boolean {
    return path.startsWith('/v1/song/query/')
      || path.startsWith('/v1/instrumental/query/')
      || path.startsWith('/v1/song/vocal-clone/')
  }

  private pollStatusFromResponse(data: unknown): string | null {
    return parseMediaResult(data).status ?? parseVoiceCloneResult(data).status ?? null
  }

  private pollKeyFieldsFromResponse(data: unknown): Record<string, unknown> {
    const media = parseMediaResult(data)
    const voice = parseVoiceCloneResult(data)
    return {
      status: media.status ?? voice.status ?? null,
      id: media.id ?? voice.id ?? null,
      task_id: media.task_id ?? voice.task_id ?? null,
      voice_id: voice.voice_id ?? null,
      has_url: Boolean(media.url),
      has_flac_url: Boolean(media.flac_url),
      has_wav_url: Boolean(media.wav_url),
      stream_url: media.stream_url ?? null,
      duration: media.duration ?? null,
      lyrics_sections_count: media.lyrics_sections?.length ?? 0,
      error_message: media.error_message ?? voice.error_message ?? null,
    }
  }

  private async recordSuccessAudit(input: ProviderApiLogInput & { path: string; responsePayload: unknown }): Promise<void> {
    if (!this.shouldAudit()) return
    if (!this.isPollQueryPath(input.path)) {
      const { path: _path, ...logInput } = input
      await recordProviderApiLog(logInput)
      return
    }

    const pollStatus = this.pollStatusFromResponse(input.responsePayload)
    const keyFields = this.pollKeyFieldsFromResponse(input.responsePayload)
    const final = isDoneStatus(pollStatus) || isFailedStatus(pollStatus)
    const { path: _path, ...logInput } = input
    await recordProviderPollAudit({
      ...logInput,
      auditKey: `${this.auditContext.taskId ?? this.auditContext.batchId ?? 'mureka'}:${input.operation}:${input.endpoint}`,
      pollStatus,
      keyFields,
      final,
      status: isFailedStatus(pollStatus) ? 'failed' : input.status,
      errorMessage: isFailedStatus(pollStatus)
        ? String(keyFields.error_message ?? 'Mureka 查询返回失败状态')
        : input.errorMessage,
    })
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const startedAt = Date.now()
    const method = init.method ?? 'GET'
    const requestPayload = this.parseRequestPayload(init)
    const headers = new Headers(init.headers)
    const isFormDataBody = typeof FormData !== 'undefined' && init.body instanceof FormData
    if (!isFormDataBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${this.apiKey}`)
    let data: unknown
    let responseStatus: number | null = null
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(60_000),
      })
      responseStatus = res.status
      try {
        data = await res.json()
      } catch {
        data = null
      }

      const logContext = {
        baseUrl: this.baseUrl,
        path,
        method,
        status: res.status,
        durationMs: Date.now() - startedAt,
        traceId: responseTraceId(data),
        apiKeyConfigured: Boolean(this.apiKey),
        apiKeyLength: this.apiKey.length,
      }

      if (!res.ok) {
        const message = responseErrorMessage(data) ?? `Mureka API 错误 ${res.status}`
        await this.recordAudit({
          ...this.auditContext,
          module: this.auditContext.module ?? 'music',
          provider: 'mureka',
          model: typeof (requestPayload as Record<string, unknown> | null)?.model === 'string'
            ? String((requestPayload as Record<string, unknown>).model)
            : null,
          operation: this.operationForPath(path),
          method,
          endpoint: path,
          requestPayload,
          responseStatus: res.status,
          responsePayload: data,
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: message,
        })
        logger.warn({ ...logContext, err: message }, 'Mureka API 请求失败')
        throw new MurekaApiError(message, res.status)
      }
      await this.recordSuccessAudit({
        ...this.auditContext,
        module: this.auditContext.module ?? 'music',
        provider: 'mureka',
        model: typeof (requestPayload as Record<string, unknown> | null)?.model === 'string'
          ? String((requestPayload as Record<string, unknown>).model)
          : null,
        operation: this.operationForPath(path),
        method,
        endpoint: path,
        requestPayload,
        responseStatus: res.status,
        responsePayload: data,
        externalTaskId: this.externalTaskIdFromResponse(data),
        durationMs: Date.now() - startedAt,
        status: 'success',
        path,
      })
      logger.debug(logContext, 'Mureka API 请求完成')
      return data
    } catch (error) {
      if (error instanceof MurekaApiError) throw error
      const message = error instanceof Error ? error.message : String(error)
      await this.recordAudit({
        ...this.auditContext,
        module: this.auditContext.module ?? 'music',
        provider: 'mureka',
        model: typeof (requestPayload as Record<string, unknown> | null)?.model === 'string'
          ? String((requestPayload as Record<string, unknown>).model)
          : null,
        operation: this.operationForPath(path),
        method,
        endpoint: path,
        requestPayload,
        responseStatus,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        errorMessage: message,
      })
      throw error
    }
  }
}
