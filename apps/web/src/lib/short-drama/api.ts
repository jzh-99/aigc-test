import { fetchWithAuth } from '@/lib/api-client'
import type { ShortDramaState, ShortDramaAspectRatio } from '@aigc/types'

// ============================================================================
// Types
// ============================================================================

export interface CreateShortDramaProjectInput {
  workspaceId: string
  prompt: string
  style: string
  aspectRatio: ShortDramaAspectRatio
  episodeCount: number
}

export interface SaveShortDramaProjectInput {
  title?: string
  state?: Partial<ShortDramaState>
  status?: string
  activeStep?: string
  coverUrl?: string
}

export interface GenerateShortDramaAssetsInput {
  assetIds: string[]
  scope: 'global' | 'episode'
  episodeId?: string
}

export interface ShortDramaProjectListItem {
  id: string
  title: string
  status: string
  coverUrl: string | null
  episodeCount: number
  updatedAt: string
  createdAt: string
}

export interface ShortDramaProjectDetail {
  id: string
  title: string
  status: string
  state: ShortDramaState
  coverUrl: string | null
  activeStep: string | null
  createdAt: string
  updatedAt: string
}

// ============================================================================
// API Functions
// ============================================================================

export function createShortDramaProject(
  input: CreateShortDramaProjectInput
): Promise<{ projectId: string; state: ShortDramaState }> {
  return fetchWithAuth('/short-drama/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      prompt: input.prompt,
      style: input.style,
      aspect_ratio: input.aspectRatio,
      episode_count: input.episodeCount,
    }),
  })
}

export function listRecentShortDramaProjects(
  workspaceId: string
): Promise<ShortDramaProjectListItem[]> {
  return fetchWithAuth(`/short-drama/projects/recent?workspace_id=${workspaceId}`)
}

export function listShortDramaProjects(
  workspaceId: string,
  cursor?: string
): Promise<{ items: ShortDramaProjectListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  if (cursor) params.set('cursor', cursor)
  return fetchWithAuth(`/short-drama/projects?${params}`)
}

export function getShortDramaProject(
  projectId: string
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}`)
}

export function saveShortDramaProject(
  projectId: string,
  input: SaveShortDramaProjectInput
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteShortDramaProject(projectId: string): Promise<void> {
  return fetchWithAuth(`/short-drama/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export function generateShortDramaScriptSummary(
  projectId: string
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/script/summary`, {
    method: 'POST',
  })
}

export function generateShortDramaEpisodeOutlines(
  projectId: string
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/script/episode-outlines`, {
    method: 'POST',
  })
}

export function generateShortDramaAssetPrompts(
  projectId: string
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/assets/prompts`, {
    method: 'POST',
  })
}

export function generateShortDramaAssets(
  projectId: string,
  input: GenerateShortDramaAssetsInput
): Promise<{ success: boolean; batchId: string }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/assets/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function uploadShortDramaAsset(
  projectId: string,
  input: { assetId?: string; storageKey?: string; imageUrl?: string; scope: 'global' | 'episode'; name?: string; kind?: string }
): Promise<{ success: boolean; assets: any[] }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/assets/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function generateShortDramaEpisodeSegments(
  projectId: string,
  episodeNumber: number
): Promise<ShortDramaProjectDetail> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments`, {
    method: 'POST',
  })
}

export function generateShortDramaSegmentVideo(
  projectId: string,
  episodeNumber: number,
  segmentId: string
): Promise<{ success: boolean; batchId: string; taskId: string }> {
  return fetchWithAuth(
    `/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments/${segmentId}/generate-video`,
    { method: 'POST' }
  )
}

export function syncShortDramaBatches(
  projectId: string
): Promise<{ success: boolean; synced: number; state: ShortDramaState }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/sync`, {
    method: 'POST',
  })
}

export function exportShortDramaEpisode(
  projectId: string,
  episodeNumber: number
): Promise<{ success: boolean; exportId: string }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/episodes/${episodeNumber}/export`, {
    method: 'POST',
  })
}

export function exportShortDramaBatch(
  projectId: string,
  episodeNumbers: number[]
): Promise<{ success: boolean; exportId: string; episodeCount: number }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/export-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeNumbers }),
  })
}
