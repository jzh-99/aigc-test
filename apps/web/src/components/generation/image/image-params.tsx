// apps/web/src/components/generation/image/image-params.tsx
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins } from 'lucide-react'
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
  onResolutionChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onQuantityChange: (v: number) => void
  onGenerate: () => void
}

export function ImageParams({
  models, modelType, resolution, aspectRatio, quantity,
  isGenerating, disabled, promptEmpty,
  onResolutionChange, onAspectRatioChange, onQuantityChange,
  onGenerate,
}: ImageParamsProps) {
  const isDisabled = isGenerating || !!disabled

  const currentDbModel = models?.find((m) => m.code === modelType)
  const availableResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')

  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, resolution) : 0
  const estimatedCredits = unitPrice * quantity

  // 质量选项
  const resolutionOptions = availableResolutions.map((r) => r.value)

  // 比例选项（静态列表）
  const ASPECT_RATIOS = [
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
  ]

  // ConfigPopover 摘要文本
  const currentResLabel = availableResolutions.find((r) => r.value === resolution)?.label ?? resolution
  const currentAspectLabel = ASPECT_RATIOS.find((ar) => ar.value === aspectRatio)?.label ?? aspectRatio
  const configSummary = [
    currentResLabel,
    currentAspectLabel,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      {/* 左侧：配置摘要 Popover + 数量 */}
      <div className="flex items-center gap-1.5">
        <VideoConfigPopover
          summary={configSummary}
          videoResolution={resolution}
          resolutionOptions={resolutionOptions}
          videoAspect={aspectRatio}
          aspectOptions={ASPECT_RATIOS}
          videoDuration={0}
          durationOptions={[]}
          isSeedance={false}
          onResolutionChange={onResolutionChange}
          onAspectRatioChange={onAspectRatioChange}
          onDurationChange={() => {}}
        />

        {/* 数量选择 */}
        <Select value={String(quantity)} onValueChange={(v) => onQuantityChange(Number(v))} disabled={isDisabled}>
          <SelectTrigger className="w-[72px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUANTITY_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} 张</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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

// 导出 ConfigOptionGroup 供 image-panel 的模型选择器使用
export { ConfigOptionGroup }
