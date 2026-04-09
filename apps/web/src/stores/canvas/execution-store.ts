import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { NodeExecutionState, NodeOutputAsset } from '@/lib/canvas/types'

export const DEFAULT_NODE_STATE: NodeExecutionState = {
  isGenerating: false,
  progress: 0,
  outputs: [],
  selectedOutputId: null,
  warningMessage: undefined,
  errorMessage: undefined,
  startedAt: null,
}

interface CanvasExecutionState {
  nodes: Record<string, NodeExecutionState>
  activeVideoNodeId: string | null

  initNodeState: (nodeId: string, state?: Partial<NodeExecutionState>) => void
  setNodeProgress: (nodeId: string, progress: number, isGenerating: boolean) => void
  addNodeOutput: (nodeId: string, output: NodeOutputAsset) => void
  selectNodeOutput: (nodeId: string, outputId: string) => void
  setNodeWarning: (nodeId: string, warning?: string) => void
  setNodeError: (nodeId: string, error?: string) => void
  setActiveVideo: (nodeId: string | null) => void
  updateNodeFromBatch: (nodeId: string, batchInfo: any) => void
  reconcileNodes: (activeNodeIds: string[]) => void
}

export const useCanvasExecutionStore = create<CanvasExecutionState>((set, get) => ({
  nodes: {},
  activeVideoNodeId: null,

  initNodeState: (nodeId, state) => {
    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: { ...DEFAULT_NODE_STATE, ...state } },
    }))
  },

  setNodeProgress: (nodeId, progress, isGenerating) => {
    set((s) => {
      const prev = s.nodes[nodeId] || DEFAULT_NODE_STATE
      const startedAt = isGenerating && !prev.isGenerating ? Date.now() : (isGenerating ? prev.startedAt : null)
      return {
        nodes: {
          ...s.nodes,
          [nodeId]: { ...prev, progress, isGenerating, startedAt, warningMessage: undefined, errorMessage: undefined },
        },
      }
    })
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

  setNodeError: (nodeId, error) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: { ...(s.nodes[nodeId] || DEFAULT_NODE_STATE), errorMessage: error, isGenerating: false, startedAt: null },
      },
    }))
  },

  setActiveVideo: (nodeId) => set({ activeVideoNodeId: nodeId }),

  updateNodeFromBatch: (nodeId, batchInfo) => {
    const isGenerating = ['pending', 'processing'].includes(batchInfo.status)
    const progress = batchInfo.quantity > 0 ? (batchInfo.completed_count / batchInfo.quantity) * 100 : 0
    get().setNodeProgress(nodeId, progress, isGenerating)
    if (batchInfo.status === 'failed') get().setNodeError(nodeId, '生成失败，请重试')
  },

  reconcileNodes: (activeNodeIds) => {
    set((s) => {
      let changed = false
      const newNodes = { ...s.nodes }
      Object.keys(newNodes).forEach((id) => {
        if (newNodes[id].isGenerating && !activeNodeIds.includes(id)) {
          newNodes[id] = { ...newNodes[id], isGenerating: false, progress: 100, startedAt: null }
          changed = true
        }
      })
      return changed ? { nodes: newNodes } : {}
    })
  },
}))

export function useNodeExecutionState(nodeId: string) {
  return useCanvasExecutionStore(
    useShallow((state) => state.nodes[nodeId] || DEFAULT_NODE_STATE)
  )
}
