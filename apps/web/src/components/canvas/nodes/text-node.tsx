'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState } from '@/stores/canvas/execution-store'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

export const TextNode = memo(function TextNode({ id, data }: { id: string; data: CanvasNodeData<{ text: string }> }) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating } = useNodeExecutionState(id)
  const isUpstream = !!(data as any).isUpstream

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-shadow duration-150',
        'bg-white',
        'border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        isGenerating && 'ring-1 ring-blue-400 shadow-blue-200',
        isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
        '[contain:layout_style] [will-change:transform]',
        '[-webkit-font-smoothing:antialiased]',
      )}
      style={{ width: 240 }}
    >
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-white text-zinc-400 hover:text-red-500 border-zinc-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      {/* Header */}
      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-zinc-50">
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
      </div>

      {/* Body */}
      <div className="p-2 flex-1">
        <textarea
          className="w-full h-20 p-2 text-xs bg-zinc-50 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-400/50 placeholder:text-zinc-400 text-zinc-700"
          placeholder="输入提示词内容..."
          value={data.config?.text ?? ''}
          onChange={(e) => updateNodeData(id, { config: { ...data.config, text: e.target.value } })}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>

      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="any-in"
        className="!w-2 !h-2 !bg-zinc-300 !border !border-zinc-400 !-left-1 hover:!bg-blue-400 transition-colors"
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="text-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
})
TextNode.displayName = 'TextNode'
