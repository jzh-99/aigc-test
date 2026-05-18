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

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  // connect 函数稳定，不依赖外部变量
  const connect = useCallback((id: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    ;(async () => {
      try {
        console.log(`[SSE] 🔌 开始连接 batchId=${id}`)
        // Use access token from auth store for SSE authentication
        const { useAuthStore } = await import('@/stores/auth-store')
        const token = useAuthStore.getState().accessToken
        console.log(`[SSE] token exists: ${!!token}`)
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        console.log(`[SSE] 🌐 发起 SSE 请求到 /api/v1/sse/batches/${id}`)
        const res = await fetch(`/api/v1/sse/batches/${id}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        })

        console.log(`[SSE] 📡 收到响应: ok=${res.ok}, status=${res.status}, body=${!!res.body}`)
        if (!res.ok) {
          const text = await res.text()
          console.error(`[SSE] ❌ SSE 连接失败: ${res.status} ${text}`)
          return
        }
        if (!res.body) {
          console.error('[SSE] ❌ 响应没有 body')
          return
        }

        retryCountRef.current = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        console.log(`[SSE] ✅ SSE 连接建立成功，开始监听事件`)

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) {
            console.log(`[SSE] 🔌 流结束 (done=true)`)
            break
          }

          const decoded = decoder.decode(value, { stream: true })
          console.log(`[SSE] 📦 收到原始数据:`, JSON.stringify(decoded))
          buffer += decoded
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          console.log(`[SSE] 📝 解析 ${lines.length} 行，保留 buffer:`, JSON.stringify(buffer))

          let eventName = ''
          for (const line of lines) {
            console.log(`[SSE] 🚶 处理行:`, JSON.stringify(line))
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim()
              console.log(`[SSE] 🏷️  eventName 设置为:`, eventName)
            } else if (line.startsWith('data:') && eventName === 'batch_update') {
              try {
                const batch: BatchResponse = JSON.parse(line.slice(5).trim())
                console.log(`[SSE] ✅ 收到 batch_update: id=${batch.id}, status=${batch.status}, completed=${batch.completed_count}`)
                onUpdateRef.current(batch)

                // Stop if terminal
                if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'partial_complete') {
                  console.log(`[SSE] 🏁 检测到终态 status=${batch.status}，断开连接`)
                  controller.abort()
                  return
                }
              } catch (err) {
                console.error('[SSE] ❌ JSON 解析失败:', err, '原始数据:', line.slice(5).trim())
              }
              eventName = ''
            } else if (line === '') {
              eventName = ''
            } else if (line.startsWith('data:') && eventName === 'error') {
              console.error('[SSE] ❌ 收到错误事件:', line.slice(5).trim())
            }
          }
        }
      } catch (err: unknown) {
        console.error('[SSE] ❌ 连接错误:', err)
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.log('[SSE] 🔌 连接已取消 (AbortError)')
          return
        }

        console.error('[SSE] ❌ SSE 连接异常:', err)
        // Exponential backoff reconnect
        if (!controller.signal.aborted) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000)
          retryCountRef.current++
          console.log(`[SSE] ⏳ ${delay}ms 后重试 (第 ${retryCountRef.current} 次)`)
          setTimeout(() => {
            if (!controllerRef.current?.signal.aborted) {
              connect(id)
            }
          }, delay)
        }
      }
    })()
  }, []) // connect 不再依赖任何外部变量！

  useEffect(() => {
    if (!batchId || !enabled) {
      controllerRef.current?.abort()
      return
    }
    connect(batchId)

    return () => {
      controllerRef.current?.abort()
    }
  }, [batchId, enabled, connect])
}
