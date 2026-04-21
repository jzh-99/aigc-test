'use client'

import { cn } from '@/lib/utils'
import { CheckCircle2, Circle, Lock } from 'lucide-react'
import { STEP_DEFS, type StepId, type StepStatus, type StepsState } from '@/hooks/canvas/use-steps-state'

// ── Step nav item ─────────────────────────────────────────────────────────────

function StepNavItem({
  stepDef,
  status,
  isActive,
  onClick,
}: {
  stepDef: (typeof STEP_DEFS)[number]
  status: StepStatus
  isActive: boolean
  onClick: () => void
}) {
  const locked = status === 'locked'
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
        isActive && 'bg-primary/10 text-primary',
        !isActive && !locked && 'hover:bg-muted text-foreground',
        locked && 'opacity-40 cursor-not-allowed text-muted-foreground',
      )}
    >
      <span className="text-lg shrink-0">{stepDef.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{stepDef.label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{stepDef.description}</div>
      </div>
      <div className="shrink-0">
        {status === 'completed' ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : locked ? (
          <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <Circle className={cn('w-4 h-4', isActive ? 'text-primary' : 'text-muted-foreground/40')} />
        )}
      </div>
    </button>
  )
}

// ── Steps mode layout ─────────────────────────────────────────────────────────

interface Props {
  canvasId: string
  stepsState: StepsState & {
    setActiveStep: (s: StepId) => void
    completeStep: (s: StepId) => void
    setScriptData: (d: StepsState['scriptData']) => void
    setStoryboardData: (d: StepsState['storyboardData']) => void
    setCharacterImage: (name: string, url: string | null) => void
    setSceneImage: (name: string, url: string | null) => void
    reset: () => void
  }
  children: React.ReactNode
}

export function StepsModeLayout({ stepsState, children }: Props) {
  const { statuses, activeStep, setActiveStep } = stepsState

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <aside className="w-52 shrink-0 border-r bg-background flex flex-col py-3 px-2 gap-1 overflow-y-auto">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">制作步骤</p>
        {STEP_DEFS.map((def, idx) => (
          <div key={def.id} className="relative">
            {idx < STEP_DEFS.length - 1 && (
              <div className="absolute left-[22px] top-[44px] w-px h-2 bg-border z-0" />
            )}
            <StepNavItem
              stepDef={def}
              status={statuses[def.id]}
              isActive={activeStep === def.id}
              onClick={() => setActiveStep(def.id)}
            />
          </div>
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
