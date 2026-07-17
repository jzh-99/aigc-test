'use client'

import { memo, useState, useEffect, useRef } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { useShallow } from 'zustand/react/shallow'
import { Type, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCanvasNodeTheme } from '@/lib/canvas/node-theme'
import type { CanvasNodeData, TextInputConfig } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'
import { NodeHandle } from './node-handle'

export const TextNode = memo(function TextNode({ id, data }: { id: string; data: CanvasNodeData<TextInputConfig> }) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating, progress } = useNodeExecutionState(id)
  const isUpstream = useNodeHighlighted(id)
  const theme = getCanvasNodeTheme('text_input')

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

      <div className={cn('flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border rounded-t-xl', theme.headerClassName)}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-current/10', theme.iconClassName)}>
            <Type size={12} />
          </span>
          <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
        </div>
        {isGenerating && (
          <div className="flex shrink-0 items-center gap-1 text-blue-500">
            <span className="font-mono text-[10px]">{Math.round(progress)}%</span>
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        )}
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
          className="nodrag nowheel w-full h-20 p-2 text-xs bg-muted rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-400/50 placeholder:text-muted-foreground text-foreground select-text"
          placeholder="输入提示词内容..."
          value={localText}
          onChange={handleChange}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>

      <NodeHandle type="target" position={Position.Left} id="any-in" nodeId={id} />
      <NodeHandle type="source" position={Position.Right} id="text-out" nodeId={id} showOnGroupHover />
    </div>
  )
})
TextNode.displayName = 'TextNode'
