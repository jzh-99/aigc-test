import type { MusicGenerateRequest, MusicTrackResponse, MusicVoiceCloneResponse } from '@aigc/types'
import { apiGet, apiPost, fetchWithAuth } from '@/lib/api-client'

export interface MusicTrackListResponse {
  data: MusicTrackResponse[]
  cursor: string | null
  has_more?: boolean
}

export interface MusicGenerateResponse {
  id: string
  status: string
  track: MusicTrackResponse | null
}

export interface MusicAdjacentResponse {
  previous_id: string | null
  next_id: string | null
}

export interface MusicVoiceCloneListResponse {
  data: MusicVoiceCloneResponse[]
}

export async function createMusicTrack(payload: MusicGenerateRequest): Promise<MusicGenerateResponse> {
  return apiPost<MusicGenerateResponse>('/music/generate', payload)
}

export async function getMusicTrack(id: string): Promise<MusicTrackResponse> {
  return apiGet<MusicTrackResponse>(`/music/tracks/${id}`)
}

export async function getMusicAdjacent(id: string): Promise<MusicAdjacentResponse> {
  return apiGet<MusicAdjacentResponse>(`/music/tracks/${id}/adjacent`)
}

export async function createMusicVoiceClone(form: FormData): Promise<MusicVoiceCloneResponse> {
  return fetchWithAuth<MusicVoiceCloneResponse>('/music/voice-clones', {
    method: 'POST',
    body: form,
  })
}

export function buildMusicTracksUrl(workspaceId: string, cursor?: string | null, limit = 20): string {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return `/music/tracks?${params.toString()}`
}

export function buildMusicVoiceClonesUrl(workspaceId: string): string {
  return `/music/voice-clones?${new URLSearchParams({ workspace_id: workspaceId }).toString()}`
}

export function buildMusicEventsUrl(trackId: string): string {
  return `/api/v1/music/tracks/${trackId}/events`
}

export function buildMusicVoiceCloneEventsUrl(voiceCloneId: string): string {
  return `/api/v1/music/voice-clones/${voiceCloneId}/events`
}
