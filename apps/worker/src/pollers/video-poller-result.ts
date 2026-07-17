export type VideoPollStatus = 'SUCCESS' | 'FAILURE' | 'NOT_START' | 'IN_PROGRESS' | 'POLL_ERROR' | 'POLL_AUTH_ERROR'

export interface VideoPollResult {
  status: VideoPollStatus
  videoUrl?: string
  failReason?: string
  httpStatus?: number
  errorMessage?: string
  retryable?: boolean
  endpoint?: string
  requestPayload?: unknown
  responseStatus?: number | null
  responsePayload?: unknown
  durationMs?: number | null
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const AUTH_HTTP_STATUSES = new Set([401, 403])

export const VIDEO_POLL_INTERVAL_MS = 15_000
export const MAX_CONSECUTIVE_VIDEO_POLL_ERRORS = 20

export function shouldFailVideoTaskAfterPollError(input: {
  provider: string
  count: number
  maxErrors: number
  retryable?: boolean
}): boolean {
  // TokenHub 任务不因轮询错误而判定失败，持续轮询至终态或总超时
  if (input.provider === 'tokenhub') return false
  return input.count >= input.maxErrors && input.retryable === false
}

export function classifyVideoPollHttpError(httpStatus: number, bodyText: string): VideoPollResult {
  const errorMessage = bodyText.slice(0, 500) || `HTTP ${httpStatus}`

  if (AUTH_HTTP_STATUSES.has(httpStatus)) {
    return {
      status: 'POLL_AUTH_ERROR',
      httpStatus,
      errorMessage,
      failReason: `视频状态查询鉴权失败（HTTP ${httpStatus}）`,
      retryable: false,
    }
  }

  return {
    status: 'POLL_ERROR',
    httpStatus,
    errorMessage,
    retryable: RETRYABLE_HTTP_STATUSES.has(httpStatus),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractVideoUrlFromValue(value: unknown): string | undefined {
  if (!value) return undefined

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractVideoUrlFromValue(item)
      if (url) return url
    }
    return undefined
  }

  if (!isObject(value)) return undefined

  const directUrl = pickString(value.url) ?? pickString(value.video_url)
  if (directUrl) return directUrl

  const videoUrl = value.video_url
  if (isObject(videoUrl)) {
    const nestedUrl = pickString(videoUrl.url)
    if (nestedUrl) return nestedUrl
  }

  return extractVideoUrlFromValue(value.content) ?? extractVideoUrlFromValue(value.data) ?? extractVideoUrlFromValue(value.output)
}

export function parseVolcengineTaskResponse(data: unknown): VideoPollResult {
  if (!isObject(data)) {
    return {
      status: 'POLL_ERROR',
      errorMessage: '火山任务响应不是对象',
      retryable: false,
    }
  }

  const rawStatus = pickString(data.status)
  const statusMap: Record<string, VideoPollStatus> = {
    succeeded: 'SUCCESS',
    failed: 'FAILURE',
    expired: 'FAILURE',
    queued: 'NOT_START',
    running: 'IN_PROGRESS',
    cancelled: 'FAILURE',
  }
  const status = rawStatus ? statusMap[rawStatus] : undefined

  const error = isObject(data.error) ? data.error : undefined
  const failReason = pickString(error?.message)
  const videoUrl = extractVideoUrlFromValue(data)

  return {
    status: status ?? 'POLL_ERROR',
    videoUrl,
    failReason,
    retryable: status == null,
    errorMessage: status == null ? `未知火山任务状态: ${rawStatus ?? 'empty'}` : undefined,
  }
}

export function parseTokenhubTaskResponse(data: unknown): VideoPollResult {
  if (!isObject(data)) {
    return {
      status: 'POLL_ERROR',
      errorMessage: 'Tokenhub 任务响应不是对象',
      retryable: false,
    }
  }

  const output = isObject(data.output) ? data.output : undefined
  const rawStatus = pickString(output?.task_status) ?? pickString(data.status)
  const statusMap: Record<string, VideoPollStatus> = {
    PENDING: 'NOT_START',
    RUNNING: 'IN_PROGRESS',
    SUCCEEDED: 'SUCCESS',
    FAILED: 'FAILURE',
    pending: 'NOT_START',
    running: 'IN_PROGRESS',
    succeeded: 'SUCCESS',
    failed: 'FAILURE',
    completed: 'SUCCESS',
    expired: 'FAILURE',
    cancelled: 'FAILURE',
  }
  const status = rawStatus ? statusMap[rawStatus] : undefined
  const videoUrl = pickString(output?.video_url) ?? extractVideoUrlFromValue(data)
  const error = isObject(data.error) ? data.error : undefined
  const failReason = pickString(output?.message) ?? pickString(error?.message) ?? pickString(data.error)

  return {
    status: status ?? 'POLL_ERROR',
    videoUrl,
    failReason,
    retryable: status == null || status === 'POLL_ERROR',
    errorMessage: status == null ? `未知 Tokenhub 任务状态: ${rawStatus ?? 'empty'}` : undefined,
  }
}
