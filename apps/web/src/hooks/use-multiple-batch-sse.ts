'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { BatchResponse } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'
import { waitForAuth } from '@/lib/api-client'

interface UseMultipleBatchSSEOptions {
  batchIds: string[]
  onUpdate: (batch: BatchResponse) => void
  enabled?: boolean
}

export function useMultipleBatchSSE({ batchIds, onUpdate, enabled = true }: UseMultipleBatchSSEOptions) {
  const controllersRef = useRef<Map<string, AbortController>>(new Map())
  const retryCountsRef = useRef<Map<string, number>>(new Map())
  const onUpdateRef = useRef(onUpdate)

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const connect = useCallback((batchId: string) => {
    controllersRef.current.get(batchId)?.abort()

    const controller = new AbortController()
    controllersRef.current.set(batchId, controller)

    ;(async () => {
      try {
        await waitForAuth()
        if (controller.signal.aborted) return

        const token = useAuthStore.getState().accessToken
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch(`/api/v1/sse/batches/${batchId}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) return

        retryCountsRef.current.set(batchId, 0)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!controller.signal.aborted) {
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
                onUpdateRef.current(batch)
                if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'partial_complete') {
                  controller.abort()
                  controllersRef.current.delete(batchId)
                  return
                }
              } catch {
                // 忽略损坏的 JSON 帧
              }
              eventName = ''
            } else if (line === '') {
              eventName = ''
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return

        if (!controller.signal.aborted) {
          const currentCount = retryCountsRef.current.get(batchId) ?? 0
          const delay = Math.min(1000 * Math.pow(2, currentCount), 30000)
          retryCountsRef.current.set(batchId, currentCount + 1)
          setTimeout(() => {
            if (!controllersRef.current.get(batchId)?.signal.aborted) connect(batchId)
          }, delay)
        }
      }
    })()
  }, [])

  useEffect(() => {
    if (!enabled) {
      controllersRef.current.forEach((controller) => controller.abort())
      controllersRef.current.clear()
      return
    }

    const currentIds = new Set(controllersRef.current.keys())
    const newIds = new Set(batchIds)

    const toDisconnect = [...currentIds].filter(id => !newIds.has(id))
    const toConnect = [...newIds].filter(id => !currentIds.has(id))

    toDisconnect.forEach(id => {
      controllersRef.current.get(id)?.abort()
      controllersRef.current.delete(id)
      retryCountsRef.current.delete(id)
    })

    toConnect.forEach(id => connect(id))

    return () => {
      controllersRef.current.forEach((controller) => controller.abort())
      controllersRef.current.clear()
      retryCountsRef.current.clear()
    }
  }, [batchIds, enabled, connect])
}
