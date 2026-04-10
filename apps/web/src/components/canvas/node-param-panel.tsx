'use client'

import { useState, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { executeCanvasNode, executeVideoNode } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'
import { X, Play, Loader2, Sparkles, Zap, Target, ImageIcon, Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import type { AppNode } from '@/lib/canvas/types'
import type { VideoMode } from './nodes/video-gen-node'

// ── Image gen types ──────────────────────────────────────────────────────────
type ModelType = 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
type Resolution = '1k' | '2k' | '3k' | '4k'

const IMAGE_MODEL_OPTIONS: Array<{
  value: ModelType; label: string; icon: React.ElementType
  resolutions: Resolution[]; supportsWatermark: boolean
}> = [
  { value: 'gemini',            label: '全能图片2',     icon: Zap,      resolutions: ['1k','2k','4k'], supportsWatermark: false },
  { value: 'nano-banana-pro',   label: '全能图片Pro',   icon: Target,   resolutions: ['1k','2k','4k'], supportsWatermark: false },
  { value: 'seedream-5.0-lite', label: 'Seedream 5.0', icon: Sparkles, resolutions: ['2k','3k'],       supportsWatermark: true  },
  { value: 'seedream-4.5',      label: 'Seedream 4.5', icon: Sparkles, resolutions: ['2k','4k'],       supportsWatermark: true  },
  { value: 'seedream-4.0',      label: 'Seedream 4.0', icon: Sparkles, resolutions: ['1k','2k','4k'],  supportsWatermark: true  },
]

const MODEL_CODE_MAP: Record<ModelType, Partial<Record<Resolution, string>>> = {
  'gemini':            { '1k': 'gemini-3.1-flash-image-preview', '2k': 'gemini-3.1-flash-image-preview-2k', '4k': 'gemini-3.1-flash-image-preview-4k' },
  'nano-banana-pro':   { '1k': 'nano-banana-2', '2k': 'nano-banana-2-2k', '4k': 'nano-banana-2-4k' },
  'seedream-5.0-lite': { '2k': 'seedream-5.0-lite', '3k': 'seedream-5.0-lite' },
  'seedream-4.5':      { '2k': 'seedream-4.5', '4k': 'seedream-4.5' },
  'seedream-4.0':      { '1k': 'seedream-4.0', '2k': 'seedream-4.0', '4k': 'seedream-4.0' },
}

const ASPECT_RATIOS_IMAGE = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

// ── Video gen types ──────────────────────────────────────────────────────────
const VIDEO_MODEL_OPTIONS = [
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', supportsMultiref: true,  supportsKeyframe: true  },
  { value: 'seedance-2.0',      label: 'Seedance 2.0',      supportsMultiref: true,  supportsKeyframe: true  },
  { value: 'seedance-1.5-pro',  label: 'Seedance 1.5 Pro',  supportsMultiref: false, supportsKeyframe: true  },
  { value: 'veo3.1-fast',       label: 'Veo 3.1 Fast',      supportsMultiref: false, supportsKeyframe: true  },
] as const

const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const
const VIDEO_DURATIONS = [3, 5, 8, 10] as const

// Credits per second for video models (mirrors backend VIDEO_CREDITS_MAP)
const VIDEO_CREDITS_PER_SEC: Record<string, number> = {
  'seedance-2.0-fast': 3,
  'seedance-2.0':      5,
  'seedance-1.5-pro':  4,
  'veo3.1-fast':       10, // flat rate
}

interface Props {
  node: AppNode
  canvasId: string
  onClose: () => void
  onExecuted: () => void
}

export function NodeParamPanel({ node, canvasId, onClose, onExecuted }: Props) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const token = useAuthStore((s) => s.accessToken)
  const [executing, setExecuting] = useState(false)

  // Edges into this node, keyed by targetHandle
  const incomingEdges = useCanvasStructureStore(
    useShallow((s) => s.edges.filter((e) => e.target === node.id))
  )
  const sourceNodeIds = useMemo(() => incomingEdges.map((e) => e.source), [incomingEdges])
  const upstreamNodes = useCanvasStructureStore(
    useShallow((s) => s.nodes.filter((n) => sourceNodeIds.includes(n.id)))
  )

  const upstreamTexts = useMemo(
    () => upstreamNodes.filter((n) => n.type === 'text_input').map((n) => (n.data.config as any)?.text ?? '').filter(Boolean),
    [upstreamNodes]
  )

  const execNodes = useCanvasExecutionStore(useShallow((s) => s.nodes))

  // Resolve a node's current output URL (asset → config.url, gen nodes → selected output)
  const resolveNodeUrl = useCallback((nodeId: string): string | undefined => {
    const n = upstreamNodes.find((u) => u.id === nodeId)
    if (!n) return undefined
    if (n.type === 'asset') return (n.data.config as any)?.url as string | undefined
    const exec = execNodes[nodeId]
    if (!exec) return undefined
    return exec.outputs.find((o) => o.id === exec.selectedOutputId)?.url
  }, [upstreamNodes, execNodes])

  // Named ref map: { 'ref-1': url, 'ref-2': url, 'frame-start': url, ... }
  const namedRefUrls = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const edge of incomingEdges) {
      if (!edge.targetHandle) continue
      map[edge.targetHandle] = resolveNodeUrl(edge.source)
    }
    return map
  }, [incomingEdges, resolveNodeUrl])

  // Ordered image refs for image_gen (ref-1 → ref-2 → ref-3)
  const orderedImageRefs = useMemo(() =>
    ['ref-1', 'ref-2', 'ref-3'].map((k) => namedRefUrls[k]).filter((u): u is string => !!u),
    [namedRefUrls]
  )

  const setNodeProgress = useCanvasExecutionStore((s) => s.setNodeProgress)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)

  const cfg = node.data.config ?? {}
  const isImageGen = node.type === 'image_gen'
  const isTextInput = node.type === 'text_input'
  const isAsset = node.type === 'asset'
  const isVideoGen = node.type === 'video_gen'

  // ── Image gen state ──────────────────────────────────────────────────────────
  const modelType: ModelType = cfg.modelType ?? 'gemini'
  const resolution: Resolution = cfg.resolution ?? '2k'
  const aspectRatio: string = cfg.aspectRatio ?? '1:1'
  const quantity: number = cfg.quantity ?? 1
  const watermark: boolean = cfg.watermark ?? false
  const prompt: string = cfg.prompt ?? ''

  const currentModel = IMAGE_MODEL_OPTIONS.find((m) => m.value === modelType) ?? IMAGE_MODEL_OPTIONS[0]
  const credits = IMAGE_MODEL_CREDITS[modelType] ?? 5

  function updateCfg(patch: Record<string, any>) {
    updateNodeData(node.id, { config: { ...cfg, ...patch } })
  }

  function handleModelChange(val: ModelType) {
    const model = IMAGE_MODEL_OPTIONS.find((m) => m.value === val)!
    const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0]
    updateCfg({ modelType: val, resolution: res })
  }

  const handleExecuteImage = useCallback(async () => {
    const modelCode = MODEL_CODE_MAP[modelType][resolution]
    if (!modelCode) { toast.error('模型配置错误'); return }
    const finalPrompt = [...upstreamTexts, prompt].filter(Boolean).join('\n')
    if (!canvasId || !finalPrompt.trim()) { toast.error('请先填写提示词'); return }
    setExecuting(true)
    setNodeProgress(node.id, 0, true)
    try {
      await executeCanvasNode(
        {
          canvasId,
          canvasNodeId: node.id,
          type: 'image_gen',
          config: { prompt: finalPrompt, model: modelCode, aspectRatio, quantity, watermark, resolution },
          workspaceId: workspaceId ?? undefined,
          referenceImageUrls: orderedImageRefs.length > 0 ? orderedImageRefs : undefined,
        },
        token ?? undefined
      )
      toast.success('已提交生成任务')
      onExecuted()
    } catch (err: any) {
      toast.error(err.message ?? '执行失败')
      setNodeError(node.id, err.message ?? '执行失败')
    } finally {
      setExecuting(false)
    }
  }, [canvasId, node.id, prompt, modelType, resolution, aspectRatio, quantity, watermark, workspaceId, token,
      upstreamTexts, orderedImageRefs, setNodeProgress, setNodeError, onExecuted])

  // ── Video gen state ──────────────────────────────────────────────────────────
  const videoModel: string = cfg.model ?? 'seedance-2.0-fast'
  const videoMode: VideoMode = cfg.videoMode ?? 'multiref'
  const videoAspect: string = cfg.aspectRatio ?? '16:9'
  const videoDuration: number = cfg.duration ?? 5
  const generateAudio: boolean = cfg.generateAudio ?? true
  const videoWatermark: boolean = cfg.watermark ?? false
  const videoPrompt: string = cfg.prompt ?? ''

  const currentVideoModel = VIDEO_MODEL_OPTIONS.find((m) => m.value === videoModel) ?? VIDEO_MODEL_OPTIONS[0]
  const videoCredits = videoModel === 'veo3.1-fast'
    ? (VIDEO_CREDITS_PER_SEC[videoModel] ?? 10)
    : (VIDEO_CREDITS_PER_SEC[videoModel] ?? 3) * videoDuration

  // When model changes, auto-switch mode if current mode not supported
  function handleVideoModelChange(val: string) {
    const m = VIDEO_MODEL_OPTIONS.find((o) => o.value === val)
    if (!m) return
    const newMode = videoMode === 'multiref' && !m.supportsMultiref ? 'keyframe' : videoMode
    updateCfg({ model: val, videoMode: newMode })
  }

  const handleExecuteVideo = useCallback(async () => {
    const finalPrompt = [...upstreamTexts, videoPrompt].filter(Boolean).join('\n')
    if (!canvasId || !finalPrompt.trim()) { toast.error('请先填写提示词'); return }
    setExecuting(true)
    setNodeProgress(node.id, 0, true)
    try {
      await executeVideoNode(
        {
          canvasId,
          canvasNodeId: node.id,
          workspaceId: workspaceId ?? undefined,
          prompt: finalPrompt,
          model: videoModel,
          videoMode,
          aspectRatio: videoAspect,
          duration: videoDuration,
          generateAudio,
          watermark: videoWatermark,
          referenceImages: videoMode === 'multiref'
            ? ['ref-1','ref-2','ref-3'].map((k) => namedRefUrls[k]).filter((u): u is string => !!u)
            : undefined,
          frameStart: videoMode === 'keyframe' ? namedRefUrls['frame-start'] : undefined,
          frameEnd:   videoMode === 'keyframe' ? namedRefUrls['frame-end']   : undefined,
        },
        token ?? undefined
      )
      toast.success('已提交视频生成任务')
      onExecuted()
    } catch (err: any) {
      toast.error(err.message ?? '执行失败')
      setNodeError(node.id, err.message ?? '执行失败')
    } finally {
      setExecuting(false)
    }
  }, [canvasId, node.id, videoPrompt, videoModel, videoMode, videoAspect, videoDuration, generateAudio,
      videoWatermark, workspaceId, token, upstreamTexts, namedRefUrls, setNodeProgress, setNodeError, onExecuted])

  const hasImagePrompt = prompt.trim() || upstreamTexts.length > 0
  const hasVideoPrompt = videoPrompt.trim() || upstreamTexts.length > 0

  return (
    <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <span className="text-xs font-semibold text-foreground">{node.data.label} · 参数</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Asset node ── */}
      {isAsset && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>素材节点 · 只读</span>
          </div>
          {cfg.url && <img src={cfg.url} alt={cfg.name} className="w-full rounded-lg object-contain max-h-48" />}
          {cfg.name && <p className="text-[10px] text-muted-foreground truncate">{cfg.name}</p>}
        </div>
      )}

      {/* ── Text input node ── */}
      {isTextInput && (
        <div className="p-3">
          <label className="text-[11px] font-medium text-muted-foreground block mb-1">文本内容</label>
          <textarea
            className="w-full h-20 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="输入提示词内容..."
            value={cfg.text ?? ''}
            onChange={(e) => updateCfg({ text: e.target.value })}
          />
        </div>
      )}

      {/* ── Image gen node ── */}
      {isImageGen && (
        <div className="flex gap-0 divide-x divide-border">
          {/* Col 1: Prompt + named ref previews */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 200 }}>
            <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
            <textarea
              className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[100px]"
              placeholder="描述你想生成的图片..."
              value={prompt}
              onChange={(e) => updateCfg({ prompt: e.target.value })}
            />
            {orderedImageRefs.length > 0 && (
              <div className="mt-1">
                <label className="text-[10px] text-muted-foreground mb-1 block">参考图（按引脚顺序）</label>
                <div className="flex gap-1 flex-wrap">
                  {orderedImageRefs.map((url, i) => (
                    <div key={i} className="relative">
                      <img src={url} alt="" className="w-10 h-10 object-cover rounded border border-border" />
                      <span className="absolute -top-1 -left-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold">参{i+1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Col 2: Model */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 160 }}>
            <label className="text-[11px] font-medium text-muted-foreground">模型</label>
            <div className="flex flex-col gap-1">
              {IMAGE_MODEL_OPTIONS.map((m) => {
                const Icon = m.icon
                const isActive = modelType === m.value
                return (
                  <button key={m.value} onClick={() => handleModelChange(m.value)}
                    className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                      isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground')}>
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="flex-1 truncate">{m.label}</span>
                    <span className={cn('text-[10px]', isActive ? 'text-primary/70' : 'text-muted-foreground')}>{IMAGE_MODEL_CREDITS[m.value]}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {/* Col 3: Resolution + Aspect ratio */}
          <div className="p-3 flex flex-col gap-3" style={{ width: 140 }}>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">分辨率</label>
              <div className="flex flex-wrap gap-1">
                {currentModel.resolutions.map((r) => (
                  <button key={r} onClick={() => updateCfg({ resolution: r })}
                    className={cn('px-2 py-0.5 rounded text-[11px] font-medium border transition-colors',
                      resolution === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{r.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">宽高比</label>
              <div className="flex flex-wrap gap-1">
                {ASPECT_RATIOS_IMAGE.map((r) => (
                  <button key={r} onClick={() => updateCfg({ aspectRatio: r })}
                    className={cn('px-1.5 py-0.5 rounded text-[11px] border transition-colors',
                      aspectRatio === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{r}</button>
                ))}
              </div>
            </div>
          </div>
          {/* Col 4: Quantity + Watermark + Execute */}
          <div className="p-3 flex flex-col gap-3 justify-between" style={{ width: 120 }}>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">数量</label>
              <div className="flex gap-1">
                {QUANTITY_OPTIONS.map((q) => (
                  <button key={q} onClick={() => updateCfg({ quantity: q })}
                    className={cn('flex-1 py-0.5 rounded text-[11px] font-medium border transition-colors',
                      quantity === q ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{q}</button>
                ))}
              </div>
            </div>
            {currentModel.supportsWatermark && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">水印</label>
                <button onClick={() => updateCfg({ watermark: !watermark })}
                  className={cn('w-full py-0.5 rounded text-[11px] font-medium border transition-colors',
                    watermark ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{watermark ? '开' : '关'}</button>
              </div>
            )}
            <button onClick={handleExecuteImage} disabled={executing || !hasImagePrompt}
              className="mt-auto w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground py-2 rounded-lg text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition">
              {executing ? <><Loader2 className="w-3 h-3 animate-spin" />提交中</> : <><Play className="w-3 h-3" />执行 · {credits * quantity}积分</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Video gen node ── */}
      {isVideoGen && (
        <div className="flex gap-0 divide-x divide-border">
          {/* Col 1: Prompt + mode toggle + ref previews */}
          <div className="p-3 flex flex-col gap-2" style={{ width: 220 }}>
            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-medium">
              <button
                onClick={() => updateCfg({ videoMode: 'multiref' })}
                disabled={!currentVideoModel.supportsMultiref}
                className={cn('flex-1 py-1 transition-colors',
                  videoMode === 'multiref' ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed'
                )}>多模态参考</button>
              <button
                onClick={() => updateCfg({ videoMode: 'keyframe' })}
                className={cn('flex-1 py-1 transition-colors',
                  videoMode === 'keyframe' ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                )}>首尾帧</button>
            </div>

            <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
            <textarea
              className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
              placeholder="描述视频内容..."
              value={videoPrompt}
              onChange={(e) => updateCfg({ prompt: e.target.value })}
            />

            {/* Reference preview */}
            {videoMode === 'multiref' && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">参考图（参1→参2→参3）</label>
                <div className="flex gap-1">
                  {['ref-1','ref-2','ref-3'].map((k, i) => {
                    const url = namedRefUrls[k]
                    return (
                      <div key={k} className={cn('relative w-14 h-14 rounded border flex items-center justify-center text-[9px] text-muted-foreground',
                        url ? 'border-border' : 'border-dashed border-muted-foreground/30 bg-muted/20')}>
                        {url
                          ? <><img src={url} alt="" className="w-full h-full object-cover rounded" />
                              <span className="absolute -top-1 -left-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold">参{i+1}</span></>
                          : <span>参{i+1}</span>
                        }
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {videoMode === 'keyframe' && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">首帧 → 尾帧</label>
                <div className="flex items-center gap-2">
                  {['frame-start','frame-end'].map((k) => {
                    const url = namedRefUrls[k]
                    const label = k === 'frame-start' ? '首' : '尾'
                    return (
                      <div key={k} className={cn('relative w-16 h-16 rounded border flex items-center justify-center text-[10px] text-muted-foreground font-medium',
                        url ? 'border-border' : 'border-dashed border-muted-foreground/30 bg-muted/20')}>
                        {url
                          ? <><img src={url} alt="" className="w-full h-full object-cover rounded" />
                              <span className="absolute -top-1 -left-1 text-[9px] bg-amber-500 text-white rounded px-1 font-bold">{label}</span></>
                          : <span>{label}帧</span>
                        }
                      </div>
                    )
                  })}
                  <span className="text-zinc-300 text-lg">→</span>
                </div>
              </div>
            )}
          </div>

          {/* Col 2: Model */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 160 }}>
            <label className="text-[11px] font-medium text-muted-foreground">模型</label>
            <div className="flex flex-col gap-1">
              {VIDEO_MODEL_OPTIONS.map((m) => {
                const isActive = videoModel === m.value
                const disabled = videoMode === 'multiref' && !m.supportsMultiref
                return (
                  <button key={m.value} onClick={() => !disabled && handleVideoModelChange(m.value)}
                    disabled={disabled}
                    className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                      isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : disabled ? 'opacity-30 cursor-not-allowed bg-muted/20 border-transparent'
                        : 'bg-muted/40 border-transparent hover:bg-muted text-foreground')}>
                    <Film className="w-3 h-3 shrink-0" />
                    <span className="flex-1 truncate text-[10px]">{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Col 3: Aspect + Duration */}
          <div className="p-3 flex flex-col gap-3" style={{ width: 130 }}>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">宽高比</label>
              <div className="flex flex-wrap gap-1">
                {VIDEO_ASPECT_RATIOS.map((r) => (
                  <button key={r} onClick={() => updateCfg({ aspectRatio: r })}
                    className={cn('px-1.5 py-0.5 rounded text-[11px] border transition-colors',
                      videoAspect === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{r}</button>
                ))}
              </div>
            </div>
            {videoModel !== 'veo3.1-fast' && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">时长（秒）</label>
                <div className="flex flex-wrap gap-1">
                  {VIDEO_DURATIONS.map((d) => (
                    <button key={d} onClick={() => updateCfg({ duration: d })}
                      className={cn('px-2 py-0.5 rounded text-[11px] font-medium border transition-colors',
                        videoDuration === d ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{d}s</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Col 4: Audio + Watermark + Execute */}
          <div className="p-3 flex flex-col gap-3 justify-between" style={{ width: 110 }}>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">生成音频</label>
                <button onClick={() => updateCfg({ generateAudio: !generateAudio })}
                  className={cn('w-full py-0.5 rounded text-[11px] font-medium border transition-colors',
                    generateAudio ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{generateAudio ? '开' : '关'}</button>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">水印</label>
                <button onClick={() => updateCfg({ watermark: !videoWatermark })}
                  className={cn('w-full py-0.5 rounded text-[11px] font-medium border transition-colors',
                    videoWatermark ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{videoWatermark ? '开' : '关'}</button>
              </div>
            </div>
            <button onClick={handleExecuteVideo} disabled={executing || !hasVideoPrompt}
              className="mt-auto w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground py-2 rounded-lg text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition">
              {executing ? <><Loader2 className="w-3 h-3 animate-spin" />提交中</> : <><Play className="w-3 h-3" />执行 · {videoCredits}积分</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
