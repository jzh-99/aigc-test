'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { X, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData } from '@/lib/canvas/types'
import type { ScriptWriterConfig } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

export const ScriptWriterNode = memo(function ScriptWriterNode({
  id,
  data,
}: {
  id: string
  data: CanvasNodeData<ScriptWriterConfig>
}) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating, submissionStatus, outputs } = useNodeExecutionState(id)
  const isUpstream = useNodeHighlighted(id)

  const script = (outputs[0]?.paramsSnapshot as { script?: string } | undefined)?.script ?? ''
  const preview = script ? script.slice(0, 80) + (script.length > 80 ? '…' : '') : ''
  const isDone = submissionStatus === 'completed'

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-shadow duration-150',
        'bg-white',
        'border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        isGenerating && 'ring-1 ring-amber-400 shadow-amber-100',
        isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
        '[contain:layout_style] [will-change:transform]',
      )}
      style={{ width: 240 }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-white text-zinc-400 hover:text-red-500 border-zinc-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-amber-50 flex items-center gap-1.5">
        <FileText size={12} className="text-amber-500 shrink-0" />
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
      </div>

      <div className="p-2.5 flex-1 min-h-[60px] flex flex-col justify-center">
        {isGenerating && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500">
            <Loader2 size={12} className="animate-spin" />
            <span>生成剧本中…</span>
          </div>
        )}
        {!isGenerating && isDone && preview && (
          <p className="text-[11px] text-zinc-600 leading-relaxed line-clamp-3">{preview}</p>
        )}
        {!isGenerating && !isDone && (
          <p className="text-[11px] text-zinc-400">
            {data.config?.description ? `"${data.config.description.slice(0, 40)}…"` : '点击节点填写描述并执行'}
          </p>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="text-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all" />
    </div>
  )
})
ScriptWriterNode.displayName = 'ScriptWriterNode'
