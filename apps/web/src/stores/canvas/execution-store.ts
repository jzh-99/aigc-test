import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  NodeExecutionState,
  NodeOutputAsset,
  NodeSubmissionStatus,
  TaskBatchStatus,
} from '@/lib/canvas/types'

const ACTIVE_STATUSES: NodeSubmissionStatus[] = ['pending', 'processing']

function isActiveStatus(status: NodeSubmissionStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
}

function deriveProgressForStatus(status: NodeSubmissionStatus, progress: number): number {
  const p = clampProgress(progress)
  if (status === 'idle') return 0
  if (status === 'completed' || status === 'partial_complete') return Math.max(p, 100)
  return p
}

function withStatus(
  prev: NodeExecutionState,
  status: NodeSubmissionStatus,
  patch?: Partial<NodeExecutionState>,
): NodeExecutionState {
  const nextIsGenerating = isActiveStatus(status)
  const patchProgress = patch?.progress ?? prev.progress
  const nextProgress = deriveProgressForStatus(status, patchProgress)

  const next: NodeExecutionState = {
    ...prev,
    ...patch,
    submissionStatus: status,
    isGenerating: nextIsGenerating,
    progress: nextProgress,
    startedAt: nextIsGenerating ? (prev.startedAt ?? Date.now()) : null,
  }

  // Clear stale errors when entering non-failed states (unless explicitly patched)
  if (status !== 'failed') {
    if (patch?.errorMessage === undefined) next.errorMessage = undefined
    if (patch?.errorCode === undefined) next.errorCode = undefined
  }

  return next
}

export const DEFAULT_NODE_STATE: NodeExecutionState = {
  submissionStatus: 'idle',
  isGenerating: false,
  progress: 0,
  outputs: [],
  selectedOutputId: null,
  warningMessage: undefined,
  errorMessage: undefined,
  errorCode: undefined,
  startedAt: null,
}

interface CanvasTaskBatchLite {
  status: TaskBatchStatus
  quantity: number
  completed_count: number
  failed_count?: number
  error?: {
    message?: string
    code?: string
  } | null
}

interface CanvasExecutionState {
  nodes: Record<string, NodeExecutionState>
  activeVideoNodeId: string | null
  highlightedNodeIds: Set<string> // upstream lineage highlight
  generatingNodeIds: Set<string>

  initNodeState: (nodeId: string, state?: Partial<NodeExecutionState>) => void
  setNodeStatus: (nodeId: string, status: NodeSubmissionStatus, patch?: Partial<NodeExecutionState>) => void
  setNodeProgress: (nodeId: string, progress: number, isGenerating: boolean) => void
  addNodeOutput: (nodeId: string, output: NodeOutputAsset) => void
  selectNodeOutput: (nodeId: string, outputId: string) => void
  setNodeWarning: (nodeId: string, warning?: string) => void
  setNodeError: (nodeId: string, error?: string, errorCode?: string) => void
  setActiveVideo: (nodeId: string | null) => void
  setHighlightedNodes: (nodeIds: Set<string>) => void
  updateNodeFromBatch: (nodeId: string, batchInfo: CanvasTaskBatchLite) => void
  reconcileNodes: (activeNodeIds: string[]) => void
}

export const useCanvasExecutionStore = create<CanvasExecutionState>((set, get) => ({
  nodes: {},
  activeVideoNodeId: null,
  highlightedNodeIds: new Set(),
  generatingNodeIds: new Set(),

  initNodeState: (nodeId, state) => {
    set((s) => {
      const prev = s.nodes[nodeId] || DEFAULT_NODE_STATE
      const status = state?.submissionStatus ?? prev.submissionStatus
      const nextNodeState = withStatus(prev, status, state)

      let nextGeneratingNodeIds = s.generatingNodeIds
      const wasGenerating = s.generatingNodeIds.has(nodeId)
      if (nextNodeState.isGenerating && !wasGenerating) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        nextGeneratingNodeIds.add(nodeId)
      }
      if (!nextNodeState.isGenerating && wasGenerating) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        nextGeneratingNodeIds.delete(nodeId)
      }

      return {
        nodes: { ...s.nodes, [nodeId]: nextNodeState },
        generatingNodeIds: nextGeneratingNodeIds,
      }
    })
  },

  setNodeStatus: (nodeId, status, patch) => {
    set((s) => {
      const prev = s.nodes[nodeId] || DEFAULT_NODE_STATE
      const nextState = withStatus(prev, status, patch)

      let nextGeneratingNodeIds = s.generatingNodeIds
      if (prev.isGenerating !== nextState.isGenerating) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        if (nextState.isGenerating) {
          nextGeneratingNodeIds.add(nodeId)
        } else {
          nextGeneratingNodeIds.delete(nodeId)
        }
      }

      return {
        nodes: {
          ...s.nodes,
          [nodeId]: nextState,
        },
        generatingNodeIds: nextGeneratingNodeIds,
      }
    })
  },

  // Backward-compatible wrapper for existing call sites.
  setNodeProgress: (nodeId, progress, isGenerating) => {
    const status: NodeSubmissionStatus = isGenerating
      ? (progress > 0 ? 'processing' : 'pending')
      : (progress >= 100 ? 'completed' : 'idle')
    get().setNodeStatus(nodeId, status, { progress })
  },

  addNodeOutput: (nodeId, output) => {
    set((s) => {
      const nodeState = s.nodes[nodeId] || DEFAULT_NODE_STATE
      if (nodeState.outputs.some((o) => o.id === output.id)) return {}
      return {
        nodes: {
          ...s.nodes,
          [nodeId]: { ...nodeState, outputs: [...nodeState.outputs, output], selectedOutputId: output.id },
        },
      }
    })
  },

  selectNodeOutput: (nodeId, outputId) => {
    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: { ...(s.nodes[nodeId] || DEFAULT_NODE_STATE), selectedOutputId: outputId } },
    }))
  },

  setNodeWarning: (nodeId, warning) => {
    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: { ...(s.nodes[nodeId] || DEFAULT_NODE_STATE), warningMessage: warning } },
    }))
  },

  setNodeError: (nodeId, error, errorCode) => {
    get().setNodeStatus(nodeId, 'failed', {
      errorMessage: error,
      errorCode,
    })
  },

  setActiveVideo: (nodeId) => set({ activeVideoNodeId: nodeId }),

  setHighlightedNodes: (nodeIds) => set({ highlightedNodeIds: nodeIds }),

  updateNodeFromBatch: (nodeId, batchInfo) => {
    const progress = batchInfo.quantity > 0 ? (batchInfo.completed_count / batchInfo.quantity) * 100 : 0

    if (batchInfo.status === 'failed') {
      get().setNodeStatus(nodeId, 'failed', {
        progress,
        errorMessage: batchInfo.error?.message ?? '生成失败，请重试',
        errorCode: batchInfo.error?.code,
      })
      return
    }

    get().setNodeStatus(nodeId, batchInfo.status, { progress })
  },

  reconcileNodes: (activeNodeIds) => {
    set((s) => {
      let changed = false
      const activeNodeIdSet = new Set(activeNodeIds)
      const newNodes = { ...s.nodes }

      Object.keys(newNodes).forEach((id) => {
        const state = newNodes[id]

        // Locally running but no longer reported by active endpoint.
        if (state.isGenerating && !activeNodeIdSet.has(id)) {
          newNodes[id] = withStatus(state, 'completed', { progress: 100 })
          changed = true
          return
        }

        // Edge case: endpoint says active but local state is stale/non-active.
        if (!state.isGenerating && activeNodeIdSet.has(id)) {
          newNodes[id] = withStatus(state, 'processing')
          changed = true
        }
      })

      const hasSameGeneratingMembers =
        s.generatingNodeIds.size === activeNodeIdSet.size &&
        Array.from(s.generatingNodeIds).every((id) => activeNodeIdSet.has(id))

      return changed || !hasSameGeneratingMembers
        ? { nodes: newNodes, generatingNodeIds: activeNodeIdSet }
        : {}
    })
  },
}))

export function useNodeExecutionState(nodeId: string) {
  return useCanvasExecutionStore(
    useShallow((state) => state.nodes[nodeId] || DEFAULT_NODE_STATE)
  )
}

export function useNodeHighlighted(nodeId: string) {
  return useCanvasExecutionStore((state) => state.highlightedNodeIds.has(nodeId))
}
