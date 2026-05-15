import { Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import {
  ASPECT_RATIOS_IMAGE,
  IMAGE_MODEL_OPTIONS,
  type ModelType,
  type Resolution,
} from './panel-constants'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import type { ModelItem } from '@aigc/types'

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
  executing: boolean
  hasPrompt: boolean
  /** 动态模型列表，来自 /models?module=image */
  models?: ModelItem[]
  modelsReady?: boolean
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
  executing,
  hasPrompt,
  models,
  modelsReady,
  onModelChange,
  onUpdateCfg,
  onExecute,
}: ImageGenPanelProps) {
  // 优先使用 DB 模型数据，fallback 到静态常量
  const useDbModels = modelsReady && models && models.length > 0
  const currentDbModel = useDbModels ? models!.find((m) => m.code === modelType) : undefined
  const currentStaticModel = IMAGE_MODEL_OPTIONS.find((m) => m.value === modelType) ?? IMAGE_MODEL_OPTIONS[0]

  // 分辨率列表：优先从 DB 模型的 params_schema 提取
  const resolutions: string[] = (() => {
    if (currentDbModel) {
      const enums = extractSchemaEnums(currentDbModel.params_schema, 'resolution')
      if (enums.length > 0) return enums
    }
    return currentStaticModel.resolutions
  })()

  // 宽高比列表：优先从 DB 模型的 params_schema 提取
  const aspectRatios: string[] = (() => {
    if (currentDbModel) {
      const enums = extractSchemaEnums(currentDbModel.params_schema, 'aspect_ratio')
      if (enums.length > 0) return enums
    }
    return [...ASPECT_RATIOS_IMAGE]
  })()

  // 积分：优先从 DB 模型的 params_pricing 计算
  const credits = (() => {
    if (currentDbModel) {
      return getPriceByResolution(currentDbModel, resolution, IMAGE_MODEL_CREDITS[modelType] ?? 5)
    }
    return IMAGE_MODEL_CREDITS[modelType] ?? 5
  })()

  const showQualitySelector = modelType !== 'gpt-image-2'

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
          {useDbModels
            ? models!.map((m) => {
                const isActive = modelType === m.code
                // DB 模型的默认积分取第一条 params_pricing
                const modelCredits = m.params_pricing[0]?.unit_price ?? IMAGE_MODEL_CREDITS[m.code] ?? 5
                return (
                  <button
                    key={m.code}
                    onClick={() => onModelChange(m.code as ModelType)}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                      isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
                    )}
                  >
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className={cn('text-[10px]', isActive ? 'text-primary/70' : 'text-muted-foreground')}>
                      {modelCredits}
                    </span>
                  </button>
                )
              })
            : IMAGE_MODEL_OPTIONS.map((m) => {
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
              {resolutions.map((r) => (
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
            {aspectRatios.map((r) => (
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
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <label className="font-medium">数量</label>
          <div className="rounded border bg-muted/40 px-2 py-1 text-foreground">固定 1 张</div>
        </div>

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
