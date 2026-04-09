import { useCallback, useEffect, useRef } from 'react'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { fetchCanvasActiveTasks, fetchNodeOutputs } from '@/lib/canvas/canvas-api'
import { useAuthStore } from '@/stores/auth-store'

const POLL_INTERVAL = 2000
const OUTPUTS_LOAD_CONCURRENCY = 4

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return
  const size = Math.max(1, Math.min(limit, items.length))
  let index = 0

  await Promise.all(Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      await worker(current)
    }
  }))
}

export function useCanvasPoller(canvasId: string | null) {
  const lastVersion = useRef<number>(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const executionStore = useCanvasExecutionStore()
  const token = useAuthStore((s) => s.accessToken)

  const loadNodeOutputs = useCallback(async (nodeId: string) => {
    if (!canvasId) return
    try {
      const outputs = await fetchNodeOutputs(canvasId, nodeId, token || undefined)
      if (!outputs.length) return

      for (const row of outputs) {
        const url = row.output_urls?.[0]
        if (!url) continue
        executionStore.addNodeOutput(nodeId, { id: row.id, url, type: 'image' })
      }

      const selected = outputs.find((o) => o.is_selected)
      if (selected) executionStore.selectNodeOutput(nodeId, selected.id)
    } catch (e) {
      console.warn('[Canvas Poller] 拉取节点历史失败:', e)
    }
  }, [canvasId, token, executionStore])

  // Load history outputs for all nodes on mount (restores history after page refresh)
  const loadAllNodeOutputs = useCallback(async () => {
    if (!canvasId) return
    const nodes = useCanvasStructureStore.getState().nodes
    await runWithConcurrency(nodes, OUTPUTS_LOAD_CONCURRENCY, async (node) => {
      await loadNodeOutputs(node.id)
    })
  }, [canvasId, loadNodeOutputs])

  const poll = useCallback(async () => {
    if (!canvasId) return

    try {
      const data = await fetchCanvasActiveTasks(canvasId, token || undefined)

      if (data.version !== lastVersion.current) {
        const prevVersion = lastVersion.current
        lastVersion.current = data.version

        for (const batch of data.batches) {
          executionStore.updateNodeFromBatch(batch.canvas_node_id, batch)
        }

        const activeNodeIds = data.batches.map((b: any) => b.canvas_node_id)
        executionStore.reconcileNodes(activeNodeIds)

        if (prevVersion !== -1) {
          const store = useCanvasExecutionStore.getState()
          for (const [nodeId, state] of Object.entries(store.nodes)) {
            if (!state.isGenerating && state.progress === 100 && state.outputs.length === 0) {
              loadNodeOutputs(nodeId)
            }
          }
        }
      }

      const shouldStop = data.batches.length === 0 && data.version === lastVersion.current
      if (!shouldStop) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL)
      }
    } catch (e) {
      console.error('[Canvas Poller] 轮询异常：', e)
      timerRef.current = setTimeout(poll, 5000)
    }
  }, [canvasId, token, executionStore, loadNodeOutputs])

  useEffect(() => {
    if (!canvasId) return

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current)
      } else {
        poll()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    // Load all existing node outputs first, then start polling
    loadAllNodeOutputs().then(() => poll())

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(timerRef.current)
    }
  }, [canvasId, poll, loadAllNodeOutputs])

  const kickPoll = useCallback(() => {
    if (!canvasId) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(poll, 500)
  }, [canvasId, poll])

  return { kickPoll, loadNodeOutputs }
}
