import { useCallback, useEffect, useRef } from 'react'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { fetchCanvasActiveTasks, fetchNodeOutputs } from '@/lib/canvas/canvas-api'
import { useAuthStore } from '@/stores/auth-store'

const POLL_INTERVAL_ACTIVE = 2000   // while tasks are running
const POLL_INTERVAL_IDLE   = 8000   // no active tasks but version may change
const POLL_IDLE_STOP_AFTER = 5      // stop polling after N consecutive idle polls
const OUTPUTS_LOAD_CONCURRENCY = 4

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

  // Load history outputs for all nodes on mount
  const loadAllNodeOutputs = useCallback(async () => {
    if (!canvasId) return
    const nodes = useCanvasStructureStore.getState().nodes
    await runWithConcurrency(nodes, OUTPUTS_LOAD_CONCURRENCY, (node) => loadNodeOutputs(node.id))
  }, [canvasId, loadNodeOutputs])

  const poll = useCallback(async () => {
    if (!canvasId) return
    const token = tokenRef.current
    try {
      const data = await fetchCanvasActiveTasks(canvasId, token || undefined)
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

        // Load outputs for nodes that just finished
        if (prevVersion !== -1) {
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
    loadAllNodeOutputs().then(() => poll())

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(timerRef.current)
    }
  }, [canvasId, poll, loadAllNodeOutputs])

  const kickPoll = useCallback(() => {
    if (!canvasId) return
    idleCountRef.current = 0
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(poll, 500)
  }, [canvasId, poll])

  return { kickPoll, loadNodeOutputs }
}
