import sharp from 'sharp'
import type { ImageGenerationAdapter, AdapterGenerateResult } from './base.js'

// Compress reference images before sending to the API to avoid 502 / timeout
// caused by oversized payloads.
const MAX_LONG_SIDE = 2048   // resize if either dimension exceeds this
const JPEG_QUALITY  = 85     // JPEG output quality
const SKIP_THRESHOLD = 2 * 1024 * 1024  // skip compression if already < 2 MB

/**
 * Compress an image Buffer to JPEG, resizing if the long side exceeds MAX_LONG_SIDE.
 * Returns the compressed buffer (always JPEG) and its byte length.
 */
async function compressBuffer(input: Buffer): Promise<Buffer> {
  const image = sharp(input)
  const { width = 0, height = 0 } = await image.metadata()
  const longSide = Math.max(width, height)
  const pipeline = longSide > MAX_LONG_SIDE
    ? image.resize(MAX_LONG_SIDE, MAX_LONG_SIDE, { fit: 'inside', withoutEnlargement: true })
    : image
  return pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
}

/**
 * Compress a base64 data URI.  Also handles HTTP/HTTPS URLs by downloading first.
 * Images already under SKIP_THRESHOLD are returned as-is (data URI).
 */
async function prepareDataUri(urlOrDataUri: string, index: number): Promise<string> {
  let inputBuffer: Buffer

  if (urlOrDataUri.startsWith('data:')) {
    const commaIdx = urlOrDataUri.indexOf(',')
    inputBuffer = Buffer.from(urlOrDataUri.slice(commaIdx + 1), 'base64')
  } else {
    // Download URL (may be internal address — worker fetches it directly)
    const res = await fetch(urlOrDataUri)
    if (!res.ok) throw new Error(`Failed to fetch reference image ${index + 1}: HTTP ${res.status}`)
    inputBuffer = Buffer.from(await res.arrayBuffer())
  }

  if (inputBuffer.length < SKIP_THRESHOLD) {
    console.log(`[nano-banana] image[${index}]: ${(inputBuffer.length / 1024).toFixed(0)} KB — skip compression`)
    return `data:image/jpeg;base64,${inputBuffer.toString('base64')}`
  }

  const compressed = await compressBuffer(inputBuffer)
  console.log(
    `[nano-banana] image[${index}]: ${(inputBuffer.length / 1024 / 1024).toFixed(1)} MB → ` +
    `${(compressed.length / 1024).toFixed(0)} KB (JPEG q${JPEG_QUALITY})`
  )
  return `data:image/jpeg;base64,${compressed.toString('base64')}`
}

export class NanoBananaAdapter implements ImageGenerationAdapter {
  readonly providerCode = 'nano-banana'
  private readonly apiUrl: string
  private readonly apiKey: string

  constructor() {
    this.apiUrl = process.env.NANO_BANANA_API_URL || ''
    this.apiKey = process.env.NANO_BANANA_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('NANO_BANANA_API_KEY is required')
    }
  }

  async generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult> {
    const { model, prompt, params: extraParams } = params

    const imageUrls = Array.isArray(extraParams.image) && extraParams.image.length > 0
      ? (extraParams.image as string[])
      : null

    // gemini-3.1-flash-image-preview-* and gpt-image-2: always use generations
    // (reference images are passed as JSON image[])
    // nano-banana-2* models: use edits when reference images are present, otherwise generations
    const supportsJsonImageInGenerations = model.startsWith('gemini-3.1-flash-image-preview') || model === 'gpt-image-2'
    const useEdits = !supportsJsonImageInGenerations && imageUrls !== null

    const maxRetries = 1 // Retry once on fast API errors (not timeout)
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = useEdits
        ? await this.callEdits(model, prompt, extraParams, imageUrls!)
        : await this.callGenerations(model, prompt, extraParams, imageUrls)

      if (!result.success && attempt < maxRetries && this.isRetryable(result.errorMessage)) {
        console.log(`[nano-banana] Retrying after fast API error (attempt ${attempt + 1}/${maxRetries}): ${result.errorMessage}`)
        await new Promise((r) => setTimeout(r, 2000)) // 2 second delay before retry
        continue
      }

      return result
    }

    return { success: false, errorMessage: 'Exhausted retries' }
  }

  // /v1/images/generations — JSON body, supports optional image array for reference images
  private async callGenerations(
    model: string,
    prompt: string,
    extraParams: Record<string, unknown>,
    imageUrls: string[] | null,
  ): Promise<AdapterGenerateResult> {
    const body: Record<string, unknown> = { model, prompt, response_format: 'url' }
    if (extraParams.aspect_ratio) body.aspect_ratio = extraParams.aspect_ratio
    if (imageUrls && imageUrls.length > 0) {
      // Download URLs and convert to base64 data URI before embedding in JSON body
      body.image = await Promise.all(imageUrls.map((url, i) => prepareDataUri(url, i)))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000) // 5 minutes
    try {
      const res = await fetch(`${this.apiUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      return await this.parseResponse(res)
    } catch (err) {
      return { success: false, errorMessage: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timeout)
    }
  }

  // /v1/images/edits — multipart/form-data, image field is binary (downloaded from URL)
  private async callEdits(
    model: string,
    prompt: string,
    extraParams: Record<string, unknown>,
    imageUrls: string[],
  ): Promise<AdapterGenerateResult> {
    // Convert each reference image to a compressed Blob
    let imageBlobs: Array<{ blob: Blob; filename: string }>
    try {
      imageBlobs = await Promise.all(
        imageUrls.map(async (url, i) => {
          let inputBuffer: Buffer

          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',')
            const data = url.slice(commaIdx + 1)
            inputBuffer = Buffer.from(data, 'base64')
          } else {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`Failed to fetch reference image ${i + 1}: ${res.status}`)
            inputBuffer = Buffer.from(await res.arrayBuffer())
          }

          // Compress if large
          let outBuffer: Buffer
          if (inputBuffer.length < SKIP_THRESHOLD) {
            console.log(`[nano-banana] image[${i}]: ${(inputBuffer.length / 1024).toFixed(0)} KB — skip compression`)
            outBuffer = inputBuffer
          } else {
            outBuffer = await compressBuffer(inputBuffer)
            console.log(
              `[nano-banana] image[${i}]: ${(inputBuffer.length / 1024 / 1024).toFixed(1)} MB → ` +
              `${(outBuffer.length / 1024).toFixed(0)} KB (JPEG q${JPEG_QUALITY})`
            )
          }

          const blob = new Blob([outBuffer], { type: 'image/jpeg' })
          return { blob, filename: `image_${i + 1}.jpg` }
        }),
      )
    } catch (err) {
      return { success: false, errorMessage: err instanceof Error ? err.message : String(err) }
    }

    const form = new FormData()
    form.append('model', model)
    form.append('prompt', prompt)
    form.append('response_format', 'url')
    if (extraParams.aspect_ratio) form.append('aspect_ratio', String(extraParams.aspect_ratio))
    for (const { blob, filename } of imageBlobs) {
      form.append('image', blob, filename)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000) // 5 minutes
    try {
      const res = await fetch(`${this.apiUrl}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      })
      return await this.parseResponse(res)
    } catch (err) {
      return { success: false, errorMessage: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async parseResponse(res: Response): Promise<AdapterGenerateResult> {
    if (!res.ok) {
      const text = await res.text()
      return { success: false, errorMessage: `API ${res.status}: ${text}` }
    }
    const json = (await res.json()) as { data: Array<{ url: string }> }
    if (!json.data?.[0]?.url) {
      return { success: false, errorMessage: 'No image URL in response' }
    }
    return { success: true, outputUrl: json.data[0].url }
  }

  private isRetryable(errorMessage?: string): boolean {
    if (!errorMessage) return false

    // Do NOT retry on timeout errors (AbortError)
    if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
      return false
    }

    // Retry on fast API errors (connection refused, network errors, DNS failures)
    // but NOT on HTTP error responses (4xx, 5xx) which indicate API-level issues
    const isHttpError = errorMessage.startsWith('API ')
    const isNetworkError = errorMessage.includes('fetch failed') ||
                          errorMessage.includes('ECONNREFUSED') ||
                          errorMessage.includes('ENOTFOUND') ||
                          errorMessage.includes('ETIMEDOUT') ||
                          errorMessage.includes('ECONNRESET')

    return !isHttpError && isNetworkError
  }
}
