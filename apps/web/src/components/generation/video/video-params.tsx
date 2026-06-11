// apps/web/src/components/generation/video/video-params.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins, Volume2, VolumeX, Move, Lock } from 'lucide-react'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, type ModelItem, type VideoCategory } from '@aigc/types'
import { VideoConfigPopover } from '../shared/video-config-popover'
import { cn } from '@/lib/utils'

type VideoMode = VideoCategory

interface VideoParamsProps {
  models?: ModelItem[]
  videoMode: VideoMode
  videoModel: string
  videoAspectRatio: string
  videoResolution: string
  videoDuration: number
  referenceVideoDurations: number[]
  videoGenerateAudio: boolean
  videoCameraFixed: boolean
  isSeedance: boolean
  isGenerating: boolean
  isUploading: boolean
  disabled?: boolean
  promptEmpty?: boolean
  onAspectRatioChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onDurationChange: (v: number) => void
  onGenerateAudioChange: (v: boolean) => void
  onCameraFixedChange: (v: boolean) => void
  onGenerate: () => void
}

export function VideoParams({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty,
  onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
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

  // ConfigPopover 摘要文本（不含音频/镜头）
  const currentAspectLabel = dbAspectRatios.find((ar) => ar.value === videoAspectRatio)?.label ?? videoAspectRatio
  const currentDurationLabel = dbDurationOptions.find((opt) => opt.value === videoDuration)?.label ?? `${videoDuration}s`
  const configSummary = [
    activeResolution.toUpperCase(),
    currentAspectLabel,
    isSeedance ? currentDurationLabel : null,
  ].filter(Boolean).join(' · ')

  // 分辨率选项
  const resolutionOptions = dbResolutions.map((r) => r.value)

  // icon 指示器按钮样式
  const iconBtnCls = (active: boolean) => cn(
    'inline-flex items-center justify-center rounded-md border p-1.5 transition-colors',
    active
      ? 'border-primary/40 bg-primary/10 text-primary'
      : 'border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
    isDisabled && 'opacity-50 cursor-not-allowed',
  )

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      {/* 左侧：配置摘要 Popover + 音频/镜头 icon 指示器 */}
      <div className="flex items-center gap-1.5">
        <VideoConfigPopover
          summary={configSummary}
          videoResolution={activeResolution}
          resolutionOptions={resolutionOptions}
          videoAspect={videoAspectRatio}
          aspectOptions={dbAspectRatios}
          videoDuration={videoDuration}
          durationOptions={dbDurationOptions}
          isSeedance={isSeedance}
          generateAudio={videoGenerateAudio}
          cameraFixed={videoCameraFixed}
          showCameraFixed={videoMode !== 'frames'}
          onResolutionChange={onResolutionChange}
          onAspectRatioChange={onAspectRatioChange}
          onDurationChange={onDurationChange}
          onGenerateAudioChange={onGenerateAudioChange}
          onCameraFixedChange={onCameraFixedChange}
          disabled={isDisabled}
        />

        {/* 音频 icon 指示器（仅 Seedance） */}
        {isSeedance && (
          <button
            type="button"
            className={iconBtnCls(videoGenerateAudio)}
            disabled={isDisabled}
            onClick={() => onGenerateAudioChange(!videoGenerateAudio)}
            title={videoGenerateAudio ? '有声（点击关闭）' : '无声（点击开启）'}
          >
            {videoGenerateAudio ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* 镜头 icon 指示器（仅 Seedance multimodal） */}
        {isSeedance && videoMode !== 'frames' && (
          <button
            type="button"
            className={iconBtnCls(!videoCameraFixed)}
            disabled={isDisabled}
            onClick={() => onCameraFixedChange(!videoCameraFixed)}
            title={videoCameraFixed ? '固定镜头（点击切换自由）' : '自由镜头（点击切换固定）'}
          >
            {videoCameraFixed ? <Lock className="h-3.5 w-3.5" /> : <Move className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

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
