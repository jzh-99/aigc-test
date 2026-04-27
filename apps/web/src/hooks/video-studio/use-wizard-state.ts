'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { fetchWithAuth } from '@/lib/api-client'
import type { Shot, ScriptResult } from '@/lib/video-studio-api'

export type WizardStepId = 'describe' | 'script' | 'storyboard' | 'characters' | 'video'
export type StepStatus = 'locked' | 'pending' | 'completed'

export interface WizardStepDef {
  id: WizardStepId
  label: string
  icon: string
  description: string
}

export const WIZARD_STEP_DEFS: WizardStepDef[] = [
  { id: 'describe',    label: '描述需求',  icon: '✍️',  description: '描述你的视频主题和风格' },
  { id: 'script',      label: '生成剧本',  icon: '📝',  description: 'AI 生成剧本、角色和场景' },
  { id: 'storyboard',  label: '分镜规划',  icon: '🎞️',  description: '拆分分镜，生成画面提示词' },
  { id: 'characters',  label: '角色&场景', icon: '🎨',  description: '生成角色和场景参考图' },
  { id: 'video',       label: '生成视频',  icon: '🎬',  description: '逐镜头生成视频片段' },
]

const UNLOCK_ORDER: WizardStepId[] = ['describe', 'script', 'storyboard', 'characters', 'video']

export interface DescribeData {
  description: string
  style: string
  duration: number
  aspectRatio: string
}

export interface WizardState {
  statuses: Record<WizardStepId, StepStatus>
  activeStep: WizardStepId
  describeData: DescribeData | null
  // unsaved draft for describe step (survives step switching without clicking 下一步)
  draftDescribeData: DescribeData | null
  scriptData: (Omit<ScriptResult, 'success'>) | null
  // history of all generated scripts, newest last
  scriptHistory: (Omit<ScriptResult, 'success'>)[]
  shots: Shot[]
  shotImages: Record<string, string>
  // selected URL per character/scene name
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  // full generation history: name → array of batches, each batch is string[]
  characterImageHistory: Record<string, string[][]>
  sceneImageHistory: Record<string, string[][]>
  shotVideos: Record<string, string>
}

function initialStatuses(): Record<WizardStepId, StepStatus> {
  return { describe: 'pending', script: 'locked', storyboard: 'locked', characters: 'locked', video: 'locked' }
}

function defaultState(): WizardState {
  return {
    statuses: initialStatuses(),
    activeStep: 'describe',
    describeData: null,
    draftDescribeData: null,
    scriptData: null,
    scriptHistory: [],
    shots: [],
    shotImages: {},
    characterImages: {},
    sceneImages: {},
    characterImageHistory: {},
    sceneImageHistory: {},
    shotVideos: {},
  }
}

function loadFromStorage(storageKey: string): WizardState {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return defaultState()
    return { ...defaultState(), ...JSON.parse(raw) }
  } catch {
    return defaultState()
  }
}

function saveToStorage(storageKey: string, state: WizardState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch { /* storage full or unavailable */ }
}

export function useWizardState(storageKey: string, projectId: string, projectName: string, serverState?: WizardState | null) {
  const [state, setState] = useState<WizardState>(() => {
    // Server state takes priority over localStorage (cross-device sync)
    if (serverState) return { ...defaultState(), ...serverState }
    return loadFromStorage(storageKey)
  })
  const keyRef = useRef(storageKey)
  keyRef.current = storageKey

  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''

  // When server state arrives (async fetch), override local state
  useEffect(() => {
    if (serverState) setState({ ...defaultState(), ...serverState })
  }, [serverState])

  // Reload if storageKey changes (navigating between projects)
  useEffect(() => {
    setState(loadFromStorage(storageKey))
  }, [storageKey])

  // Persist to localStorage on every state change
  useEffect(() => {
    saveToStorage(keyRef.current, state)
  }, [state])

  // Server sync helpers
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  const projectNameRef = useRef(projectName)
  projectNameRef.current = projectName
  const mountedRef = useRef(false) // skip initial render

  const syncNow = useCallback((overrideState?: WizardState) => {
    const wsId = workspaceIdRef.current
    if (!wsId || !projectId) return
    fetchWithAuth(`/video-studio/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: wsId,
        name: projectNameRef.current,
        wizard_state: overrideState ?? stateRef.current,
      }),
    }).catch(() => { /* silent — localStorage is the fallback */ })
  }, [projectId])

  // Debounced sync on state change (skip first render)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(syncNow, 1500)
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [state, syncNow])

  // Flush on: page unload, tab hidden (切后台), route unmount (侧栏离开)
  useEffect(() => {
    const flush = () => {
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow()
    }
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush() // component unmount = navigated away via sidebar
    }
  }, [syncNow])

  const setActiveStep = useCallback((step: WizardStepId) => {
    setState((s) => {
      const next = { ...s, activeStep: step }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

  const completeStep = useCallback((step: WizardStepId) => {
    setState((s) => {
      const idx = UNLOCK_ORDER.indexOf(step)
      const nextStep = UNLOCK_ORDER[idx + 1]
      const statuses = { ...s.statuses, [step]: 'completed' as StepStatus }
      if (nextStep && statuses[nextStep] === 'locked') statuses[nextStep] = 'pending'
      const next = { ...s, statuses, activeStep: nextStep ?? step }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

  const setDescribeData = useCallback((data: DescribeData) => {
    setState((s) => ({ ...s, describeData: data, draftDescribeData: data }))
  }, [])

  const setDraftDescribeData = useCallback((data: DescribeData) => {
    setState((s) => ({ ...s, draftDescribeData: data }))
  }, [])

  const setScriptData = useCallback((data: Omit<ScriptResult, 'success'>) => {
    setState((s) => {
      const history = s.scriptHistory ?? []
      // avoid duplicate if same title+script
      const alreadyIn = history.length > 0 && history[history.length - 1].script === data.script
      return {
        ...s,
        scriptData: data,
        scriptHistory: alreadyIn ? history : [...history, data],
      }
    })
  }, [])

  const setShots = useCallback((shots: Shot[]) => {
    setState((s) => ({ ...s, shots }))
  }, [])

  const setShotImage = useCallback((shotId: string, url: string) => {
    setState((s) => ({ ...s, shotImages: { ...s.shotImages, [shotId]: url } }))
  }, [])

  const setCharacterImage = useCallback((name: string, url: string, batch?: string[]) => {
    setState((s) => {
      const prev = s.characterImageHistory[name] ?? []
      const newBatch = batch ?? [url]
      const alreadyStored = prev.length > 0 && prev[prev.length - 1].join() === newBatch.join()
      return {
        ...s,
        characterImages: { ...s.characterImages, [name]: url },
        characterImageHistory: alreadyStored ? s.characterImageHistory : { ...s.characterImageHistory, [name]: [...prev, newBatch] },
      }
    })
  }, [])

  const setSceneImage = useCallback((name: string, url: string, batch?: string[]) => {
    setState((s) => {
      const prev = s.sceneImageHistory[name] ?? []
      const newBatch = batch ?? [url]
      const alreadyStored = prev.length > 0 && prev[prev.length - 1].join() === newBatch.join()
      return {
        ...s,
        sceneImages: { ...s.sceneImages, [name]: url },
        sceneImageHistory: alreadyStored ? s.sceneImageHistory : { ...s.sceneImageHistory, [name]: [...prev, newBatch] },
      }
    })
  }, [])

  const setShotVideo = useCallback((shotId: string, url: string) => {
    setState((s) => ({ ...s, shotVideos: { ...s.shotVideos, [shotId]: url } }))
  }, [])

  const reset = useCallback(() => {
    const fresh = defaultState()
    setState(fresh)
    try { localStorage.removeItem(keyRef.current) } catch { /* ignore */ }
  }, [])

  return {
    ...state,
    setActiveStep,
    completeStep,
    setDescribeData,
    setDraftDescribeData,
    setScriptData,
    setShots,
    setShotImage,
    setCharacterImage,
    setSceneImage,
    setShotVideo,
    reset,
  }
}
