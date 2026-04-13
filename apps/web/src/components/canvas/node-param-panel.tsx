'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { executeCanvasNode, executeVideoNode } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'
import { X, Play, Loader2, Sparkles, Zap, Target, ImageIcon, Film, Music, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import type { AppNode } from '@/lib/canvas/types'
import type { VideoMode } from './nodes/video-gen-node'
import { getAllUpstreamNodeIds } from '@/lib/canvas/dag'

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
  { value: 'seedance-2.0',      label: 'Seedance 2.0',      isSeedance: true,  isSeedance2: true,  supportsMultiref: true,  supportsKeyframe: true  },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', isSeedance: true,  isSeedance2: true,  supportsMultiref: true,  supportsKeyframe: true  },
  { value: 'seedance-1.5-pro',  label: 'Seedance 1.5 Pro',  isSeedance: true,  isSeedance2: false, supportsMultiref: false, supportsKeyframe: true  },
  { value: 'veo3.1-fast',       label: 'Veo 3.1 Fast',      isSeedance: false, isSeedance2: false, supportsMultiref: false, supportsKeyframe: true  },
] as const

const VIDEO_ASPECT_RATIOS_SEEDANCE = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9',     label: '16:9' },
  { value: '9:16',     label: '9:16' },
  { value: '1:1',      label: '1:1' },
  { value: '4:3',      label: '4:3' },
  { value: '3:4',      label: '3:4' },
  { value: '21:9',     label: '21:9' },
] as const

const VIDEO_ASPECT_RATIOS_VEO = [
  { value: '',    label: '自动' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

const SEEDANCE_DURATION_OPTIONS = [
  { value: -1,  label: '自动' },
  { value: 4,   label: '4秒' },
  { value: 5,   label: '5秒' },
  { value: 6,   label: '6秒' },
  { value: 8,   label: '8秒' },
  { value: 10,  label: '10秒' },
  { value: 12,  label: '12秒' },
  { value: 15,  label: '15秒' },
] as const

// Credits per second for video models
const VIDEO_CREDITS_PER_SEC: Record<string, number> = {
  'seedance-2.0':      5,
  'seedance-2.0-fast': 3,
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
  const removeEdgesByTarget = useCanvasStructureStore((s) => s.removeEdgesByTarget)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const token = useAuthStore((s) => s.accessToken)
  const [executing, setExecuting] = useState(false)

  // Edges into this node, keyed by targetHandle
  const incomingEdges = useCanvasStructureStore(
    useShallow((s) => s.edges.filter((e) => e.target === node.id))
  )
  // All upstream node IDs (recursive) — sorted array so useShallow can do element-wise comparison
  const allUpstreamNodeIds = useCanvasStructureStore(
    useShallow((s) => Array.from(getAllUpstreamNodeIds(node.id, s.edges)).sort())
  )
  const upstreamNodes = useCanvasStructureStore(
    useShallow((s) => s.nodes.filter((n) => allUpstreamNodeIds.includes(n.id)))
  )

  const upstreamTexts = useMemo(
    () => upstreamNodes.filter((n) => n.type === 'text_input').map((n) => (n.data.config as any)?.text ?? '').filter(Boolean),
    [upstreamNodes]
  )

  const upstreamTextNodeLabels = useMemo(
    () => upstreamNodes.filter((n) => n.type === 'text_input').map((n) => n.data.label ?? '文本'),
    [upstreamNodes]
  )

  // Only subscribe to selectedOutputId of upstream gen nodes — not full execution state
  const upstreamGenIds = useMemo(
    () => upstreamNodes.filter((n) => n.type === 'image_gen' || n.type === 'video_gen').map((n) => n.id),
    [upstreamNodes]
  )
  const upstreamSelectedOutputs = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const url = st?.outputs.find((o) => o.id === st.selectedOutputId)?.url
        return [id, url]
      })
    ))
  )

  // Helper: resolve a source node's current output URL
  const resolveSourceUrl = useCallback((sourceId: string): string | undefined => {
    const n = upstreamNodes.find((u) => u.id === sourceId)
    if (!n) return undefined
    if (n.type === 'asset') return (n.data.config as any)?.url as string | undefined
    return upstreamSelectedOutputs[sourceId]
  }, [upstreamNodes, upstreamSelectedOutputs])

  // For image_gen and video_gen multiref: all any-in edges in order
  const orderedImageRefs = useMemo(() => {
    const result: { url: string; mimeType?: string }[] = []
    for (const e of incomingEdges) {
      if (e.targetHandle && e.targetHandle !== 'any-in') continue
      const n = upstreamNodes.find((u) => u.id === e.source)
      if (!n || n.type === 'text_input') continue
      const url = resolveSourceUrl(e.source)
      if (!url) continue
      const mimeType = (n.data.config as any)?.mimeType as string | undefined
      result.push({ url, mimeType })
    }
    return result
  }, [incomingEdges, upstreamNodes, resolveSourceUrl])

  // Categorize multiref by type
  const multirefImages = useMemo(() => orderedImageRefs.filter(r => !r.mimeType || r.mimeType.startsWith('image')).map(r => r.url), [orderedImageRefs])
  const multirefVideos = useMemo(() => orderedImageRefs.filter(r => r.mimeType != null && r.mimeType.startsWith('video')).map(r => r.url), [orderedImageRefs])
  const multirefAudios = useMemo(() => orderedImageRefs.filter(r => r.mimeType != null && r.mimeType.startsWith('audio')).map(r => r.url), [orderedImageRefs])

  // For video_gen keyframe: named handles only
  const namedRefUrls = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const edge of incomingEdges) {
      if (!edge.targetHandle || edge.targetHandle === 'any-in') continue
      map[edge.targetHandle] = resolveSourceUrl(edge.source)
    }
    return map
  }, [incomingEdges, resolveSourceUrl])

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
  const promptFromConfig: string = cfg.prompt ?? ''
  const textFromConfig: string = cfg.text ?? ''

  const [textDraft, setTextDraft] = useState(textFromConfig)
  const [promptDraft, setPromptDraft] = useState(promptFromConfig)
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentModel = IMAGE_MODEL_OPTIONS.find((m) => m.value === modelType) ?? IMAGE_MODEL_OPTIONS[0]
  const credits = IMAGE_MODEL_CREDITS[modelType] ?? 5

  const updateCfg = useCallback((patch: Record<string, any>) => {
    const latestNode = useCanvasStructureStore.getState().nodes.find((n) => n.id === node.id)
    const latestCfg = (latestNode?.data.config ?? {}) as Record<string, any>
    updateNodeData(node.id, { config: { ...latestCfg, ...patch } })
  }, [node.id, updateNodeData])

  useEffect(() => {
    setTextDraft(textFromConfig)
  }, [node.id, textFromConfig])

  useEffect(() => {
    setPromptDraft(promptFromConfig)
  }, [node.id, promptFromConfig])

  const flushTextDraft = useCallback(() => {
    if (!isTextInput) return
    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current)
      textDebounceRef.current = null
    }
    if (textDraft !== textFromConfig) {
      updateCfg({ text: textDraft })
    }
  }, [isTextInput, textDraft, textFromConfig, updateCfg])

  const flushPromptDraft = useCallback(() => {
    if (!isImageGen && !isVideoGen) return
    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current)
      promptDebounceRef.current = null
    }
    if (promptDraft !== promptFromConfig) {
      updateCfg({ prompt: promptDraft })
    }
  }, [isImageGen, isVideoGen, promptDraft, promptFromConfig, updateCfg])

  useEffect(() => {
    if (!isTextInput) return
    if (textDraft === textFromConfig) return

    if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    textDebounceRef.current = setTimeout(() => {
      updateCfg({ text: textDraft })
      textDebounceRef.current = null
    }, 200)

    return () => {
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    }
  }, [isTextInput, textDraft, textFromConfig, updateCfg])

  useEffect(() => {
    if (!isImageGen && !isVideoGen) return
    if (promptDraft === promptFromConfig) return

    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    promptDebounceRef.current = setTimeout(() => {
      updateCfg({ prompt: promptDraft })
      promptDebounceRef.current = null
    }, 200)

    return () => {
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    }
  }, [isImageGen, isVideoGen, promptDraft, promptFromConfig, updateCfg])

  useEffect(() => {
    return () => {
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    }
  }, [])

  function handleModelChange(val: ModelType) {
    const model = IMAGE_MODEL_OPTIONS.find((m) => m.value === val)!
    const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0]
    updateCfg({ modelType: val, resolution: res })
  }

  const handleExecuteImage = useCallback(async () => {
    const modelCode = MODEL_CODE_MAP[modelType][resolution]
    if (!modelCode) { toast.error('模型配置错误'); return }
    const finalPrompt = [...upstreamTexts, promptDraft].filter(Boolean).join('\n')
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
          referenceImageUrls: orderedImageRefs.length > 0 ? orderedImageRefs.map(r => r.url) : undefined,
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
  }, [canvasId, node.id, promptDraft, modelType, resolution, aspectRatio, quantity, watermark, workspaceId, token,
      upstreamTexts, orderedImageRefs, setNodeProgress, setNodeError, onExecuted])

  // ── Video gen state ──────────────────────────────────────────────────────────
  const videoModel: string = cfg.model ?? 'seedance-2.0'
  const videoMode: VideoMode = cfg.videoMode ?? 'multiref'
  const videoAspect: string = cfg.aspectRatio ?? 'adaptive'
  const videoDuration: number = cfg.duration ?? 5
  const generateAudio: boolean = cfg.generateAudio ?? true
  const cameraFixed: boolean = cfg.cameraFixed ?? false
  const videoWatermark: boolean = cfg.watermark ?? false

  const currentVideoModel = VIDEO_MODEL_OPTIONS.find((m) => m.value === videoModel) ?? VIDEO_MODEL_OPTIONS[0]
  const isSeedance = currentVideoModel.isSeedance
  const isSeedance2 = currentVideoModel.isSeedance2
  const videoCredits = isSeedance
    ? (VIDEO_CREDITS_PER_SEC[videoModel] ?? 3) * (videoDuration === -1 ? 15 : videoDuration)
    : (VIDEO_CREDITS_PER_SEC[videoModel] ?? 10)

  // When model changes, auto-switch mode if current mode not supported
  function handleVideoModelChange(val: string) {
    const m = VIDEO_MODEL_OPTIONS.find((o) => o.value === val)
    if (!m) return
    const newMode = videoMode === 'multiref' && !m.supportsMultiref ? 'keyframe' : videoMode
    // Reset aspect ratio when switching between seedance/non-seedance
    const newAspect = m.isSeedance ? (videoAspect || 'adaptive') : ''
    updateCfg({ model: val, videoMode: newMode, aspectRatio: newAspect })
  }

  // When mode changes, remove edges connected to handles that are now hidden
  function handleVideoModeChange(newMode: VideoMode) {
    if (newMode === videoMode) return
    updateCfg({ videoMode: newMode })
    if (newMode === 'keyframe') {
      // switching to keyframe: remove multiref any-in edges
      removeEdgesByTarget(node.id, ['any-in'])
    } else {
      // switching to multiref: remove keyframe handles (including text-in)
      removeEdgesByTarget(node.id, ['frame-start', 'frame-end', 'text-in'])
    }
  }

  const handleExecuteVideo = useCallback(async () => {
    const finalPrompt = [...upstreamTexts, promptDraft].filter(Boolean).join('\n')
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
          aspectRatio: videoAspect || undefined,
          duration: videoDuration,
          generateAudio,
          cameraFixed,
          watermark: videoWatermark,
          referenceImages: videoMode === 'multiref' ? multirefImages : undefined,
          referenceVideos: videoMode === 'multiref' ? multirefVideos : undefined,
          referenceAudios: videoMode === 'multiref' ? multirefAudios : undefined,
          frameStart: videoMode === 'keyframe' ? namedRefUrls['frame-start'] : undefined,
          frameEnd:   videoMode === 'keyframe' ? namedRefUrls['frame-end']   : undefined,
        },
        token ?? undefined
      )
      toast.success('已提交视频生成任务')
      onExecuted()
    } catch (err: any) {
      const msg = err.message ?? '执行失败'
      const isSubmitFail = msg.includes('视频生成服务暂时不可用') || msg.includes('任务创建失败')
      toast.error(isSubmitFail ? `${msg}（积分已退回）` : msg)
      setNodeError(node.id, isSubmitFail ? '提交失败，积分已退回' : msg)
      setNodeProgress(node.id, 0, false)
    } finally {
      setExecuting(false)
    }
  }, [canvasId, node.id, promptDraft, videoModel, videoMode, videoAspect, videoDuration, generateAudio,
      cameraFixed, videoWatermark, workspaceId, token, upstreamTexts, multirefImages, multirefVideos, multirefAudios,
      namedRefUrls, setNodeProgress, setNodeError, onExecuted])

  const hasImagePrompt = promptDraft.trim() || upstreamTexts.length > 0
  const hasVideoPrompt = promptDraft.trim() || upstreamTexts.length > 0

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
          {upstreamTextNodeLabels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {upstreamTextNodeLabels.map((label, i) => (
                <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                  [{label}]+
                </span>
              ))}
            </div>
          )}
          <textarea
            className="w-full h-20 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="输入提示词内容..."
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={flushTextDraft}
          />
        </div>
      )}

      {/* ── Image gen node ── */}
      {isImageGen && (
        <div className="flex gap-0 divide-x divide-border">
          {/* Col 1: Prompt + named ref previews */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 200 }}>
            <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
            {upstreamTextNodeLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {upstreamTextNodeLabels.map((label, i) => (
                  <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                    [{label}]+
                  </span>
                ))}
              </div>
            )}
            <textarea
              className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[100px]"
              placeholder="描述你想生成的图片..."
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onBlur={flushPromptDraft}
            />
            {orderedImageRefs.length > 0 && (
              <div className="mt-1">
                <label className="text-[10px] text-muted-foreground mb-1 block">参考图（按引脚顺序）</label>
                <div className="flex gap-1 flex-wrap">
                  {orderedImageRefs.map((ref, i) => (
                    <div key={i} className="relative">
                      <img src={ref.url} alt="" className="w-10 h-10 object-cover rounded border border-border" />
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
                onClick={() => handleVideoModeChange('multiref')}
                disabled={!currentVideoModel.supportsMultiref}
                className={cn('flex-1 py-1 transition-colors',
                  videoMode === 'multiref' ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed'
                )}>全能参考</button>
              <button
                onClick={() => handleVideoModeChange('keyframe')}
                className={cn('flex-1 py-1 transition-colors',
                  videoMode === 'keyframe' ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                )}>首尾帧</button>
            </div>

            <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
            {upstreamTextNodeLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {upstreamTextNodeLabels.map((label, i) => (
                  <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                    [{label}]+
                  </span>
                ))}
              </div>
            )}
            <textarea
              className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
              placeholder="描述视频内容..."
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onBlur={flushPromptDraft}
            />

            {/* 全能参考 preview */}
            {videoMode === 'multiref' && orderedImageRefs.length > 0 && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">已连接素材</label>
                <div className="flex gap-1 flex-wrap">
                  {orderedImageRefs.map((ref, i) => {
                    const isVid = ref.mimeType?.startsWith('video')
                    const isAud = ref.mimeType?.startsWith('audio')
                    return (
                      <div key={i} className="relative w-12 h-12 rounded border border-border bg-muted/20 flex items-center justify-center overflow-hidden">
                        {isAud ? (
                          <Music className="w-5 h-5 text-muted-foreground" />
                        ) : isVid ? (
                          <Video className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <img src={ref.url} alt="" className="w-full h-full object-cover" />
                        )}
                        <span className="absolute -top-1 -left-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold">{i+1}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {videoMode === 'multiref' && orderedImageRefs.length === 0 && (
              <div className="text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2 text-center">
                可连接图片、视频、音频节点
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
                      <div key={k} className={cn('relative w-14 h-14 rounded border flex items-center justify-center text-[10px] text-muted-foreground font-medium',
                        url ? 'border-border' : 'border-dashed border-muted-foreground/30 bg-muted/20')}>
                        {url
                          ? <><img src={url} alt="" className="w-full h-full object-cover rounded" />
                              <span className="absolute -top-1 -left-1 text-[9px] bg-amber-500 text-white rounded px-1 font-bold">{label}</span></>
                          : <span>{label}帧</span>
                        }
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Col 2: Model (dropdown) + params */}
          <div className="p-3 flex flex-col gap-2" style={{ width: 200 }}>
            {/* Model select */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">模型</label>
              <div className="flex flex-col gap-1">
                {VIDEO_MODEL_OPTIONS.filter(m => videoMode === 'multiref' ? m.supportsMultiref : m.supportsKeyframe).map((m) => {
                  const isActive = videoModel === m.value
                  return (
                    <button key={m.value} onClick={() => handleVideoModelChange(m.value)}
                      className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                        isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground')}>
                      <Film className="w-3 h-3 shrink-0" />
                      <span className="flex-1 truncate text-[10px]">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Aspect ratio */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">比例</label>
              <select
                value={videoAspect}
                onChange={(e) => updateCfg({ aspectRatio: e.target.value })}
                className="w-full h-7 px-2 text-[11px] bg-muted/60 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {(isSeedance ? VIDEO_ASPECT_RATIOS_SEEDANCE : VIDEO_ASPECT_RATIOS_VEO).map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>

            {/* Duration (Seedance only) */}
            {isSeedance && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">时长</label>
                <select
                  value={String(videoDuration)}
                  onChange={(e) => updateCfg({ duration: Number(e.target.value) })}
                  className="w-full h-7 px-2 text-[11px] bg-muted/60 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SEEDANCE_DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Audio + Camera (Seedance only) */}
            {isSeedance && (
              <div className="grid grid-cols-2 gap-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">音频</label>
                  <div className="flex gap-1">
                    {[{ v: true, l: '有声' }, { v: false, l: '无声' }].map(({ v, l }) => (
                      <button key={String(v)} onClick={() => updateCfg({ generateAudio: v })}
                        className={cn('flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors',
                          generateAudio === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">镜头</label>
                  <div className="flex gap-1">
                    {[{ v: false, l: '自由' }, { v: true, l: '固定' }].map(({ v, l }) => (
                      <button key={String(v)} onClick={() => updateCfg({ cameraFixed: v })}
                        className={cn('flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors',
                          cameraFixed === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Watermark (Seedance only) */}
            {isSeedance && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">水印</label>
                <div className="flex gap-1">
                  {[{ v: false, l: '无' }, { v: true, l: '有' }].map(({ v, l }) => (
                    <button key={String(v)} onClick={() => updateCfg({ watermark: v })}
                      className={cn('flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors',
                        videoWatermark === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted')}>{l}</button>
                  ))}
                </div>
              </div>
            )}

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
