'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ASPECT_RATIOS, QUANTITY_OPTIONS } from '../shared/constants'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import type { ModelItem } from '@aigc/types'

export interface ImageParamsProps {
  models?: ModelItem[]
  modelType: string
  resolution: string
  aspectRatio: string
  quantity: number
  isGenerating: boolean
  disabled?: boolean
  promptEmpty?: boolean
  onModelChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onAspectRatioChange: (v: string) => void
  onQuantityChange: (v: number) => void
  onGenerate: () => void
  onSaveDefaults: () => void
}

/** 比例图标组件 */
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

/**
 * 底部单行参数栏 — pill 标签 + A豆 + 生成按钮
 * 用于嵌入图片面板底部第 4 层
 */
export function ImageParamsBar({
  models, modelType, resolution, aspectRatio, quantity,
  isGenerating, disabled, promptEmpty,
  onGenerate,
  onSettingsOpen,
}: ImageParamsProps & { onSettingsOpen: () => void }) {
  const currentDbModel = models?.find((m) => m.code === modelType)
  const availableResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, resolution) : 0
  const estimatedCredits = unitPrice * quantity

  const currentResLabel = availableResolutions.find((r) => r.value === resolution)?.label ?? resolution
  const currentRatioLabel = ASPECT_RATIOS.find((ar) => ar.value === aspectRatio)?.label ?? aspectRatio

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {availableResolutions.length > 1 && (
        <button
          className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
          onClick={onSettingsOpen}
          disabled={disabled}
        >
          {currentResLabel}
        </button>
      )}

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={disabled}
      >
        {currentRatioLabel}
      </button>

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2.5 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={disabled}
      >
        {quantity} 张
      </button>

      <button
        className="bg-white/[0.06] text-white/50 text-[11px] px-2 py-[3px] rounded-md hover:bg-white/[0.1] transition-colors cursor-pointer"
        onClick={onSettingsOpen}
        disabled={disabled}
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
        disabled={isGenerating || disabled || promptEmpty}
      >
        {isGenerating ? (
          <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
        ) : (
          <><Sparkles className="h-4 w-4" />立即生成</>
        )}
      </button>
    </div>
  )
}

/**
 * 设置弹窗内容 — 完整参数表单（模型、质量、比例、数量、设为默认）
 * 用于嵌入 GenerationSettingsSheet
 */
export function ImageSettingsContent({
  models, modelType, resolution, aspectRatio, quantity,
  disabled,
  onModelChange, onResolutionChange, onAspectRatioChange, onQuantityChange,
  onSaveDefaults,
}: ImageParamsProps) {
  const currentDbModel = models?.find((m) => m.code === modelType)
  const availableResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const showQualitySelector = availableResolutions.length > 1

  return (
    <div className="space-y-4">
      {/* 模型选择 */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
        <Select value={modelType} onValueChange={onModelChange} disabled={disabled}>
          <SelectTrigger className="h-9">
            <SelectValue>{currentDbModel?.name ?? modelType}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(models ?? []).map((m) => {
              const minPrice = m.params_pricing.length > 0
                ? Math.min(...m.params_pricing.map((r) => r.unit_price))
                : 0
              return (
                <SelectItem key={m.code} value={m.code} className="py-2">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm mb-0.5">{m.name}</div>
                      {m.description && (
                        <div className="text-xs text-muted-foreground leading-snug">{m.description}</div>
                      )}
                      <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                        <Coins className="h-3 w-3" />{minPrice} A豆/张
                      </div>
                    </div>
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* 质量选择 */}
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
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >{res.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* 比例选择 */}
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
                disabled && 'opacity-50 cursor-not-allowed',
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

      {/* 数量选择 */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">数量</Label>
        <Select value={String(quantity)} onValueChange={(v) => onQuantityChange(Number(v))} disabled={disabled}>
          <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUANTITY_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} 张</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 设为默认 */}
      <button
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
        disabled={disabled}
        onClick={onSaveDefaults}
      >
        设为默认
      </button>
    </div>
  )
}

/**
 * 向后兼容导出 — 保留原有 ImageParams 完整布局
 * 包含参数卡片（模型/质量/比例）+ 底部操作行（数量/积分/生成按钮）
 */
export function ImageParams({
  models, modelType, resolution, aspectRatio, quantity,
  isGenerating, disabled, promptEmpty,
  onModelChange, onResolutionChange, onAspectRatioChange, onQuantityChange,
  onGenerate, onSaveDefaults,
}: ImageParamsProps) {
  const currentDbModel = models?.find((m) => m.code === modelType)
  const availableResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const showQualitySelector = availableResolutions.length > 1
  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, resolution) : 0
  const estimatedCredits = unitPrice * quantity

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
              <SelectTrigger className="h-9">
                <SelectValue>{currentDbModel?.name ?? modelType}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(models ?? []).map((m) => {
                  const minPrice = m.params_pricing.length > 0
                    ? Math.min(...m.params_pricing.map((r) => r.unit_price))
                    : 0
                  return (
                    <SelectItem key={m.code} value={m.code} className="py-2">
                      <div className="flex items-start gap-3">
                        <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-0.5">{m.name}</div>
                          {m.description && (
                            <div className="text-xs text-muted-foreground leading-snug">{m.description}</div>
                          )}
                          <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                            <Coins className="h-3 w-3" />{minPrice} A豆/张
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
                      disabled && 'opacity-50 cursor-not-allowed',
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
                    disabled && 'opacity-50 cursor-not-allowed',
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
          <span>{estimatedCredits} A豆</span>
        </div>
        <button
          className="bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white rounded-lg px-8 h-10 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onGenerate}
          disabled={isGenerating || disabled || promptEmpty}
        >
          {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</> : <><Sparkles className="h-4 w-4" />生成</>}
        </button>
      </div>
    </>
  )
}
