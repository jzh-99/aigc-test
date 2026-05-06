'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2, Circle, Lock, PanelRight, Pencil, Trash2 } from 'lucide-react'
import { WIZARD_STEP_DEFS, type WizardStepId, type StepStatus, type WizardStepDef } from '@/hooks/video-studio/use-wizard-state'
import { VideoStudioSidebar } from './video-studio-sidebar'

function StepNavItem({
  def,
  status,
  isActive,
  onClick,
}: {
  def: WizardStepDef
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
      <span className="text-lg shrink-0">{def.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{def.label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{def.description}</div>
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

interface Props {
  statuses: Record<WizardStepId, StepStatus>
  activeStep: WizardStepId
  onStepClick: (step: WizardStepId) => void
  projectName: string
  projectId: string
  onProjectNameChange?: (name: string) => Promise<void> | void
  onDeleteProject?: () => void
  headerRight?: React.ReactNode
  visibleSteps?: WizardStepDef[]
  children: React.ReactNode
}

export function WizardLayout({ statuses, activeStep, onStepClick, projectName, projectId, onProjectNameChange, onDeleteProject, headerRight, visibleSteps = WIZARD_STEP_DEFS, children }: Props) {
  const completedCount = visibleSteps.filter((step) => statuses[step.id] === 'completed').length
  const total = visibleSteps.length
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(projectName)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const submitName = async () => {
    const next = nameDraft.trim()
    if (!next || next === projectName) {
      setNameDraft(projectName)
      setEditingName(false)
      return
    }
    await onProjectNameChange?.(next)
    setEditingName(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          {editingName ? (
            <input
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={submitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitName()
                if (e.key === 'Escape') {
                  setNameDraft(projectName)
                  setEditingName(false)
                }
              }}
              className="h-7 w-52 rounded border bg-background px-2 text-sm font-semibold outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(projectName)
                setEditingName(true)
              }}
              className="group flex max-w-[240px] items-center gap-1 text-left font-semibold text-sm"
              title="编辑项目名称"
            >
              <span className="truncate">{projectName}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          )}
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {completedCount}/{total} 步完成
          </span>
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onDeleteProject && (
            <button
              onClick={onDeleteProject}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-600 transition-colors"
              title="删除项目"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          )}
          <button
            onClick={() => setSidebarOpen((open) => !open)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="项目记录和资产库"
          >
            <PanelRight className="w-3.5 h-3.5" />
            记录/资产
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <aside className="w-52 shrink-0 border-r bg-background flex flex-col py-3 px-2 gap-1 overflow-y-auto">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">制作步骤</p>
          {visibleSteps.map((def, idx) => (
            <div key={def.id} className="relative">
              {idx < visibleSteps.length - 1 && (
                <div className="absolute left-[22px] top-[44px] w-px h-2 bg-border z-0" />
              )}
              <StepNavItem
                def={def}
                status={statuses[def.id]}
                isActive={activeStep === def.id}
                onClick={() => onStepClick(def.id)}
              />
            </div>
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-muted/20">
          {children}
        </main>
        {sidebarOpen && <VideoStudioSidebar projectId={projectId} onClose={() => setSidebarOpen(false)} />}
      </div>
    </div>
  )
}
