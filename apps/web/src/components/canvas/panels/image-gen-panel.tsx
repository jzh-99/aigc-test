import { Loader2, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import { ASPECT_RATIOS_IMAGE } from './panel-constants'
import { ResourceMentionTextarea } from './resource-mention-textarea'
import { getMaxImageReferenceCount } from '@/lib/image-categories'
import type { CanvasReferenceMentionResource } from './resource-mentions'
import type { ModelType, Resolution } from './panel-constants'
import type { ModelItem } from '@aigc/types'

interface ImageGenPanelProps {
  promptDraft: string
  setPromptDraft: (value: string) => void
  flushPromptDraft: () => void
  upstreamTextNodeLabels: string[]
  orderedImageRefs: CanvasReferenceMentionResource[]
  mentionResources: CanvasReferenceMentionResource[]
  modelType: ModelType
  resolution: Resolution
  aspectRatio: string
  quantity: number
  executing: boolean
  hasPrompt: boolean
  models?: ModelItem[]
  modelsReady?: boolean
  onModelChange: (value: ModelType) => void
  onUpdateCfg: (patch: Record<string, unknown>) => void
  onRemoveReference: (resourceId: string) => void
  onExecute: () => void
}

export function ImageGenPanel({
  promptDraft,
  setPromptDraft,
  flushPromptDraft,
  upstreamTextNodeLabels,
  orderedImageRefs,
  mentionResources,
  modelType,
  resolution,
  aspectRatio,
  quantity,
  executing,
  hasPrompt,
  models,
  onModelChange,
  onUpdateCfg,
  onRemoveReference,
  onExecute,
}: ImageGenPanelProps) {
  const currentDbModel = models?.find((m) => m.code === modelType)

  const resolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution').map((e) => e.value)
  const aspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio').map((e) => e.value)
  const displayAspectRatios = aspectRatios.length > 0 ? aspectRatios : [...ASPECT_RATIOS_IMAGE]

  const credits = currentDbModel
    ? getPriceByResolution(currentDbModel, resolution, currentDbModel.credit_cost ?? 5)
    : 0

  const showQualitySelector = modelType !== 'gpt-image-2' && resolutions.length > 1

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
        <ResourceMentionTextarea
          minHeightClassName="min-h-[100px]"
          placeholder="描述你想生成的图片..."
          value={promptDraft}
          resources={mentionResources}
          onChange={setPromptDraft}
          onBlur={flushPromptDraft}
        />
        {orderedImageRefs.length > 0 && (
          <div className="mt-1">
            <label className="text-[10px] text-muted-foreground mb-1 block">参考图（按引脚顺序）</label>
            <div className="flex gap-1 flex-wrap">
              {orderedImageRefs.map((ref, i) => (
                <div key={ref.id} data-testid={`canvas-reference-preview-${ref.mentionLabel}`} className="group/reference relative">
                  <img src={ref.url} alt={ref.mentionLabel} className="w-10 h-10 object-cover rounded border border-border" loading="lazy" />
                  <span className="absolute -top-1 -left-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold">参{i + 1}</span>
                  <button
                    type="button"
                    data-testid={`canvas-reference-remove-${ref.mentionLabel}`}
                    aria-label="取消引用"
                    title={`取消引用${ref.mentionLabel}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveReference(ref.id)
                    }}
                    className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow ring-1 ring-border transition group-hover/reference:pointer-events-auto group-hover/reference:opacity-100 group-focus-within/reference:pointer-events-auto group-focus-within/reference:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1" style={{ width: 160 }}>
        <label className="text-[11px] font-medium text-muted-foreground">模型</label>
        <div className="flex flex-col gap-1">
          {(models ?? []).map((m) => {
            const isActive = modelType === m.code
            const modelCredits = m.params_pricing[0]?.unit_price ?? m.credit_cost ?? 5
            const maxReferenceImages = getMaxImageReferenceCount(m)
            const isReferenceOverLimit = !isActive && orderedImageRefs.length > maxReferenceImages
            return (
              <button
                key={m.code}
                type="button"
                disabled={isReferenceOverLimit}
                title={isReferenceOverLimit ? `当前已连接 ${orderedImageRefs.length} 张参考图，该模型最多支持 ${maxReferenceImages} 张` : undefined}
                onClick={() => onModelChange(m.code as ModelType)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                  isActive
                    ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                    : isReferenceOverLimit
                      ? 'bg-muted/20 border-transparent text-muted-foreground/50 cursor-not-allowed opacity-60'
                      : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
                )}
              >
                <span className="flex-1 truncate">{m.name}</span>
                <span className={cn('text-[10px]', isActive ? 'text-primary/70' : isReferenceOverLimit ? 'text-muted-foreground/50' : 'text-muted-foreground')}>
                  {isReferenceOverLimit ? `最多${maxReferenceImages}` : modelCredits}
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
            {displayAspectRatios.map((r) => (
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
        {/* <div className="space-y-1 text-[11px] text-muted-foreground">
          <label className="font-medium">数量</label>
          <div className="rounded border bg-muted/40 px-2 py-1 text-foreground">固定 1 张</div>
        </div> */}
        
        {/* 质量 */}

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
