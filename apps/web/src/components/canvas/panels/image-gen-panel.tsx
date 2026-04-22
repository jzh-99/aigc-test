import { Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import {
  ASPECT_RATIOS_IMAGE,
  IMAGE_MODEL_OPTIONS,
  type ModelType,
  QUANTITY_OPTIONS,
  type Resolution,
} from './panel-constants'

interface OrderedImageRef {
  url: string
}

interface ImageGenPanelProps {
  promptDraft: string
  setPromptDraft: (value: string) => void
  flushPromptDraft: () => void
  upstreamTextNodeLabels: string[]
  orderedImageRefs: OrderedImageRef[]
  modelType: ModelType
  resolution: Resolution
  aspectRatio: string
  quantity: number
  watermark: boolean
  executing: boolean
  hasPrompt: boolean
  onModelChange: (value: ModelType) => void
  onUpdateCfg: (patch: Record<string, unknown>) => void
  onExecute: () => void
}

export function ImageGenPanel({
  promptDraft,
  setPromptDraft,
  flushPromptDraft,
  upstreamTextNodeLabels,
  orderedImageRefs,
  modelType,
  resolution,
  aspectRatio,
  quantity,
  watermark,
  executing,
  hasPrompt,
  onModelChange,
  onUpdateCfg,
  onExecute,
}: ImageGenPanelProps) {
  const currentModel = IMAGE_MODEL_OPTIONS.find((m) => m.value === modelType) ?? IMAGE_MODEL_OPTIONS[0]
  const showQualitySelector = modelType !== 'gpt-image-2'
  const credits = IMAGE_MODEL_CREDITS[modelType] ?? 5

  return (
    <div className="flex gap-0 divide-x divide-border">
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
                  <span className="absolute -top-1 -left-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold">参{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1" style={{ width: 160 }}>
        <label className="text-[11px] font-medium text-muted-foreground">模型</label>
        <div className="flex flex-col gap-1">
          {IMAGE_MODEL_OPTIONS.map((m) => {
            const Icon = m.icon
            const isActive = modelType === m.value
            return (
              <button
                key={m.value}
                onClick={() => onModelChange(m.value)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                  isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
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

      <div className="p-3 flex flex-col gap-3" style={{ width: 140 }}>
        {showQualitySelector && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">分辨率</label>
            <div className="flex flex-wrap gap-1">
              {currentModel.resolutions.map((r) => (
                <button
                  key={r}
                  onClick={() => onUpdateCfg({ resolution: r })}
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
        )}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">宽高比</label>
          <div className="flex flex-wrap gap-1">
            {ASPECT_RATIOS_IMAGE.map((r) => (
              <button
                key={r}
                onClick={() => onUpdateCfg({ aspectRatio: r })}
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

      <div className="p-3 flex flex-col gap-3 justify-between" style={{ width: 120 }}>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">数量</label>
          <div className="flex gap-1">
            {QUANTITY_OPTIONS.map((q) => (
              <button
                key={q}
                onClick={() => onUpdateCfg({ quantity: q })}
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
              onClick={() => onUpdateCfg({ watermark: !watermark })}
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
          data-testid="canvas-execute-image"
          onClick={onExecute}
          disabled={executing || !hasPrompt}
          className="mt-auto w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground py-2 rounded-lg text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {executing ? <><Loader2 className="w-3 h-3 animate-spin" />提交中</> : <><Play className="w-3 h-3" />执行 · {credits * quantity}积分</>}
        </button>
      </div>
    </div>
  )
}
