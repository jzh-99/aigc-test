'use client'

import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── PopoverSelect ──────────────────────────────────────────────────────────
// 图标工具栏中的隐藏式下拉选择器：点击图标按钮弹出选项列表

interface PopoverSelectOption {
  value: string
  label: string
  disabled?: boolean
  hint?: string
}

interface PopoverSelectProps {
  icon: React.ReactNode
  label: string
  value: string
  options: PopoverSelectOption[]
  onChange: (value: string) => void
  displayValue?: string
  /** 仅展示图标，隐藏文字和箭头（适合空间紧凑的场景） */
  iconOnly?: boolean
  valueClassName?: string
}

export function PopoverSelect({
  icon,
  label,
  value,
  options,
  onChange,
  displayValue,
  iconOnly,
  valueClassName,
}: PopoverSelectProps) {
  const [open, setOpen] = useState(false)
  const currentLabel = displayValue ?? options.find((o) => o.value === value)?.label ?? value

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={iconOnly ? `${label}: ${currentLabel}` : undefined}
          className={cn(
            'inline-flex items-center rounded-lg border transition-colors',
            iconOnly ? 'p-1.5' : 'gap-1.5 px-2 py-1.5 text-[11px]',
            open
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-border/60 bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground',
          )}
        >
          <span className="flex items-center">{icon}</span>
          {!iconOnly && (
            <>
              <span className={cn('truncate font-medium', valueClassName ?? 'max-w-[72px]')}>{currentLabel}</span>
              <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
            </>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[120] max-h-64 min-w-[160px] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">{label}</div>
          {options.map((option) => {
            const isActive = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : option.disabled
                      ? 'text-muted-foreground/50 cursor-not-allowed'
                      : 'text-popover-foreground hover:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{option.hint}</span>
                )}
                {isActive && <Check className="h-3 w-3 shrink-0" />}
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─── ExecuteButton ──────────────────────────────────────────────────────────
// 圆形执行按钮 + A豆气泡

interface ExecuteButtonProps {
  icon: React.ReactNode
  credits: number
  executing: boolean
  disabled: boolean
  onClick: () => void
}

export function ExecuteButton({
  icon,
  credits,
  executing,
  disabled,
  onClick,
}: ExecuteButtonProps) {
  return (
    <div className="flex items-center gap-2">
      {/* A豆数量标签 — 按钮左侧 */}
      {!executing && credits > 0 && (
        <span className="whitespace-nowrap rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {credits} A豆
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || executing}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full transition-all',
          'bg-primary text-primary-foreground shadow-md shadow-primary/20',
          'hover:shadow-lg hover:shadow-primary/30 hover:scale-105',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-md',
        )}
      >
        {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </button>
    </div>
  )
}

// ─── RangePopover ───────────────────────────────────────────────────────────
// 滑块类属性的 Popover 封装（语速/音调/音量）

interface RangePopoverProps {
  icon: React.ReactNode
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
}

export function RangePopover({
  icon,
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: RangePopoverProps) {
  const [open, setOpen] = useState(false)
  const displayText = formatValue ? formatValue(value) : String(value)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors',
            open
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-border/60 bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground',
          )}
        >
          <span className="flex items-center">{icon}</span>
          <span className="font-medium">{displayText}</span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[120] w-56 rounded-xl border border-border/80 bg-popover p-3 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-popover-foreground">{label}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{displayText}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─── PanelToolbar ───────────────────────────────────────────────────────────
// 工具栏容器：底部一行 flex wrap 布局

export function PanelToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {children}
    </div>
  )
}
