import type { AdapterGenerateResult, ImageGenerationAdapter } from './base.js'

const CTYUN_EDGE_IMAGE_MODEL_ID: Record<string, string> = {
  'ctyun-seedream-5.0-lite': 'ctyun-seedream-5.0-lite',
}

type Resolution = '1k' | '2k' | '3k' | '4k'
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

const SIZE_MAP: Record<Resolution, Record<AspectRatio, string>> = {
  '1k': {
    '1:1': '1024x1024',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1152x864',
    '3:4': '864x1152',
  },
  '2k': {
    '1:1': '2048x2048',
    '16:9': '2848x1600',
    '9:16': '1600x2848',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
  },
  '3k': {
    '1:1': '3072x3072',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3': '3456x2592',
    '3:4': '2592x3456',
  },
  '4k': {
    '1:1': '4096x4096',
    '16:9': '5504x3040',
    '9:16': '3040x5504',
    '4:3': '4704x3520',
    '3:4': '3520x4704',
  },
}

function resolveSize(aspectRatio: string, resolution: string): string {
  const res = (['1k', '2k', '3k', '4k'].includes(resolution) ? resolution : '2k') as Resolution
  const ar = (Object.keys(SIZE_MAP['2k']).includes(aspectRatio) ? aspectRatio : '1:1') as AspectRatio
  return SIZE_MAP[res][ar]
}

interface CtyunEdgeImageResponse {
  data?: Array<{ url?: string }>
  error?: { message?: string }
  message?: string
}

export function buildCtyunEdgeImageBody(params: {
  model: string
  prompt: string
  params: Record<string, unknown>
}): Record<string, unknown> {
  const gatewayModel = CTYUN_EDGE_IMAGE_MODEL_ID[params.model]
  if (!gatewayModel) {
    throw new Error(`未知的天翼云边缘图片模型: ${params.model}`)
  }

  const resolution = typeof params.params.resolution === 'string'
    ? params.params.resolution
    : '2K'
  const aspectRatio = typeof params.params.aspect_ratio === 'string'
    ? params.params.aspect_ratio
    : '1:1'

  return {
    model: gatewayModel,
    prompt: params.prompt,
    response_format: 'url',
    size: resolveSize(aspectRatio, resolution),
    stream: false,
    watermark: params.params.watermark === true,
  }
}

function extractErrorMessage(data: CtyunEdgeImageResponse | string | null, status: number): string {
  if (!data) return `天翼云边缘AI网关 API 错误 ${status}`
  if (typeof data === 'string') return data || `天翼云边缘AI网关 API 错误 ${status}`
  return data.error?.message ?? data.message ?? `天翼云边缘AI网关 API 错误 ${status}`
}

export class CtyunEdgeImageAdapter implements ImageGenerationAdapter {
  readonly providerCode = 'ctyun-edge'
  private readonly apiBaseUrl: string
  private readonly apiKey: string

  constructor() {
    this.apiBaseUrl = (process.env.CTYUN_EDGE_API_BASE_URL || 'https://ai.ctaigw.cn/v1').replace(/\/$/, '')
    this.apiKey = process.env.CTYUN_EDGE_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('CTYUN_EDGE_API_KEY is required')
    }
  }

  async generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult> {
    const body = buildCtyunEdgeImageBody(params)
    const res = await fetch(`${this.apiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(330_000),
    })

    const text = await res.text()
    let data: CtyunEdgeImageResponse | string | null = null
    if (text) {
      try {
        data = JSON.parse(text) as CtyunEdgeImageResponse
      } catch {
        data = text
      }
    }

    const outputUrl = typeof data === 'object' && data !== null
      ? data.data?.find(item => typeof item.url === 'string' && item.url.length > 0)?.url
      : undefined

    if (!res.ok || !outputUrl) {
      return {
        success: false,
        errorMessage: extractErrorMessage(data, res.status),
        requestPayload: body,
      }
    }

    return {
      success: true,
      outputUrl,
      requestPayload: body,
    }
  }
}
