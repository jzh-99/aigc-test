import type { ImageGenerationAdapter, AdapterGenerateResult } from './base.js'
import sharp from 'sharp'

const VOLCENGINE_API_URL = 'https://ark.cn-beijing.volces.com/api/v3'

// Volcengine image constraints (per API docs)
const VOLCENGINE_MAX_IMAGES = 14
const VOLCENGINE_MAX_SIZE_BYTES = 10 * 1024 * 1024  // 10 MB
const VOLCENGINE_MAX_PIXELS = 6000 * 6000            // 36M px
const VOLCENGINE_MAX_LONG_SIDE = 6000
const VOLCENGINE_JPEG_QUALITY = 85
const VOLCENGINE_ALLOWED_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff', 'gif'])
const VOLCENGINE_FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  gif: 'image/gif',
}

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

/** Download a URL or decode a data URI, returning raw buffer + detected mime type. */
async function fetchImageBuffer(urlOrDataUri: string, index: number): Promise<{ buffer: Buffer; mimeType: string }> {
  if (urlOrDataUri.startsWith('data:')) {
    const commaIdx = urlOrDataUri.indexOf(',')
    const meta = urlOrDataUri.slice(5, commaIdx)          // e.g. "image/png;base64"
    const mimeType = meta.split(';')[0] ?? 'image/jpeg'
    const buffer = Buffer.from(urlOrDataUri.slice(commaIdx + 1), 'base64')
    return { buffer, mimeType }
  }
  const res = await fetch(urlOrDataUri)
  if (!res.ok) throw new Error(`Failed to fetch reference image ${index + 1}: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') ?? ''
  let mimeType = ct.split(';')[0].trim()

  if (!mimeType || mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream') {
    const format = (await sharp(buffer).metadata()).format
    mimeType = format ? (VOLCENGINE_FORMAT_MIME[format] ?? `image/${format}`) : 'image/jpeg'
  }

  return { buffer, mimeType }
}

/**
 * Prepare a reference image for Volcengine API:
 * - Validates format (jpeg/png/webp/bmp/tiff/gif)
 * - Ensures total pixels ≤ 36M and size ≤ 10MB (resizes/recompresses if needed)
 * - Returns data URI: data:image/<format>;base64,...
 */
async function prepareVolcengineImage(urlOrDataUri: string, index: number): Promise<string> {
  const { buffer, mimeType } = await fetchImageBuffer(urlOrDataUri, index)

  const format = mimeType.replace('image/', '').toLowerCase()
  if (!VOLCENGINE_ALLOWED_FORMATS.has(format)) {
    throw new Error(`Reference image ${index + 1}: unsupported format "${format}" (allowed: jpeg/png/webp/bmp/tiff/gif)`)
  }

  // Check pixel count and size — resize/recompress if needed
  const meta = await sharp(buffer).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  const pixels = w * h
  const needsResize = pixels > VOLCENGINE_MAX_PIXELS || Math.max(w, h) > VOLCENGINE_MAX_LONG_SIDE
  const needsRecompress = buffer.length > VOLCENGINE_MAX_SIZE_BYTES

  let outBuffer = buffer
  let outMime = mimeType

  if (needsResize || needsRecompress) {
    const pipeline = sharp(buffer)
    if (needsResize) {
      pipeline.resize(VOLCENGINE_MAX_LONG_SIDE, VOLCENGINE_MAX_LONG_SIDE, { fit: 'inside', withoutEnlargement: true })
    }
    outBuffer = await pipeline.jpeg({ quality: VOLCENGINE_JPEG_QUALITY }).toBuffer()
    outMime = 'image/jpeg'
    console.log(`[volcengine-image] image[${index}]: resized/recompressed ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${(outBuffer.length / 1024).toFixed(0)}KB`)
  }

  return `data:${outMime};base64,${outBuffer.toString('base64')}`
}


const MODEL_ID_MAP: Record<string, string> = {
  'seedream-5.0-lite': 'doubao-seedream-5-0-lite-260128',
  'seedream-4.5':      'doubao-seedream-4-5-251128',
  'seedream-4.0':      'doubao-seedream-4-0-250828',
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

    // Resolve size from aspect_ratio + resolution → pixel dimensions
    const resolution  = typeof extraParams.resolution  === 'string' ? extraParams.resolution  : '2k'
    const aspectRatio = typeof extraParams.aspect_ratio === 'string' ? extraParams.aspect_ratio : '1:1'

    // Build request body
    const body: Record<string, unknown> = {
      model:           volcengineModel,
      prompt,
      size:            resolveSize(aspectRatio, resolution),
      watermark:       extraParams.watermark === true,
    }

    // Only seedream-5.0-lite supports output_format
    if (model === 'seedream-5.0-lite') {
      body.output_format = 'png'
    }

    // Reference images: download and convert to base64 data URI
    // (storage_url may be an internal address unreachable by Volcengine servers)
    const rawImages = extraParams.image
    if (Array.isArray(rawImages) && rawImages.length > 0) {
      const capped = (rawImages as string[]).slice(0, VOLCENGINE_MAX_IMAGES)
      try {
        const prepared = await Promise.all(capped.map((url, i) => prepareVolcengineImage(url, i)))
        body.image = prepared.length === 1 ? prepared[0] : prepared
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[volcengine-image] Failed to prepare reference images: ${msg}`)
        return { success: false, errorMessage: msg }
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000) // 5 minutes

    try {
      console.log(`[volcengine-image] Calling model=${volcengineModel} size=${body.size}`)
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

    // For Seedream /contents/generations/tasks endpoint:
    // Response has `data` array with items, each item can have `url` or `error`
    const items = json.data ?? []
    if (items.length === 0) {
      console.error(`[volcengine-image] Empty data array in response`)
      return { success: false, errorMessage: 'No images in Volcengine response' }
    }

    // Find first successfully generated image
    const successItem = items.find((item: any) => item.url && !item.error)
    if (!successItem?.url) {
      // Check if any item has per-image error
      const firstErr = items.find((item: any) => item.error)
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
