import type { BatchSource } from '@aigc/types'

const BATCH_SOURCES: BatchSource[] = ['generation', 'studio', 'canvas']

export function normalizeBatchSource(value: string | undefined | null): BatchSource {
  if (value === undefined || value === null || value === '') return 'generation'
  if (BATCH_SOURCES.includes(value as BatchSource)) return value as BatchSource
  throw new Error('Invalid batch source')
}
