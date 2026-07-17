import type { AdapterGenerateResult, ImageGenerationAdapter } from './base.js'
import { resolveImageSize } from './ctyun-edge-image.js'

const TOKENHUB_IMAGE_ENDPOINT = '/v1/images/generations'
const TOKENHUB_SEEDREAM_5_LITE = 'Doubao-Seedream-5.0-lite'

interface TokenhubImageResponse {
  data?: Array<{ url?: string }>
  error?: { message?: string }
  message?: string
}

function extractErrorMessage(data: TokenhubImageResponse | string | null, status: number): string {
  if (!data) return `TokenHub API 错误 ${status}`
  if (typeof data === 'string') {
    const message = data.trim()
    return message || `TokenHub API 错误 ${status}（响应体为空）`
  }
  return data.error?.message ?? data.message ?? `TokenHub API 错误 ${status}`
}

export class TokenhubImageAdapter implements ImageGenerationAdapter {
  readonly providerCode = 'tokenhub'
  private readonly apiBaseUrl: string
  private readonly apiKey: string

  constructor() {
    this.apiBaseUrl = (process.env.TOKENHUB_API_BASE_URL ?? '').replace(/\/$/, '')
    this.apiKey = process.env.TOKENHUB_API_KEY ?? ''
    if (!this.apiBaseUrl) throw new Error('TOKENHUB_API_BASE_URL 未配置')
    if (!this.apiKey) throw new Error('TOKENHUB_API_KEY 未配置')
  }

  async generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult> {
    const resolution = typeof params.params.resolution === 'string' ? params.params.resolution : '2k'
    const aspectRatio = typeof params.params.aspect_ratio === 'string' ? params.params.aspect_ratio : '1:1'
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      size: resolveImageSize(aspectRatio, resolution),
      watermark: params.params.watermark === true,
      response_format: 'url',
    }
    if (params.model === TOKENHUB_SEEDREAM_5_LITE) body.output_format = 'png'
    const images = params.params.image
    if (Array.isArray(images) && images.length > 0) {
      const validImages = images.filter((image): image is string => typeof image === 'string' && image.length > 0)
      if (validImages.length > 0) body.image = validImages.length === 1 ? validImages[0] : validImages
    }

    const res = await fetch(`${this.apiBaseUrl}${TOKENHUB_IMAGE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(330_000),
    })

    const text = await res.text()
    let data: TokenhubImageResponse | string | null = null
    if (text) {
      try {
        data = JSON.parse(text) as TokenhubImageResponse
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
