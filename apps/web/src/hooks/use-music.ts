import { useEffect } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import type { MusicSseEvent, MusicTrackResponse } from '@aigc/types'
import { apiFetcher } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  buildMusicEventsUrl,
  buildMusicTracksUrl,
  buildMusicVoiceClonesUrl,
  type MusicAdjacentResponse,
  type MusicTrackListResponse,
  type MusicVoiceCloneListResponse,
} from '@/lib/music/api'

export function useMusicTracks(limit = 20) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const swr = useSWRInfinite<MusicTrackListResponse>(
    (pageIndex, previousPage) => {
      if (!workspaceId) return null
      if (previousPage && !previousPage.cursor) return null
      return buildMusicTracksUrl(workspaceId, pageIndex === 0 ? null : previousPage?.cursor, limit)
    },
    apiFetcher,
  )

  return {
    ...swr,
    tracks: swr.data?.flatMap((page) => page.data) ?? [],
    cursor: swr.data?.[swr.data.length - 1]?.cursor ?? null,
    isLoadingInitial: !swr.data && !swr.error,
  }
}

export function useMusicTrack(id: string | null | undefined) {
  return useSWR<MusicTrackResponse>(id ? `/music/tracks/${id}` : null, apiFetcher)
}

export function useMusicAdjacent(id: string | null | undefined) {
  return useSWR<MusicAdjacentResponse>(id ? `/music/tracks/${id}/adjacent` : null, apiFetcher)
}

export function useMusicVoiceClones() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  return useSWR<MusicVoiceCloneListResponse>(workspaceId ? buildMusicVoiceClonesUrl(workspaceId) : null, apiFetcher)
}

export function useMusicTrackEvents(
  trackId: string | null | undefined,
  onEvent: (event: MusicSseEvent) => void,
) {
  const token = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!trackId || typeof window === 'undefined') return
    const url = new URL(buildMusicEventsUrl(trackId), window.location.origin)
    if (token) url.searchParams.set('token', token)
    const source = new EventSource(url.toString(), { withCredentials: true })
    const handleMessage = (event: MessageEvent) => {
      try {
        onEvent(JSON.parse(event.data) as MusicSseEvent)
      } catch {
        // 忽略无法解析的心跳/兼容消息
      }
    }
    source.addEventListener('message', handleMessage)
    source.addEventListener('status', handleMessage)
    source.addEventListener('lyrics_delta', handleMessage)
    source.addEventListener('stream_url', handleMessage)
    source.addEventListener('completed', handleMessage)
    source.addEventListener('failed', handleMessage)
    return () => source.close()
  }, [trackId, token, onEvent])
}

