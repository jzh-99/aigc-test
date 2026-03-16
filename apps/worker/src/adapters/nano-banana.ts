import type { ImageGenerationAdapter, AdapterGenerateResult } from './base.js'

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

    // gemini-3.1-flash-image-preview-* models: always use generations (image passed as JSON array)
    // nano-banana-2* models: use edits when reference images are present, otherwise generations
    const isGemini = model.startsWith('gemini-3.1-flash-image-preview')
    const useEdits = !isGemini && imageUrls !== null

    const maxRetries = 2
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = useEdits
        ? await this.callEdits(model, prompt, extraParams, imageUrls!)
        : await this.callGenerations(model, prompt, extraParams, imageUrls)

      if (!result.success && attempt < maxRetries && this.isRetryable(result.errorMessage)) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
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
    if (imageUrls && imageUrls.length > 0) body.image = imageUrls

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
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
    // Convert each reference image to a Blob (handles data: URIs and HTTP URLs)
    let imageBlobs: Array<{ blob: Blob; filename: string }>
    try {
      imageBlobs = await Promise.all(
        imageUrls.map(async (url, i) => {
          if (url.startsWith('data:')) {
            // data:[<mediatype>][;base64],<data>
            const commaIdx = url.indexOf(',')
            const meta = url.slice(0, commaIdx)
            const data = url.slice(commaIdx + 1)
            const mimeMatch = meta.match(/^data:([^;]+)/)
            const mime = mimeMatch?.[1] ?? 'image/jpeg'
            const ext = mime.split('/')[1]?.replace(/\+.*$/, '') ?? 'jpg'
            const bytes = Buffer.from(data, 'base64')
            console.log(`[nano-banana] image[${i}]: mime=${mime} dataLen=${data.length} bytesLen=${bytes.length} prefix=${data.slice(0,20)}`)
            const blob = new Blob([bytes], { type: mime })
            return { blob, filename: `image_${i + 1}.${ext}` }
          }
          const res = await fetch(url)
          if (!res.ok) throw new Error(`Failed to fetch reference image ${i + 1}: ${res.status}`)
          const blob = await res.blob()
          const ext = blob.type.split('/')[1] ?? 'jpg'
          return { blob, filename: `image_${i + 1}.${ext}` }
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
    const timeout = setTimeout(() => controller.abort(), 120_000) // longer timeout for uploads
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
    if (!errorMessage.startsWith('API ')) return true
    const match = errorMessage.match(/^API (\d+):/)
    if (match && Number(match[1]) >= 500) return true
    return false
  }
}
