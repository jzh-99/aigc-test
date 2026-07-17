import { recordProviderApiLog, type ProviderApiLogInput } from '@aigc/db'

const pollAuditSignatures = new Map<string, string>()

export interface ProviderPollAuditInput extends ProviderApiLogInput {
  auditKey: string
  pollStatus?: string | null
  keyFields?: Record<string, unknown>
  final?: boolean
  force?: boolean
}

export function buildProviderPollAuditSignature(input: {
  pollStatus?: string | null
  keyFields?: Record<string, unknown>
  responseStatus?: number | null
  final?: boolean
  status: 'success' | 'failed'
  errorMessage?: string | null
}): string {
  return JSON.stringify({
    poll_status: input.pollStatus ?? null,
    key_fields: input.keyFields ?? {},
    response_status: input.responseStatus ?? null,
    final: Boolean(input.final),
    status: input.status,
    error_message: input.errorMessage ?? null,
  })
}

export function shouldRecordProviderPollAudit(auditKey: string, signature: string, force = false): boolean {
  if (force) {
    pollAuditSignatures.set(auditKey, signature)
    return true
  }
  const previous = pollAuditSignatures.get(auditKey)
  if (previous === signature) return false
  pollAuditSignatures.set(auditKey, signature)
  return true
}

export async function recordProviderPollAudit(input: ProviderPollAuditInput): Promise<void> {
  const signature = buildProviderPollAuditSignature({
    pollStatus: input.pollStatus,
    keyFields: input.keyFields,
    responseStatus: input.responseStatus,
    final: input.final,
    status: input.status,
    errorMessage: input.errorMessage,
  })
  if (!shouldRecordProviderPollAudit(input.auditKey, signature, input.force || input.status === 'failed')) return
  const { auditKey: _auditKey, pollStatus: _pollStatus, keyFields: _keyFields, final: _final, force: _force, ...logInput } = input
  await recordProviderApiLog(logInput)
}
