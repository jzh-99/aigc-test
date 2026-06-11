// apps/web/src/components/generation/shared/video-config-popover.tsx
'use client'

import { useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Clock, Film, Ratio } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── ConfigOptionGroup ───────────────────────────────────────
// pill 形选项组：图标 + 标签 + 选项按钮 + ✓ 标记

export function ConfigOptionGroup({
  icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: ReactNode
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
}) {
  if (options.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span>{option.label}</span>
              {active && <Check className="h-3 w-3" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── DurationSlider ──────────────────────────────────────────
// 时长滑块：标签 + range input + 数值显示

export function DurationSlider({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const safeValue = Math.min(max, Math.max(min, value))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          时长
        </span>
        <span className="font-mono text-primary">{safeValue}s</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={safeValue}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full accent-primary"
      />
    </div>
  )
}

// ─── VideoConfigPopover ──────────────────────────────────────
// 视频配置弹窗：触发按钮显示摘要 + 弹出配置面板
// 仅包含分辨率、比例、时长；音频/镜头由外部 icon 按钮控制

export interface VideoConfigPopoverProps {
  /** 触发按钮上显示的配置摘要文本 */
  summary: string
  videoResolution: string
  resolutionOptions: string[]
  videoAspect: string
  aspectOptions: Array<{ value: string; label: string }>
  videoDuration: number
  durationOptions: Array<{ value: number; label: string }>
  isSeedance: boolean
  onResolutionChange: (value: string) => void
  onAspectRatioChange: (value: string) => void
  onDurationChange: (value: number) => void
  disabled?: boolean
}

export function VideoConfigPopover({
  summary,
  videoResolution,
  resolutionOptions,
  videoAspect,
  aspectOptions,
  videoDuration,
  durationOptions,
  isSeedance,
  onResolutionChange,
  onAspectRatioChange,
  onDurationChange,
  disabled,
}: VideoConfigPopoverProps) {
  const [open, setOpen] = useState(false)

  const resolutionPopOptions = resolutionOptions.map((r) => ({ value: r, label: r.toUpperCase() }))
  const availableDurationValues = durationOptions
    .map((option) => option.value)
    .filter((v) => Number.isFinite(v) && v > 0)
  const durationMin = availableDurationValues.length > 0 ? Math.min(...availableDurationValues) : 4
  const durationMax = availableDurationValues.length > 0 ? Math.max(...availableDurationValues) : 15

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-w-[200px] max-w-[360px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
            open
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-border/60 bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground',
          )}
          disabled={disabled}
          title="视频配置"
        >
          <Film className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left font-medium">{summary}</span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[120] w-72 space-y-3 rounded-xl border border-border/80 bg-popover p-3 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="text-xs font-semibold text-popover-foreground">视频配置</div>
          <ConfigOptionGroup
            icon={<Film className="h-3 w-3" />}
            label="分辨率"
            value={videoResolution}
            options={resolutionPopOptions}
            onChange={onResolutionChange}
          />
          <ConfigOptionGroup
            icon={<Ratio className="h-3 w-3" />}
            label="画面比例"
            value={videoAspect}
            options={aspectOptions}
            onChange={onAspectRatioChange}
          />
          {isSeedance && (
            <DurationSlider
              value={videoDuration}
              min={durationMin}
              max={durationMax}
              onChange={onDurationChange}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
