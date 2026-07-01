import { tokenbusConfig, systemConfig } from '@aigc/nacos-config'
import type { AdapterGenerateResult, ImageGenerationAdapter } from './base.js'

type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3'
type OpenAiResolution = '1k' | '2k' | '4k'
type OpenAiAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3'
type GeminiModel =
  | 'google/gemini-3-pro-image-preview'
  | 'google/gemini-3.1-flash-image-preview'

const SUPPORTED_GEMINI_MODELS = new Set<GeminiModel>([
  'google/gemini-3-pro-image-preview',
  'google/gemini-3.1-flash-image-preview',
])

const OPENAI_SIZE_MAP: Record<OpenAiResolution, Record<OpenAiAspectRatio, string>> = {
  '1k': {
    '1:1': '1280x1280',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1280x960',
    '3:4': '960x1280',
    '3:2': '1280x848',
    '2:3': '848x1280',
  },
  '2k': {
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
  },
  '4k': {
    '1:1': '2880x2880',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '3:2': '3520x2336',
    '2:3': '2336x3520',
  },
}

interface TokenbusImageResponse {
  data?: Array<{ url?: string; b64_json?: string; task_id?: string }>
  error?: { message?: string }
  message?: string
}

interface TokenbusGeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string }
        inline_data?: { mime_type?: string; data?: string }
      }>
    }
  }>
  error?: { message?: string }
  message?: string
}

export interface TokenbusImageRequest {
  endpoint: string
  body: Record<string, unknown>
}

function resolveOpenAiSize(resolution: unknown, aspectRatio: unknown): string {
  const res = typeof resolution === 'string' && resolution.toLowerCase() in OPENAI_SIZE_MAP
    ? resolution.toLowerCase() as OpenAiResolution
    : '1k'
  const ar = typeof aspectRatio === 'string' && aspectRatio in OPENAI_SIZE_MAP[res]
    ? aspectRatio as OpenAiAspectRatio
    : '1:1'
  return OPENAI_SIZE_MAP[res][ar]
}

function resolveGeminiAspectRatio(aspectRatio: unknown): AspectRatio {
  return typeof aspectRatio === 'string' && ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].includes(aspectRatio)
    ? aspectRatio as AspectRatio
    : '1:1'
}

function resolveGeminiImageSize(resolution: unknown): '1K' | '2K' | '4K' {
  if (typeof resolution !== 'string') return '1K'
  const normalized = resolution.toLowerCase()
  if (normalized === '4k') return '4K'
  if (normalized === '2k') return '2K'
  return '1K'
}

export function buildTokenbusImageRequest(params: {
  model: string
  prompt: string
  params: Record<string, unknown>
}): TokenbusImageRequest {
  if (params.model === 'openai/gpt-image-2') {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      // 请求 url 格式而非 b64_json：返回真实 http(s) CDN URL，避免下游 transfer worker
      // 的 SSRF 校验（validateExternalUrl）拒绝 data: 协议导致转存永久失败。
      // tokenbus 网关 OpenAI 兼容接口支持 url 字段（见 tokenbus 图片生成 API 文档）。
      // 即便网关偶发只回 b64_json，normalizeOutputUrl 仍会兜底包成 data: URL，
      // 配合 transfer worker 的 data: 直传分支也能正常转存。
      n: typeof params.params.n === 'number' ? params.params.n : 1,
      response_format: 'url',
      size: typeof params.params.size === 'string'
        ? params.params.size
        : resolveOpenAiSize(params.params.resolution, params.params.aspect_ratio),
      quality: typeof params.params.quality === 'string' ? params.params.quality : 'low',
    }
    if (typeof params.params.background === 'string') body.background = params.params.background
    if (typeof params.params.user === 'string') body.user = params.params.user
    return { endpoint: '/v1/images/generations', body }
  }

  if (SUPPORTED_GEMINI_MODELS.has(params.model as GeminiModel)) {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: params.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: resolveGeminiAspectRatio(params.params.aspect_ratio),
          imageSize: resolveGeminiImageSize(params.params.resolution),
        },
      },
    }
    if (typeof params.params.system_instruction === 'string' && params.params.system_instruction.trim()) {
      body.systemInstruction = { parts: [{ text: params.params.system_instruction }] }
    }
    return { endpoint: `/v1beta/models/${params.model}:generateContent`, body }
  }

  throw new Error(`Tokenbus 暂不支持模型：${params.model}`)
}

function extractErrorMessage(data: TokenbusImageResponse | TokenbusGeminiResponse | string | null, status: number): string {
  if (!data) return `Tokenbus API 错误 ${status}`
  if (typeof data === 'string') return data || `Tokenbus API 错误 ${status}`
  return data.error?.message ?? data.message ?? `Tokenbus API 错误 ${status}`
}

function normalizeOutputUrl(item: { url?: string; b64_json?: string } | undefined): string | undefined {
  if (item?.url) return item.url
  if (!item?.b64_json) return undefined
  return item.b64_json.startsWith('data:')
    ? item.b64_json
    : `data:image/png;base64,${item.b64_json}`
}

function normalizeGeminiOutputUrl(data: TokenbusGeminiResponse | string | null): string | undefined {
  if (!data || typeof data === 'string') return undefined
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    const inlineData = part.inlineData
    if (inlineData?.data) {
      return `data:${inlineData.mimeType ?? 'image/png'};base64,${inlineData.data}`
    }
    const snakeInlineData = part.inline_data
    if (snakeInlineData?.data) {
      return `data:${snakeInlineData.mime_type ?? 'image/png'};base64,${snakeInlineData.data}`
    }
  }
  return undefined
}

export class TokenbusImageAdapter implements ImageGenerationAdapter {
  readonly providerCode = 'tokenbus'
  private readonly apiBaseUrl: string
  private readonly apiKey: string

  constructor() {
    this.apiBaseUrl = tokenbusConfig.apiBaseUrl.replace(/\/$/, '')
    this.apiKey = tokenbusConfig.apiKey
    if (!this.apiBaseUrl) {
      throw new Error('TOKENBUS_API_BASE_URL is required')
    }
    if (!this.apiKey) {
      throw new Error('TOKENBUS_API_KEY is required')
    }
  }

  async generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult> {
    const request = buildTokenbusImageRequest(params)
    const res = await fetch(`${this.apiBaseUrl}${request.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(systemConfig.tokenbusImageTimeoutMs),
    })

    const text = await res.text()
    let data: TokenbusImageResponse | TokenbusGeminiResponse | string | null = null
    if (text) {
      try {
        data = JSON.parse(text) as TokenbusImageResponse
      } catch {
        data = text
      }
    }

    const firstItem = typeof data === 'object' && data !== null && 'data' in data ? data.data?.[0] : undefined
    const outputUrl = params.model === 'openai/gpt-image-2'
      ? normalizeOutputUrl(firstItem)
      : normalizeGeminiOutputUrl(data as TokenbusGeminiResponse | string | null)

    if (!res.ok || !outputUrl) {
      const taskId = firstItem?.task_id
      return {
        success: false,
        errorMessage: taskId
          ? `Tokenbus 返回异步 task_id=${taskId}，当前生成链路暂未接入异步轮询`
          : extractErrorMessage(data, res.status),
        requestPayload: request.body,
      }
    }

    return {
      success: true,
      outputUrl,
      requestPayload: request.body,
    }
  }
}
