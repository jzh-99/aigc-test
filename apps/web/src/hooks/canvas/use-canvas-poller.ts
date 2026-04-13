import { useCallback, useEffect, useRef } from 'react'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { fetchCanvasActiveTasks, fetchNodeOutputs, fetchAllNodeOutputs } from '@/lib/canvas/canvas-api'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'

const POLL_INTERVAL_ACTIVE = 2000   // while tasks are running
const POLL_INTERVAL_IDLE   = 8000   // no active tasks but version may change
const POLL_IDLE_STOP_AFTER = 5      // stop polling after N consecutive idle polls
const OUTPUTS_LOAD_CONCURRENCY = 4
const MAX_CONSECUTIVE_ERRORS = 10

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return
  const size = Math.max(1, Math.min(limit, items.length))
  let index = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index++]
      await worker(current)
    }
  }))
}

export function useCanvasPoller(canvasId: string | null) {
  const lastVersion = useRef<number>(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const idleCountRef = useRef(0)
  const consecutiveErrorRef = useRef(0)
  const loadingAllRef = useRef(false)
  // Use refs for token/stores to avoid re-creating poll closure on every auth change
  const tokenRef = useRef<string | null>(null)
  tokenRef.current = useAuthStore((s) => s.accessToken)

  const loadNodeOutputs = useCallback(async (nodeId: string) => {
    if (!canvasId) return
    const token = tokenRef.current
    try {
      const outputs = await fetchNodeOutputs(canvasId, nodeId, token || undefined)
      if (!outputs.length) return
      const store = useCanvasExecutionStore.getState()
      for (const row of outputs) {
        const url = row.output_urls?.[0]
        if (!url) continue
        store.addNodeOutput(nodeId, { id: row.id, url, type: 'image' })
      }
      const selected = outputs.find((o: any) => o.is_selected)
      if (selected) store.selectNodeOutput(nodeId, selected.id)
    } catch (e) {
      console.warn('[Canvas Poller] 拉取节点历史失败:', e)
    }
  }, [canvasId])

  // Load history outputs for all nodes on mount (single batch request)
  const loadAllNodeOutputs = useCallback(async () => {
    if (!canvasId) return
    loadingAllRef.current = true
    try {
      const token = tokenRef.current
      const grouped = await fetchAllNodeOutputs(canvasId, token || undefined)
      const store = useCanvasExecutionStore.getState()
      for (const [nodeId, outputs] of Object.entries(grouped)) {
        for (const row of outputs) {
          const url = row.output_urls?.[0]
          if (!url) continue
          store.addNodeOutput(nodeId, { id: row.id, url, type: 'image' })
        }
        const selected = outputs.find((o) => o.is_selected)
        if (selected) store.selectNodeOutput(nodeId, selected.id)
      }
    } catch (e) {
      console.warn('[Canvas Poller] 批量拉取节点输出失败，回退逐个加载:', e)
      // Fallback to per-node loading
      const nodes = useCanvasStructureStore.getState().nodes
      await runWithConcurrency(nodes, OUTPUTS_LOAD_CONCURRENCY, (node) => loadNodeOutputs(node.id))
    } finally {
      loadingAllRef.current = false
    }
  }, [canvasId, loadNodeOutputs])

  const poll = useCallback(async () => {
    if (!canvasId) return
    const token = tokenRef.current
    try {
      const data = await fetchCanvasActiveTasks(canvasId, token || undefined)
      consecutiveErrorRef.current = 0
      const hasActiveTasks = data.batches.length > 0
      const versionChanged = data.version !== lastVersion.current

      if (versionChanged) {
        const prevVersion = lastVersion.current
        lastVersion.current = data.version
        idleCountRef.current = 0

        const store = useCanvasExecutionStore.getState()
        for (const batch of data.batches) {
          store.updateNodeFromBatch(batch.canvas_node_id, batch)
        }
        store.reconcileNodes(data.batches.map((b: any) => b.canvas_node_id))

        // Load outputs for nodes that just finished (skip if bulk load is in progress)
        if (prevVersion !== -1 && !loadingAllRef.current) {
          const execState = useCanvasExecutionStore.getState()
          const finishedNodes = Object.entries(execState.nodes)
            .filter(([, s]) => !s.isGenerating && s.progress === 100 && s.outputs.length === 0)
            .map(([id]) => id)
          await runWithConcurrency(finishedNodes, OUTPUTS_LOAD_CONCURRENCY, loadNodeOutputs)
        }
      } else if (!hasActiveTasks) {
        idleCountRef.current += 1
      }

      // Stop polling after sustained idle; kickPoll() will restart when needed
      if (!hasActiveTasks && idleCountRef.current >= POLL_IDLE_STOP_AFTER) return

      const interval = hasActiveTasks ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE
      timerRef.current = setTimeout(poll, interval)
    } catch (e) {
      consecutiveErrorRef.current += 1
      if (consecutiveErrorRef.current >= MAX_CONSECUTIVE_ERRORS) {
        console.error('[Canvas Poller] 连续错误达到上限，停止轮询')
        toast.error('画布轮询连接失败，请检查网络后刷新页面')
        return
      }
      console.error('[Canvas Poller] 轮询异常：', e)
      timerRef.current = setTimeout(poll, 5000)
    }
  }, [canvasId, loadNodeOutputs])

  useEffect(() => {
    if (!canvasId) return
    idleCountRef.current = 0

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current)
      } else {
        idleCountRef.current = 0
        poll()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    poll()
    loadAllNodeOutputs()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(timerRef.current)
    }
  }, [canvasId, poll, loadAllNodeOutputs])

  const kickPoll = useCallback(() => {
    if (!canvasId) return
    idleCountRef.current = 0
    consecutiveErrorRef.current = 0
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(poll, 500)
  }, [canvasId, poll])

  return { kickPoll, loadNodeOutputs }
}
