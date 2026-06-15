// apps/web/src/components/generation/image/image-params.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins, Images } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUANTITY_OPTIONS } from '../shared/constants'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import type { ModelItem } from '@aigc/types'
import { ConfigOptionGroup } from '../shared/video-config-popover'
import { VideoConfigPopover } from '../shared/video-config-popover'

interface ImageParamsProps {
  models?: ModelItem[]
  modelType: string
  resolution: string
  aspectRatio: string
  quantity: number
  isGenerating: boolean
  disabled?: boolean
  promptEmpty?: boolean
  showConfigControls?: boolean
  showQuantitySelect?: boolean
  onResolutionChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onQuantityChange: (v: number) => void
  onGenerate: () => void
}

export function ImageParams({
  models, modelType, resolution, aspectRatio, quantity,
  isGenerating, disabled, promptEmpty, showConfigControls = true, showQuantitySelect = true,
  onResolutionChange, onAspectRatioChange, onQuantityChange,
  onGenerate,
}: ImageParamsProps) {
  const isDisabled = isGenerating || !!disabled

  const currentDbModel = models?.find((m) => m.code === modelType)
  const availableResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const availableAspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')

  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, resolution) : 0
  const estimatedCredits = unitPrice * quantity

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      {/* 左侧：配置摘要 Popover + 数量 */}
      {showConfigControls ? (
        <ImageConfigControls
          availableResolutions={availableResolutions}
          availableAspectRatios={availableAspectRatios}
          resolution={resolution}
          aspectRatio={aspectRatio}
          quantity={quantity}
          disabled={isDisabled}
          onResolutionChange={onResolutionChange}
          onAspectRatioChange={onAspectRatioChange}
          onQuantityChange={onQuantityChange}
          showQuantitySelect={showQuantitySelect}
        />
      ) : <div />}

      {/* 右侧：积分 + 生成按钮 */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits} A豆</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isDisabled || promptEmpty}>
          {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</> : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </div>
  )
}

export function ImageConfigControls({
  availableResolutions,
  availableAspectRatios,
  resolution,
  aspectRatio,
  quantity,
  disabled,
  showQuantitySelect = true,
  onResolutionChange,
  onAspectRatioChange,
  onQuantityChange,
}: {
  availableResolutions: ReturnType<typeof extractSchemaEnums>
  availableAspectRatios: ReturnType<typeof extractSchemaEnums>
  resolution: string
  aspectRatio: string
  quantity: number
  disabled?: boolean
  showQuantitySelect?: boolean
  onResolutionChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onQuantityChange: (v: number) => void
}) {
  const defaultAspectRatios = [
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
  ]
  const aspectRatios = availableAspectRatios.length > 0 ? availableAspectRatios : defaultAspectRatios
  const resolutionOptions = availableResolutions.map((r) => r.value)
  const currentResLabel = availableResolutions.find((r) => r.value === resolution)?.label ?? resolution
  const currentAspectLabel = aspectRatios.find((ar) => ar.value === aspectRatio)?.label ?? aspectRatio
  const configSummary = [currentResLabel, currentAspectLabel, `${quantity}张`].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-1.5">
      <VideoConfigPopover
        summary={configSummary}
        videoResolution={resolution}
        resolutionOptions={resolutionOptions}
        videoAspect={aspectRatio}
        aspectOptions={aspectRatios}
        videoDuration={0}
        durationOptions={[]}
        isSeedance={false}
        onResolutionChange={onResolutionChange}
        onAspectRatioChange={onAspectRatioChange}
        onDurationChange={() => {}}
      >
        {showQuantitySelect && (
          <ConfigOptionGroup
            icon={<Images className="h-3 w-3" />}
            label="生成数量"
            value={String(quantity)}
            options={QUANTITY_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(value) => onQuantityChange(Number(value))}
            disabled={disabled}
          />
        )}
      </VideoConfigPopover>
    </div>
  )
}

// 导出 ConfigOptionGroup 供 image-panel 的模型选择器使用
export { ConfigOptionGroup }
