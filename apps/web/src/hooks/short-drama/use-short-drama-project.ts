'use client'

import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import type { ShortDramaState } from '@aigc/types'
import {
  getShortDramaProject,
  saveShortDramaProject,
  syncShortDramaBatches,
  type ShortDramaProjectDetail,
} from '@/lib/short-drama/api'

const POLL_INTERVAL = 3_000

function hasPendingWork(state: ShortDramaState): boolean {
  const hasPendingText = (
    state.script.status === 'generating' ||
    state.assets.status === 'generating' ||
    state.episodes.status === 'generating'
  )
  const hasPendingAssets = state.assets.items.some(
    a => a.status === 'pending' || a.status === 'generating'
  )
  const hasPendingSegments = state.episodes.items.some(ep =>
    ep.segments.some(s => s.status === 'pending' || s.status === 'generating')
  )
  const hasPendingExports = state.exports.batches.some(
    b => b.status === 'pending' || b.status === 'exporting'
  )
  return hasPendingText || hasPendingAssets || hasPendingSegments || hasPendingExports
}

function notifyFailedSegmentTransitions(previous: ShortDramaState, next: ShortDramaState, notifiedKeys: Set<string>) {
  for (const nextEpisode of next.episodes.items) {
    const previousEpisode = previous.episodes.items.find(ep => ep.episodeNumber === nextEpisode.episodeNumber)
    if (!previousEpisode) continue

    for (const nextSegment of nextEpisode.segments) {
      if (nextSegment.status !== 'failed') continue
      const previousSegment = previousEpisode.segments.find(segment => segment.id === nextSegment.id)
      if (!previousSegment || (previousSegment.status !== 'pending' && previousSegment.status !== 'generating')) continue

      const key = `${nextEpisode.episodeNumber}:${nextSegment.id}:${nextSegment.videoTaskId ?? nextSegment.videoBatchId ?? ''}`
      if (notifiedKeys.has(key)) continue

      notifiedKeys.add(key)
      toast.error(`第 ${nextEpisode.episodeNumber} 集「${nextSegment.title}」视频生成失败，请稍后重试`)
    }
  }
}

export function useShortDramaProject(projectId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ShortDramaProjectDetail>(
    projectId ? `/short-drama/projects/${projectId}` : null,
    projectId ? () => getShortDramaProject(projectId) : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const state = data?.state ?? null
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const notifiedFailedSegmentKeysRef = useRef(new Set<string>())

  // 自动轮询：当有 pending/generating 状态时每 3s sync
  useEffect(() => {
    if (!projectId || !state) return

    if (hasPendingWork(state)) {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const result = await syncShortDramaBatches(projectId)
            if (state) {
              notifyFailedSegmentTransitions(state, result.state, notifiedFailedSegmentKeysRef.current)
            }
            mutate(current => current ? { ...current, state: result.state } : current, false)
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
    mutate(current => current ? { ...current, state: result.state } : current, false)
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
