import type { ImageGenerationAdapter } from './base.js'
import { CtyunEdgeImageAdapter } from './ctyun-edge-image.js'
import { NanoBananaAdapter } from './nano-banana.js'
import { TokenhubImageAdapter } from './tokenhub-image.js'
import { VolcengineImageAdapter } from './volcengine-image.js'

const cache = new Map<string, ImageGenerationAdapter>()

export function getAdapter(providerCode: string): ImageGenerationAdapter {
  const cached = cache.get(providerCode)
  if (cached) return cached

  let adapter: ImageGenerationAdapter
  switch (providerCode) {
    case 'tokenhub':
      adapter = new TokenhubImageAdapter()
      break
    case 'comfly':
      adapter = new NanoBananaAdapter()
      break
    case 'volcengine':
      adapter = new VolcengineImageAdapter()
      break
    case 'ctyun-edge':
      adapter = new CtyunEdgeImageAdapter()
      break
    default:
      throw new Error(`Unknown provider: ${providerCode}`)
  }

  cache.set(providerCode, adapter)
  return adapter
}
