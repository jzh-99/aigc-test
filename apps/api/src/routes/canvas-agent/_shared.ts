import { getDb } from '@aigc/db'
import { encryptProxyUrl } from '../../lib/storage.js'

const PROXY_URL_PREFIX = '/api/v1/assets/proxy?token='
const BASE64_PROXY_PREFIX = `base64:${PROXY_URL_PREFIX}`

type ContentPart = { type?: unknown; [key: string]: unknown }

export function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function toAbsoluteUrl(pathOrUrl: string, baseUrl: string): string | null {
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl
  if (pathOrUrl.startsWith('/')) {
    if (!baseUrl) return null
    return `${normalizeBaseUrl(baseUrl)}${pathOrUrl}`
  }
  return null
}

/** 将请求 content 中的媒体 URL 规范化为上游 AI 可访问的绝对 URL */
export function normalizeContentForUpstream(
  content: string | Array<{ type: string; [key: string]: unknown }>,
  publicBaseUrl: string,
): {
  content: string | Array<{ type: string; [key: string]: unknown }>
  totalMediaCount: number
  rewrittenMediaCount: number
  invalidMediaCount: number
} {
  if (typeof content === 'string') {
    return { content, totalMediaCount: 0, rewrittenMediaCount: 0, invalidMediaCount: 0 }
  }

  let totalMediaCount = 0
  let rewrittenMediaCount = 0
  let invalidMediaCount = 0

  const normalized = (content as ContentPart[]).map((part) => {
    const mediaType = part.type
    if (mediaType !== 'image_url' && mediaType !== 'video_url' && mediaType !== 'audio_url') return part

    totalMediaCount++
    const mediaKey = mediaType as 'image_url' | 'video_url' | 'audio_url'
    const mediaVal = part[mediaKey]
    if (!mediaVal || typeof mediaVal !== 'object') {
      invalidMediaCount++
      return part
    }

    const originalUrl = (mediaVal as { url?: unknown }).url
    if (typeof originalUrl !== 'string' || !originalUrl.trim()) {
      invalidMediaCount++
      return part
    }

    let nextUrl = originalUrl.trim()
    let changed = false

    if (nextUrl.startsWith(BASE64_PROXY_PREFIX)) {
      nextUrl = nextUrl.slice('base64:'.length)
      changed = true
    }

    if (nextUrl.startsWith('http://')) {
      if (!publicBaseUrl) {
        invalidMediaCount++
        return part
      }
      nextUrl = `${normalizeBaseUrl(publicBaseUrl)}${PROXY_URL_PREFIX}${encryptProxyUrl(nextUrl)}`
      changed = true
    } else if (nextUrl.startsWith('/')) {
      const absolute = toAbsoluteUrl(nextUrl, publicBaseUrl)
      if (!absolute) {
        invalidMediaCount++
        return part
      }
      nextUrl = absolute
      changed = true
    }

    if (!/^https?:\/\//i.test(nextUrl) && !nextUrl.startsWith('data:')) {
      invalidMediaCount++
      return part
    }

    if (changed) rewrittenMediaCount++

    return {
      ...part,
      [mediaKey]: {
        ...(mediaVal as Record<string, unknown>),
        url: nextUrl,
      },
    }
  })

  return {
    content: normalized as Array<{ type: string; [key: string]: unknown }>,
    totalMediaCount,
    rewrittenMediaCount,
    invalidMediaCount,
  }
}

/** 验证用户是否有权访问指定画布 */
export async function assertCanvasAccess(canvasId: string, userId: string): Promise<boolean> {
  const db = getDb()
  const canvas = await db
    .selectFrom('canvases')
    .select('workspace_id')
    .where('id', '=', canvasId)
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  if (!canvas) return false

  const member = await db
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', canvas.workspace_id)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return Boolean(member)
}
