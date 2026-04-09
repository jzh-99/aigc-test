'use client'

import { useState, useEffect } from 'react'
import { Handle, Position } from 'reactflow'
import { useNodeExecutionState, useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData } from '@/lib/canvas/types'

function nodeWidthFromRatio(w: number, h: number): number {
  const ratio = w / h
  return Math.min(400, Math.max(180, Math.round(220 * ratio)))
}

function useElapsedTimer(startedAt: number | null): string {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!startedAt) return ''
  return `${elapsed}s`
}

export function ImageGenNode({ id, data }: { id: string; data: CanvasNodeData<any> }) {
  const execState = useNodeExecutionState(id)
  const selectNodeOutput = useCanvasExecutionStore((s) => s.selectNodeOutput)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  const { isGenerating, progress, errorMessage, warningMessage, outputs, selectedOutputId, startedAt } = execState
  const selectedOutput = outputs.find((o) => o.id === selectedOutputId)
  const currentImageUrl = selectedOutput?.url
  const currentIndex = outputs.findIndex((o) => o.id === selectedOutputId)
  const elapsed = useElapsedTimer(isGenerating ? startedAt : null)

  function handlePrev(e: React.MouseEvent) {
    e.stopPropagation()
    if (currentIndex > 0) selectNodeOutput(id, outputs[currentIndex - 1].id)
  }
  function handleNext(e: React.MouseEvent) {
    e.stopPropagation()
    if (currentIndex < outputs.length - 1) selectNodeOutput(id, outputs[currentIndex + 1].id)
  }

  const nodeWidth = imgSize ? nodeWidthFromRatio(imgSize.w, imgSize.h) : 260

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-all duration-200',
        'bg-white',
        isGenerating
          ? 'border-blue-400 shadow-blue-200 ring-1 ring-blue-400'
          : 'border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
        '[contain:layout_style] [will-change:transform]',
        '[-webkit-font-smoothing:antialiased]',
      )}
      style={{ width: nodeWidth }}
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
      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-zinc-50 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {data.label}
        </span>
        {isGenerating && (
          <div className="flex items-center gap-1">
            {elapsed && <span className="font-mono text-[10px] text-blue-400">⏱ {elapsed}</span>}
            <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" />
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="p-2 bg-white">
        {currentImageUrl ? (
          <img
            src={currentImageUrl}
            alt="Generated"
            className="w-full h-auto rounded-lg block [transform:translateZ(0)] [backface-visibility:hidden]"
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget
              setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
            }}
          />
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-2 text-zinc-400 rounded-lg bg-zinc-50"
            style={{ aspectRatio: '4/3' }}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-mono text-[10px] tracking-widest uppercase">
                  {Math.round(progress)}<span className="text-zinc-300 ml-0.5">%</span>
                </span>
              </>
            ) : (
              <span className="text-[11px]">点击节点展开参数</span>
            )}
          </div>
        )}
      </div>

      {warningMessage && (
        <div className="bg-yellow-50 text-yellow-600 text-[11px] px-3 py-1 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />{warningMessage}
        </div>
      )}
      {errorMessage && (
        <div className="bg-red-50 text-red-500 text-[11px] px-3 py-1 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />{errorMessage}
        </div>
      )}

      {/* History pager */}
      {outputs.length > 1 && (
        <div className="border-t border-zinc-100 px-3 py-1 flex items-center justify-between bg-zinc-50 rounded-b-xl">
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 0}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 p-0.5 rounded transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[10px] text-zinc-400">
            {currentIndex + 1} / {outputs.length}
          </span>
          <button
            onClick={handleNext}
            disabled={currentIndex >= outputs.length - 1}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 p-0.5 rounded transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="any-in"
        className="!w-2 !h-2 !bg-zinc-300 !border !border-zinc-400 !-left-1 hover:!bg-blue-400 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
}
