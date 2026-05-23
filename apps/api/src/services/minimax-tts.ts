const DEFAULT_MINIMAX_TTS_TIMEOUT_MS = 30000

interface MiniMaxTtsInput {
  apiBaseUrl: string
  model: string
  voiceId: string
  text: string
  speed?: number
  volume?: number
  pitch?: number
  emotion?: string
  stream?: boolean
}

interface MiniMaxTtsResponse {
  data?: {
    audio?: string
  }
  audio?: string
  base64?: string
  error?: {
    message?: string
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

function getMiniMaxApiKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY ?? ''
  if (!apiKey) throw new Error('MINIMAX_API_KEY is required')
  return apiKey
}

function getMiniMaxGroupId(): string | null {
  return process.env.MINIMAX_GROUP_ID ?? null
}

function buildMiniMaxUrl(apiBaseUrl: string): string {
  const groupId = getMiniMaxGroupId()
  if (!groupId) return apiBaseUrl

  const url = new URL(apiBaseUrl)
  url.searchParams.set('GroupId', groupId)
  return url.toString()
}

export function shouldUseMiniMaxStreaming(text: string): boolean {
  return Array.from(text).length > 3000
}

export function decodeMiniMaxAudioPayload(audio: string): Buffer {
  const normalized = audio.trim()
  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    return Buffer.from(normalized, 'hex')
  }
  return Buffer.from(normalized, 'base64')
}

function parseMiniMaxAudioBuffer(payload: MiniMaxTtsResponse): Buffer {
  const statusCode = payload.base_resp?.status_code ?? 0
  if (statusCode !== 0) {
    throw new Error(payload.base_resp?.status_msg || 'MiniMax TTS failed')
  }

  const audio = payload.data?.audio ?? payload.audio ?? payload.base64
  if (!audio) throw new Error(payload.error?.message || 'MiniMax TTS response missing audio')

  return decodeMiniMaxAudioPayload(audio)
}

export function parseMiniMaxStreamingAudioBuffer(rawText: string): Buffer {
  const chunks: Buffer[] = []

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue

    const data = trimmed.slice('data:'.length).trim()
    if (!data || data === '[DONE]') continue

    try {
      const payload = JSON.parse(data) as MiniMaxTtsResponse
      const audio = payload.data?.audio ?? payload.audio ?? payload.base64
      if (audio) chunks.push(decodeMiniMaxAudioPayload(audio))
    } catch {
      // MiniMax 流式响应可能包含非 JSON 心跳行，直接忽略。
    }
  }

  if (chunks.length === 0) throw new Error('MiniMax TTS streaming response missing audio')
  return Buffer.concat(chunks)
}

export async function generateMiniMaxTtsAudio(input: MiniMaxTtsInput): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutMs = Number.parseInt(process.env.MINIMAX_TTS_TIMEOUT_MS ?? String(DEFAULT_MINIMAX_TTS_TIMEOUT_MS), 10)
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(buildMiniMaxUrl(input.apiBaseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getMiniMaxApiKey()}`,
      },
      body: JSON.stringify({
        model: input.model,
        text: input.text,
        stream: input.stream ?? shouldUseMiniMaxStreaming(input.text),
        output_format: 'hex',
        language_boost: 'auto',
        voice_setting: {
          voice_id: input.voiceId,
          speed: input.speed ?? 1,
          vol: input.volume ?? 1,
          pitch: input.pitch ?? 0,
          ...input?.emotion && { emotion: input.emotion },
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`MiniMax TTS HTTP ${response.status}: ${message}`)
    }

    const responseText = await response.text()
    if (input.stream ?? shouldUseMiniMaxStreaming(input.text)) {
      return parseMiniMaxStreamingAudioBuffer(responseText)
    }

    const payload = JSON.parse(responseText) as MiniMaxTtsResponse
    return parseMiniMaxAudioBuffer(payload)
  } finally {
    clearTimeout(timer)
  }
}
