'use client'

import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useShortDramaProject } from '@/hooks/short-drama/use-short-drama-project'
import { ShortDramaStepper } from '@/components/short-drama/short-drama-stepper'
import { StepScriptOutline } from '@/components/short-drama/step-script-outline'
import { StepAssets } from '@/components/short-drama/step-assets'
import { StepEpisodes } from '@/components/short-drama/step-episodes'
import { saveShortDramaProject } from '@/lib/short-drama/api'
import type { ShortDramaStepId } from '@aigc/types'

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
    await saveShortDramaProject(projectId, {
      state: { ...state, steps: { ...state.steps, active: step } },
    })
    mutate()
  }

  const handleStateChange = () => {
    mutate()
  }

  const activeStep = state.steps.active

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{project.title}</h1>
      </div>

      <ShortDramaStepper state={state} onStepClick={handleStepClick} />

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
  )
}
