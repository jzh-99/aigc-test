import type { ImageGenerationAdapter } from './base.js'
import { NanoBananaAdapter } from './nano-banana.js'

const cache = new Map<string, ImageGenerationAdapter>()

export function getAdapter(providerCode: string): ImageGenerationAdapter {
  const cached = cache.get(providerCode)
  if (cached) return cached

  let adapter: ImageGenerationAdapter
  switch (providerCode) {
    case 'nano-banana':
      adapter = new NanoBananaAdapter()
      break
    default:
      throw new Error(`Unknown provider: ${providerCode}`)
  }

  cache.set(providerCode, adapter)
  return adapter
}
