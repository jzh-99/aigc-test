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
  highlightedNodeIds: Set<string>  // upstream lineage highlight
  generatingNodeIds: Set<string>

  initNodeState: (nodeId: string, state?: Partial<NodeExecutionState>) => void
  setNodeProgress: (nodeId: string, progress: number, isGenerating: boolean) => void
  addNodeOutput: (nodeId: string, output: NodeOutputAsset) => void
  selectNodeOutput: (nodeId: string, outputId: string) => void
  setNodeWarning: (nodeId: string, warning?: string) => void
  setNodeError: (nodeId: string, error?: string) => void
  setActiveVideo: (nodeId: string | null) => void
  setHighlightedNodes: (nodeIds: Set<string>) => void
  updateNodeFromBatch: (nodeId: string, batchInfo: any) => void
  reconcileNodes: (activeNodeIds: string[]) => void
}

export const useCanvasExecutionStore = create<CanvasExecutionState>((set, get) => ({
  nodes: {},
  activeVideoNodeId: null,
  highlightedNodeIds: new Set(),
  generatingNodeIds: new Set(),

  initNodeState: (nodeId, state) => {
    set((s) => {
      const nextNodeState = { ...DEFAULT_NODE_STATE, ...state }
      let nextGeneratingNodeIds = s.generatingNodeIds
      if (nextNodeState.isGenerating && !s.generatingNodeIds.has(nodeId)) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        nextGeneratingNodeIds.add(nodeId)
      }
      if (!nextNodeState.isGenerating && s.generatingNodeIds.has(nodeId)) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        nextGeneratingNodeIds.delete(nodeId)
      }
      return {
        nodes: { ...s.nodes, [nodeId]: nextNodeState },
        generatingNodeIds: nextGeneratingNodeIds,
      }
    })
  },

  setNodeProgress: (nodeId, progress, isGenerating) => {
    set((s) => {
      const prev = s.nodes[nodeId] || DEFAULT_NODE_STATE
      const startedAt = isGenerating && !prev.isGenerating ? Date.now() : (isGenerating ? prev.startedAt : null)

      let nextGeneratingNodeIds = s.generatingNodeIds
      if (prev.isGenerating !== isGenerating) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        if (isGenerating) {
          nextGeneratingNodeIds.add(nodeId)
        } else {
          nextGeneratingNodeIds.delete(nodeId)
        }
      }

      return {
        nodes: {
          ...s.nodes,
          [nodeId]: { ...prev, progress, isGenerating, startedAt, warningMessage: undefined, errorMessage: undefined },
        },
        generatingNodeIds: nextGeneratingNodeIds,
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
    set((s) => {
      let nextGeneratingNodeIds = s.generatingNodeIds
      if (s.generatingNodeIds.has(nodeId)) {
        nextGeneratingNodeIds = new Set(s.generatingNodeIds)
        nextGeneratingNodeIds.delete(nodeId)
      }

      return {
        nodes: {
          ...s.nodes,
          [nodeId]: { ...(s.nodes[nodeId] || DEFAULT_NODE_STATE), errorMessage: error, isGenerating: false, startedAt: null },
        },
        generatingNodeIds: nextGeneratingNodeIds,
      }
    })
  },

  setActiveVideo: (nodeId) => set({ activeVideoNodeId: nodeId }),

  setHighlightedNodes: (nodeIds) => set({ highlightedNodeIds: nodeIds }),

  updateNodeFromBatch: (nodeId, batchInfo) => {
    const isGenerating = ['pending', 'processing'].includes(batchInfo.status)
    const progress = batchInfo.quantity > 0 ? (batchInfo.completed_count / batchInfo.quantity) * 100 : 0
    get().setNodeProgress(nodeId, progress, isGenerating)
    if (batchInfo.status === 'failed') get().setNodeError(nodeId, '生成失败，请重试')
  },

  reconcileNodes: (activeNodeIds) => {
    set((s) => {
      let changed = false
      const activeNodeIdSet = new Set(activeNodeIds)
      const newNodes = { ...s.nodes }
      Object.keys(newNodes).forEach((id) => {
        if (newNodes[id].isGenerating && !activeNodeIdSet.has(id)) {
          newNodes[id] = { ...newNodes[id], isGenerating: false, progress: 100, startedAt: null }
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
