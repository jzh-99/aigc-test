'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins, Film, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, parseCategoryReferences, type ModelItem, type VideoCategory } from '@aigc/types'

type VideoMode = VideoCategory

export interface VideoParamsProps {
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

/** 获取当前模型的 schema 枚举和积分信息（共用逻辑） */
function useVideoParamsHelpers(props: VideoParamsProps) {
  const { models, videoMode, videoModel, videoResolution, videoDuration, referenceVideoDurations, isSeedance } = props

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
  const estimatedCredits = isSeedance ? billableDuration * unitPrice : unitPrice

  return { availableModels, currentDbModel, dbResolutions, dbAspectRatios, dbDurationOptions, estimatedCredits }
}

/**
 * 底部单行参数栏 — pill 标签 + A豆 + 生成按钮
 * 用于嵌入视频面板底部第 4 层
 */
export function VideoParamsBar({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty,
  onGenerate,
  onSettingsOpen,
}: VideoParamsProps & { onSettingsOpen: () => void }) {
  const { dbResolutions, estimatedCredits } = useVideoParamsHelpers({
    models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
    referenceVideoDurations, isSeedance,
    videoGenerateAudio: true, videoCameraFixed: false,
    isGenerating, isUploading, disabled, promptEmpty,
    onModelChange: () => {}, onAspectRatioChange: () => {}, onResolutionChange: () => {},
    onDurationChange: () => {}, onGenerateAudioChange: () => {}, onCameraFixedChange: () => {},
    onGenerate, onSaveDefaults: () => {},
  })

  const isDisabled = isGenerating || isUploading || !!disabled

  // 分辨率标签
  const resLabel = dbResolutions.find((r) => r.value === videoResolution)?.label || (videoResolution || '自动')
  // 比例标签
  const ratioLabel = videoAspectRatio === 'adaptive' ? '自适应' : videoAspectRatio
  // 时长标签
  const durationLabel = videoDuration === -1 ? '自动' : `${videoDuration}秒`

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={isDisabled}
      >
        {resLabel}
      </button>

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={isDisabled}
      >
        {ratioLabel}
      </button>

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={isDisabled}
      >
        {durationLabel}
      </button>

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={isDisabled}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 text-[13px] font-medium text-white/70">
        <Coins className="h-4 w-4 text-amber-500" />
        <span>{estimatedCredits} A豆</span>
      </div>

      <button
        className="bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white rounded-lg px-5 py-[7px] text-[13px] font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onGenerate}
        disabled={isGenerating || isUploading || disabled || promptEmpty}
      >
        {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
          : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
          : <><Sparkles className="h-4 w-4" />生成</>}
      </button>
    </div>
  )
}

/**
 * 设置弹窗内容 — 完整参数表单（模型、分辨率、比例、时长、音频、镜头、设为默认）
 * 用于嵌入 GenerationSettingsSheet
 */
export function VideoSettingsContent({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled,
  onModelChange, onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onSaveDefaults,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled
  const { availableModels, currentDbModel, dbResolutions, dbAspectRatios, dbDurationOptions } = useVideoParamsHelpers({
    models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
    referenceVideoDurations, isSeedance,
    videoGenerateAudio, videoCameraFixed,
    isGenerating, isUploading, disabled,
    onModelChange, onAspectRatioChange, onResolutionChange, onDurationChange,
    onGenerateAudioChange, onCameraFixedChange,
    onGenerate: () => {}, onSaveDefaults,
  })

  return (
    <div className="space-y-4">
      {/* 模型选择 */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
        <Select value={videoModel} onValueChange={onModelChange} disabled={isDisabled}>
          <SelectTrigger className="h-9">
            <SelectValue>{currentDbModel?.name ?? videoModel}</SelectValue>
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
                        {isModelSeedance ? `${minPrice} A豆/秒` : `${minPrice} A豆/次`}
                      </div>
                    </div>
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* 分辨率 */}
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

      {/* 设为默认 */}
      <button
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
        disabled={isDisabled}
        onClick={onSaveDefaults}
      >
        设为默认
      </button>
    </div>
  )
}

/**
 * 向后兼容导出 — 保留原有 VideoParams 完整布局
 * 包含参数卡片（模型/分辨率/比例/时长/音频/镜头）+ 底部操作行（积分/生成按钮）
 */
export function VideoParams({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty,
  onModelChange, onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onGenerate, onSaveDefaults,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled
  const { availableModels, currentDbModel, dbResolutions, dbAspectRatios, dbDurationOptions, estimatedCredits } = useVideoParamsHelpers({
    models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
    referenceVideoDurations, isSeedance, videoGenerateAudio, videoCameraFixed,
    isGenerating, isUploading, disabled, promptEmpty,
    onModelChange, onAspectRatioChange, onResolutionChange, onDurationChange,
    onGenerateAudioChange, onCameraFixedChange, onGenerate, onSaveDefaults,
  })

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
                              {isModelSeedance ? `${minPrice} A豆/秒` : `${minPrice} A豆/次`}
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
          <span>{estimatedCredits} A豆</span>
        </div>
        <button
          className="bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white rounded-lg px-8 h-10 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onGenerate}
          disabled={isDisabled || promptEmpty}
        >
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
            : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </button>
      </div>
    </>
  )
}
