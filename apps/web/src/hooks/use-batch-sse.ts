'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { BatchResponse } from '@aigc/types'

interface UseBatchSSEOptions {
  batchId: string | null
  onUpdate: (batch: BatchResponse) => void
  enabled?: boolean
}

export function useBatchSSE({ batchId, onUpdate, enabled = true }: UseBatchSSEOptions) {
  const controllerRef = useRef<AbortController | null>(null)
  const retryCountRef = useRef(0)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const connect = useCallback((id: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    ;(async () => {
      try {
        // Use access token from auth store for SSE authentication
        const { useAuthStore } = await import('@/stores/auth-store')
        const token = useAuthStore.getState().accessToken
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch(`/api/v1/sse/batches/${id}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) return

        retryCountRef.current = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let eventName = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith('data:') && eventName === 'batch_update') {
              try {
                const batch: BatchResponse = JSON.parse(line.slice(5).trim())
                console.log('[SSE] Received batch_update:', batch.id, batch.status, batch.completed_count)
                onUpdateRef.current(batch)

                // Stop if terminal
                if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'partial_complete') {
                  controller.abort()
                  return
                }
              } catch {
                // ignore malformed JSON
              }
              eventName = ''
            } else if (line === '') {
              eventName = ''
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return

        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000)
        retryCountRef.current++
        setTimeout(() => {
          if (!controller.signal.aborted) {
            connect(id)
          }
        }, delay)
      }
    })()
  }, [])

  useEffect(() => {
    if (!batchId || !enabled) return
    connect(batchId)

    return () => {
      controllerRef.current?.abort()
    }
  }, [batchId, enabled, connect])
}
