'use client'

import { Cpu, Play, Ratio, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/hooks/use-confirm'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import { ASPECT_RATIOS_IMAGE } from './panel-constants'
import { ResourceMentionTextarea } from './resource-mention-textarea'
import { getMaxImageReferenceCount } from '@/lib/image-categories'
import { PopoverSelect, ExecuteButton, PanelToolbar } from './panel-shared'
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
  const confirm = useConfirm()
  const currentDbModel = models?.find((m) => m.code === modelType)

  const resolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution').map((e) => e.value)
  const aspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio').map((e) => e.value)
  const displayAspectRatios = aspectRatios.length > 0 ? aspectRatios : [...ASPECT_RATIOS_IMAGE]

  const credits = currentDbModel
    ? getPriceByResolution(currentDbModel, resolution)
    : 0

  const showQualitySelector = modelType !== 'gpt-image-2' && resolutions.length > 1

  // 构建模型选项列表
  const modelOptions = (models ?? []).map((m) => {
    const maxReferenceImages = getMaxImageReferenceCount(m)
    const isReferenceOverLimit = orderedImageRefs.length > maxReferenceImages
    const modelCredits = m.params_pricing[0]?.unit_price ?? 5
    return {
      value: m.code,
      label: m.name,
      disabled: m.code !== modelType && isReferenceOverLimit,
      hint: isReferenceOverLimit ? `最多${maxReferenceImages}` : `${modelCredits}`,
    }
  })

  // 构建分辨率选项列表
  const resolutionOptions = resolutions.map((r) => ({
    value: r,
    label: r.toUpperCase(),
  }))

  // 构建比例选项列表
  const aspectRatioOptions = displayAspectRatios.map((r) => ({
    value: r,
    label: r,
  }))

  return (
    <div className="p-4 space-y-4">
      {/* 上游文本节点标签 */}
      {upstreamTextNodeLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {upstreamTextNodeLabels.map((label, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
              [{label}]+
            </span>
          ))}
        </div>
      )}

      {/* 提示词大文本框 */}
      <ResourceMentionTextarea
        minHeightClassName="min-h-[160px]"
        placeholder="描述你想生成的图片..."
        value={promptDraft}
        resources={mentionResources}
        onChange={setPromptDraft}
        onBlur={flushPromptDraft}
      />

      {/* 参考图预览 */}
      {orderedImageRefs.length > 0 && (
        <div className="space-y-2">
          <label className="text-[10px] text-muted-foreground">参考图（按引脚顺序）</label>
          <div className="flex gap-2 flex-wrap">
            {orderedImageRefs.map((ref, i) => (
              <div key={ref.id} data-testid={`canvas-reference-preview-${ref.mentionLabel}`} className="group/reference relative">
                <img src={ref.url} alt={ref.mentionLabel} className="w-12 h-12 object-cover rounded-lg border border-border/60" loading="lazy" />
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

      {/* 底部工具栏：Popover 属性 + 执行按钮 */}
      <div className="flex items-center justify-between">
        <PanelToolbar>
          {/* 模型选择 */}
          <PopoverSelect
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="模型"
            value={modelType}
            options={modelOptions}
            onChange={(val) => onModelChange(val as ModelType)}
          />

          {/* 分辨率选择 */}
          {showQualitySelector && (
            <PopoverSelect
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label="分辨率"
              value={resolution}
              options={resolutionOptions}
              onChange={(val) => onUpdateCfg({ resolution: val })}
            />
          )}

          {/* 比例选择 */}
          <PopoverSelect
            icon={<Ratio className="h-3.5 w-3.5" />}
            label="比例"
            value={aspectRatio}
            options={aspectRatioOptions}
            onChange={(val) => onUpdateCfg({ aspectRatio: val })}
          />
        </PanelToolbar>

        <ExecuteButton
          icon={<Play className="h-4 w-4" />}
          credits={credits * quantity}
          executing={executing}
          disabled={!hasPrompt}
          onClick={async () => {
            const ok = await confirm({
              title: '确认生成',
              description: `本次操作预计消耗 ${credits * quantity} A豆（画布图片生成），确认是否继续？`,
              confirmText: '确认生成',
              destructive: false,
            })
            if (!ok) return
            onExecute()
          }}
        />
      </div>
    </div>
  )
}
