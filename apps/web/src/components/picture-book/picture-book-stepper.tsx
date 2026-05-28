'use client'

import { Check } from 'lucide-react'
import type { PictureBookStepId } from '@/lib/picture-book/types'

const steps: Array<{ id: PictureBookStepId; label: string }> = [
  { id: 'script', label: '剧本大纲' },
  { id: 'assets', label: '资产库' },
  { id: 'storyboard', label: '分镜视频' },
  { id: 'preview', label: '预览导出' },
]

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
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onChange(step.id)}
            className="inline-flex items-center gap-3 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
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
