'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { apiGet } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'

const TERMINAL_STATUSES = new Set(['completed', 'partial_complete', 'failed'])

function extractUrls(batch: BatchResponse): string[] {
  return batch.tasks
    .map((task) => task.asset?.storage_url ?? task.asset?.original_url)
    .filter(Boolean) as string[]
}

interface PendingBatchWatcherOptions<T> {
  pendingBatches: Record<string, T>
  intervalMs?: number
  failureMessage: string
  emptyMessage: string
  onCompleted: (target: T, urls: string[], batchId: string) => void
  onClear: (batchId: string) => void
}

export function usePendingBatchWatcher<T>({
  pendingBatches,
  intervalMs = 3000,
  failureMessage,
  emptyMessage,
  onCompleted,
  onClear,
}: PendingBatchWatcherOptions<T>) {
  const onCompletedRef = useRef(onCompleted)
  const onClearRef = useRef(onClear)
  onCompletedRef.current = onCompleted
  onClearRef.current = onClear

  const batchIds = useMemo(() => Object.keys(pendingBatches), [pendingBatches])

  const checkBatch = useCallback(async (batchId: string, target: T) => {
    try {
      const batch = await apiGet<BatchResponse>(`/batches/${batchId}`)
      if (batch.status === 'completed' || batch.status === 'partial_complete') {
        const urls = extractUrls(batch)
        if (urls.length > 0) {
          onCompletedRef.current(target, urls, batchId)
        } else {
          toast.error(emptyMessage)
        }
        onClearRef.current(batchId)
        return true
      }
      if (batch.status === 'failed') {
        toast.error(failureMessage)
        onClearRef.current(batchId)
        return true
      }
      if (TERMINAL_STATUSES.has(batch.status)) {
        onClearRef.current(batchId)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [emptyMessage, failureMessage])

  useEffect(() => {
    if (batchIds.length === 0) return

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    for (const batchId of batchIds) {
      const target = pendingBatches[batchId]
      const poll = async () => {
        if (cancelled) return
        const done = await checkBatch(batchId, target)
        if (!cancelled && !done) {
          timers.push(setTimeout(poll, intervalMs))
        }
      }
      void poll()
    }

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [batchIds, checkBatch, intervalMs, pendingBatches])
}
