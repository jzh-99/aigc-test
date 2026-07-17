'use client'

import { Check } from 'lucide-react'
import type { PictureBookStepId } from '@/lib/picture-book/types'

const steps: Array<{ id: PictureBookStepId; label: string }> = [
  { id: 'script', label: '绘本大纲' },
  { id: 'assets', label: '绘本资产库' },
  { id: 'storyboard', label: '绘本分镜' },
  { id: 'preview', label: '预览导出' },
]

function canEnterStep(step: PictureBookStepId, active: PictureBookStepId, completed: PictureBookStepId[]): boolean {
  if (step === active || completed.includes(step)) return true
  const stepIndex = steps.findIndex(item => item.id === step)
  if (stepIndex <= 0) return true
  return completed.includes(steps[stepIndex - 1].id)
}

export function PictureBookStepper({
  active,
  completed,
  onChange,
}: {
  active: PictureBookStepId
  completed: PictureBookStepId[]
  onChange: (step: PictureBookStepId) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-5">
      {steps.map((step, index) => {
        const isActive = active === step.id
        const isDone = completed.includes(step.id)
        const enabled = canEnterStep(step.id, active, completed)
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => {
              if (enabled) onChange(step.id)
            }}
            disabled={!enabled}
            title={enabled ? step.label : '请先完成当前步骤'}
            className="inline-flex items-center gap-3 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-muted-foreground"
          >
            <span className={isActive ? 'inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground' : isDone ? 'inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary' : 'inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground'}>
              {isDone ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span className={isActive ? 'text-foreground' : ''}>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
