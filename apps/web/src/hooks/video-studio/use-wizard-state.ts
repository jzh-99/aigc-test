'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { fetchWithAuth } from '@/lib/api-client'
import type { Fragment, Shot, ScriptResult, SeriesOutlineResult } from '@/lib/video-studio-api'

export type WizardStepId = 'describe' | 'outline' | 'script' | 'storyboard' | 'characters' | 'video' | 'complete'
export type StepStatus = 'locked' | 'pending' | 'completed'

export interface WizardStepDef {
  id: WizardStepId
  label: string
  icon: string
  description: string
}

export const WIZARD_STEP_DEFS: WizardStepDef[] = [
  { id: 'describe',    label: '描述需求',  icon: '✍️',  description: '描述你的视频主题和风格' },
  { id: 'outline',     label: '剧集大纲',  icon: '📺',  description: '生成系列大纲和分集结构' },
  { id: 'script',      label: '生成剧本',  icon: '📝',  description: 'AI 生成剧本、角色和场景' },
  { id: 'storyboard',  label: '片段规划',  icon: '🎞️',  description: '拆分长片段和分镜提示词' },
  { id: 'characters',  label: '角色&场景', icon: '🎨',  description: '生成角色和场景参考图' },
  { id: 'video',       label: '生成视频',  icon: '🎬',  description: '逐镜头生成视频片段' },
  { id: 'complete',    label: '完成导出',  icon: '✅',  description: '预览、剪辑并导出成品' },
]

const UNLOCK_ORDER: WizardStepId[] = ['describe', 'outline', 'script', 'storyboard', 'characters', 'video', 'complete']
const SINGLE_UNLOCK_ORDER: WizardStepId[] = ['describe', 'script', 'storyboard', 'characters', 'video', 'complete']
const SERIES_UNLOCK_ORDER: WizardStepId[] = ['describe', 'outline', 'characters', 'complete']

export interface DescribeData {
  description: string
  style: string
  duration: number
  aspectRatio: string
}

export interface PendingImageBatchTarget {
  name: string
  type: 'character' | 'scene'
}

export interface EpisodeState {
  id: string
  title: string
  synopsis: string
  coreConflict?: string
  hook?: string
  scriptData: (Omit<ScriptResult, 'success'>) | null
  scriptHistory: (Omit<ScriptResult, 'success'>)[]
  fragments: Fragment[]
}

export type SeriesOutline = Omit<SeriesOutlineResult, 'success'>

export interface WizardState {
  statuses: Record<WizardStepId, StepStatus>
  activeStep: WizardStepId
  projectType?: 'single' | 'series'
  seriesParentId?: string | null
  episodeIndex?: number | null
  sharedCharacters?: Array<{ name: string; description: string; voiceDescription?: string }>
  sharedScenes?: Array<{ name: string; description: string }>
  sharedCharacterImages?: Record<string, string>
  sharedSceneImages?: Record<string, string>
  seriesOutline: SeriesOutline | null
  activeEpisodeId: string | null
  episodes: EpisodeState[]
  describeData: DescribeData | null
  // unsaved draft for describe step (survives step switching without clicking 下一步)
  draftDescribeData: DescribeData | null
  scriptData: (Omit<ScriptResult, 'success'>) | null
  // history of all generated scripts, newest last
  scriptHistory: (Omit<ScriptResult, 'success'>)[]
  shots: Shot[]
  fragments: Fragment[]
  shotImages: Record<string, string>
  // selected URL per character/scene name
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  // full generation history: name → array of batches, each batch is string[]
  characterImageHistory: Record<string, string[][]>
  sceneImageHistory: Record<string, string[][]>
  shotVideos: Record<string, string>
  // full generation history: fragmentId → array of URLs (newest last)
  shotVideoHistory: Record<string, string[]>
  pendingImageBatches: Record<string, PendingImageBatchTarget>
  pendingVideoBatches: Record<string, string>
}

function initialStatuses(): Record<WizardStepId, StepStatus> {
  return { describe: 'pending', outline: 'locked', script: 'locked', storyboard: 'locked', characters: 'locked', video: 'locked', complete: 'locked' }
}

function defaultState(): WizardState {
  return {
    statuses: initialStatuses(),
    activeStep: 'describe',
    projectType: 'single',
    seriesParentId: null,
    episodeIndex: null,
    sharedCharacters: [],
    sharedScenes: [],
    sharedCharacterImages: {},
    sharedSceneImages: {},
    seriesOutline: null,
    activeEpisodeId: null,
    episodes: [],
    describeData: null,
    draftDescribeData: null,
    scriptData: null,
    scriptHistory: [],
    shots: [],
    fragments: [],
    shotImages: {},
    characterImages: {},
    sceneImages: {},
    characterImageHistory: {},
    sceneImageHistory: {},
    shotVideos: {},
    shotVideoHistory: {},
    pendingImageBatches: {},
    pendingVideoBatches: {},
  }
}

function normalizeState(state: WizardState): WizardState {
  const statuses = { ...initialStatuses(), ...(state.statuses ?? {}) }
  if (state.scriptData && statuses.script === 'locked') statuses.script = 'completed'
  if ((state.fragments?.length || state.shots?.length) && statuses.storyboard === 'locked') statuses.storyboard = 'completed'
  const fragments = state.fragments?.length ? state.fragments : state.shots?.length ? [{ id: 'fragment_1', label: '片段1', duration: state.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0), shots: state.shots }] : []
  const episodes = state.episodes?.length ? state.episodes : state.scriptData || fragments.length ? [{
    id: 'ep_1',
    title: state.scriptData?.title || '第1集',
    synopsis: state.describeData?.description ?? '',
    scriptData: state.scriptData,
    scriptHistory: state.scriptHistory ?? [],
    fragments,
  }] : []
  return {
    ...defaultState(),
    ...state,
    statuses,
    fragments,
    episodes,
    activeEpisodeId: state.activeEpisodeId ?? episodes[0]?.id ?? null,
  }
}

function loadFromStorage(storageKey: string): WizardState {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return defaultState()
    return normalizeState({ ...defaultState(), ...JSON.parse(raw) })
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
    if (serverState) return normalizeState({ ...defaultState(), ...serverState })
    return loadFromStorage(storageKey)
  })
  const keyRef = useRef(storageKey)
  keyRef.current = storageKey

  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''

  // When server state arrives (async fetch), override local state
  useEffect(() => {
    if (serverState) setState(normalizeState({ ...defaultState(), ...serverState }))
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
    const nextState = overrideState ?? stateRef.current
    fetchWithAuth(`/video-studio/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: wsId,
        name: projectNameRef.current,
        wizard_state: nextState,
        project_type: nextState.projectType === 'series' ? 'series' : undefined,
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

  const refreshFromServer = useCallback(async () => {
    const wsId = workspaceIdRef.current
    if (!wsId || !projectId) return
    try {
      const project = await fetchWithAuth<{ wizard_state?: WizardState }>(`/video-studio/projects/${projectId}`)
      if (project?.wizard_state) setState(normalizeState({ ...defaultState(), ...project.wizard_state }))
    } catch { /* local state remains fallback */ }
  }, [projectId])

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
      const order = s.projectType === 'series' ? SERIES_UNLOCK_ORDER : SINGLE_UNLOCK_ORDER
      const idx = order.indexOf(step)
      const nextStep = order[idx + 1]
      const statuses = { ...s.statuses, [step]: 'completed' as StepStatus }
      if (nextStep && statuses[nextStep] === 'locked') statuses[nextStep] = 'pending'
      const next = { ...s, statuses, activeStep: nextStep ?? step }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

  const setDescribeData = useCallback((data: DescribeData, projectType: 'single' | 'series' = 'single') => {
    setState((s) => ({ ...s, projectType, describeData: data, draftDescribeData: data }))
  }, [])

  const setDraftDescribeData = useCallback((data: DescribeData) => {
    setState((s) => ({ ...s, draftDescribeData: data }))
  }, [])

  const setScriptData = useCallback((data: Omit<ScriptResult, 'success'>) => {
    setState((s) => {
      const history = s.scriptHistory ?? []
      const alreadyIn = history.length > 0 && history[history.length - 1].script === data.script
      const activeEpisodeId = s.activeEpisodeId ?? s.episodes[0]?.id ?? 'ep_1'
      const episodes = s.episodes.length > 0 ? s.episodes : [{ id: activeEpisodeId, title: data.title || '第1集', synopsis: s.describeData?.description ?? '', scriptData: null, scriptHistory: [], fragments: [] }]
      return {
        ...s,
        activeEpisodeId,
        scriptData: data,
        scriptHistory: alreadyIn ? history : [...history, data],
        episodes: episodes.map((episode) => {
          if (episode.id !== activeEpisodeId) return episode
          const episodeHistory = episode.scriptHistory ?? []
          const episodeAlreadyIn = episodeHistory.length > 0 && episodeHistory[episodeHistory.length - 1].script === data.script
          return { ...episode, scriptData: data, scriptHistory: episodeAlreadyIn ? episodeHistory : [...episodeHistory, data] }
        }),
      }
    })
  }, [])

  const setSeriesOutline = useCallback((outline: SeriesOutline) => {
    setState((s) => {
      const episodes = outline.episodes.map((episode) => {
        const existing = s.episodes.find((item) => item.id === episode.id)
        return {
          id: episode.id,
          title: episode.title,
          synopsis: episode.synopsis,
          coreConflict: episode.coreConflict,
          hook: episode.hook,
          scriptData: existing?.scriptData ?? null,
          scriptHistory: existing?.scriptHistory ?? [],
          fragments: existing?.fragments ?? [],
        }
      })
      return { ...s, projectType: 'series', seriesOutline: outline, episodes, activeEpisodeId: s.activeEpisodeId ?? episodes[0]?.id ?? null }
    })
  }, [])

  const setActiveEpisodeId = useCallback((episodeId: string) => {
    setState((s) => {
      const episode = s.episodes.find((item) => item.id === episodeId)
      if (!episode) return s
      const fragments = episode.fragments ?? []
      return {
        ...s,
        activeEpisodeId: episodeId,
        scriptData: episode.scriptData,
        scriptHistory: episode.scriptHistory ?? [],
        fragments,
        shots: fragments.flatMap((fragment) => fragment.shots ?? []),
      }
    })
  }, [])

  const setFragments = useCallback((fragments: Fragment[]) => {
    setState((s) => {
      const shots = fragments.flatMap((fragment) => fragment.shots ?? [])
      const activeEpisodeId = s.activeEpisodeId
      return {
        ...s,
        fragments,
        shots,
        episodes: activeEpisodeId ? s.episodes.map((episode) => episode.id === activeEpisodeId ? { ...episode, fragments } : episode) : s.episodes,
      }
    })
  }, [])

  const setShots = useCallback((shots: Shot[]) => {
    const fragments = shots.length ? [{ id: 'fragment_1', label: '片段1', duration: shots.reduce((sum, shot) => sum + (shot.duration || 0), 0), shots }] : []
    setFragments(fragments)
  }, [setFragments])

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
    setState((s) => {
      const prev = s.shotVideoHistory?.[shotId] ?? []
      const alreadyIn = prev.length > 0 && prev[prev.length - 1] === url
      const next = {
        ...s,
        shotVideos: { ...s.shotVideos, [shotId]: url },
        shotVideoHistory: alreadyIn ? (s.shotVideoHistory ?? {}) : { ...(s.shotVideoHistory ?? {}), [shotId]: [...prev, url] },
      }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

  const addPendingImageBatch = useCallback((batchId: string, target: PendingImageBatchTarget) => {
    setState((s) => ({
      ...s,
      pendingImageBatches: { ...(s.pendingImageBatches ?? {}), [batchId]: target },
    }))
  }, [])

  const clearPendingImageBatch = useCallback((batchId: string) => {
    setState((s) => {
      const { [batchId]: _removed, ...pendingImageBatches } = s.pendingImageBatches ?? {}
      return { ...s, pendingImageBatches }
    })
  }, [])

  const addPendingVideoBatch = useCallback((batchId: string, shotId: string) => {
    setState((s) => {
      const next = {
        ...s,
        pendingVideoBatches: { ...(s.pendingVideoBatches ?? {}), [batchId]: shotId },
      }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

  const clearPendingVideoBatch = useCallback((batchId: string) => {
    setState((s) => {
      const { [batchId]: _removed, ...pendingVideoBatches } = s.pendingVideoBatches ?? {}
      const next = { ...s, pendingVideoBatches }
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      syncNow(next)
      return next
    })
  }, [syncNow])

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
    setSeriesOutline,
    setActiveEpisodeId,
    setFragments,
    setShots,
    setShotImage,
    setCharacterImage,
    setSceneImage,
    setShotVideo,
    addPendingImageBatch,
    clearPendingImageBatch,
    addPendingVideoBatch,
    clearPendingVideoBatch,
    reset,
    syncNow,
    refreshFromServer,
  }
}
