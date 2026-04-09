import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { NodeExecutionState, NodeOutputAsset } from '@/lib/canvas/types'

// ---------------------------------------------------------
// 执行状态库：隔离存储节点的动态属性 (生成进度、产出结果、告警等)
// 绝对禁止在 `structure_data` JSONB 中存储
// ---------------------------------------------------------
export const DEFAULT_NODE_STATE: NodeExecutionState = {
  isGenerating: false,
  progress: 0,
  outputs: [],
  selectedOutputId: null,
  warningMessage: undefined,
  errorMessage: undefined,
}

interface CanvasExecutionState {
  nodes: Record<string, NodeExecutionState>
  activeVideoNodeId: string | null // 控制全局唯一视频播放（防卡顿）

  // --- API / Mutations ---
  initNodeState: (nodeId: string, state?: Partial<NodeExecutionState>) => void
  setNodeProgress: (nodeId: string, progress: number, isGenerating: boolean) => void
  addNodeOutput: (nodeId: string, output: NodeOutputAsset) => void
  selectNodeOutput: (nodeId: string, outputId: string) => void
  setNodeWarning: (nodeId: string, warning?: string) => void
  setNodeError: (nodeId: string, error?: string) => void
  setActiveVideo: (nodeId: string | null) => void

  // 轮询更新辅助函数：当从 /active-tasks 拉到批次状态时更新对应节点
  updateNodeFromBatch: (nodeId: string, batchInfo: any) => void

  // 清理不再存在的孤儿节点状态
  reconcileNodes: (activeNodeIds: string[]) => void
}

export const useCanvasExecutionStore = create<CanvasExecutionState>((set, get) => ({
  nodes: {},
  activeVideoNodeId: null,

  initNodeState: (nodeId, state) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: { ...DEFAULT_NODE_STATE, ...state },
      },
    }))
  },

  setNodeProgress: (nodeId, progress, isGenerating) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...(s.nodes[nodeId] || DEFAULT_NODE_STATE),
          progress,
          isGenerating,
          warningMessage: undefined, // 开始生成时清空告警
          errorMessage: undefined,
        },
      },
    }))
  },

  addNodeOutput: (nodeId, output) => {
    set((s) => {
      const nodeState = s.nodes[nodeId] || DEFAULT_NODE_STATE
      // Deduplicate by id to prevent duplicates on re-mount/re-poll
      if (nodeState.outputs.some((o) => o.id === output.id)) return {}
      return {
        nodes: {
          ...s.nodes,
          [nodeId]: {
            ...nodeState,
            outputs: [...nodeState.outputs, output],
            selectedOutputId: output.id,
          },
        },
      }
    })
  },

  selectNodeOutput: (nodeId, outputId) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...(s.nodes[nodeId] || DEFAULT_NODE_STATE),
          selectedOutputId: outputId,
        },
      },
    }))
  },

  setNodeWarning: (nodeId, warning) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...(s.nodes[nodeId] || DEFAULT_NODE_STATE),
          warningMessage: warning,
        },
      },
    }))
  },

  setNodeError: (nodeId, error) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...(s.nodes[nodeId] || DEFAULT_NODE_STATE),
          errorMessage: error,
          isGenerating: false, // 出错即停止
        },
      },
    }))
  },

  setActiveVideo: (nodeId) => {
    set({ activeVideoNodeId: nodeId })
  },

  updateNodeFromBatch: (nodeId, batchInfo) => {
    // 假设 batchInfo 中带有 status 和 completed_count
    // 这是一个为 useCanvasPoller 准备的回填钩子
    const isGenerating = ['pending', 'processing'].includes(batchInfo.status)
    const progress = batchInfo.quantity > 0 ? (batchInfo.completed_count / batchInfo.quantity) * 100 : 0

    get().setNodeProgress(nodeId, progress, isGenerating)

    if (batchInfo.status === 'failed') {
      get().setNodeError(nodeId, '生成失败，请重试')
    }
  },

  reconcileNodes: (activeNodeIds) => {
    // 处理轮询刚刚结束，批次列表变空的场景，把 `isGenerating=true` 但已不在活跃列表里的节点标记为完成
    set((s) => {
      let changed = false
      const newNodes = { ...s.nodes }

      Object.keys(newNodes).forEach((id) => {
        if (newNodes[id].isGenerating && !activeNodeIds.includes(id)) {
          // 任务已完成，停止 Spinner
          newNodes[id] = { ...newNodes[id], isGenerating: false, progress: 100 }
          changed = true
          // TODO: 这里未来会派发事件，通知该节点去懒加载获取最新的历史 output 记录
        }
      })

      return changed ? { nodes: newNodes } : {}
    })
  },
}))

// ---
// 防爆神器：专门暴露一个只供单个 Node 组件订阅的自定义 Hook
// 组件层面禁止直接 `const execution = useCanvasExecutionStore()`
// ---
export function useNodeExecutionState(nodeId: string) {
  return useCanvasExecutionStore(
    useShallow((state) => state.nodes[nodeId] || DEFAULT_NODE_STATE)
  )
}
