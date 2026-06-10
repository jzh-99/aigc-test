'use client'

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { X, Clapperboard, Loader2, CheckCircle2, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCanvasNodeTheme } from '@/lib/canvas/node-theme'
import type { CanvasNodeData, StoryboardSplitterConfig } from '@/lib/canvas/types'
import { normalizeStoryboardShots } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'
import { StoryboardTableDialog } from './storyboard-table-dialog'

const PREVIEW_SHOT_COUNT = 3

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
  const [tableOpen, setTableOpen] = useState(false)

  const shots = normalizeStoryboardShots((outputs[0]?.paramsSnapshot as { shots?: unknown } | undefined)?.shots)
  const isDone = submissionStatus === 'completed'
  const previewShots = shots.slice(0, PREVIEW_SHOT_COUNT)
  const remaining = shots.length - previewShots.length
  const theme = getCanvasNodeTheme('storyboard_splitter')

  return (
    <>
      <div
        className={cn(
          'group relative flex flex-col rounded-xl border shadow-md transition-shadow duration-150',
          'border-border bg-card hover:border-border/60 hover:shadow-lg',
          isGenerating && 'ring-1 ring-violet-400/80',
          isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300',
          '[transform:translateZ(0)] [backface-visibility:hidden]',
          '[contain:layout_style] [will-change:transform]',
        )}
        style={{ width: 280 }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
          className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-card text-muted-foreground hover:text-red-500 border-border"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={11} />
        </button>

        <div className={cn('flex items-center gap-1.5 rounded-t-xl border-b border-border px-3 py-1.5', theme.headerClassName)}>
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-current/10', theme.iconClassName)}>
            <Clapperboard size={12} />
          </span>
          <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
          {isDone && shots.length > 0 && (
            <span className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm">
              {shots.length} 镜头
            </span>
          )}
          {isDone && shots.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setTableOpen(true) }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
              title="全屏查看分镜表"
            >
              <Maximize2 size={11} />
            </button>
          )}
        </div>

        <div className="flex min-h-[74px] flex-1 flex-col justify-center p-2.5">
          {isGenerating && (
            <div className="flex items-center gap-1.5 text-xs text-violet-500">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span>拆分分镜中…</span>
            </div>
          )}

          {!isGenerating && isDone && shots.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <CheckCircle2 size={11} className="shrink-0 text-violet-500" />
                <span className="text-[10px] font-medium text-violet-500">
                  {shots.length} 个分镜已就绪
                </span>
              </div>
              <div className="space-y-1">
                {previewShots.map((shot) => (
                  <div
                    key={shot.shotNumber}
                    className="grid grid-cols-[34px_28px_34px_minmax(0,1fr)] items-center gap-1.5 text-[10px] leading-relaxed"
                  >
                    <span className="font-medium text-violet-500">
                      镜头{shot.shotNumber}
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">{shot.duration}s</span>
                    <span className="truncate rounded bg-violet-500/10 px-1 py-0.5 text-center text-[9px] font-medium text-violet-500">
                      {shot.shotType.slice(0, 2)}
                    </span>
                    <span className="truncate text-foreground/70">{shot.sceneDescription}</span>
                  </div>
                ))}
              </div>
              {remaining > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setTableOpen(true) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-[10px] text-violet-500 transition-colors hover:text-violet-400 hover:underline"
                >
                  +{remaining} 个镜头，点击全屏查看
                </button>
              )}
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

      <StoryboardTableDialog
        open={tableOpen}
        onOpenChange={setTableOpen}
        shots={shots}
        title={data.label}
      />
    </>
  )
})
StoryboardSplitterNode.displayName = 'StoryboardSplitterNode'
