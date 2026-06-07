'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins, Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, parseCategoryReferences, type ModelItem, type VideoCategory } from '@aigc/types'

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
  onModelChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onDurationChange: (v: number) => void
  onGenerateAudioChange: (v: boolean) => void
  onCameraFixedChange: (v: boolean) => void
  onGenerate: () => void
  onSaveDefaults: () => void
}

const toggleBtnCls = (active: boolean, disabled: boolean) => cn(
  'py-1.5 px-2 rounded-lg border-2 text-sm font-medium transition-all',
  active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50',
  disabled && 'opacity-50 cursor-not-allowed',
)

export function VideoParams({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty,
  onModelChange, onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onGenerate, onSaveDefaults,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled

  const availableModels = (models ?? []).filter((m) => {
    const categories = parseCategoryReferences(m.category_references)
    return Boolean(categories[videoMode])
  })

  const currentDbModel = models?.find((m) => m.code === videoModel)

  const dbResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const dbAspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')
  const dbDurationOptions = extractSchemaEnums(currentDbModel?.params_schema, 'time_length').map((item) => {
    const num = Number(item.value)
    return { value: num, label: num === -1 ? '自动' : `${num}秒` }
  })

  const unitPrice = currentDbModel
    ? (() => {
        const resolution = videoResolution || (dbResolutions.length > 0 ? dbResolutions[0].value : '720p')
        return getPriceByResolution(currentDbModel, resolution)
      })()
    : 0

  const billableDuration = (videoDuration === -1 ? 15 : videoDuration) + calculateReferenceVideoDurationSeconds(referenceVideoDurations)

  const estimatedCredits = isSeedance
    ? billableDuration * unitPrice
    : unitPrice

  return (
    <>
      <div className="rounded-xl border bg-card p-3 relative">
        <button
          className="absolute top-2 right-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
          disabled={isDisabled}
          onClick={onSaveDefaults}
        >
          设为默认
        </button>
        <div className="space-y-3">
          {/* 模型 + 分辨率 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
              <Select value={videoModel} onValueChange={onModelChange} disabled={isDisabled}>
                <SelectTrigger className="h-9">
                  <SelectValue>
                    {currentDbModel?.name ?? videoModel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => {
                    const minPrice = m.params_pricing.length > 0
                      ? Math.min(...m.params_pricing.map((r) => r.unit_price))
                      : 0
                    const isModelSeedance = m.code.startsWith('seedance-')
                    return (
                      <SelectItem key={m.code} value={m.code} className="py-2">
                        <div className="flex items-start gap-3">
                          <Film className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm mb-0.5">{m.name}</div>
                            {m.description && (
                              <div className="text-xs text-muted-foreground leading-snug">{m.description}</div>
                            )}
                            <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                              <Coins className="h-3 w-3" />
                              {isModelSeedance ? `${minPrice} 积分/秒` : `${minPrice} 积分/次`}
                            </div>
                          </div>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">分辨率</Label>
              <Select
                value={videoResolution || dbResolutions[0]?.value}
                onValueChange={onResolutionChange}
                disabled={isDisabled || dbResolutions.length === 0}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dbResolutions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="font-medium">{r.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 比例 + 时长（Seedance）/ 比例按钮组（其他） */}
          {isSeedance ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
                <Select value={videoAspectRatio} onValueChange={onAspectRatioChange} disabled={isDisabled}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dbAspectRatios.map((ar) => (
                      <SelectItem key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">时长</Label>
                <Select value={String(videoDuration)} onValueChange={(v) => onDurationChange(Number(v))} disabled={isDisabled}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dbDurationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {dbAspectRatios.map((ar) => (
                  <button key={ar.value} onClick={() => onAspectRatioChange(ar.value)} disabled={isDisabled}
                    className={cn('py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                      videoAspectRatio === ar.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50',
                      isDisabled && 'opacity-50 cursor-not-allowed')}>
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 音频 + 镜头（Seedance only） */}
          {isSeedance && (
            videoMode === 'frames' ? (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">音频</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{ value: true, label: '有声' }, { value: false, label: '无声' }].map((opt) => (
                    <button key={String(opt.value)} onClick={() => onGenerateAudioChange(opt.value)} disabled={isDisabled}
                      className={toggleBtnCls(videoGenerateAudio === opt.value, isDisabled)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">音频</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[{ value: true, label: '有声' }, { value: false, label: '无声' }].map((opt) => (
                      <button key={String(opt.value)} onClick={() => onGenerateAudioChange(opt.value)} disabled={isDisabled}
                        className={toggleBtnCls(videoGenerateAudio === opt.value, isDisabled)}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">镜头</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[{ value: false, label: '自由' }, { value: true, label: '固定' }].map((opt) => (
                      <button key={String(opt.value)} onClick={() => onCameraFixedChange(opt.value)} disabled={isDisabled}
                        className={toggleBtnCls(videoCameraFixed === opt.value, isDisabled)}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits} 积分</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isDisabled || promptEmpty}>
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
            : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </>
  )
}
