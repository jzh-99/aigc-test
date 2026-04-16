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
import type { AppNode, AppEdge, CanvasNodeConfig, VideoMode } from '@/lib/canvas/types'
import type { AgentWorkflow } from '@/lib/canvas/agent-types'
import { isAssetConfig, isVideoGenConfig } from '@/lib/canvas/types'
import { hasCycle } from '@/lib/canvas/dag'
import { nodeRegistry } from '@/lib/canvas/registry'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Deep equality check for undo history — prevents recording no-op changes
// and works with the throttle to batch rapid mutations (e.g. dragging)
function deepEqual(a: unknown, b: unknown): boolean {
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

  if (isRecord(a) && isRecord(b)) {
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
  flushHistory: () => void

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => string | null  // returns error message or null

  addNode: (type: string, position: { x: number; y: number }) => void
  addNodeWithConfig: (type: string, position: { x: number; y: number }, config: Record<string, unknown>, id?: string) => void
  removeNodes: (nodeIds: string[]) => void
  removeEdgesByTarget: (nodeId: string, handleIds: string[]) => void
  updateNodeData: (nodeId: string, partialData: Partial<AppNode['data']>) => void
  applyAgentWorkflow: (workflow: AgentWorkflow) => void
}

let historyCommitTimer: ReturnType<typeof setTimeout> | undefined
let pendingHistoryCommit: (() => void) | null = null
// When true, the next handleSet call bypasses throttle and commits immediately.
// Set before discrete operations (add/remove/connect/update) to ensure each
// gets its own undo snapshot instead of being merged into a drag throttle window.
let immediateNext = false

export const useCanvasStructureStore = create<CanvasStructureState>()(
  temporal(
    (set, get) => ({
  canvasId: null,
  workspaceId: null,
  nodes: [],
  edges: [],
  localVersion: 1,

  initCanvas: (canvasId, nodes, edges, version, workspaceId) => {
    // Cancel any pending throttled history commit from the previous canvas
    clearTimeout(historyCommitTimer)
    pendingHistoryCommit = null
    immediateNext = false
    // Clear history BEFORE set() so the load itself is never recorded
    useCanvasStructureStore.temporal.getState().clear()
    set({ canvasId, nodes, edges, localVersion: version, workspaceId: workspaceId ?? null })
    // Clear again in case set() triggered handleSet and snuck a snapshot in
    useCanvasStructureStore.temporal.getState().clear()
  },

  setLocalVersion: (version) => {
    set({ localVersion: version })
  },

  flushHistory: () => {
    if (!pendingHistoryCommit) return
    clearTimeout(historyCommitTimer)
    const commit = pendingHistoryCommit
    pendingHistoryCommit = null
    commit()
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
    if (connection.source === connection.target) return null

    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    const getNodeMimeType = (node: AppNode | undefined): string | undefined => {
      if (!node || node.type !== 'asset' || !isAssetConfig(node.data.config)) return undefined
      return node.data.config.mimeType
    }

    const sourceMime = getNodeMimeType(sourceNode)

    // Block video/audio assets from connecting to image_gen
    if (targetNode?.type === 'image_gen' && sourceMime && (sourceMime.startsWith('video') || sourceMime.startsWith('audio'))) {
      return '视频/音频素材不能连接到 AI 生图节点'
    }

    // Enforce connection limits for video_gen any-in handle
    if (connection.targetHandle === 'any-in' || !connection.targetHandle) {
      if (targetNode?.type === 'video_gen') {
        const mimeType = sourceMime
        const videoMode: VideoMode = isVideoGenConfig(targetNode.data.config)
          ? targetNode.data.config.videoMode
          : 'multiref'
        const existingAnyIn = edges.filter((e) => e.target === connection.target && (!e.targetHandle || e.targetHandle === 'any-in'))

        if (videoMode === 'keyframe') {
          // keyframe: max 2 images, unlimited text
          if (sourceNode?.type !== 'text_input') {
            const existingImages = existingAnyIn.filter((e) => {
              const src = nodes.find((n) => n.id === e.source)
              return src?.type !== 'text_input'
            }).length
            if (existingImages >= 2) return '首尾帧最多连接 2 张图片'
            // only images allowed in keyframe mode
            if (mimeType && !mimeType.startsWith('image')) return '首尾帧模式只接受图片素材'
          }
        } else {
          // multiref: max 9 images, 3 videos, 3 audios
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

    immediateNext = true
    set({ edges: simulatedEdges })
    return null
  },

  addNode: (type, position) => {
    immediateNext = true
    const newNode = nodeRegistry.createNodeInstance(type, position)
    set((state) => ({ nodes: state.nodes.concat(newNode) }))
  },

  addNodeWithConfig: (type, position, config, id) => {
    immediateNext = true
    const newNode = nodeRegistry.createNodeInstance(type, position, id)
    newNode.data.config = {
      ...newNode.data.config,
      ...config,
    } as CanvasNodeConfig
    set((state) => ({ nodes: state.nodes.concat(newNode) }))
  },

  removeNodes: (nodeIds) => {
    immediateNext = true
    set((state) => ({
      nodes: state.nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: state.edges.filter(
        (e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)
      ),
    }))
  },

  removeEdgesByTarget: (nodeId, handleIds) => {
    immediateNext = true
    set((state) => ({
      edges: state.edges.filter(
        (e) => !(e.target === nodeId && e.targetHandle && handleIds.includes(e.targetHandle))
      ),
    }))
  },

  updateNodeData: (nodeId, partialData) => {
    immediateNext = true
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

  applyAgentWorkflow: (workflow) => {
    // Always append — never wipe existing nodes regardless of LLM strategy field.
    // The LLM sometimes sends "create" even when the canvas has content.
    immediateNext = true
    set((s) => ({
      nodes: [...s.nodes, ...workflow.newNodes],
      edges: [...s.edges, ...workflow.newEdges],
    }))
  },
}),
    {
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
      limit: 50,
      // Throttle history snapshots so rapid changes (dragging, etc.) merge into one entry.
      // Discrete operations (add/remove/connect/update) set immediateNext=true to bypass
      // throttle and get their own snapshot — preventing undo from skipping steps.
      handleSet: (handleSetCb) => {
        return (state: Parameters<typeof handleSetCb>[0]) => {
          if (immediateNext) {
            immediateNext = false
            // Flush any pending drag snapshot first so it lands before this discrete op
            if (pendingHistoryCommit) {
              clearTimeout(historyCommitTimer)
              const prev = pendingHistoryCommit
              pendingHistoryCommit = null
              prev()
            }
            handleSetCb(state)
            return
          }
          clearTimeout(historyCommitTimer)
          pendingHistoryCommit = () => {
            pendingHistoryCommit = null
            handleSetCb(state)
          }
          historyCommitTimer = setTimeout(() => {
            const commit = pendingHistoryCommit
            pendingHistoryCommit = null
            commit?.()
          }, 500)
        }
      },
      // Skip recording if nothing actually changed
      equality: (pastState, currentState) =>
        deepEqual(pastState, currentState),
    },
  )
)
