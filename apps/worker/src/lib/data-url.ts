/**
 * 解析 data: URL（base64 / 百分号编码的内联资源）为 buffer + contentType。
 *
 * 用途：部分 AI 适配器（如 tokenbus 的 Gemini 图片路径）只能返回 inline base64，
 * 无法提供 http(s) CDN URL。这类产物以 `data:image/...;base64,...` 形式入队 transfer，
 * 不能走 SSRF 校验 + HTTP 下载分支，必须就地解码后直传 TOS。
 *
 * @throws 非 data: 协议、或 payload 为空时抛错（交由调用方走 http/https 下载分支或失败处理）
 */
export function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('decodeDataUrl 仅支持 data: URL，http/https 请走下载分支')
  }
  const commaIdx = dataUrl.indexOf(',')
  // meta 形如 "image/png;base64"（data: 之后、第一个逗号之前）
  const meta = dataUrl.slice(5, commaIdx > 5 ? commaIdx : dataUrl.length)
  const isBase64 = meta.includes(';base64')
  const contentType = meta.split(';')[0] || 'application/octet-stream'
  const payload = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : ''
  if (!payload) {
    throw new Error('decodeDataUrl: data: URL 的 payload 为空')
  }
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
  return { buffer, contentType }
}
