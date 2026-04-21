'use client'

import { useState, useCallback } from 'react'

export type StepId = 'script' | 'storyboard' | 'characters' | 'audio' | 'video'
export type StepStatus = 'locked' | 'pending' | 'in_progress' | 'completed'

export interface StepDef {
  id: StepId
  label: string
  icon: string
  description: string
}

export const STEP_DEFS: StepDef[] = [
  { id: 'script',      label: '剧本',     icon: '📝', description: '生成故事剧本、角色和场景' },
  { id: 'storyboard',  label: '分镜',     icon: '🎞', description: '将剧本拆分为分镜文案' },
  { id: 'characters',  label: '角色&场景', icon: '🎨', description: '为每个角色和场景生成参考图' },
  { id: 'audio',       label: '配音&BGM', icon: '🎵', description: '生成配音和背景音乐' },
  { id: 'video',       label: '视频合成', icon: '🎬', description: '合成最终视频' },
]

// Unlock order: each step unlocks the next when completed
const UNLOCK_ORDER: StepId[] = ['script', 'storyboard', 'characters', 'audio', 'video']

export interface StepsState {
  statuses: Record<StepId, StepStatus>
  activeStep: StepId
  // Data passed between steps
  scriptData: {
    script: string
    characters: string[]
    scenes: string[]
    description: string
    style: string
    duration: number
  } | null
  storyboardData: Array<{ id: string; label: string; content: string }> | null
  characterImages: Record<string, string | null>  // name → selected image url
  sceneImages: Record<string, string | null>
}

function initialStatuses(): Record<StepId, StepStatus> {
  return {
    script:      'pending',
    storyboard:  'locked',
    characters:  'locked',
    audio:       'locked',
    video:       'locked',
  }
}

export function useStepsState() {
  const [state, setState] = useState<StepsState>({
    statuses: initialStatuses(),
    activeStep: 'script',
    scriptData: null,
    storyboardData: null,
    characterImages: {},
    sceneImages: {},
  })

  const setActiveStep = useCallback((step: StepId) => {
    setState((s) => ({ ...s, activeStep: step }))
  }, [])

  const completeStep = useCallback((step: StepId) => {
    setState((s) => {
      const idx = UNLOCK_ORDER.indexOf(step)
      const next = UNLOCK_ORDER[idx + 1]
      const statuses = { ...s.statuses, [step]: 'completed' as StepStatus }
      if (next && statuses[next] === 'locked') statuses[next] = 'pending'
      return { ...s, statuses, activeStep: next ?? step }
    })
  }, [])

  const setScriptData = useCallback((data: StepsState['scriptData']) => {
    setState((s) => ({ ...s, scriptData: data }))
  }, [])

  const setStoryboardData = useCallback((data: StepsState['storyboardData']) => {
    setState((s) => ({ ...s, storyboardData: data }))
  }, [])

  const setCharacterImage = useCallback((name: string, url: string | null) => {
    setState((s) => ({ ...s, characterImages: { ...s.characterImages, [name]: url } }))
  }, [])

  const setSceneImage = useCallback((name: string, url: string | null) => {
    setState((s) => ({ ...s, sceneImages: { ...s.sceneImages, [name]: url } }))
  }, [])

  const reset = useCallback(() => {
    setState({
      statuses: initialStatuses(),
      activeStep: 'script',
      scriptData: null,
      storyboardData: null,
      characterImages: {},
      sceneImages: {},
    })
  }, [])

  return {
    ...state,
    setActiveStep,
    completeStep,
    setScriptData,
    setStoryboardData,
    setCharacterImage,
    setSceneImage,
    reset,
  }
}
