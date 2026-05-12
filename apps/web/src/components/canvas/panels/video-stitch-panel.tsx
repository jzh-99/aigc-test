'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, Film, GripVertical, Loader2, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { getVideoConcatExport, startVideoConcatExport } from '@/lib/canvas/canvas-api'
import type { NodeOutputAsset, VideoStitchConfig } from '@/lib/canvas/types'
import { isAssetConfig } from '@/lib/canvas/types'
import { cn } from '@/lib/utils'

interface Props {
  nodeId: string
  canvasId: string
  config: VideoStitchConfig
  onUpdateCfg: (patch: Partial<VideoStitchConfig>) => void
  onExecuted: () => void
}

interface StitchInput {
  edgeId: string
  sourceId: string
  label: string
  url: string
  output?: NodeOutputAsset
}

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 120

export function VideoStitchPanel({ nodeId, canvasId, config, onUpdateCfg, onExecuted }: Props) {
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)
  const execNodes = useCanvasExecutionStore((s) => s.nodes)
  const setNodeStatus = useCanvasExecutionStore((s) => s.setNodeStatus)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const addNodeOutput = useCanvasExecutionStore((s) => s.addNodeOutput)

  const videoRef = useRef<HTMLVideoElement>(null)
  const currentIdxRef = useRef(0)
  const dragEdgeIdRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [durations, setDurations] = useState<Record<string, number>>({})

  const orderedInputs = useMemo(() => {
    const inputEdges = edges.filter((e) => e.target === nodeId && (!e.targetHandle || e.targetHandle === 'video-in'))
    const inputs = inputEdges.flatMap<StitchInput>((edge) => {
      const source = nodes.find((n) => n.id === edge.source)
      if (!source) return []

      if (source.type === 'asset' && isAssetConfig(source.data.config) && source.data.config.mimeType?.startsWith('video') && source.data.config.url) {
        return [{ edgeId: edge.id, sourceId: source.id, label: source.data.label, url: source.data.config.url }]
      }

      if (source.type === 'video_gen' || source.type === 'video_stitch') {
        const state = execNodes[source.id]
        const output = state?.outputs.find((o) => o.id === state.selectedOutputId) ?? state?.outputs.find((o) => o.type === 'video')
        if (output?.url && output.type === 'video') {
          return [{ edgeId: edge.id, sourceId: source.id, label: source.data.label, url: output.url, output }]
        }
      }

      return []
    })

    const order = config.inputOrder ?? []
    const orderIndex = new Map(order.map((edgeId, index) => [edgeId, index]))
    return inputs.sort((a, b) => {
      const ai = orderIndex.get(a.edgeId)
      const bi = orderIndex.get(b.edgeId)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return inputEdges.findIndex((e) => e.id === a.edgeId) - inputEdges.findIndex((e) => e.id === b.edgeId)
    })
  }, [config.inputOrder, edges, execNodes, nodeId, nodes])

  currentIdxRef.current = currentIdx

  const reorder = useCallback((fromEdgeId: string, toEdgeId: string) => {
    if (fromEdgeId === toEdgeId) return
    const next = orderedInputs.map((input) => input.edgeId)
    const from = next.indexOf(fromEdgeId)
    const to = next.indexOf(toEdgeId)
    if (from === -1 || to === -1) return
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onUpdateCfg({ inputOrder: next })
  }, [onUpdateCfg, orderedInputs])

  const playFrom = useCallback((idx: number) => {
    const video = videoRef.current
    if (!video || idx >= orderedInputs.length) {
      setPlaying(false)
      return
    }
    setCurrentIdx(idx)
    video.src = orderedInputs[idx].url
    video.play().catch(() => {})
  }, [orderedInputs])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video || orderedInputs.length === 0) return
    if (playing) {
      video.pause()
      setPlaying(false)
      return
    }
    setPlaying(true)
    if (!video.src) playFrom(0)
    else video.play().catch(() => {})
  }, [orderedInputs.length, playFrom, playing])

  const handleExport = useCallback(async () => {
    if (orderedInputs.length < 2) {
      toast.error('至少需要 2 个可用视频')
      return
    }

    const missingDuration = orderedInputs.find((input) => !durations[input.edgeId] || durations[input.edgeId] <= 0)
    if (missingDuration) {
      toast.error('视频时长读取中，请稍后重试')
      return
    }

    setExporting(true)
    setNodeStatus(nodeId, 'pending', { progress: 0 })
    try {
      const segments = orderedInputs.map((input) => ({
        url: input.url,
        inPoint: 0,
        outPoint: durations[input.edgeId],
      }))
      const { jobId } = await startVideoConcatExport({ segments, projectName: `canvas_${canvasId}_${nodeId}` })
      setNodeStatus(nodeId, 'processing', { progress: 5 })

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        const result = await getVideoConcatExport(jobId)
        setNodeStatus(nodeId, 'processing', { progress: Math.min(95, 5 + ((i + 1) / MAX_POLLS) * 90) })

        if (result.status === 'done' && result.resultUrl) {
          addNodeOutput(nodeId, {
            id: jobId,
            url: result.resultUrl,
            type: 'video',
            paramsSnapshot: { inputOrder: orderedInputs.map((input) => input.edgeId), segments },
          })
          setNodeStatus(nodeId, 'completed', { progress: 100 })
          toast.success('视频拼接完成')
          onExecuted()
          return
        }

        if (result.status === 'failed') {
          throw new Error(result.error ?? '视频拼接失败')
        }
      }

      throw new Error('视频拼接超时')
    } catch (err) {
      const message = err instanceof Error ? err.message : '视频拼接失败'
      toast.error(message)
      setNodeError(nodeId, message)
    } finally {
      setExporting(false)
    }
  }, [addNodeOutput, canvasId, durations, nodeId, onExecuted, orderedInputs, setNodeError, setNodeStatus])

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">输入视频顺序</p>
        {orderedInputs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            连接 AI 视频节点或视频素材后开始拼接
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {orderedInputs.map((input, index) => (
              <div
                key={input.edgeId}
                draggable
                onDragStart={() => { dragEdgeIdRef.current = input.edgeId }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragEdgeIdRef.current) reorder(dragEdgeIdRef.current, input.edgeId)
                  dragEdgeIdRef.current = null
                }}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <span className="w-5 shrink-0 text-[10px] text-muted-foreground">{index + 1}</span>
                <Film className="h-3.5 w-3.5 shrink-0 text-red-500" />
                <span className="min-w-0 flex-1 truncate" title={input.label}>{input.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {durations[input.edgeId] ? `${durations[input.edgeId].toFixed(1)}s` : '读取中'}
                </span>
                <video
                  src={input.url}
                  preload="metadata"
                  className="hidden"
                  onLoadedMetadata={(e) => {
                    const duration = e.currentTarget.duration
                    if (Number.isFinite(duration) && duration > 0) {
                      setDurations((prev) => ({ ...prev, [input.edgeId]: duration }))
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {orderedInputs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium">拼接预览</span>
            <span className="text-[11px] text-muted-foreground">
              {playing ? `视频 ${currentIdx + 1} / ${orderedInputs.length}` : `共 ${orderedInputs.length} 个视频`}
            </span>
          </div>
          <video
            ref={videoRef}
            className="w-full max-h-56 bg-black"
            onEnded={() => playFrom(currentIdxRef.current + 1)}
          />
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={togglePlayback}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? '暂停' : '播放全部'}
            </button>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {orderedInputs[currentIdx]?.label}
            </span>
          </div>
        </div>
      )}

      {orderedInputs.length === 1 && (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          至少连接 2 个视频才能生成拼接结果
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={exporting || orderedInputs.length < 2}
        className={cn(
          'flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-colors disabled:opacity-50',
          'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        {exporting && <Loader2 className="h-3 w-3 animate-spin" />}
        {exporting ? '拼接中…' : '生成拼接视频'}
      </button>
    </div>
  )
}
