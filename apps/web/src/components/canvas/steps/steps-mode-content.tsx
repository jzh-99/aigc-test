'use client'

import type { StepId, StepsState } from '@/hooks/canvas/use-steps-state'
import { StepScript } from './step-script'
import { StepStoryboard } from './step-storyboard'
import { StepCharacters } from './step-characters'
import { StepAudio } from './step-audio'
import { StepVideo } from './step-video'

interface Props {
  canvasId: string
  activeStep: StepId
  stepsState: StepsState & {
    setActiveStep: (s: StepId) => void
    completeStep: (s: StepId) => void
    setScriptData: (d: StepsState['scriptData']) => void
    setStoryboardData: (d: StepsState['storyboardData']) => void
    setCharacterImage: (name: string, url: string | null) => void
    setSceneImage: (name: string, url: string | null) => void
  }
}

export function StepsModeContent({ canvasId, activeStep, stepsState }: Props) {
  switch (activeStep) {
    case 'script':
      return (
        <StepScript
          canvasId={canvasId}
          scriptData={stepsState.scriptData}
          onComplete={(data) => {
            stepsState.setScriptData(data)
            stepsState.completeStep('script')
          }}
        />
      )
    case 'storyboard':
      return (
        <StepStoryboard
          canvasId={canvasId}
          script={stepsState.scriptData?.script ?? ''}
          storyboardData={stepsState.storyboardData}
          onComplete={(shots) => {
            stepsState.setStoryboardData(shots)
            stepsState.completeStep('storyboard')
          }}
        />
      )
    case 'characters':
      return (
        <StepCharacters
          canvasId={canvasId}
          characters={stepsState.scriptData?.characters ?? []}
          scenes={stepsState.scriptData?.scenes ?? []}
          characterImages={stepsState.characterImages}
          sceneImages={stepsState.sceneImages}
          onSelectCharacterImage={stepsState.setCharacterImage}
          onSelectSceneImage={stepsState.setSceneImage}
          onComplete={() => stepsState.completeStep('characters')}
        />
      )
    case 'audio':
      return <StepAudio onComplete={() => stepsState.completeStep('audio')} />
    case 'video':
      return (
        <StepVideo
          canvasId={canvasId}
          shots={stepsState.storyboardData ?? []}
          characterImages={stepsState.characterImages}
          sceneImages={stepsState.sceneImages}
          onComplete={() => stepsState.completeStep('video')}
        />
      )
  }
}
