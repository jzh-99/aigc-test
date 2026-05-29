import { getDb } from './client.js'

const SECRET_KEY_PATTERN = /authorization|api[_-]?key|secret|(?<!max_)token|signature|password|credential/i
const LARGE_STRING_PATTERN = /base64|image|audio|video|file|buffer|blob|binary/i
const DEFAULT_STRING_LIMIT = 120
const DEFAULT_PAYLOAD_LIMIT = 32_000

export interface ProviderApiLogInput {
  batchId?: string | null
  taskId?: string | null
  userId?: string | null
  teamId?: string | null
  workspaceId?: string | null
  module: string
  provider: string
  model?: string | null
  operation: string
  method: string
  endpoint: string
  requestPayload?: unknown
  responseStatus?: number | null
  responsePayload?: unknown
  externalTaskId?: string | null
  durationMs?: number | null
  status: 'success' | 'failed'
  errorMessage?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeLargeString(value: string) {
  return { type: 'omitted_large_string', length: value.length }
}

export function sanitizeProviderApiPayload(value: unknown, key = ''): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (value.length > DEFAULT_STRING_LIMIT && LARGE_STRING_PATTERN.test(key)) return summarizeLargeString(value)
    return value
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderApiPayload(item, key))
  if (!isRecord(value)) return value ?? null

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeProviderApiPayload(entryValue, entryKey),
    ]),
  )
}

export function truncateProviderApiPayload(value: unknown, limit = DEFAULT_PAYLOAD_LIMIT): {
  payload: unknown
  truncated: boolean
} {
  const sanitized = sanitizeProviderApiPayload(value)
  const serialized = JSON.stringify(sanitized)
  if (serialized.length <= limit) return { payload: sanitized, truncated: false }
  return {
    payload: {
      type: 'truncated_json_payload',
      original_length: serialized.length,
      preview: serialized.slice(0, limit),
    },
    truncated: true,
  }
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined) return null
  return JSON.stringify(value)
}

export async function recordProviderApiLog(input: ProviderApiLogInput): Promise<void> {
  try {
    const request = truncateProviderApiPayload(input.requestPayload)
    const response = truncateProviderApiPayload(input.responsePayload)
    await getDb()
      .insertInto('provider_api_logs')
      .values({
        batch_id: input.batchId ?? null,
        task_id: input.taskId ?? null,
        user_id: input.userId ?? null,
        team_id: input.teamId ?? null,
        workspace_id: input.workspaceId ?? null,
        module: input.module,
        provider: input.provider,
        model: input.model ?? null,
        operation: input.operation,
        method: input.method,
        endpoint: input.endpoint,
        request_payload: jsonOrNull(request.payload),
        request_truncated: request.truncated,
        response_status: input.responseStatus ?? null,
        response_payload: jsonOrNull(response.payload),
        response_truncated: response.truncated,
        external_task_id: input.externalTaskId ?? null,
        duration_ms: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
        status: input.status,
        error_message: input.errorMessage?.slice(0, 2000) ?? null,
      })
      .execute()
  } catch {
    // 审计日志不能影响主生成链路。
  }
}
