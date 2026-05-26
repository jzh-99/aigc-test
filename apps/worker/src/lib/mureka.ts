import type { MusicModel, MusicVoiceGender } from '@aigc/types'

export interface MurekaClientOptions {
  baseUrl?: string
  apiKey?: string
  fetchImpl?: typeof fetch
}

export interface MurekaLyricsRequest {
  prompt: string
  model: MusicModel
  voiceGender?: MusicVoiceGender
}

export interface MurekaSongRequest {
  lyrics: string
  model: MusicModel
  prompt?: string | null
  title?: string | null
  voiceId?: string | null
  voiceGender?: MusicVoiceGender
  styles?: string[]
}

export interface MurekaInstrumentalRequest {
  prompt: string
  model: MusicModel
  voiceGender?: MusicVoiceGender
}

export interface MurekaVoiceCloneRequest {
  audioUrl: string
  name: string
  description?: string | null
  model?: MusicModel
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

function textField(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function parseLyrics(data: unknown): string {
  const record = firstRecord(data)
  const lyrics = textField(record, ['lyrics', 'text', 'content'])
  if (!lyrics) throw new MurekaApiError('Mureka 歌词响应缺少 lyrics')
  return lyrics
}

function parseMediaResult(data: unknown): MurekaMediaResult {
  const record = firstRecord(data)
  return {
    id: textField(record, ['id']),
    task_id: textField(record, ['task_id', 'taskId']),
    status: textField(record, ['status']),
    title: textField(record, ['title']),
    lyrics: textField(record, ['lyrics']),
    url: textField(record, ['url', 'audio_url']),
    flac_url: textField(record, ['flac_url', 'flacUrl']),
    wav_url: textField(record, ['wav_url', 'wavUrl']),
    stream_url: textField(record, ['stream_url', 'streamUrl']),
    error_message: textField(record, ['error_message', 'error']),
  }
}

function parseVoiceCloneResult(data: unknown): MurekaVoiceCloneResult {
  const record = firstRecord(data)
  return {
    id: textField(record, ['id']),
    task_id: textField(record, ['task_id', 'taskId']),
    status: textField(record, ['status']),
    voice_id: textField(record, ['voice_id', 'voiceId']),
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

  constructor(options: MurekaClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.apiKey = resolveApiKey(options.apiKey)
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async generateLyrics(request: MurekaLyricsRequest): Promise<string> {
    const data = await this.postJson('/v1/lyrics/generate', {
      model: request.model,
      prompt: request.prompt,
      voice_gender: request.voiceGender ?? 'auto',
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
      voice_id: request.voiceId ?? undefined,
      voice_gender: request.voiceGender ?? 'auto',
      styles: request.styles?.length ? request.styles : undefined,
      n: 1,
      stream: true,
    })
    return parseMediaResult(data)
  }

  async generateInstrumental(request: MurekaInstrumentalRequest): Promise<MurekaMediaResult> {
    const data = await this.postJson('/v1/instrumental/generate', {
      model: request.model,
      prompt: request.prompt,
      voice_gender: request.voiceGender ?? 'auto',
      n: 1,
      stream: true,
    })
    return parseMediaResult(data)
  }

  async cloneVoice(request: MurekaVoiceCloneRequest): Promise<MurekaVoiceCloneResult> {
    const data = await this.postJson('/v1/song/vocal-clone', {
      model: request.model ?? 'mureka-8',
      audio_url: request.audioUrl,
      name: request.name,
      description: request.description ?? undefined,
      gender: request.gender ?? 'auto',
    })
    return parseVoiceCloneResult(data)
  }

  async pollSongResult(taskId: string, options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<MurekaMediaResult> {
    return this.poll(`/v1/song/generate/${encodeURIComponent(taskId)}`, parseMediaResult, options)
  }

  async pollVoiceCloneResult(taskId: string, options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<MurekaVoiceCloneResult> {
    return this.poll(`/v1/song/vocal-clone/${encodeURIComponent(taskId)}`, parseVoiceCloneResult, options)
  }

  private async poll<T extends { status?: string | null; error_message?: string | null }>(
    path: string,
    parser: (data: unknown) => T,
    options: { intervalMs?: number; timeoutMs?: number },
  ): Promise<T> {
    const intervalMs = options.intervalMs ?? 3000
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000)
    while (Date.now() < deadline) {
      const result = parser(await this.getJson(path))
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

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(60_000),
    })

    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = null
    }

    if (!res.ok) {
      const record = firstRecord(data)
      const message = textField(record, ['message', 'error', 'detail']) ?? `Mureka API 错误 ${res.status}`
      throw new MurekaApiError(message, res.status)
    }
    return data
  }
}

