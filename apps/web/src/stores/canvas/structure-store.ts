import { create } from 'zustand'
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow'
import type { AppNode, AppEdge, CanvasNodeConfig, VideoMode } from '@/lib/canvas/types'
import type { AgentWorkflow } from '@/lib/canvas/agent-types'
import { isAssetConfig, isVideoGenConfig } from '@/lib/canvas/types'
import { hasCycle } from '@/lib/canvas/dag'
import { nodeRegistry } from '@/lib/canvas/registry'
import {
  type UndoSnapshot,
  loadUndoHistory,
  saveUndoHistory,
  MAX_UNDO,
} from '@/lib/canvas/canvas-undo-history'

interface CanvasStructureState {
  canvasId: string | null
  workspaceId: string | null
  nodes: AppNode[]
  edges: AppEdge[]
  localVersion: number
  _past: UndoSnapshot[]
  _future: UndoSnapshot[]

  initCanvas: (canvasId: string, nodes: AppNode[], edges: AppEdge[], version: number, workspaceId?: string) => void
  setLocalVersion: (version: number) => void
  flushHistory: () => void
  undo: () => void
  redo: () => void

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => string | null

  addNode: (type: string, position: { x: number; y: number }) => void
  addNodeWithConfig: (type: string, position: { x: number; y: number }, config: Record<string, unknown>, id?: string) => void
  removeNodes: (nodeIds: string[]) => void
  removeEdgesByTarget: (nodeId: string, handleIds: string[]) => void
  updateNodeData: (nodeId: string, partialData: Partial<AppNode['data']>) => void
  applyAgentWorkflow: (workflow: AgentWorkflow) => void
}

// Throttle state for drag operations
let dragTimer: ReturnType<typeof setTimeout> | undefined
let pendingSnapshot: UndoSnapshot | null = null

function commitSnapshot(canvasId: string, snapshot: UndoSnapshot, past: UndoSnapshot[]): UndoSnapshot[] {
  const next = [...past, snapshot].slice(-MAX_UNDO)
  saveUndoHistory(canvasId, { past: next, future: [] })
  return next
}

// Push a snapshot into history.
// immediate=true: flush any pending drag snapshot first, then push immediately.
// immediate=false: throttle 500ms to merge rapid drag changes into one entry.
function pushSnapshot(
  getState: () => CanvasStructureState,
  setState: (fn: (s: CanvasStructureState) => Partial<CanvasStructureState>) => void,
  snapshot: UndoSnapshot,
  immediate: boolean,
) {
  if (immediate) {
    clearTimeout(dragTimer)
    const { canvasId, _past } = getState()
    if (!canvasId) return
    // Flush pending drag snapshot first so it lands before this discrete op
    let base = _past
    if (pendingSnapshot) {
      base = commitSnapshot(canvasId, pendingSnapshot, _past)
      pendingSnapshot = null
    }
    const next = commitSnapshot(canvasId, snapshot, base)
    setState(() => ({ _past: next, _future: [] }))
    return
  }

  // Throttled path for drag
  clearTimeout(dragTimer)
  pendingSnapshot = snapshot
  dragTimer = setTimeout(() => {
    const { canvasId, _past } = getState()
    if (!canvasId || !pendingSnapshot) return
    const next = commitSnapshot(canvasId, pendingSnapshot, _past)
    pendingSnapshot = null
    setState(() => ({ _past: next, _future: [] }))
  }, 500)
}

function createNodeFromAgentNode(agentNode: AppNode): AppNode {
  try {
    const baseNode = nodeRegistry.createNodeInstance(
      agentNode.type ?? '',
      agentNode.position ?? { x: 0, y: 0 },
      agentNode.id,
    )

    return {
      ...agentNode,
      id: baseNode.id,
      type: baseNode.type,
      position: agentNode.position ?? baseNode.position,
      data: {
        ...baseNode.data,
        ...agentNode.data,
        label: agentNode.data?.label ?? baseNode.data.label,
        config: {
          ...baseNode.data.config,
          ...((agentNode.data?.config ?? {}) as unknown as Record<string, unknown>),
        } as CanvasNodeConfig,
      },
    }
  } catch {
    return agentNode
  }
}

export const useCanvasStructureStore = create<CanvasStructureState>((set, get) => ({
  canvasId: null,
  workspaceId: null,
  nodes: [],
  edges: [],
  localVersion: 1,
  _past: [],
  _future: [],

  initCanvas: (canvasId, nodes, edges, version, workspaceId) => {
    clearTimeout(dragTimer)
    pendingSnapshot = null
    const { past, future } = loadUndoHistory(canvasId)
    set({ canvasId, nodes, edges, localVersion: version, workspaceId: workspaceId ?? null, _past: past, _future: future })
  },

  setLocalVersion: (version) => {
    set({ localVersion: version })
  },

  flushHistory: () => {
    if (!pendingSnapshot) return
    clearTimeout(dragTimer)
    const { canvasId, _past } = get()
    if (!canvasId) return
    const next = commitSnapshot(canvasId, pendingSnapshot, _past)
    pendingSnapshot = null
    set({ _past: next, _future: [] })
  },

  undo: () => {
    const { canvasId, nodes, edges, _past, _future } = get()
    if (!canvasId || _past.length === 0) return
    const prev = _past[_past.length - 1]
    const newPast = _past.slice(0, -1)
    const newFuture = [{ nodes, edges }, ..._future]
    saveUndoHistory(canvasId, { past: newPast, future: newFuture })
    set({ nodes: prev.nodes, edges: prev.edges, _past: newPast, _future: newFuture })
  },

  redo: () => {
    const { canvasId, nodes, edges, _past, _future } = get()
    if (!canvasId || _future.length === 0) return
    const next = _future[0]
    const newFuture = _future.slice(1)
    const newPast = [..._past, { nodes, edges }].slice(-MAX_UNDO)
    saveUndoHistory(canvasId, { past: newPast, future: newFuture })
    set({ nodes: next.nodes, edges: next.edges, _past: newPast, _future: newFuture })
  },

  onNodesChange: (changes) => {
    const { nodes, edges } = get()
    // Record snapshot of state BEFORE the drag starts (throttled)
    const hasDrag = changes.some((c) => c.type === 'position')
    if (hasDrag) {
      pushSnapshot(get, set, { nodes, edges }, false)
    }
    set({ nodes: applyNodeChanges(changes, nodes) as AppNode[] })
  },

  onEdgesChange: (changes) => {
    const { nodes, edges } = get()
    const hasRemove = changes.some((c) => c.type === 'remove')
    if (hasRemove) {
      pushSnapshot(get, set, { nodes, edges }, true)
    }
    const next = applyEdgeChanges(changes, edges) as AppEdge[]
    set({ edges: next })
  },

  onConnect: (connection) => {
    const { nodes, edges } = get()
    if (connection.source === connection.target) return null

    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    const getNodeMimeType = (node: AppNode | undefined): string | undefined => {
      if (!node || node.type !== 'asset' || !isAssetConfig(node.data.config)) return undefined
      return node.data.config.mimeType
    }

    const sourceMime = getNodeMimeType(sourceNode)

    if (targetNode?.type === 'image_gen' && sourceMime && (sourceMime.startsWith('video') || sourceMime.startsWith('audio'))) {
      return '视频/音频素材不能连接到 AI 生图节点'
    }

    if (connection.targetHandle === 'any-in' || !connection.targetHandle) {
      if (targetNode?.type === 'video_gen') {
        const mimeType = sourceMime
        const videoMode: VideoMode = isVideoGenConfig(targetNode.data.config)
          ? targetNode.data.config.videoMode
          : 'multiref'
        const existingAnyIn = edges.filter((e) => e.target === connection.target && (!e.targetHandle || e.targetHandle === 'any-in'))

        if (videoMode === 'keyframe') {
          if (sourceNode?.type !== 'text_input') {
            const existingImages = existingAnyIn.filter((e) => {
              const src = nodes.find((n) => n.id === e.source)
              return src?.type !== 'text_input'
            }).length
            if (existingImages >= 2) return '首尾帧最多连接 2 张图片'
            if (mimeType && !mimeType.startsWith('image')) return '首尾帧模式只接受图片素材'
          }
        } else {
          const existingImages = existingAnyIn.filter((e) => {
            const src = nodes.find((n) => n.id === e.source)
            const mt = getNodeMimeType(src)
            return !mt || mt.startsWith('image')
          }).length
          const existingVideos = existingAnyIn.filter((e) => {
            const src = nodes.find((n) => n.id === e.source)
            const mt = getNodeMimeType(src)
            return mt?.startsWith('video')
          }).length
          const existingAudios = existingAnyIn.filter((e) => {
            const src = nodes.find((n) => n.id === e.source)
            const mt = getNodeMimeType(src)
            return mt?.startsWith('audio')
          }).length

          const isVideo = mimeType?.startsWith('video')
          const isAudio = mimeType?.startsWith('audio')
          const isImage = !isVideo && !isAudio

          if (isImage && existingImages >= 9) return '参考图最多 9 张'
          if (isVideo && existingVideos >= 3) return '参考视频最多 3 个'
          if (isAudio && existingAudios >= 3) return '参考音频最多 3 个'
        }
      }
    }

    const simulatedEdges = addEdge(connection, edges) as AppEdge[]
    if (hasCycle(nodes, simulatedEdges)) {
      console.warn('[Canvas] 禁止产生循环依赖连线')
      return null
    }

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ edges: simulatedEdges })
    return null
  },

  addNode: (type, position) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position)
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode) })
  },

  addNodeWithConfig: (type, position, config, id) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position, id)
    newNode.data.config = { ...newNode.data.config, ...config } as CanvasNodeConfig
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode) })
  },

  removeNodes: (nodeIds) => {
    const { nodes, edges } = get()
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      nodes: nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: edges.filter((e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)),
    })
  },

  removeEdgesByTarget: (nodeId, handleIds) => {
    const { nodes, edges } = get()
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      edges: edges.filter(
        (e) => !(e.target === nodeId && e.targetHandle && handleIds.includes(e.targetHandle))
      ),
    })
  },

  updateNodeData: (nodeId, partialData) => {
    if (!partialData || Object.keys(partialData).length === 0) return
    const { nodes, edges } = get()
    const index = nodes.findIndex((node) => node.id === nodeId)
    if (index === -1) return
    const target = nodes[index]
    const updatedNode: AppNode = { ...target, data: { ...target.data, ...partialData } }
    const next = nodes.slice()
    next[index] = updatedNode
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: next })
  },

  applyAgentWorkflow: (workflow) => {
    const { nodes, edges } = get()
    const newNodes = workflow.newNodes.map(createNodeFromAgentNode)
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      nodes: [...nodes, ...newNodes],
      edges: [...edges, ...workflow.newEdges],
    })
  },
}))
