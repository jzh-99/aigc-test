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

type ShortDramaPollScope =
  | { type: 'project' }
  | { type: 'episode'; episodeNumber: number }

function isPendingStatus(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'generating' || status === 'exporting'
}

function hasPendingEpisodeWork(state: ShortDramaState, episodeNumber: number): boolean {
  const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
  const hasPendingSegments = episode?.segments.some(segment => isPendingStatus(segment.status)) ?? false
  const hasPendingExports = state.exports.batches.some(batch =>
    batch.episodeNumbers.includes(episodeNumber)
    && (
      isPendingStatus(batch.status)
      || batch.exports.some(item => item.episodeNumber === episodeNumber && isPendingStatus(item.status))
    )
  )

  return hasPendingSegments || hasPendingExports
}

function hasPendingWork(state: ShortDramaState, scope: ShortDramaPollScope): boolean {
  if (scope.type === 'episode') {
    return hasPendingEpisodeWork(state, scope.episodeNumber)
  }

  if (state.steps.active === 'script') {
    // 覆盖全部 script 步骤发起的文本流程 generating，任一卡死时持续轮询触发 /sync 自愈
    return (
      state.script.status === 'generating' ||
      state.script.outlinesStatus === 'generating' ||
      state.script.episodeSummaryStatus === 'generating' ||
      state.assets.status === 'generating'
    )
  }

  const hasPendingAssets = state.assets.items.some(
    a => isPendingStatus(a.status)
  )
  if (state.steps.active === 'assets') {
    if (state.locks.assets) return false
    return state.assets.status === 'generating' || hasPendingAssets
  }

  const hasPendingSegments = state.episodes.items.some(ep =>
    ep.segments.some(s => isPendingStatus(s.status))
  )
  const hasPendingExports = state.exports.batches.some(
    b => isPendingStatus(b.status) || b.exports.some(item => isPendingStatus(item.status))
  )
  if (state.steps.active === 'episodes') {
    // episode.status=generating 为片段「脚本」生成中（区别于 segment 视频状态），同样需轮询自愈
    const hasGeneratingEpisodes = state.episodes.items.some(ep => ep.status === 'generating')
    return hasGeneratingEpisodes || hasPendingSegments || hasPendingExports
  }

  return false
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

export function useShortDramaProject(
  projectId: string | null,
  options: { pollScope?: ShortDramaPollScope } = {}
) {
  const { data, error, isLoading, mutate } = useSWR<ShortDramaProjectDetail>(
    projectId ? `/short-drama/projects/${projectId}` : null,
    projectId ? () => getShortDramaProject(projectId) : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const state = data?.state ?? null
  const pollScopeType = options.pollScope?.type ?? 'project'
  const pollEpisodeNumber = options.pollScope?.type === 'episode' ? options.pollScope.episodeNumber : null
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const notifiedFailedSegmentKeysRef = useRef(new Set<string>())

  // 自动轮询：当有 pending/generating 状态时每 3s sync
  useEffect(() => {
    if (!projectId || !state) return
    const pollScope: ShortDramaPollScope = pollScopeType === 'episode' && pollEpisodeNumber
      ? { type: 'episode', episodeNumber: pollEpisodeNumber }
      : { type: 'project' }

    if (hasPendingWork(state, pollScope)) {
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
  }, [projectId, state, mutate, pollScopeType, pollEpisodeNumber])

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
