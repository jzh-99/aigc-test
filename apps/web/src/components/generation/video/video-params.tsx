// apps/web/src/components/generation/video/video-params.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins } from 'lucide-react'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, type ModelItem } from '@aigc/types'
import { VideoConfigPopover } from '../shared/video-config-popover'

interface VideoParamsProps {
  models?: ModelItem[]
  videoModel: string
  videoAspectRatio: string
  videoResolution: string
  videoDuration: number
  referenceVideoDurations: number[]
  videoGenerateAudio: boolean
  isSeedance: boolean
  isGenerating: boolean
  isUploading: boolean
  disabled?: boolean
  promptEmpty?: boolean
  showConfigControls?: boolean
  onAspectRatioChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onDurationChange: (v: number) => void
  onGenerateAudioChange: (v: boolean) => void
  onGenerate: () => void
}

export function VideoParams({
  models, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty, showConfigControls = true,
  onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange,
  onGenerate,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled

  const currentDbModel = models?.find((m) => m.code === videoModel)

  const dbResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const dbAspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')
  const dbDurationOptions = extractSchemaEnums(currentDbModel?.params_schema, 'time_length').map((item) => {
    const num = Number(item.value)
    return { value: num, label: num === -1 ? '自动' : `${num}秒` }
  })

  // 当前生效分辨率
  const activeResolution = videoResolution || dbResolutions[0]?.value || '720p'

  // 积分计算
  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, activeResolution) : 0
  const billableDuration = (videoDuration === -1 ? 15 : videoDuration) + calculateReferenceVideoDurationSeconds(referenceVideoDurations)
  const estimatedCredits = isSeedance ? billableDuration * unitPrice : unitPrice

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      {/* 左侧：配置摘要 Popover */}
      {showConfigControls ? (
        <VideoConfigControls
          dbResolutions={dbResolutions}
          dbAspectRatios={dbAspectRatios}
          dbDurationOptions={dbDurationOptions}
          videoAspectRatio={videoAspectRatio}
          videoResolution={activeResolution}
          videoDuration={videoDuration}
          videoGenerateAudio={videoGenerateAudio}
          isSeedance={isSeedance}
          disabled={isDisabled}
          onAspectRatioChange={onAspectRatioChange}
          onResolutionChange={onResolutionChange}
          onDurationChange={onDurationChange}
          onGenerateAudioChange={onGenerateAudioChange}
        />
      ) : <div />}

      {/* 右侧：积分 + 生成按钮 */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits} A豆</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isDisabled || promptEmpty}>
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
            : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </div>
  )
}

export function VideoConfigControls({
  dbResolutions,
  dbAspectRatios,
  dbDurationOptions,
  videoAspectRatio,
  videoResolution,
  videoDuration,
  videoGenerateAudio,
  isSeedance,
  disabled,
  onAspectRatioChange,
  onResolutionChange,
  onDurationChange,
  onGenerateAudioChange,
}: {
  dbResolutions: ReturnType<typeof extractSchemaEnums>
  dbAspectRatios: ReturnType<typeof extractSchemaEnums>
  dbDurationOptions: Array<{ value: number; label: string }>
  videoAspectRatio: string
  videoResolution: string
  videoDuration: number
  videoGenerateAudio: boolean
  isSeedance: boolean
  disabled?: boolean
  onAspectRatioChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onDurationChange: (v: number) => void
  onGenerateAudioChange: (v: boolean) => void
}) {
  const currentAspectLabel = dbAspectRatios.find((ar) => ar.value === videoAspectRatio)?.label ?? videoAspectRatio
  const currentDurationLabel = dbDurationOptions.find((opt) => opt.value === videoDuration)?.label ?? `${videoDuration}s`
  const configSummary = [
    videoResolution.toUpperCase(),
    videoAspectRatio === 'adaptive' ? null : currentAspectLabel,
    isSeedance ? currentDurationLabel : null,
  ].filter(Boolean).join(' · ')
  const resolutionOptions = dbResolutions.map((r) => r.value)

  return (
    <div className="flex items-center gap-1.5">
      <VideoConfigPopover
        summary={configSummary}
        videoResolution={videoResolution}
        resolutionOptions={resolutionOptions}
        videoAspect={videoAspectRatio}
        aspectOptions={dbAspectRatios}
        videoDuration={videoDuration}
        durationOptions={dbDurationOptions}
        isSeedance={isSeedance}
        generateAudio={videoGenerateAudio}
        onResolutionChange={onResolutionChange}
        onAspectRatioChange={onAspectRatioChange}
        onDurationChange={onDurationChange}
        onGenerateAudioChange={onGenerateAudioChange}
        disabled={disabled}
      />
    </div>
  )
}
