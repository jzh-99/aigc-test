'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { BatchResponse } from '@aigc/types'

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
    const existingController = controllersRef.current.get(batchId)
    if (existingController) {
      existingController.abort()
    }
    
    const controller = new AbortController()
    controllersRef.current.set(batchId, controller)

    ;(async () => {
      try {
        console.log(`[MultipleSSE] 🔌 开始连接 batchId=${batchId}`)
        const { useAuthStore } = await import('@/stores/auth-store')
        const token = useAuthStore.getState().accessToken
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        console.log(`[MultipleSSE] 🌐 发起 SSE 请求到 /api/v1/sse/batches/${batchId}`)
        const res = await fetch(`/api/v1/sse/batches/${batchId}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        })

        console.log(`[MultipleSSE] 📡 收到响应: ok=${res.ok}, status=${res.status}`)
        if (!res.ok) {
          const text = await res.text()
          console.error(`[MultipleSSE] ❌ SSE 连接失败: ${res.status} ${text}`)
          return
        }
        if (!res.body) {
          console.error('[MultipleSSE] ❌ 响应没有 body')
          return
        }

        retryCountsRef.current.set(batchId, 0)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        console.log(`[MultipleSSE] ✅ SSE 连接建立成功: ${batchId}`)

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) {
            console.log(`[MultipleSSE] 🔌 流结束: ${batchId}`)
            break
          }

          const decoded = decoder.decode(value, { stream: true })
          buffer += decoded
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let eventName = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith('data:') && eventName === 'batch_update') {
              try {
                const batch: BatchResponse = JSON.parse(line.slice(5).trim())
                console.log(`[MultipleSSE] ✅ 收到更新: ${batch.id}, status=${batch.status}`)
                onUpdateRef.current(batch)

                if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'partial_complete') {
                  console.log(`[MultipleSSE] 🏁 检测到终态: ${batch.id}`)
                  controller.abort()
                  controllersRef.current.delete(batchId)
                  return
                }
              } catch (err) {
                console.error('[MultipleSSE] ❌ JSON 解析失败:', err)
              }
              eventName = ''
            } else if (line === '') {
              eventName = ''
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.log(`[MultipleSSE] 🔌 连接已取消: ${batchId}`)
          return
        }

        console.error(`[MultipleSSE] ❌ 连接异常: ${batchId}`, err)
        if (!controller.signal.aborted) {
          const currentCount = retryCountsRef.current.get(batchId) ?? 0
          const delay = Math.min(1000 * Math.pow(2, currentCount), 30000)
          retryCountsRef.current.set(batchId, currentCount + 1)
          console.log(`[MultipleSSE] ⏳ ${batchId} 将在 ${delay}ms 后重试 (第 ${currentCount + 1} 次)`)
          setTimeout(() => {
            if (!controllersRef.current.get(batchId)?.signal.aborted) {
              connect(batchId)
            }
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

    console.log(`[MultipleSSE] 更新连接: 断开 ${toDisconnect.length} 个，连接 ${toConnect.length} 个`)
    
    toDisconnect.forEach(id => {
      controllersRef.current.get(id)?.abort()
      controllersRef.current.delete(id)
      retryCountsRef.current.delete(id)
      console.log(`[MultipleSSE] 🔌 断开连接: ${id}`)
    })

    toConnect.forEach(id => {
      connect(id)
    })

    return () => {
      controllersRef.current.forEach((controller) => controller.abort())
      controllersRef.current.clear()
      retryCountsRef.current.clear()
    }
  }, [batchIds, enabled, connect])
}
