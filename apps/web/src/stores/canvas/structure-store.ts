import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow'
import type { AppNode, AppEdge } from '@/lib/canvas/types'
import { hasCycle } from '@/lib/canvas/dag'

// Deep equality check for undo history — prevents recording no-op changes
// and works with the throttle to batch rapid mutations (e.g. dragging)
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}

interface CanvasStructureState {
  canvasId: string | null
  workspaceId: string | null
  nodes: AppNode[]
  edges: AppEdge[]
  localVersion: number

  initCanvas: (canvasId: string, nodes: AppNode[], edges: AppEdge[], version: number, workspaceId?: string) => void
  setLocalVersion: (version: number) => void

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void

  addNode: (type: string, position: { x: number; y: number }) => void
  addNodeWithConfig: (type: string, position: { x: number; y: number }, config: any, id?: string) => void
  removeNodes: (nodeIds: string[]) => void
  removeEdgesByTarget: (nodeId: string, handleIds: string[]) => void
  updateNodeData: (nodeId: string, partialData: Partial<AppNode['data']>) => void
}

export const useCanvasStructureStore = create<CanvasStructureState>()(
  temporal(
    (set, get) => ({
  canvasId: null,
  workspaceId: null,
  nodes: [],
  edges: [],
  localVersion: 1,

  initCanvas: (canvasId, nodes, edges, version, workspaceId) => {
    set({ canvasId, nodes, edges, localVersion: version, workspaceId: workspaceId ?? null })
    // Clear undo history so users can't undo past the loaded state
    useCanvasStructureStore.temporal.getState().clear()
  },

  setLocalVersion: (version) => {
    set({ localVersion: version })
  },

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as AppNode[],
    }))
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges) as AppEdge[],
    }))
  },

  onConnect: (connection) => {
    const { nodes, edges } = get()
    if (connection.source === connection.target) return

    const simulatedEdges = addEdge(connection, edges) as AppEdge[]
    if (hasCycle(nodes, simulatedEdges)) {
      console.warn('[Canvas] 禁止产生循环依赖连线')
      return
    }

    set({ edges: simulatedEdges })
  },

  addNode: (type, position) => {
    const newNode = nodeRegistry.createNodeInstance(type, position)
    set((state) => ({ nodes: state.nodes.concat(newNode) }))
  },

  addNodeWithConfig: (type, position, config, id) => {
    const newNode = nodeRegistry.createNodeInstance(type, position, id)
    newNode.data.config = { ...newNode.data.config, ...config }
    set((state) => ({ nodes: state.nodes.concat(newNode) }))
  },

  removeNodes: (nodeIds) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: state.edges.filter(
        (e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)
      ),
    }))
  },

  removeEdgesByTarget: (nodeId, handleIds) => {
    set((state) => ({
      edges: state.edges.filter(
        (e) => !(e.target === nodeId && e.targetHandle && handleIds.includes(e.targetHandle))
      ),
    }))
  },

  updateNodeData: (nodeId, partialData) => {
    set((state) => {
      if (!partialData || Object.keys(partialData).length === 0) return {}

      const index = state.nodes.findIndex((node) => node.id === nodeId)
      if (index === -1) return {}

      const target = state.nodes[index]
      const updatedNode: AppNode = {
        ...target,
        data: { ...target.data, ...partialData },
      }

      const nextNodes = state.nodes.slice()
      nextNodes[index] = updatedNode
      return { nodes: nextNodes }
    })
  },
}),
    {
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
      limit: 50,
      // Throttle history snapshots so rapid changes (dragging, etc.) merge into one entry
      handleSet: (handleSetCb) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        return (state: Parameters<typeof handleSetCb>[0]) => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            handleSetCb(state)
          }, 500)
        }
      },
      // Skip recording if nothing actually changed
      equality: (pastState, currentState) =>
        deepEqual(pastState, currentState),
    },
  )
)
