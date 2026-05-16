'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { X, Clapperboard, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData, StoryboardSplitterConfig } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

export const StoryboardSplitterNode = memo(function StoryboardSplitterNode({
  id,
  data,
}: {
  id: string
  data: CanvasNodeData<StoryboardSplitterConfig>
}) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating, submissionStatus, outputs } = useNodeExecutionState(id)
  const isUpstream = useNodeHighlighted(id)

  const shots = (outputs[0]?.paramsSnapshot as { shots?: Array<{ label: string }> } | undefined)?.shots ?? []
  const isDone = submissionStatus === 'completed'

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-shadow duration-150',
        'bg-card',
        'border-border hover:border-border/60 hover:shadow-lg',
        isGenerating && 'ring-1 ring-violet-400 shadow-violet-100',
        isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
        '[contain:layout_style] [will-change:transform]',
      )}
      style={{ width: 240 }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-card text-muted-foreground hover:text-red-500 border-border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      <div className="px-3 py-1.5 border-b border-border rounded-t-xl bg-violet-50 dark:bg-violet-950/30 flex items-center gap-1.5">
        <Clapperboard size={12} className="text-violet-500 shrink-0" />
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
      </div>

      <div className="p-2.5 flex-1 min-h-[60px] flex flex-col justify-center">
        {isGenerating && (
          <div className="flex items-center gap-1.5 text-xs text-violet-500">
            <Loader2 size={12} className="animate-spin" />
            <span>拆分分镜中…</span>
          </div>
        )}
        {!isGenerating && isDone && shots.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-violet-600">
            <CheckCircle2 size={12} />
            <span>{shots.length} 个分镜已就绪，点击面板确认展开</span>
          </div>
        )}
        {!isGenerating && !isDone && (
          <p className="text-[11px] text-muted-foreground">
            连接剧本节点后执行，自动拆分为分镜节点
          </p>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="any-in"
        className="!w-2 !h-2 !bg-border !border !border-border/80 !-left-1 hover:!bg-violet-400 transition-colors" />
      <Handle type="source" position={Position.Right} id="text-out"
        className="!w-2 !h-2 !bg-border !border !border-border/80 !-right-1 hover:!bg-violet-400 transition-colors" />
    </div>
  )
})
StoryboardSplitterNode.displayName = 'StoryboardSplitterNode'
