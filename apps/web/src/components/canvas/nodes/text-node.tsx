'use client'

import { memo, useState, useEffect, useRef } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

export const TextNode = memo(function TextNode({ id, data }: { id: string; data: CanvasNodeData<{ text: string }> }) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating } = useNodeExecutionState(id)
  const isUpstream = useNodeHighlighted(id)

  // Upstream text nodes connected via any-in
  const upstreamTextLabels = useCanvasStructureStore(
    useShallow((s) => {
      const textEdges = s.edges.filter((e) => e.target === id)
      return textEdges
        .map((e) => s.nodes.find((n) => n.id === e.source))
        .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'text_input')
        .map((n) => n.data.label ?? '文本')
    })
  )

  // Local state for textarea — debounce writes to store to avoid per-keystroke node array rebuilds
  const [localText, setLocalText] = useState(data.config?.text ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Sync if store value changes externally (e.g. paste from Ctrl+V node copy)
  useEffect(() => {
    setLocalText(data.config?.text ?? '')
  }, [data.config?.text])

  function writeText(val: string) {
    updateNodeData(id, { config: { ...data.config, text: val } })
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setLocalText(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      writeText(val)
    }, 300)
  }

  function handleBlur() {
    clearTimeout(debounceRef.current)
    writeText(localText)
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-shadow duration-150',
        'bg-card',
        'border-border hover:border-border/80 hover:shadow-lg',
        isGenerating && 'ring-1 ring-blue-400 shadow-blue-200',
        isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
        '[contain:layout_style] [will-change:transform]',
        '[-webkit-font-smoothing:antialiased]',
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

      <div className="px-3 py-1.5 border-b border-border rounded-t-xl bg-muted">
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
      </div>

      <div className="p-2 flex-1">
        {upstreamTextLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {upstreamTextLabels.map((label, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                [{label}]+
              </span>
            ))}
          </div>
        )}
        <textarea
          className="w-full h-20 p-2 text-xs bg-muted rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-400/50 placeholder:text-muted-foreground text-foreground"
          placeholder="输入提示词内容..."
          value={localText}
          onChange={handleChange}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>

      <Handle type="target" position={Position.Left} id="any-in"
        className="!w-2 !h-2 !bg-border !border !border-border/80 !-left-1 hover:!bg-blue-400 transition-colors" />
      <Handle type="source" position={Position.Right} id="text-out"
        className="!w-3.5 !h-3.5 !bg-border !border !border-border/80 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-muted-foreground hover:!border-muted-foreground transition-all" />
    </div>
  )
})
TextNode.displayName = 'TextNode'
