import { recordProviderApiLog, type ProviderApiLogInput } from '@aigc/db'

export interface LlmProviderAuditContext {
  userId?: string | null
  teamId?: string | null
  workspaceId?: string | null
  batchId?: string | null
  taskId?: string | null
  module: string
  provider: string
  model?: string | null
  operation: string
  endpoint: string
}

export interface LlmStreamSummary {
  stream: true
  chunk_count: number
  response_bytes: number
  text_preview: string
  finished: boolean
}

export function summarizeLlmStreamChunk(summary: LlmStreamSummary, chunk: string): void {
  summary.chunk_count += 1
  summary.response_bytes += Buffer.byteLength(chunk)
  if (summary.text_preview.length >= 2000) return
  summary.text_preview = `${summary.text_preview}${chunk}`.slice(0, 2000)
}

export async function recordLlmProviderCall(input: LlmProviderAuditContext & {
  requestPayload: unknown
  responseStatus?: number | null
  responsePayload?: unknown
  durationMs?: number | null
  status: 'success' | 'failed'
  errorMessage?: string | null
}): Promise<void> {
  const logInput: ProviderApiLogInput = {
    batchId: input.batchId,
    taskId: input.taskId,
    userId: input.userId,
    teamId: input.teamId,
    workspaceId: input.workspaceId,
    module: input.module,
    provider: input.provider,
    model: input.model,
    operation: input.operation,
    method: 'POST',
    endpoint: input.endpoint,
    requestPayload: input.requestPayload,
    responseStatus: input.responseStatus,
    responsePayload: input.responsePayload,
    durationMs: input.durationMs,
    status: input.status,
    errorMessage: input.errorMessage,
  }
  await recordProviderApiLog(logInput)
}
