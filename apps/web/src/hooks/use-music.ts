import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { MusicSseEvent, MusicTrackResponse } from '@aigc/types'
import { apiFetcher } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  buildMusicEventsUrl,
  buildMusicVoiceCloneEventsUrl,
  buildMusicTracksUrl,
  buildMusicVoiceClonesUrl,
  type MusicAdjacentResponse,
  type MusicTrackListResponse,
  type MusicVoiceCloneListResponse,
} from '@/lib/music/api'

export type MusicVoiceCloneSseEvent =
  | { event: 'status'; status?: string }
  | { event: 'ready'; voice_id?: string }
  | { event: 'failed'; error_message?: string }

export function useMusicTracks(page = 1, limit = 10, title?: string) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const swr = useSWR<MusicTrackListResponse>(
    isInitialized && workspaceId ? buildMusicTracksUrl(workspaceId, page, limit, title) : null,
    apiFetcher,
  )

  return {
    ...swr,
    tracks: swr.data?.data ?? [],
    total: swr.data?.total ?? 0,
    totalPages: swr.data?.total_pages ?? 0,
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
  const isInitialized = useAuthStore((s) => s.isInitialized)
  return useSWR<MusicVoiceCloneListResponse>(
    isInitialized && workspaceId ? buildMusicVoiceClonesUrl(workspaceId) : null,
    apiFetcher,
  )
}

type SseEventHandler<T> = (event: T) => void

function useAuthorizedSse<T extends { event?: string }>(
  url: string | null | undefined,
  eventNames: string[],
  onEvent: SseEventHandler<T>,
) {
  const controllerRef = useRef<AbortController | null>(null)
  const onEventRef = useRef(onEvent)
  const eventNamesRef = useRef(eventNames)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    eventNamesRef.current = eventNames
  }, [eventNames])

  const connect = useCallback((targetUrl: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    ;(async () => {
      const token = useAuthStore.getState().accessToken
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(targetUrl, {
        headers,
        credentials: 'include',
        signal: controller.signal,
      })
      if (!res.ok || !res.body) return

      const allowedEvents = new Set(eventNamesRef.current)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventName = 'message'
      const flushEvent = (data: string) => {
        if (!allowedEvents.has(eventName)) return
        try {
          const parsed = JSON.parse(data) as Partial<T>
          onEventRef.current({
            ...parsed,
            event: parsed.event ?? eventName,
          } as T)
        } catch {
          // 忽略心跳和不完整数据
        }
      }

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          eventName = 'message'
          const dataLines: string[] = []
          for (const rawLine of chunk.split(/\r?\n/)) {
            const line = rawLine.trimEnd()
            if (line.startsWith(':')) continue
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
          }
          if (dataLines.length) flushEvent(dataLines.join('\n'))
        }
      }
    })().catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      // fetch-SSE 不做 401 自动重连，避免认证失败时持续刷接口。
      console.error('音乐 SSE 连接失败', error)
    })
  }, [])

  useEffect(() => {
    if (!url || typeof window === 'undefined') {
      controllerRef.current?.abort()
      return
    }
    connect(url)
    return () => controllerRef.current?.abort()
  }, [connect, url])
}

export function useMusicTrackEvents(
  trackId: string | null | undefined,
  onEvent: (event: MusicSseEvent) => void,
) {
  const url = trackId ? buildMusicEventsUrl(trackId) : null
  useAuthorizedSse<MusicSseEvent>(
    url,
    ['message', 'status', 'lyrics_delta', 'stream_url', 'completed', 'failed'],
    onEvent,
  )
}

export function useMusicVoiceCloneEvents(
  voiceCloneId: string | null | undefined,
  onEvent: (event: MusicVoiceCloneSseEvent) => void,
) {
  const url = voiceCloneId ? buildMusicVoiceCloneEventsUrl(voiceCloneId) : null
  useAuthorizedSse<MusicVoiceCloneSseEvent>(
    url,
    ['message', 'status', 'ready', 'failed'],
    onEvent,
  )
}
