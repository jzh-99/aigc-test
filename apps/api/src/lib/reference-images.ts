// 参考图 base64 脱敏：上传到 TOS/S3，返回公网 URL 数组。
//
// 红线（对齐源项目 app/services/base64_assets.py + minio_storage.persist_base64）：
//   - 参考图 base64 明文**绝不入库、绝不入日志**；本函数把 data URI 解码为 Buffer 后上传存储，
//     只返回 URL。调用方（图片路由）把 URL 写入 jobData.params.image，源 base64 不再出现在
//     DB / 日志 / 队列载荷中。
//   - 入参若已是 http(s) URL（外部 CDN），原样保留不二次上传（对齐源 is_base64_asset 的反向判定）。
//
// 上传能力复用 apps/api/src/lib/storage.ts 的 uploadToTos（支持 STORAGE_DRIVER=s3 MinIO 与 TOS 双驱动）。
import { randomUUID } from 'node:crypto'

import { uploadToTos } from './storage.js'

// data URI → { buffer, ext }。仅处理 data:image/...;base64,... 形式。
// 非法格式抛错（调用方需自行保证传入的是 base64 data URI 或 URL）。
function decodeBase64Image(dataUri: string): { buffer: Buffer; ext: string } {
  // 形如 data:image/png;base64,xxxx
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUri)
  if (!match) {
    throw new Error(`无法解析 base64 data URI（期望 data:image/<ext>;base64,<...>）`)
  }
  const mimeSub = match[1].toLowerCase()
  const base64 = match[2]
  const buffer = Buffer.from(base64, 'base64')
  // 归一化扩展名：jpeg → jpg（对齐常见存储约定；其余原样）
  const ext = mimeSub === 'jpeg' ? 'jpg' : mimeSub
  return { buffer, ext }
}

// 判定字符串是否为 base64 data URI（非 http(s) URL 即视为待脱敏的 base64）。
// 对齐源 is_base64_asset：非 URL 即 base64 资产。
function isBase64DataUri(value: string): boolean {
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return false
  return value.startsWith('data:')
}

// 参考图脱敏落存储。
// - image 为 null/undefined/空数组 → 返回空数组（不调用上传）
// - image 为 string → 单元素处理
// - image 为 string[] → 逐项处理
// - 已是 http(s) URL → 原样保留（不重新上传）
// - data URI → 解码 + 上传，返回公网 URL
//
// 返回的 URL 数组顺序与入参一致（便于调用方按序回填 params.image）。
export async function persistReferenceImages(
  image: string | string[] | null | undefined,
): Promise<string[]> {
  if (!image) return []
  const items = Array.isArray(image) ? image : [image]
  if (items.length === 0) return []

  const urls: string[] = []
  for (const item of items) {
    if (typeof item !== 'string' || item.length === 0) continue
    if (!isBase64DataUri(item)) {
      // 已是 URL 或其他非 base64 形式：原样保留
      urls.push(item)
      continue
    }
    const { buffer, ext } = decodeBase64Image(item)
    // key 布局：openapi/ref/<uuid>.<ext>；不包含任何 base64 明文
    const key = `openapi/ref/${randomUUID()}.${ext}`
    const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    const url = await uploadToTos(key, buffer, contentType)
    urls.push(url)
  }
  return urls
}
