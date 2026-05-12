'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODEL_OPTIONS, ALL_RESOLUTION_OPTIONS, ASPECT_RATIOS, QUANTITY_OPTIONS } from '../shared/constants'
import type { ModelResolution } from '../shared/constants'

interface ImageParamsProps {
  modelType: string
  resolution: string
  aspectRatio: string
  quantity: number
  isGenerating: boolean
  disabled?: boolean
  onModelChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onQuantityChange: (v: number) => void
  onGenerate: () => void
  onSaveDefaults: () => void
}

function AspectRatioIcon({ ratio, active }: { ratio: string; active: boolean }) {
  const [w, h] = ratio.split(':').map(Number)
  const maxSize = 14
  const scale = maxSize / Math.max(w, h)
  return (
    <div
      className={cn('rounded border-2', active ? 'border-primary bg-primary/20' : 'border-current opacity-40')}
      style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
    />
  )
}

export function ImageParams({
  modelType, resolution, aspectRatio, quantity,
  isGenerating, disabled,
  onModelChange, onResolutionChange, onAspectRatioChange, onQuantityChange,
  onGenerate, onSaveDefaults,
}: ImageParamsProps) {
  const currentModel = MODEL_OPTIONS.find(m => m.value === modelType)
  const showQualitySelector = modelType !== 'gpt-image-2'
  const availableResolutions = ALL_RESOLUTION_OPTIONS.filter(r => currentModel?.resolutions.includes(r.value as ModelResolution) ?? true)
  const estimatedCredits = (currentModel?.credits ?? 5) * quantity

  return (
    <>
      <div className="rounded-xl border bg-card p-3 relative">
        <button
          className="absolute top-2 right-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
          disabled={disabled}
          onClick={onSaveDefaults}
        >
          设为默认
        </button>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
            <Select value={modelType} onValueChange={onModelChange} disabled={disabled}>
              <SelectTrigger className="h-9"><SelectValue>{currentModel?.label}</SelectValue></SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((model) => {
                  const Icon = model.icon
                  return (
                    <SelectItem key={model.value} value={model.value} className="py-2">
                      <div className="flex items-start gap-3">
                        <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-0.5">{model.label}</div>
                          <div className="text-xs text-muted-foreground leading-snug">{model.desc}</div>
                          <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                            <Coins className="h-3 w-3" />{model.credits} 积分/张
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {showQualitySelector && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">质量</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {availableResolutions.map((res) => (
                  <button
                    key={res.value}
                    onClick={() => onResolutionChange(res.value)}
                    disabled={disabled}
                    className={cn(
                      'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                      resolution === res.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >{res.label}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar.value}
                  onClick={() => onAspectRatioChange(ar.value)}
                  disabled={disabled}
                  className={cn(
                    'flex flex-col items-center gap-1 py-1.5 px-1 rounded-lg border-2 transition-all',
                    aspectRatio === ar.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50',
                    disabled && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <div className="flex items-end justify-center h-3.5">
                    <AspectRatioIcon ratio={ar.value} active={aspectRatio === ar.value} />
                  </div>
                  <span className="text-xs font-medium">{ar.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Select value={String(quantity)} onValueChange={(v) => onQuantityChange(Number(v))} disabled={disabled}>
          <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUANTITY_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} 张</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits} 积分</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isGenerating || disabled}>
          {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</> : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </>
  )
}
