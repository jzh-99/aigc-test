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
import { DEFAULT_IMAGE_CATEGORY_LIMITS, DEFAULT_VIDEO_CATEGORY_LIMITS, isAssetConfig, isImageGenConfig, isVideoGenConfig } from '@/lib/canvas/types'
import { ACTIVE_IMAGE_CATEGORY, parseCategoryReferences } from '@aigc/types'
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
  addNodeAndConnect: (sourceNodeIds: string[], type: string, position: { x: number; y: number }) => string[]
  addNodesWithEdges: (newNodes: AppNode[], newEdges: AppEdge[]) => string[]
  removeNodes: (nodeIds: string[]) => void
  removeEdgeById: (edgeId: string) => void
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

function createEdgeWithId(connection: Connection): AppEdge {
  return {
    id: `edge_${connection.source}_${connection.sourceHandle ?? 'source'}_${connection.target}_${connection.targetHandle ?? 'target'}_${crypto.randomUUID()}`,
    source: connection.source!,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target!,
    targetHandle: connection.targetHandle ?? null,
  }
}

function getVideoCategoryLimits(node: AppNode | undefined) {
  if (!node || node.type !== 'video_gen' || !isVideoGenConfig(node.data.config)) {
    return DEFAULT_VIDEO_CATEGORY_LIMITS
  }
  // 使用 parseCategoryReferences 确保数据格式正确
  const parsed = parseCategoryReferences(node.data.config.categoryReferences)
  // 如果解析结果为空对象，返回默认值
  if (Object.keys(parsed).length === 0) {
    return DEFAULT_VIDEO_CATEGORY_LIMITS
  }
  return parsed
}

function getImageCategoryLimits(node: AppNode | undefined) {
  if (!node || node.type !== 'image_gen' || !isImageGenConfig(node.data.config)) {
    return DEFAULT_IMAGE_CATEGORY_LIMITS
  }
  const parsed = parseCategoryReferences(node.data.config.categoryReferences)
  if (Object.keys(parsed).length === 0) {
    return DEFAULT_IMAGE_CATEGORY_LIMITS
  }
  return parsed
}

function getReferenceKind(node: AppNode | undefined): 'image' | 'video' | 'audio' | null {
  if (!node || node.type === 'text_input') return null
  if (node.type === 'image_gen') return 'image'
  if (node.type === 'video_gen' || node.type === 'video_stitch') return 'video'
  if (node.type === 'audio_gen') return 'audio'
  if (!isAssetConfig(node.data.config)) return null

  const mimeType = node.data.config.mimeType ?? ''
  if (mimeType.startsWith('image')) return 'image'
  if (mimeType.startsWith('video')) return 'video'
  if (mimeType.startsWith('audio')) return 'audio'
  return null
}

function validateConnection(nodes: AppNode[], edges: AppEdge[], connection: Connection): string | null {
  if (!connection.source || !connection.target || connection.source === connection.target) return null

  const sourceNode = nodes.find((n) => n.id === connection.source)
  const targetNode = nodes.find((n) => n.id === connection.target)

  const getNodeMimeType = (node: AppNode | undefined): string | undefined => {
    if (!node || node.type !== 'asset' || !isAssetConfig(node.data.config)) return undefined
    return node.data.config.mimeType
  }

  const sourceMime = getNodeMimeType(sourceNode)
  const sourceKind = getReferenceKind(sourceNode)

  if (targetNode?.type === 'video_stitch') {
    const isVideoSource = sourceNode?.type === 'video_gen'
      || sourceNode?.type === 'video_stitch'
      || (sourceNode?.type === 'asset' && !!sourceMime?.startsWith('video'))
    if (!isVideoSource) return '视频拼接节点只能连接 AI 视频、拼接视频或视频素材'
  }

  if (targetNode?.type === 'image_gen' && sourceMime && (sourceMime.startsWith('video') || sourceMime.startsWith('audio'))) {
    return '视频/音频素材不能连接到 AI 生图节点'
  }

  if (targetNode?.type === 'image_gen' && sourceKind === 'image') {
    const existingImageRefs = edges.filter((e) => {
      if (e.target !== connection.target) return false
      const src = nodes.find((n) => n.id === e.source)
      return getReferenceKind(src) === 'image'
    })
    const maxImages = getImageCategoryLimits(targetNode)[ACTIVE_IMAGE_CATEGORY]?.limits.image.max ?? 0
    if (existingImageRefs.length >= maxImages) {
      return `图生图最多连接 ${maxImages} 张参考图`
    }
  }

  if (connection.targetHandle === 'any-in' || !connection.targetHandle) {
    if (targetNode?.type === 'video_gen') {
      const mimeType = sourceMime
      const videoMode: VideoMode = isVideoGenConfig(targetNode.data.config)
        ? targetNode.data.config.videoMode
        : 'multiref'
      const categoryKey = videoMode === 'keyframe' ? 'frames' : 'multimodal'
      const categoryLimits = getVideoCategoryLimits(targetNode)[categoryKey] ?? DEFAULT_VIDEO_CATEGORY_LIMITS[categoryKey]
      const existingAnyIn = edges.filter((e) => e.target === connection.target && (!e.targetHandle || e.targetHandle === 'any-in'))
      const countByKind = (kind: 'image' | 'video' | 'audio') => existingAnyIn.filter((e) => {
        const src = nodes.find((n) => n.id === e.source)
        return getReferenceKind(src) === kind
      }).length

      if (videoMode === 'keyframe') {
        if (sourceNode?.type !== 'text_input') {
          if (mimeType && !mimeType.startsWith('image')) return '首尾帧模式只接受图片素材'
          if (countByKind('image') >= categoryLimits.limits.image.max) return `首尾帧最多连接 ${categoryLimits.limits.image.max} 张图片`
        }
      } else if (sourceKind) {
        if (countByKind(sourceKind) >= categoryLimits.limits[sourceKind].max) {
          const label = sourceKind === 'image' ? '参考图' : sourceKind === 'video' ? '参考视频' : '参考音频'
          const unit = sourceKind === 'image' ? '张' : '个'
          return `${label}最多 ${categoryLimits.limits[sourceKind].max} ${unit}`
        }
      }
    }
  }

  const simulatedEdges = addEdge(connection, edges) as AppEdge[]
  if (hasCycle(nodes, simulatedEdges)) {
    console.warn('[Canvas] 禁止产生循环依赖连线')
    return '禁止产生循环依赖连线'
  }

  return null
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
    const err = validateConnection(nodes, edges, connection)
    if (err) return err
    if (!connection.source || !connection.target || connection.source === connection.target) return null

    const simulatedEdges = addEdge(connection, edges) as AppEdge[]
    if (simulatedEdges === edges) return null

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

  addNodeAndConnect: (sourceNodeIds, type, position) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position)
    let nextEdges = edges
    const errors: string[] = []

    for (const sourceNodeId of sourceNodeIds) {
      const connection: Connection = {
        source: sourceNodeId,
        sourceHandle: null,
        target: newNode.id,
        targetHandle: type === 'video_stitch' ? 'video-in' : 'any-in',
      }
      const err = validateConnection([...nodes, newNode], nextEdges, connection)
      if (err) {
        errors.push(err)
        continue
      }
      if (!connection.source || !connection.target || connection.source === connection.target) continue
      const edge = createEdgeWithId(connection)
      if (hasCycle([...nodes, newNode], [...nextEdges, edge])) continue
      nextEdges = nextEdges.concat(edge)
    }

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode), edges: nextEdges })
    return errors
  },

  addNodesWithEdges: (newNodes, newEdges) => {
    const { nodes, edges } = get()
    let nextEdges = edges
    const allNodes = [...nodes, ...newNodes]
    const errors: string[] = []

    for (const edge of newEdges) {
      const connection: Connection = {
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      }
      const err = validateConnection(allNodes, nextEdges, connection)
      if (err) {
        errors.push(err)
        continue
      }
      if (!connection.source || !connection.target || connection.source === connection.target) continue
      const nextEdge = { ...edge, id: edge.id || `edge_${crypto.randomUUID()}` }
      if (hasCycle(allNodes, [...nextEdges, nextEdge])) continue
      nextEdges = nextEdges.concat(nextEdge)
    }

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: [...nodes, ...newNodes], edges: nextEdges })
    return errors
  },

  removeNodes: (nodeIds) => {
    const { nodes, edges } = get()
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      nodes: nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: edges.filter((e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)),
    })
  },

  removeEdgeById: (edgeId) => {
    const { nodes, edges } = get()
    if (!edges.some((edge) => edge.id === edgeId)) return
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ edges: edges.filter((edge) => edge.id !== edgeId) })
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
