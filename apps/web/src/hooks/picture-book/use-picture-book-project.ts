'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  getPictureBookCharges,
  getPictureBookProject,
  renamePictureBookProject,
  savePictureBookDraft,
  syncPictureBookBatches,
} from '@/lib/picture-book/api'
import type { PictureBookChargeSummary, PictureBookProject, PictureBookState } from '@/lib/picture-book/types'

const POLL_INTERVAL = 3_000

function isPendingStatus(status?: string): boolean {
  return status === 'pending' || status === 'generating'
}

function hasPendingWork(state: PictureBookState): boolean {
  // 检查资产生成状态
  const allAssets = [...(state.assets?.characters ?? []), ...(state.assets?.backgrounds ?? [])]
  const hasPendingAssets = allAssets.some(
    a => isPendingStatus(a.status)
  )

  // 检查分镜生成状态
  const hasPendingStoryboards = state.storyboard?.some(
    s => isPendingStatus(s.status)
  ) ?? false

  return hasPendingAssets || hasPendingStoryboards
}

export function usePictureBookProject(projectId?: string | null) {
  const projectKey = projectId ? `picture-book-project:${projectId}` : null
  const chargesKey = projectId ? `picture-book-project-charges:${projectId}` : null
  const [localState, setLocalState] = useState<PictureBookState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef<PictureBookState | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const projectSWR = useSWR<PictureBookProject>(
    projectKey,
    () => getPictureBookProject(projectId!),
  )
  const chargesSWR = useSWR<{ summary: PictureBookChargeSummary }>(
    chargesKey,
    () => getPictureBookCharges(projectId!),
  )

  useEffect(() => {
    if (projectSWR.data?.state) {
      setLocalState(projectSWR.data.state)
      latestStateRef.current = projectSWR.data.state
    }
  }, [projectSWR.data?.state])

  // 自动轮询机制
  useEffect(() => {
    if (!projectId || !localState) return

    if (hasPendingWork(localState)) {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const result = await syncPictureBookBatches(projectId)
            latestStateRef.current = result.state
            setLocalState(result.state)
            await projectSWR.mutate()
          } catch {
            // 静默忽略同步错误
          }
        }, POLL_INTERVAL)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [projectId, localState, projectSWR])

  const flushDraft = useCallback(async (overrideState?: PictureBookState | null) => {
    if (!projectId) return
    const state = overrideState ?? latestStateRef.current
    if (!state) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaving(true)
    setSaveError(null)
    try {
      const result = await savePictureBookDraft(projectId, state)
      const savedState = {
        ...state,
        draft: { ...state.draft, dirty: false, savedAt: result.draft_saved_at },
      }
      latestStateRef.current = savedState
      setLocalState(savedState)
      await projectSWR.mutate(current => current ? { ...current, state: savedState } : current, false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '草稿保存失败')
    } finally {
      setSaving(false)
    }
  }, [projectId, projectSWR])

  const updateState = useCallback((updater: PictureBookState | ((state: PictureBookState) => PictureBookState)) => {
    setLocalState((current) => {
      if (!current) return current
      const nextRaw = typeof updater === 'function' ? updater(current) : updater
      const next = { ...nextRaw, draft: { ...nextRaw.draft, dirty: true } }
      latestStateRef.current = next
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void flushDraft(next)
      }, 1200)
      return next
    })
  }, [flushDraft])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const state = latestStateRef.current
      if (state?.draft.dirty && projectId) void savePictureBookDraft(projectId, state).catch(() => {})
    }
  }, [projectId])

  const rename = useCallback(async (title: string) => {
    if (!projectId) return
    await renamePictureBookProject(projectId, title)
    await projectSWR.mutate()
  }, [projectId, projectSWR])

  const syncBatches = useCallback(async () => {
    if (!projectId) return
    const result = await syncPictureBookBatches(projectId)
    latestStateRef.current = result.state
    setLocalState(result.state)
    await Promise.all([projectSWR.mutate(), chargesSWR.mutate()])
    return result
  }, [projectId, projectSWR, chargesSWR])

  return useMemo(() => ({
    project: projectSWR.data,
    state: localState,
    charges: chargesSWR.data?.summary,
    isLoading: projectSWR.isLoading,
    error: projectSWR.error,
    saving,
    saveError,
    updateState,
    flushDraft,
    rename,
    syncBatches,
    mutate: projectSWR.mutate,
  }), [chargesSWR.data?.summary, errorKey(projectSWR.error), flushDraft, localState, projectSWR, rename, saveError, saving, syncBatches, updateState])
}

function errorKey(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}
