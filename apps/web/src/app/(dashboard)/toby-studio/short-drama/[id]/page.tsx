'use client'

import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useShortDramaProject } from '@/hooks/short-drama/use-short-drama-project'
import { ShortDramaStepper } from '@/components/short-drama/short-drama-stepper'
import { StepScriptOutline } from '@/components/short-drama/step-script-outline'
import { StepAssets } from '@/components/short-drama/step-assets'
import { StepEpisodes } from '@/components/short-drama/step-episodes'
import { saveShortDramaProject } from '@/lib/short-drama/api'
import { canEnterShortDramaStep, type ShortDramaStepId } from '@aigc/types'

export default function ShortDramaEditorPage() {
  const params = useParams()
  const projectId = params.id as string

  const { project, state, isLoading, error, mutate } = useShortDramaProject(projectId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !project || !state) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-muted-foreground">
        {error?.message ?? '项目加载失败'}
      </div>
    )
  }

  const handleStepClick = async (step: ShortDramaStepId) => {
    if (step === state.steps.active) return
    if (!canEnterShortDramaStep(state, step)) return
    await saveShortDramaProject(projectId, {
      state: { ...state, steps: { ...state.steps, active: step } },
    })
    mutate()
  }

  const handleStateChange = () => {
    mutate()
  }

  const activeStep = canEnterShortDramaStep(state, state.steps.active)
    ? state.steps.active
    : canEnterShortDramaStep(state, 'assets')
      ? 'assets'
      : 'script'
  const displayState = activeStep === state.steps.active
    ? state
    : { ...state, steps: { ...state.steps, active: activeStep } }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="border-b border-border/70 pb-5">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground">AI SHORT DRAMA</p>
          <h1 className="mt-2 text-xl font-bold text-foreground">{project.title}</h1>
        </div>

        <ShortDramaStepper state={displayState} onStepClick={handleStepClick} />

        <div className="mt-6">
          {activeStep === 'script' && (
            <StepScriptOutline projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
          {activeStep === 'assets' && (
            <StepAssets projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
          {activeStep === 'episodes' && (
            <StepEpisodes projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
        </div>
      </div>
    </div>
  )
}
