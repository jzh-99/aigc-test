import { fetchWithAuth } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type { ShortDramaState, ShortDramaAspectRatio } from '@aigc/types'

// ============================================================================
// Types
// ============================================================================

export interface CreateShortDramaProjectInput {
  workspaceId: string
  prompt: string
  source?: 'idea' | 'upload'
  originalScript?: string
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

export interface GenerateShortDramaSegmentVideoInput {
  model: string
  resolution: '720p' | '1080p'
}

export interface ShortDramaProjectListItem {
  id: string
  title: string
  prompt?: string
  style?: string
  aspectRatio?: ShortDramaAspectRatio
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

export interface ShortDramaScriptUploadResult {
  text: string
  charCount: number
}

const API_BASE = '/api/v1'

/**
 * 后端 SSE 主动下发的 error 事件（业务明确失败）。
 * 与网络中断（fetch/reader 抛错）区分：前者直接抛出，后者触发回查兜底。
 */
class ShortDramaSseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShortDramaSseError'
  }
}

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
        throw new ShortDramaSseError(payload.message ?? '操作失败')
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
  options: ShortDramaStreamOptions = {},
  projectId?: string,
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

  try {
    return await consumeShortDramaSSE<T>(res, options)
  } catch (err) {
    // 后端主动 error 事件（业务明确失败）：直接抛出，不回查
    if (err instanceof ShortDramaSseError) throw err
    // 其余（网络中断/连接被代理掐断）：后端可能仍在生成或已成功落库。
    // 回查项目状态：若未标记失败，按「已同步最新状态」返回，避免误报 network error。
    if (projectId) {
      const recovered = await recoverShortDramaStream<T>(projectId)
      if (recovered) return recovered
    }
    throw err
  }
}

/**
 * 流式连接中断后回查项目状态。
 * 后端 AI 生成耗时较长时，连接可能被中间代理（nginx/SLB）掐断，
 * 但后端仍会跑完并落库。此时回查拿到最新状态，避免给用户误报失败。
 * 仅当后端未标记 failed 时视为「已同步」，由上层 onStateChange 刷新 UI。
 */
async function recoverShortDramaStream<T>(projectId: string): Promise<T | null> {
  try {
    const project = await getShortDramaProject(projectId)
    if (project.status !== 'failed') {
      return { success: true, state: project.state } as unknown as T
    }
    return null
  } catch {
    return null
  }
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
      source: input.source ?? 'idea',
      original_script: input.originalScript,
      style: input.style,
      aspect_ratio: input.aspectRatio,
      episode_count: input.episodeCount,
    }),
  })
}

export function updateShortDramaScriptSource(
  projectId: string,
  payload: { originalPrompt?: string; originalScript?: string }
): Promise<{ success: true; state: ShortDramaState }> {
  return fetchWithAuth(`/short-drama/projects/${projectId}/script/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function uploadShortDramaScript(file: File): Promise<ShortDramaScriptUploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  return fetchWithAuth('/short-drama/script/upload', {
    method: 'POST',
    body: formData,
  })
}

export function listRecentShortDramaProjects(
  workspaceId: string,
  limit = 10,
): Promise<ShortDramaProjectListItem[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) })
  return fetchWithAuth<{ items: ShortDramaProjectListItem[] }>(
    `/short-drama/projects/recent?${params}`
  ).then(res => res.items)
}

export function listShortDramaProjects(
  workspaceId: string,
  cursor?: string,
  limit?: number,
): Promise<{ items: ShortDramaProjectListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  if (cursor) params.set('cursor', cursor)
  if (limit) params.set('limit', String(limit))
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
    options,
    projectId,
  )
}

export function generateShortDramaEpisodeOutlines(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-outlines`,
    options,
    projectId,
  )
}

export function generateShortDramaAssetPrompts(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/assets/prompts`,
    options,
    projectId,
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

/**
 * 上传本地图片文件到短剧素材存储，返回 storageKey
 */
export function uploadShortDramaImage(
  projectId: string,
  file: File,
): Promise<{ url: string }> {
  const formData = new FormData()
  formData.append('file', file)
  return fetchWithAuth(`/short-drama/projects/${projectId}/assets/upload-image`, {
    method: 'POST',
    body: formData,
  })
}

export function generateShortDramaEpisodeSegments(
  projectId: string,
  episodeNumber: number,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments`,
    options,
    projectId,
  )
}

export function generateShortDramaSegmentVideo(
  projectId: string,
  episodeNumber: number,
  segmentId: string,
  input: GenerateShortDramaSegmentVideoInput
): Promise<{ success: boolean; batchId: string; taskId: string; state: ShortDramaState }> {
  return fetchWithAuth(
    `/short-drama/projects/${projectId}/episodes/${episodeNumber}/segments/${segmentId}/generate-video`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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
