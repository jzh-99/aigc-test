'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { CanvasApiError, submitStoryboardSplitterJob } from '@/lib/canvas/canvas-api'
import type { StoryboardSplitterConfig, AppNode, AppEdge, ShotItem } from '@/lib/canvas/types'
import { DEFAULT_TEXT_CATEGORY_LIMITS, isTextInputConfig, normalizeStoryboardShots } from '@/lib/canvas/types'

interface Props {
  nodeId: string
  canvasId: string
  config: StoryboardSplitterConfig
  onExecuted: () => void
  onExpanded?: (shotNodeIds: string[]) => void
}

export function StoryboardSplitterPanel({ nodeId, canvasId, config, onExecuted, onExpanded }: Props) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const setNodeStatus = useCanvasExecutionStore((s) => s.setNodeStatus)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const execState = useCanvasExecutionStore((s) => s.nodes[nodeId])
  const token = useAuthStore((s) => s.accessToken)

  const [executing, setExecuting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 从执行状态中读取原始分镜数据，类型适配 ShotItem
  const rawShots = normalizeStoryboardShots((execState?.outputs[0]?.paramsSnapshot as { shots?: unknown } | undefined)?.shots)
  const [editedShots, setEditedShots] = useState<ShotItem[]>([])
  const isDone = execState?.submissionStatus === 'completed' && rawShots.length > 0

  // 优先展示用户编辑后的草稿，否则展示原始数据
  const shotsToShow: ShotItem[] = editedShots.length > 0 ? editedShots : rawShots

  const updateCfg = useCallback((patch: Partial<StoryboardSplitterConfig>) => {
    updateNodeData(nodeId, { config: { ...config, ...patch } })
  }, [nodeId, config, updateNodeData])

  // 基于 shotNumber 定位并更新 sceneDescription
  const updateShot = (shotNumber: number, sceneDescription: string) => {
    const base = editedShots.length > 0 ? editedShots : rawShots
    setEditedShots(base.map((s) => s.shotNumber === shotNumber ? { ...s, sceneDescription } : s))
  }

  // 收集上游剧本文本
  const getUpstreamScript = useCallback((): string => {
    const { nodes, edges } = useCanvasStructureStore.getState()
    const execStore = useCanvasExecutionStore.getState()
    const upstreamEdges = edges.filter((e) => e.target === nodeId)
    const parts: string[] = []
    for (const edge of upstreamEdges) {
      const src = nodes.find((n) => n.id === edge.source)
      if (!src) continue
      if (src.type === 'script_writer') {
        const out = execStore.nodes[src.id]?.outputs[0]
        const script = (out?.paramsSnapshot as { script?: string } | undefined)?.script
        if (script) parts.push(script)
      } else if (src.type === 'text_input' && isTextInputConfig(src.data.config)) {
        if (src.data.config.text) parts.push(src.data.config.text)
      }
    }
    return parts.join('\n')
  }, [nodeId])

  const handleExecute = useCallback(async () => {
    const { nodes, edges } = useCanvasStructureStore.getState()
    const upstreamEdges = edges.filter((e) => e.target === nodeId)
    if (upstreamEdges.length === 0) {
      toast.error('请先连接剧本节点或文本节点')
      return
    }
    const script = getUpstreamScript()
    if (!script.trim()) {
      // 有连接但内容为空：可能是 script_writer 未执行，或 text_input 内容为空
      const hasScriptWriter = upstreamEdges.some((e) => {
        const src = nodes.find((n) => n.id === e.source)
        return src?.type === 'script_writer'
      })
      toast.error(hasScriptWriter ? '请先执行剧本生成节点，再拆分分镜' : '请先在文本节点中输入内容')
      return
    }
    setExecuting(true)
    setEditedShots([])
    setExpanded(false)
    setNodeStatus(nodeId, 'pending', { progress: 0 })
    try {
      // 提交到队列，结果由 poller 轮询写入 outputs，不在此等待
      await submitStoryboardSplitterJob(
        { script, shotCount: config.shotCount, canvasId, canvasNodeId: nodeId },
        token ?? undefined,
      )
      toast.success('分镜拆分任务已提交，正在处理中…')
      onExecuted()
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行失败'
      const code = err instanceof CanvasApiError ? err.code : undefined
      toast.error(message)
      setNodeError(nodeId, message, code)
      setNodeStatus(nodeId, 'idle', { progress: 0 })
    } finally {
      setExecuting(false)
    }
  }, [config.shotCount, nodeId, canvasId, token, getUpstreamScript, setNodeStatus, setNodeError, onExecuted])

  // 将分镜草稿展开为画布节点，使用 compositionPrompt 作为节点内容
  const handleExpandToCanvas = useCallback(() => {
    const shots = shotsToShow
    if (shots.length === 0) return

    const currentNode = useCanvasStructureStore.getState().nodes.find((n) => n.id === nodeId)
    const baseX = (currentNode?.position.x ?? 100) + 350
    const baseY = currentNode?.position.y ?? 100

    const newNodes: AppNode[] = shots.map((shot, i) => ({
      id: `shot_${nodeId}_${i}`,
      type: 'text_input' as const,
      position: { x: baseX, y: baseY + i * 220 },
      data: { label: `镜头${shot.shotNumber}`, config: { text: shot.compositionPrompt, model: 'qwen3.6-plus', categoryReferences: DEFAULT_TEXT_CATEGORY_LIMITS } },
    }))
    const newEdges: AppEdge[] = newNodes.map((n) => ({
      id: `edge_${nodeId}_${n.id}`,
      source: nodeId,
      target: n.id,
      sourceHandle: 'text-out',
      targetHandle: 'any-in',
    }))

    useCanvasStructureStore.getState().applyAgentWorkflow({
      strategy: 'append',
      summary: `展开 ${shots.length} 个分镜节点`,
      reusedNodeIds: [],
      newNodes,
      newEdges,
      steps: [],
    })

    setExpanded(true)
    toast.success(`已展开 ${shots.length} 个分镜节点`)
    onExpanded?.(newNodes.map((n) => n.id))
  }, [nodeId, shotsToShow, onExpanded])

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[11px] font-medium text-muted-foreground block mb-1">分镜数量（0=自动）</label>
          <input
            type="number"
            min={0}
            max={50}
            value={config.shotCount}
            onChange={(e) => updateCfg({ shotCount: Number(e.target.value) })}
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
          />
        </div>
      </div>

      <button
        onClick={handleExecute}
        disabled={executing}
        className="w-full text-xs bg-primary text-primary-foreground rounded-lg py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {executing && <Loader2 size={11} className="animate-spin" />}
        {executing ? '拆分中…' : isDone ? '重新拆分' : '拆分分镜'}
      </button>
      {/* {isDone && shotsToShow.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[11px] font-medium text-muted-foreground">
            {shotsToShow.length} 个分镜草稿，可直接编辑后展开：
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {shotsToShow.map((shot) => (
              <div key={shot.shotNumber} className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {`镜头${shot.shotNumber} · ${shot.duration}s · ${shot.shotType}`}
                </span>
                <textarea
                  value={shot.sceneDescription}
                  onChange={(e) => updateShot(shot.shotNumber, e.target.value)}
                  rows={3}
                  className="w-full text-[11px] bg-background border border-border rounded px-2 py-1.5 resize-y outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleExpandToCanvas}
            disabled={expanded}
            className="w-full text-xs bg-violet-600 text-white rounded-lg py-1.5 hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {expanded ? '已展开到画布 ✓' : `确认展开 ${shotsToShow.length} 个分镜节点 →`}
          </button>
        </div>
      )} */}
    </div>
  )
}
