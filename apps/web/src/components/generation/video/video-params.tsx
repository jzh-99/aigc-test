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

type VideoMode = 'frames' | 'components' | 'multimodal'

interface VideoParamsProps {
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
  disabled && 'opacity-50 cursor-not-allowed'
)

export function VideoParams({
  videoMode, videoModel, videoAspectRatio, videoUpsample, videoDuration,
  videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled,
  onModelChange, onAspectRatioChange, onUpsampleChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onGenerate, onSaveDefaults,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled
  const currentModelOpts = VIDEO_MODEL_OPTIONS[videoMode]
  const currentModel = currentModelOpts.find(m => m.value === videoModel)
  const estimatedCredits = isSeedance
    ? (videoDuration === -1 ? 15 : videoDuration) * (currentModel?.credits ?? 5)
    : (currentModel?.credits ?? 10)

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
                  <SelectValue>{currentModel?.label ?? videoModel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {currentModelOpts.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="py-2">
                      <div className="flex items-start gap-3">
                        <Film className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-0.5">{m.label}</div>
                          <div className="text-xs text-muted-foreground leading-snug">{m.desc}</div>
                          <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                            <Coins className="h-3 w-3" />
                            {m.isSeedance ? `${m.credits} 积分/秒` : `${m.credits} 积分/次`}
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">分辨率</Label>
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
                    {VIDEO_ASPECT_RATIOS_SEEDANCE.map((ar) => (
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
                    {SEEDANCE_DURATION_OPTIONS.map((opt) => (
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
                {VIDEO_ASPECT_RATIOS_DEFAULT.map((ar) => (
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
