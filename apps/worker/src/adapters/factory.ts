import type { ImageGenerationAdapter } from './base.js'
import { CtyunEdgeImageAdapter } from './ctyun-edge-image.js'
import { TokenbusImageAdapter } from './tokenbus-image.js'
import { VolcengineImageAdapter } from './volcengine-image.js'

// 注意：此处不再缓存 adapter 单例。
// 早期实现用 Map 缓存按 providerCode 复用实例，但 adapter 在构造函数中一次性读取
// Nacos getter（API key / endpoint），缓存会导致 Nacos 热更新这些配置后旧实例仍持有旧值，
// 必须重启 worker 才能生效。去掉缓存后，每次生成请求新建实例，构造函数重新读取 getter，
// 从而让配置热更即时生效。新建对象的开销可忽略（图片生成频率不高，且对象本身很轻）。
export function getAdapter(providerCode: string): ImageGenerationAdapter {
  switch (providerCode) {
    case 'volcengine':
      return new VolcengineImageAdapter()
    case 'ctyun-edge':
      return new CtyunEdgeImageAdapter()
    case 'tokenbus':
      return new TokenbusImageAdapter()
    default:
      throw new Error(`Unknown provider: ${providerCode}`)
  }
}
