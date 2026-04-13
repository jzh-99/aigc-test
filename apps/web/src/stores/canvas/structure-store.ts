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
import { nodeRegistry } from '@/lib/canvas/registry'

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

    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    if (sourceNode && targetNode) {
      const sourceDef = nodeRegistry.getDefinition(sourceNode.type!)
      const targetDef = nodeRegistry.getDefinition(targetNode.type!)

      const sourceHandleDef = sourceDef?.outputs.find((h) => h.id === connection.sourceHandle)
      const targetHandleDef = targetDef?.inputs.find((h) => h.id === connection.targetHandle)

      if (
        sourceHandleDef &&
        targetHandleDef &&
        sourceHandleDef.type !== targetHandleDef.type &&
        targetHandleDef.type !== 'any'
      ) {
        console.warn(
          `[Canvas] 连线类型不匹配: 无法将 ${sourceHandleDef.type} 连入 ${targetHandleDef.type}`
        )
        return
      }
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
    },
  )
)
