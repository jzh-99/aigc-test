'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Music, Pause, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCanvasNodeTheme } from '@/lib/canvas/node-theme'
import type { AudioGenConfig, CanvasNodeData } from '@/lib/canvas/types'
import { useCanvasExecutionStore, useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { InlineLabel } from './inline-label'
import { useNodeUpload } from '@/hooks/canvas/use-node-upload'

function useElapsedTimer(startedAt: number | null): string {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt ? `${elapsed}s` : ''
}

export const AudioGenNode = memo(function AudioGenNode({ id, data }: { id: string; data: CanvasNodeData<AudioGenConfig> }) {
  const execState = useNodeExecutionState(id)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const canvasId = useCanvasStructureStore((s) => s.canvasId)
  const selectNodeOutput = useCanvasExecutionStore((s) => s.selectNodeOutput)
  const isUpstream = useNodeHighlighted(id)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { inputRef, uploading: nodeUploading, triggerUpload, handleChange } = useNodeUpload(id, canvasId ?? '', 'audio/*')

  const { isGenerating, progress, errorMessage, warningMessage, outputs, selectedOutputId, startedAt, submissionStatus } = execState
  const currentIndex = outputs.findIndex((o) => o.id === selectedOutputId)
  const selectedOutput = outputs.find((o) => o.id === selectedOutputId)
  const currentUrl = selectedOutput?.url
  const elapsed = useElapsedTimer(isGenerating ? startedAt : null)
  const theme = getCanvasNodeTheme('audio_gen')
  const isFailed = submissionStatus === 'failed'

  useEffect(() => setPlaying(false), [selectedOutputId])

  function handlePrev(event: React.MouseEvent) {
    event.stopPropagation()
    if (currentIndex > 0) selectNodeOutput(id, outputs[currentIndex - 1].id)
  }

  function handleNext(event: React.MouseEvent) {
    event.stopPropagation()
    if (currentIndex < outputs.length - 1) selectNodeOutput(id, outputs[currentIndex + 1].id)
  }

  function togglePlay(event: React.MouseEvent) {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play()
      setPlaying(true)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex w-[240px] flex-col rounded-xl border bg-card shadow-md transition-all duration-200',
        isGenerating
          ? 'border-emerald-400 shadow-emerald-200 ring-1 ring-emerald-400'
          : isFailed
          ? 'border-red-400 shadow-red-100 ring-1 ring-red-300'
          : isUpstream
          ? 'border-violet-400 shadow-violet-100 ring-1 ring-violet-300'
          : 'border-border hover:border-border/60 hover:shadow-lg',
        '[contain:layout_style] [transform:translateZ(0)]',
      )}
    >
      <button
        onClick={(event) => { event.stopPropagation(); removeNodes([id]) }}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute -right-2.5 -top-2.5 z-50 rounded-full border border-border bg-card p-1 text-muted-foreground opacity-0 shadow transition-opacity hover:text-red-500 group-hover:opacity-100"
      >
        <X size={11} />
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={(event) => { event.stopPropagation(); triggerUpload() }}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={nodeUploading}
        className="absolute -top-3 left-1/2 z-50 rounded-full border border-border bg-card p-1 text-muted-foreground opacity-0 shadow transition-opacity -translate-x-1/2 scale-90 hover:scale-100 hover:text-emerald-500 group-hover:opacity-100 disabled:opacity-40"
        title="上传音频"
      >
        {nodeUploading ? <Loader2 size={11} className="animate-spin" /> : <span className="text-xs font-bold leading-none">+</span>}
      </button>

      <div className={cn('flex items-center justify-between rounded-t-xl border-b border-border px-3 py-1.5', theme.headerClassName)}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Music className={cn('h-3 w-3 shrink-0', theme.iconClassName)} />
          <InlineLabel nodeId={id} label={data.label} onRename={(nodeId, label) => updateNodeData(nodeId, { label })} />
        </div>
        {isGenerating && (
          <div className="flex items-center gap-1">
            {elapsed && <span className="font-mono text-[10px] text-emerald-500">{elapsed}</span>}
            <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
          </div>
        )}
      </div>

      <div className="p-2">
        {currentUrl ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <audio ref={audioRef} src={currentUrl} preload="metadata" onEnded={() => setPlaying(false)} />
            <button
              onClick={togglePlay}
              onMouseDown={(event) => event.stopPropagation()}
              className="flex w-full items-center gap-2 rounded-md bg-background px-2 py-2 text-left text-xs text-foreground shadow-sm hover:bg-muted"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate">音频输出</span>
            </button>
          </div>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground">
            {isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-mono text-[10px] tracking-widest uppercase">{Math.round(progress)}%</span>
              </>
            ) : (
              <span className="text-[11px]">点击节点配置音频</span>
            )}
          </div>
        )}
      </div>

      {warningMessage && (
        <div className="flex items-center gap-1.5 bg-yellow-50 px-3 py-1 text-[11px] text-yellow-600">
          <AlertCircle className="h-3 w-3 shrink-0" />{warningMessage}
        </div>
      )}
      {errorMessage && (
        <div className="flex items-center gap-1.5 bg-red-50 px-3 py-1.5 text-[11px] text-red-500">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate" title={errorMessage}>{errorMessage}</span>
        </div>
      )}

      {/* {outputs.length >= 1 && (
        <div className="flex items-center justify-between rounded-b-xl border-t border-border bg-muted px-3 py-1">
          <button onClick={handlePrev} disabled={currentIndex <= 0} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">{currentIndex + 1} / {outputs.length}</span>
          <button onClick={handleNext} disabled={currentIndex >= outputs.length - 1} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )} */}

      <Handle
        type="target"
        position={Position.Left}
        id="text-in"
        className="!h-2.5 !w-2.5 !border !border-border/80 !bg-border transition-colors hover:!bg-emerald-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="audio-out"
        className="!-right-1.5 !h-3.5 !w-3.5 !rounded-full !border !border-border/80 !bg-border opacity-0 transition-all hover:!border-muted-foreground hover:!bg-muted-foreground group-hover:opacity-100"
      />
    </div>
  )
})

AudioGenNode.displayName = 'AudioGenNode'
