'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { BatchResponse } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'
import { waitForAuth } from '@/lib/api-client'

interface UseBatchSSEOptions {
  batchId: string | null
  onUpdate: (batch: BatchResponse) => void
  enabled?: boolean
}

export function useBatchSSE({ batchId, onUpdate, enabled = true }: UseBatchSSEOptions) {
  const controllerRef = useRef<AbortController | null>(null)
  const retryCountRef = useRef(0)
  const onUpdateRef = useRef(onUpdate)

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const connect = useCallback((id: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    ;(async () => {
      try {
        // 等待 auth 初始化完成，避免 token 未就绪时发起 SSE 连接
        await waitForAuth()
        if (controller.signal.aborted) return

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

        // 指数退避重连
        if (!controller.signal.aborted) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000)
          retryCountRef.current++
          setTimeout(() => {
            if (!controllerRef.current?.signal.aborted) connect(id)
          }, delay)
        }
      }
    })()
  }, [])

  useEffect(() => {
    if (!batchId || !enabled) {
      controllerRef.current?.abort()
      return
    }
    connect(batchId)
    return () => { controllerRef.current?.abort() }
  }, [batchId, enabled, connect])
}
