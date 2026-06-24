// 播客内容预处理 + 媒体转存 helper（移植源项目 prepare_podcast_content + MinIO 转存）。
//
// 对齐源 app/workers/poll_tasks.py:prepare_podcast_content（内容预处理）与
// MinioStorageClient.transfer（音频转存）。aigc-test 改转存 TOS：
//   - PDF base64 → TOS（路由层做，脱敏 content 为 TOS URL）
//   - 音频临时 URL → TOS（worker 做，复用 music-storage.transferMusicUrl）
//
// 关键约定（CLAUDE.md 红线）：
//   - PDF base64 不入库不入日志：路由层脱敏为 TOS URL 后才写 task_batches.params
//   - content_type=file 且 content 为 http(s) URL → 视为已脱敏的 TOS URL，直接透传给 sami

import { randomUUID } from 'node:crypto'
import { getBucket, getPublicUrl, getTos } from '../lib/storage.js'

// TOS 上传依赖（可注入，便于测试 mock putObject 而不真实连接 TOS）
export interface TosUploader {
  putObject(params: {
    bucket: string
    key: string
    body: Buffer
    contentType: string
  }): Promise<unknown>
}

// PDF data URI 前缀（对齐源 routes_podcast.py:21 PDF_BASE64_PREFIX）
const PDF_BASE64_PREFIX = 'data:application/pdf;base64,'

// 脱敏占位符（对齐源 routes_podcast.py:22 MASKED_PDF_CONTENT，用于日志/DB 占位）
export const MASKED_PDF_CONTENT = `${PDF_BASE64_PREFIX}<masked>`

// ─── 判定 content 是否为 PDF base64（需脱敏落 TOS）──────────────────────────────
// 对齐源 routes_podcast.py:36-38 _is_file_base64_request：
//   content_type='file' 且 content 不以 http(s) 开头 → 视为 base64（需转 TOS）
export function isPdfBase64Content(contentType: string, content: string): boolean {
  return contentType === 'file' && !content.startsWith('http://') && !content.startsWith('https://')
}

// ─── PDF base64 → TOS（路由层脱敏用）───────────────────────────────────────────
// 返回 TOS 永久 URL，调用方需把 content 字段替换为该 URL（脱敏：原始 base64 不入库不入日志）
// tosUploader 可选注入：生产用 getTos()，测试传 mock 记录 putObject 调用
export async function uploadPdfBase64ToTos(
  base64Content: string,
  taskId: string,
  tosUploader?: TosUploader,
): Promise<{ storageUrl: string; storageKey: string }> {
  // 兼容 data:application/pdf;base64, 前缀与纯 base64 两种输入
  const commaIdx = base64Content.indexOf(',')
  const rawBase64 = commaIdx >= 0 && base64Content.slice(0, commaIdx).includes('base64')
    ? base64Content.slice(commaIdx + 1)
    : base64Content
  const buffer = Buffer.from(rawBase64, 'base64')
  if (buffer.length === 0) {
    throw new Error('PDF base64 内容为空，无法转存')
  }
  const key = `assets/podcast/${taskId}/${randomUUID()}.pdf`
  const tos: TosUploader = tosUploader ?? (getTos() as unknown as TosUploader)
  await tos.putObject({
    bucket: getBucket(),
    key,
    body: buffer,
    contentType: 'application/pdf',
  })
  const storageUrl = `${getPublicUrl()}/${encodeURI(key)}`
  return { storageUrl, storageKey: key }
}

// ─── 解析播客内容预处理结果（worker 消费）──────────────────────────────────────
// 对齐源 prepare_podcast_content 的分流：
//   - sourceFileUrl 非空（路由层已转 TOS）→ 用该 URL
//   - content_type='file' 且 content 已是 URL → 直接用（同上）
//   - content_type='text' → 直接用文本（后续安全改写，本层不处理）
//   - content_type='url' → 直接用 URL（sami 自行抓取）
//   - content_type='file' 且 content 为 base64 → 路由层应已转 TOS，此处置占位 URL
export interface ResolvedPodcastContent {
  // 传给 sami 的最终 content（文本 / TOS URL / 外部 URL）
  content: string
  // 是否为 URL 形态（决定 sami 走 input_url 还是 input_text）
  isUrl: boolean
}

export function resolvePodcastContent(params: {
  contentType: 'text' | 'file' | 'url'
  content: string
  sourceFileUrl?: string | null
}): ResolvedPodcastContent {
  const { contentType, content, sourceFileUrl } = params
  // 路由层已转 TOS 的 PDF：优先用 sourceFileUrl
  if (sourceFileUrl) {
    return { content: sourceFileUrl, isUrl: true }
  }
  if (contentType === 'text') {
    return { content, isUrl: false }
  }
  // content_type='url' 或 'file'(content 已是 URL)
  return { content, isUrl: true }
}
