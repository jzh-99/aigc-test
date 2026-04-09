'use client'

import { useState, useCallback } from 'react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { executeCanvasNode } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'
import { X, Play, Loader2, Sparkles, Zap, Target, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import type { AppNode } from '@/lib/canvas/types'

type ModelType = 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
type Resolution = '1k' | '2k' | '3k' | '4k'

const MODEL_OPTIONS: Array<{
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

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

interface Props {
  node: AppNode
  canvasId: string
  onClose: () => void
  onExecuted: () => void
}

export function NodeParamPanel({ node, canvasId, onClose, onExecuted }: Props) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)
  const executionNodes = useCanvasExecutionStore((s) => s.nodes)
  const setNodeProgress = useCanvasExecutionStore((s) => s.setNodeProgress)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const token = useAuthStore((s) => s.accessToken)
  const [executing, setExecuting] = useState(false)

  const cfg = node.data.config ?? {}
  const isImageGen = node.type === 'image_gen'
  const isTextInput = node.type === 'text_input'
  const isAsset = node.type === 'asset'

  const modelType: ModelType = cfg.modelType ?? 'gemini'
  const resolution: Resolution = cfg.resolution ?? '2k'
  const aspectRatio: string = cfg.aspectRatio ?? '1:1'
  const quantity: number = cfg.quantity ?? 1
  const watermark: boolean = cfg.watermark ?? false
  const prompt: string = cfg.prompt ?? ''

  const currentModel = MODEL_OPTIONS.find((m) => m.value === modelType) ?? MODEL_OPTIONS[0]
  const credits = IMAGE_MODEL_CREDITS[modelType] ?? 5

  // Collect upstream nodes connected to this node
  const upstreamNodes = edges
    .filter((e) => e.target === node.id)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter(Boolean) as AppNode[]

  const upstreamTexts = upstreamNodes
    .filter((n) => n.type === 'text_input')
    .map((n) => (n.data.config as any)?.text ?? '')
    .filter(Boolean)

  // Collect reference image URLs from upstream image_gen and asset nodes
  const upstreamImageUrls = upstreamNodes
    .filter((n) => n.type === 'image_gen' || n.type === 'asset')
    .map((n) => {
      if (n.type === 'asset') return (n.data.config as any)?.url as string | undefined
      // For image_gen: use selected output from execution store
      const execState = executionNodes[n.id]
      if (!execState) return undefined
      const selected = execState.outputs.find((o) => o.id === execState.selectedOutputId)
      return selected?.url
    })
    .filter((url): url is string => !!url)

  function updateCfg(patch: Record<string, any>) {
    updateNodeData(node.id, { config: { ...cfg, ...patch } })
  }

  function handleModelChange(val: ModelType) {
    const model = MODEL_OPTIONS.find((m) => m.value === val)!
    const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0]
    updateCfg({ modelType: val, resolution: res })
  }

  const handleExecute = useCallback(async () => {
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
          referenceImageUrls: upstreamImageUrls.length > 0 ? upstreamImageUrls : undefined,
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
      upstreamTexts, upstreamImageUrls, setNodeProgress, setNodeError, onExecuted])

  const hasPrompt = prompt.trim() || upstreamTexts.length > 0

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
          {cfg.url && (
            <img src={cfg.url} alt={cfg.name} className="w-full rounded-lg object-contain max-h-48" />
          )}
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
          {/* Col 1: Prompt + reference preview */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 200 }}>
            <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
            <textarea
              className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[100px]"
              placeholder="描述你想生成的图片..."
              value={prompt}
              onChange={(e) => updateCfg({ prompt: e.target.value })}
            />
            {upstreamImageUrls.length > 0 && (
              <div className="mt-1">
                <label className="text-[10px] text-muted-foreground mb-1 block">参考图 ({upstreamImageUrls.length})</label>
                <div className="flex gap-1 flex-wrap">
                  {upstreamImageUrls.map((url, i) => (
                    <img key={i} src={url} alt="" className="w-10 h-10 object-cover rounded border border-border" />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Col 2: Model */}
          <div className="p-3 flex flex-col gap-1" style={{ width: 160 }}>
            <label className="text-[11px] font-medium text-muted-foreground">模型</label>
            <div className="flex flex-col gap-1">
              {MODEL_OPTIONS.map((m) => {
                const Icon = m.icon
                const isActive = modelType === m.value
                return (
                  <button
                    key={m.value}
                    onClick={() => handleModelChange(m.value)}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                      isActive
                        ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
                    )}
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="flex-1 truncate">{m.label}</span>
                    <span className={cn('text-[10px]', isActive ? 'text-primary/70' : 'text-muted-foreground')}>
                      {IMAGE_MODEL_CREDITS[m.value]}
                    </span>
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
                  <button
                    key={r}
                    onClick={() => updateCfg({ resolution: r })}
                    className={cn(
                      'px-2 py-0.5 rounded text-[11px] font-medium border transition-colors',
                      resolution === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                    )}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">宽高比</label>
              <div className="flex flex-wrap gap-1">
                {ASPECT_RATIOS.map((r) => (
                  <button
                    key={r}
                    onClick={() => updateCfg({ aspectRatio: r })}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[11px] border transition-colors',
                      aspectRatio === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                    )}
                  >
                    {r}
                  </button>
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
                  <button
                    key={q}
                    onClick={() => updateCfg({ quantity: q })}
                    className={cn(
                      'flex-1 py-0.5 rounded text-[11px] font-medium border transition-colors',
                      quantity === q ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                    )}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {currentModel.supportsWatermark && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">水印</label>
                <button
                  onClick={() => updateCfg({ watermark: !watermark })}
                  className={cn(
                    'w-full py-0.5 rounded text-[11px] font-medium border transition-colors',
                    watermark ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                  )}
                >
                  {watermark ? '开' : '关'}
                </button>
              </div>
            )}

            <button
              onClick={handleExecute}
              disabled={executing || !hasPrompt}
              className="mt-auto w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground py-2 rounded-lg text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {executing ? (
                <><Loader2 className="w-3 h-3 animate-spin" />提交中</>
              ) : (
                <><Play className="w-3 h-3" />执行 · {credits * quantity}积分</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
