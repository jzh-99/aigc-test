import { fetchWithAuth } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
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

export interface ShortDramaStreamProgress {
  message: string
  from?: number
  to?: number
  completedCount?: number
  totalCount?: number
}

export interface ShortDramaStreamWarning {
  message: string
  completedCount?: number
  totalCount?: number
  remainingCount?: number
}

export interface ShortDramaStreamResult {
  success: boolean
  partial?: boolean
  warning?: string
  title?: string
  summary?: string
  outlines?: ShortDramaState['script']['outlines']
  assets?: ShortDramaState['assets']['items']
  credits?: number
  completedCount?: number
  totalCount?: number
  remainingCount?: number
  state: ShortDramaState
}

export interface ShortDramaStreamOptions {
  onChunk?: (text: string) => void
  onProgress?: (progress: ShortDramaStreamProgress) => void
  onWarning?: (warning: ShortDramaStreamWarning) => void
}

const API_BASE = '/api/v1'

async function consumeShortDramaSSE<T>(
  res: Response,
  options: ShortDramaStreamOptions = {}
): Promise<T> {
  if (!res.body) {
    throw new Error('服务端未返回流式响应')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let result: T | null = null
  let currentEvent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      if (!line || line.startsWith(':')) continue

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (!line.startsWith('data: ')) continue

      const data = line.slice(6).trim()
      if (!data) continue

      const json = JSON.parse(data) as unknown
      if (currentEvent === 'chunk') {
        const payload = json as { text?: string }
        if (payload.text) options.onChunk?.(payload.text)
      } else if (currentEvent === 'progress') {
        options.onProgress?.(json as ShortDramaStreamProgress)
      } else if (currentEvent === 'warning') {
        options.onWarning?.(json as ShortDramaStreamWarning)
      } else if (currentEvent === 'done') {
        result = json as T
      } else if (currentEvent === 'error') {
        const payload = json as { message?: string }
        throw new Error(payload.message ?? '操作失败')
      }

      currentEvent = ''
    }
  }

  if (!result) {
    throw new Error('未收到完成事件')
  }

  return result
}

async function postShortDramaSSE<T>(
  path: string,
  options: ShortDramaStreamOptions = {}
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? '生成失败')
  }

  return consumeShortDramaSSE<T>(res, options)
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
  return fetchWithAuth<{ items: ShortDramaProjectListItem[] }>(
    `/short-drama/projects/recent?workspace_id=${workspaceId}`
  ).then(res => res.items)
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
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/summary`,
    options
  )
}

export function generateShortDramaEpisodeOutlines(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-outlines`,
    options
  )
}

export function generateShortDramaAssetPrompts(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/assets/prompts`,
    options
  )
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
  episodeNumber: number,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments`,
    options
  )
}

export function generateShortDramaSegmentVideo(
  projectId: string,
  episodeNumber: number,
  segmentId: string
): Promise<{ success: boolean; batchId: string; taskId: string }> {
  return fetchWithAuth(
    `/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments/${segmentId}/generate-video`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
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
