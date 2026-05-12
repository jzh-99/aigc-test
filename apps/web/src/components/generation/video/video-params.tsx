'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins, Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VIDEO_MODEL_OPTIONS, VIDEO_ASPECT_RATIOS_DEFAULT, VIDEO_ASPECT_RATIOS_SEEDANCE,
  VIDEO_RESOLUTIONS, SEEDANCE_DURATION_OPTIONS,
} from '../shared/constants'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import type { ModelItem } from '@aigc/types'

type VideoMode = 'frames' | 'components' | 'multimodal'

interface VideoParamsProps {
  models?: ModelItem[]
  modelsReady?: boolean
  videoMode: VideoMode
  videoModel: string
  videoAspectRatio: string
  videoUpsample: boolean
  videoDuration: number
  videoGenerateAudio: boolean
  videoCameraFixed: boolean
  isSeedance: boolean
  isGenerating: boolean
  isUploading: boolean
  disabled?: boolean
  onModelChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onUpsampleChange: (v: boolean) => void
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
  models, modelsReady, videoMode, videoModel, videoAspectRatio, videoUpsample, videoDuration,
  videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled,
  onModelChange, onAspectRatioChange, onUpsampleChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onGenerate, onSaveDefaults,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled
  // modelsReady=true 表示接口已返回，此时不再 fallback 到硬编码
  const useDbModels = modelsReady ? true : (models && models.length > 0)

  // 按当前 videoMode 过滤可用模型（DB 模型用 video_categories 字段）
  const availableDbModels = (models && models.length > 0)
    ? models.filter((m) => {
        const cats = Array.isArray(m.video_categories) ? (m.video_categories as string[]) : []
        // video_categories 为空时不过滤（兼容未配置的模型）
        return cats.length === 0 || cats.includes(videoMode)
      })
    : []

  // 当前选中的模型
  const currentDbModel = (models && models.length > 0) ? models.find((m) => m.code === videoModel) : undefined
  const currentStaticModelOpts = VIDEO_MODEL_OPTIONS[videoMode]
  const currentStaticModel = currentStaticModelOpts.find((m) => m.value === videoModel)

  // 分辨率选项：从 params_schema 提取，fallback 到 VIDEO_RESOLUTIONS
  const dbResolutions = (() => {
    if (currentDbModel) {
      return extractSchemaEnums(currentDbModel.params_schema, 'resolution')
    }
    return []
  })()
  const hasDbResolutions = dbResolutions.length > 0

  // 比例选项：从 params_schema 提取，fallback 到 constants.ts
  const dbAspectRatios = (() => {
    if (currentDbModel) {
      const raw = (currentDbModel.params_schema as Record<string, unknown>)?.['aspect_ratio']
      if (Array.isArray(raw)) {
        return raw.map((item) => {
          if (typeof item === 'string') return { value: item, label: item }
          if (item && typeof item === 'object' && 'value' in item) {
            const v = item as { value: unknown; label?: unknown }
            return { value: String(v.value), label: v.label ? String(v.label) : String(v.value) }
          }
          return null
        }).filter((v): v is { value: string; label: string } => v !== null)
      }
    }
    return []
  })()
  const hasDbAspectRatios = dbAspectRatios.length > 0

  // 时长选项：从 params_schema 提取，fallback 到 SEEDANCE_DURATION_OPTIONS
  const dbDurationOptions = (() => {
    if (currentDbModel) {
      const raw = (currentDbModel.params_schema as Record<string, unknown>)?.['time_length']
      if (Array.isArray(raw)) {
        return raw.map((item) => {
          if (typeof item === 'number') return { value: item, label: `${item}秒` }
          if (item && typeof item === 'object' && 'value' in item) {
            const v = item as { value: unknown; label?: unknown }
            return { value: Number(v.value), label: v.label ? String(v.label) : `${v.value}秒` }
          }
          return null
        }).filter((v): v is { value: number; label: string } => v !== null)
      }
    }
    return []
  })()
  const durationOptions = dbDurationOptions.length > 0 ? dbDurationOptions : SEEDANCE_DURATION_OPTIONS

  // 积分估算：按秒计费（Seedance）或按次计费
  const unitPrice = (() => {
    if (currentDbModel) {
      // 当前分辨率对应的单价
      const resolution = hasDbResolutions
        ? (videoUpsample ? dbResolutions[dbResolutions.length - 1] : dbResolutions[0])
        : (videoUpsample ? '1080p' : '720p')
      return getPriceByResolution(currentDbModel, resolution, currentDbModel.credit_cost)
    }
    return currentStaticModel?.credits ?? (isSeedance ? 5 : 10)
  })()

  const estimatedCredits = isSeedance
    ? (videoDuration === -1 ? 15 : videoDuration) * unitPrice
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
                    {useDbModels ? (currentDbModel?.name ?? videoModel) : (currentStaticModel?.label ?? videoModel)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(useDbModels ? availableDbModels : currentStaticModelOpts).map((m) => {
                    const isDbModel = 'code' in m
                    if (isDbModel) {
                      const dbM = m as ModelItem
                      const minPrice = dbM.params_pricing.length > 0
                        ? Math.min(...dbM.params_pricing.map((r) => r.unit_price))
                        : dbM.credit_cost
                      const isModelSeedance = dbM.code.startsWith('seedance-')
                      return (
                        <SelectItem key={dbM.code} value={dbM.code} className="py-2">
                          <div className="flex items-start gap-3">
                            <Film className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm mb-0.5">{dbM.name}</div>
                              {dbM.description && (
                                <div className="text-xs text-muted-foreground leading-snug">{dbM.description}</div>
                              )}
                              <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                                <Coins className="h-3 w-3" />
                                {isModelSeedance ? `${minPrice} 积分/秒` : `${minPrice} 积分/次`}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      )
                    }
                    // fallback 静态模型
                    const staticM = m as typeof currentStaticModelOpts[number]
                    return (
                      <SelectItem key={staticM.value} value={staticM.value} className="py-2">
                        <div className="flex items-start gap-3">
                          <Film className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm mb-0.5">{staticM.label}</div>
                            <div className="text-xs text-muted-foreground leading-snug">{staticM.desc}</div>
                            <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                              <Coins className="h-3 w-3" />
                              {staticM.isSeedance ? `${staticM.credits} 积分/秒` : `${staticM.credits} 积分/次`}
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
              {hasDbResolutions ? (
                // DB 模型：用提取到的分辨率字符串列表
                <Select
                  value={videoUpsample ? dbResolutions[dbResolutions.length - 1] : dbResolutions[0]}
                  onValueChange={(v) => onUpsampleChange(v === dbResolutions[dbResolutions.length - 1])}
                  disabled={isDisabled}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dbResolutions.map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="font-medium">{r}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                // fallback 静态分辨率
                <Select value={String(videoUpsample)} onValueChange={(v) => onUpsampleChange(v === 'true')} disabled={isDisabled}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_RESOLUTIONS.filter((r) => !(r.value === true && videoModel === 'seedance-2.0-fast')).map((r) => (
                      <SelectItem key={String(r.value)} value={String(r.value)}>
                        <span className="font-medium">{r.label}</span>
                        <span className="text-xs text-muted-foreground ml-1.5">{r.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                    {(hasDbAspectRatios ? dbAspectRatios : VIDEO_ASPECT_RATIOS_SEEDANCE).map((ar) => (
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
                    {durationOptions.map((opt) => (
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
                {(hasDbAspectRatios ? dbAspectRatios : VIDEO_ASPECT_RATIOS_DEFAULT).map((ar) => (
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
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isDisabled}>
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
            : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </>
  )
}
