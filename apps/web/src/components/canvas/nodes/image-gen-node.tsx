'use client'

import { useState, useEffect, memo } from 'react'
import { Handle, Position } from 'reactflow'
import { useNodeExecutionState, useCanvasExecutionStore, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { selectNodeOutputForCanvas } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'
import type { CanvasNodeData } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

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

export const ImageGenNode = memo(function ImageGenNode({ id, data }: { id: string; data: CanvasNodeData<any> }) {
  const execState = useNodeExecutionState(id)
  const selectNodeOutput = useCanvasExecutionStore((s) => s.selectNodeOutput)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const canvasId = useCanvasStructureStore((s) => s.canvasId)
  // Count incoming edges to show ref count badge
  const incomingCount = useCanvasStructureStore(
    useShallow((s) => s.edges.filter((e) => e.target === id).length)
  )
  const token = useAuthStore((s) => s.accessToken)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const { isGenerating, progress, errorMessage, warningMessage, outputs, selectedOutputId, startedAt } = execState
  const isUpstream = useNodeHighlighted(id)
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

  async function handleConfirmSelect(e: React.MouseEvent) {
    e.stopPropagation()
    if (!canvasId || !token || !selectedOutputId) return
    setConfirming(true)
    try {
      await selectNodeOutputForCanvas(canvasId, id, selectedOutputId, token)
      toast.success('已设为定稿图')
    } catch (err: any) {
      toast.error(err?.message ?? '设为定稿失败')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-all duration-200',
        'bg-white',
        isGenerating
          ? 'border-blue-400 shadow-blue-200 ring-1 ring-blue-400'
          : isUpstream
          ? 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100'
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
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
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
        <div className="bg-red-50 text-red-500 text-[11px] px-3 py-1.5 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <span className="text-[10px] text-red-400 shrink-0 underline underline-offset-2 cursor-pointer">点击重试</span>
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
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-zinc-400">
              {currentIndex + 1} / {outputs.length}
            </span>
            <button
              onClick={handleConfirmSelect}
              disabled={!token || !canvasId || !selectedOutputId || confirming}
              className="px-1.5 py-0.5 text-[10px] rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 flex items-center gap-1"
            >
              {confirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              设为定稿
            </button>
          </div>
          <button
            onClick={handleNext}
            disabled={currentIndex >= outputs.length - 1}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 p-0.5 rounded transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Single input handle — ref count badge shown when connected */}
      {incomingCount > 0 && (
        <div
          className="absolute flex items-center pointer-events-none"
          style={{ top: '50%', left: 0, transform: 'translate(-100%, -50%)' }}
        >
          <span className="text-[9px] font-medium text-zinc-500 bg-white border border-zinc-200 rounded px-1 py-0.5 mr-1 shadow-sm whitespace-nowrap">
            参×{incomingCount}
          </span>
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="any-in"
        style={{ top: '50%' }}
        className="!w-2.5 !h-2.5 !bg-zinc-300 !border !border-zinc-400 hover:!bg-blue-400 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
})
ImageGenNode.displayName = 'ImageGenNode'
