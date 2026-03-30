import type { ImageGenerationAdapter, AdapterGenerateResult } from './base.js'

const VOLCENGINE_API_URL = 'https://ark.cn-beijing.volces.com/api/v3'

// ---------------------------------------------------------------------------
// aspect_ratio + resolution → size (pixel dimensions) lookup table
// ---------------------------------------------------------------------------

type Resolution = '1k' | '2k' | '3k' | '4k'
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

/**
 * Maps (resolution, aspectRatio) → size string for the Volcengine API.
 *
 * Seedream 5.0 lite supports 2K / 3K.
 * Seedream 4.5 supports 2K / 4K.
 * Seedream 4.0 supports 1K / 2K / 4K.
 */
const SIZE_MAP: Record<Resolution, Record<AspectRatio, string>> = {
  '1k': {
    '1:1':  '1024x1024',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3':  '1152x864',
    '3:4':  '864x1152',
  },
  '2k': {
    '1:1':  '2048x2048',
    '16:9': '2848x1600',
    '9:16': '1600x2848',
    '4:3':  '2304x1728',
    '3:4':  '1728x2304',
  },
  '3k': {
    '1:1':  '3072x3072',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3':  '3456x2592',
    '3:4':  '2592x3456',
  },
  '4k': {
    '1:1':  '4096x4096',
    '16:9': '5504x3040',
    '9:16': '3040x5504',
    '4:3':  '4704x3520',
    '3:4':  '3520x4704',
  },
}

/** Resolve the Volcengine `size` parameter from aspect_ratio + resolution. */
function resolveSize(aspectRatio: string, resolution: string): string {
  const res = (['1k', '2k', '3k', '4k'].includes(resolution) ? resolution : '2k') as Resolution
  const ar  = (Object.keys(SIZE_MAP['2k']).includes(aspectRatio) ? aspectRatio : '1:1') as AspectRatio
  return SIZE_MAP[res][ar]
}

/**
 * Map frontend model code → Volcengine doubao model ID.
 */
const MODEL_ID_MAP: Record<string, string> = {
  'seedream-5.0-lite': 'doubao-seedream-5.0-lite',
  'seedream-4.5':      'doubao-seedream-4.5',
  'seedream-4.0':      'doubao-seedream-4.0',
}

export class VolcengineImageAdapter implements ImageGenerationAdapter {
  readonly providerCode = 'volcengine'
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.VOLCENGINE_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('VOLCENGINE_API_KEY is required')
    }
  }

  async generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult> {
    const { model, prompt, params: extraParams } = params

    const volcengineModel = MODEL_ID_MAP[model]
    if (!volcengineModel) {
      return { success: false, errorMessage: `Unknown Volcengine model: ${model}` }
    }

    // Resolve size from aspect_ratio + resolution
    const aspectRatio = typeof extraParams.aspect_ratio === 'string' ? extraParams.aspect_ratio : '1:1'
    const resolution  = typeof extraParams.resolution  === 'string' ? extraParams.resolution  : '2k'
    const size = resolveSize(aspectRatio, resolution)

    // Build request body
    const body: Record<string, unknown> = {
      model:           volcengineModel,
      prompt,
      size,
      response_format: 'url',
      // Disable sequential image generation (no group image feature)
      sequential_image_generation: 'disabled',
      // Watermark: default false unless explicitly set to true
      watermark: extraParams.watermark === true,
    }

    // Reference images: pass through as-is (URL or base64 data URI)
    const images = extraParams.image
    if (Array.isArray(images) && images.length > 0) {
      // Volcengine accepts single string or array; use array for multi-image
      body.image = images.length === 1 ? images[0] : images
    }

    // Seedream 5.0 lite: enable web search by default
    if (model === 'seedream-5.0-lite') {
      body.tools = [{ type: 'web_search' }]
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000) // 5 minutes

    try {
      console.log(`[volcengine-image] Calling model=${volcengineModel} size=${size}`)
      const res = await fetch(`${VOLCENGINE_API_URL}/images/generations`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      })

      return await this.parseResponse(res, model)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[volcengine-image] Request failed: ${msg}`)
      return { success: false, errorMessage: msg }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async parseResponse(res: Response, model: string): Promise<AdapterGenerateResult> {
    const text = await res.text()

    if (!res.ok) {
      console.error(`[volcengine-image] API error ${res.status}: ${text.slice(0, 500)}`)
      return { success: false, errorMessage: `Volcengine API ${res.status}: ${text.slice(0, 500)}` }
    }

    let json: {
      data?: Array<{ url?: string; error?: { code: string; message: string } }>
      error?: { code: string; message: string }
    }
    try {
      json = JSON.parse(text)
    } catch {
      return { success: false, errorMessage: `Invalid JSON response from Volcengine: ${text.slice(0, 200)}` }
    }

    // Top-level error
    if (json.error) {
      return { success: false, errorMessage: `Volcengine error ${json.error.code}: ${json.error.message}` }
    }

    // Find first successfully generated image
    const items = json.data ?? []
    const successItem = items.find((item) => item.url && !item.error)
    if (!successItem?.url) {
      // Check if any item has per-image error
      const firstErr = items.find((item) => item.error)
      const errMsg = firstErr?.error
        ? `${firstErr.error.code}: ${firstErr.error.message}`
        : 'No image URL in Volcengine response'
      console.error(`[volcengine-image] ${errMsg}`)
      return { success: false, errorMessage: errMsg }
    }

    console.log(`[volcengine-image] Success model=${model} url=${successItem.url.slice(0, 80)}...`)
    return { success: true, outputUrl: successItem.url }
  }
}
