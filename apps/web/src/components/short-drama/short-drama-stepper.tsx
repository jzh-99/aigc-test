'use client'

import type { ShortDramaStepId, ShortDramaState } from '@aigc/types'
import { canEnterShortDramaStep } from '@aigc/types'
import { Check } from 'lucide-react'

interface ShortDramaStepperProps {
  state: ShortDramaState
  onStepClick: (step: ShortDramaStepId) => void
}

const STEPS: { id: ShortDramaStepId; label: string }[] = [
  { id: 'script', label: '剧本' },
  { id: 'assets', label: '素材' },
  { id: 'episodes', label: '分集' },
]

export function ShortDramaStepper({ state, onStepClick }: ShortDramaStepperProps) {
  const activeStep = state.steps.active
  const completedSteps = state.steps.completed

  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const isCompleted = completedSteps.includes(step.id)
        const isActive = activeStep === step.id
        const canEnter = canEnterShortDramaStep(state, step.id)

        return (
          <div key={step.id} className="flex items-center">
            {index > 0 && (
              <div className={`w-8 h-px mx-2 ${isCompleted || isActive ? 'bg-primary' : 'bg-border'}`} />
            )}
            <button
              onClick={() => canEnter && onStepClick(step.id)}
              disabled={!canEnter}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isCompleted
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : canEnter
                      ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                      : 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              {isCompleted && <Check className="w-3.5 h-3.5" />}
              <span>{step.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
