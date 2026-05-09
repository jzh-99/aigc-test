'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { AlertCircle, Check, Film, Loader2, Pause, Play, X } from 'lucide-react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore, useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { cn } from '@/lib/utils'
import type { CanvasNodeData, VideoStitchConfig } from '@/lib/canvas/types'
import { isAssetConfig } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

interface PreviewVideo {
  edgeId: string
  label: string
  url: string
}

export const VideoStitchNode = memo(function VideoStitchNode({ id, data }: { id: string; data: CanvasNodeData<VideoStitchConfig> }) {
  const execState = useNodeExecutionState(id)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const structure = useCanvasStructureStore(
    useShallow((s) => ({ nodes: s.nodes, edges: s.edges }))
  )
  const execNodes = useCanvasExecutionStore((s) => s.nodes)
  const inputCount = useMemo(
    () => structure.edges.filter((e) => e.target === id && (!e.targetHandle || e.targetHandle === 'video-in')).length,
    [id, structure.edges]
  )
  const previewVideos = useMemo(() => {
    const inputEdges = structure.edges.filter((e) => e.target === id && (!e.targetHandle || e.targetHandle === 'video-in'))
    const inputs = inputEdges.flatMap<PreviewVideo>((edge) => {
      const source = structure.nodes.find((n) => n.id === edge.source)
      if (!source) return []

      if (source.type === 'asset' && isAssetConfig(source.data.config) && source.data.config.mimeType?.startsWith('video') && source.data.config.url) {
        return [{ edgeId: edge.id, label: source.data.label, url: source.data.config.url }]
      }

      if (source.type === 'video_gen' || source.type === 'video_stitch') {
        const state = execNodes[source.id]
        const output = state?.outputs.find((o) => o.id === state.selectedOutputId) ?? state?.outputs.find((o) => o.type === 'video')
        if (output?.url && output.type === 'video') return [{ edgeId: edge.id, label: source.data.label, url: output.url }]
      }

      return []
    })

    const order = data.config?.inputOrder ?? []
    const orderIndex = new Map(order.map((edgeId, index) => [edgeId, index]))
    return inputs.sort((a, b) => {
      const ai = orderIndex.get(a.edgeId)
      const bi = orderIndex.get(b.edgeId)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return inputEdges.findIndex((e) => e.id === a.edgeId) - inputEdges.findIndex((e) => e.id === b.edgeId)
    })
  }, [data.config?.inputOrder, execNodes, id, structure.edges, structure.nodes])
  const isUpstream = useNodeHighlighted(id)
  const [playing, setPlaying] = useState(false)
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const preloadRef = useRef<HTMLVideoElement>(null)
  const currentIdxRef = useRef(0)

  const { isGenerating, progress, errorMessage, outputs, selectedOutputId, submissionStatus } = execState
  const isFailed = submissionStatus === 'failed'
  const selectedOutput = outputs.find((o) => o.id === selectedOutputId)
  const stitchedUrl = selectedOutput?.url
  const previewUrl = previewVideos[currentIdx]?.url
  const currentUrl = stitchedUrl ?? previewUrl
  const displayAspect = videoSize ? `${videoSize.w} / ${videoSize.h}` : '16 / 9'
  const canPreview = !!currentUrl
  const isSequencePreview = !stitchedUrl && previewVideos.length > 0

  currentIdxRef.current = currentIdx

  const playFrom = useCallback((idx: number) => {
    const video = videoRef.current
    if (!video || idx >= previewVideos.length) {
      setPlaying(false)
      return
    }
    setCurrentIdx(idx)
    video.src = previewVideos[idx].url
    video.play().catch(() => {})
  }, [previewVideos])

  useEffect(() => {
    setPlaying(false)
    setVideoSize(null)
    setCurrentIdx(0)
  }, [selectedOutputId, previewVideos.length])

  useEffect(() => {
    if (!isSequencePreview || !preloadRef.current) return
    const next = previewVideos[currentIdx + 1]
    preloadRef.current.src = next?.url ?? ''
    if (next) preloadRef.current.load()
  }, [currentIdx, isSequencePreview, previewVideos])

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-all duration-200 bg-white',
        isGenerating
          ? 'border-blue-400 shadow-blue-200 ring-1 ring-blue-400'
          : isFailed
          ? 'border-red-400 shadow-red-100 ring-1 ring-red-300'
          : isUpstream
          ? 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100'
          : 'border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        '[transform:translateZ(0)] [backface-visibility:hidden]'
      )}
      style={{ width: 260 }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-white text-zinc-400 hover:text-red-500 border-zinc-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-zinc-50 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <Film className="w-3 h-3 text-red-400 shrink-0" />
          <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-red-100 text-red-600">拼接</span>
          {isGenerating && <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" />}
        </div>
      </div>

      <div className="p-1 bg-white relative">
        {canPreview ? (
          <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: displayAspect }}>
            <video
              ref={videoRef}
              src={currentUrl}
              className="w-full h-full object-contain"
              preload="auto"
              onLoadedMetadata={(e) => {
                const video = e.currentTarget
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                  setVideoSize({ w: video.videoWidth, h: video.videoHeight })
                }
              }}
              onEnded={() => {
                if (isSequencePreview) playFrom(currentIdxRef.current + 1)
                else setPlaying(false)
              }}
            />
            {isSequencePreview && <video ref={preloadRef} preload="auto" className="hidden" />}
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (playing) {
                  videoRef.current?.pause()
                  setPlaying(false)
                } else {
                  setPlaying(true)
                  if (isSequencePreview && currentIdx >= previewVideos.length) playFrom(0)
                  else videoRef.current?.play().catch(() => {})
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-colors',
                playing ? 'bg-transparent opacity-0 hover:opacity-100 hover:bg-black/20' : 'bg-black/30 hover:bg-black/40'
              )}
            >
              <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow">
                {playing ? <Pause className="w-4 h-4 text-zinc-800" /> : <Play className="w-4 h-4 text-zinc-800 ml-0.5" />}
              </div>
            </button>
            {isSequencePreview && (
              <div className="absolute left-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                {currentIdx + 1}/{previewVideos.length} {previewVideos[currentIdx]?.label}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-zinc-400 rounded-lg bg-zinc-50" style={{ aspectRatio: '16/9' }}>
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-mono text-[10px] tracking-widest uppercase">
                  {Math.round(progress)}<span className="text-zinc-300 ml-0.5">%</span>
                </span>
              </>
            ) : (
              <span className="text-[11px]">连接视频并在参数栏拼接</span>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="bg-red-50 text-red-500 text-[11px] px-3 py-1.5 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate" title={errorMessage}>{errorMessage}</span>
        </div>
      )}

      {stitchedUrl && (
        <div className="border-t border-zinc-100 px-3 py-1 flex items-center justify-center gap-1.5 bg-zinc-50 rounded-b-xl text-[10px] text-green-600">
          <Check className="w-3 h-3" /> 拼接完成
        </div>
      )}

      {inputCount > 0 && (
        <div
          className="absolute flex items-center pointer-events-none"
          style={{ top: '50%', left: 0, transform: 'translate(-100%, -50%)' }}
        >
          <span className="text-[9px] font-medium text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 mr-1 shadow-sm whitespace-nowrap">
            视频×{inputCount}
          </span>
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="video-in"
        style={{ top: '50%' }}
        className="!w-2.5 !h-2.5 !bg-red-300 !border !border-red-400 hover:!bg-red-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
})
VideoStitchNode.displayName = 'VideoStitchNode'
