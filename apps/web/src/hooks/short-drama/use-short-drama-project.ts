'use client'

import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { ShortDramaState } from '@aigc/types'
import {
  getShortDramaProject,
  saveShortDramaProject,
  syncShortDramaBatches,
  type ShortDramaProjectDetail,
} from '@/lib/short-drama/api'

const POLL_INTERVAL = 10_000

function hasPendingWork(state: ShortDramaState): boolean {
  const hasPendingAssets = state.assets.items.some(
    a => a.status === 'pending' || a.status === 'generating'
  )
  const hasPendingSegments = state.episodes.items.some(ep =>
    ep.segments.some(s => s.status === 'pending' || s.status === 'generating')
  )
  const hasPendingExports = state.exports.batches.some(
    b => b.status === 'pending' || b.status === 'exporting'
  )
  return hasPendingAssets || hasPendingSegments || hasPendingExports
}

export function useShortDramaProject(projectId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ShortDramaProjectDetail>(
    projectId ? `/short-drama/projects/${projectId}` : null,
    projectId ? () => getShortDramaProject(projectId) : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const state = data?.state ?? null
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 自动轮询：当有 pending/generating 状态时每 10s sync
  useEffect(() => {
    if (!projectId || !state) return

    if (hasPendingWork(state)) {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const result = await syncShortDramaBatches(projectId)
            if (result.synced > 0) {
              mutate()
            }
          } catch {
            // 静默忽略 sync 错误
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
  }, [projectId, state, mutate])

  const updateState = useCallback(
    async (partialState: Partial<ShortDramaState>) => {
      if (!projectId) return
      const result = await saveShortDramaProject(projectId, { state: partialState })
      mutate(result, false)
      return result
    },
    [projectId, mutate]
  )

  const flushDraft = useCallback(
    async (input: { title?: string; status?: string; activeStep?: string }) => {
      if (!projectId) return
      const result = await saveShortDramaProject(projectId, input)
      mutate(result, false)
      return result
    },
    [projectId, mutate]
  )

  const syncBatches = useCallback(async () => {
    if (!projectId) return null
    const result = await syncShortDramaBatches(projectId)
    if (result.synced > 0) {
      mutate()
    }
    return result
  }, [projectId, mutate])

  return {
    project: data,
    state,
    error,
    isLoading,
    mutate,
    updateState,
    flushDraft,
    syncBatches,
  }
}
