const BASE = '/api/v1/video-studio'

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err?.error?.message ?? `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface ScriptResult {
  success: boolean
  title: string
  actCount?: number
  script: string
  characters: Array<{ name: string; description: string; voiceDescription?: string }>
  scenes: Array<{ name: string; description: string }>
}

export interface Shot {
  id: string
  label: string
  content: string
  characters?: string[]
  scene?: string
  cameraMove: string
  duration: number
  voiceNote?: string
  visualPrompt?: string
}

export interface Fragment {
  id: string
  label: string
  duration: number
  transition?: string
  shots: Shot[]
}

export interface StoryboardResult {
  success: boolean
  fragments: Fragment[]
  shots?: Shot[]
}

export interface AssetPromptsResult {
  success: boolean
  styleAnchor: string
  characters: Array<{ name: string; prompt: string }>
  scenes: Array<{ name: string; prompt: string }>
}

export interface SeriesOutlineResult {
  success: boolean
  title: string
  synopsis: string
  worldbuilding: string
  mainCharacters: Array<{ name: string; description: string; voiceDescription?: string }>
  mainScenes: Array<{ name: string; description: string }>
  relationships?: Array<{ from: string; to: string; description: string }>
  episodes: Array<{ id: string; title: string; synopsis: string; coreConflict?: string; hook?: string }>
}

export function writeScript(params: {
  description: string
  style: string
  duration: number
  feedback?: string
}, token?: string) {
  return post<ScriptResult>('/script-write', params, token)
}

export function splitStoryboard(params: {
  script: string
  shotCount?: number
  fragmentCount?: number
  duration?: number
  aspectRatio?: string
  style?: string
  characters?: Array<{ name: string; description: string; voiceDescription?: string }>
  scenes?: Array<{ name: string; description: string }>
}, token?: string) {
  return post<StoryboardResult>('/storyboard-split', params, token)
}

export function generateSeriesOutline(params: {
  description: string
  style: string
  episodeCount: number
  episodeDuration: number
}, token?: string) {
  return post<SeriesOutlineResult>('/series-outline', params, token)
}

export function generateAssetPrompts(params: {
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
  style: string
}, token?: string) {
  return post<AssetPromptsResult>('/asset-prompts', params, token)
}

export interface VideoStudioProjectItem {
  id: string
  name: string
  created_at: string
  updated_at: string
  project_type?: 'single' | 'series' | 'episode'
  series_parent_id?: string | null
  episode_index?: number | null
  wizard_state?: unknown
}

export function createSeriesEpisodes(projectId: string, params: {
  workspace_id: string
  name: string
  describeData: { description: string; style: string; duration: number; aspectRatio: string }
  outline: SeriesOutlineResult | Omit<SeriesOutlineResult, 'success'>
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  assetStyle?: string
}, token?: string) {
  return post<{ success: boolean; episodes: VideoStudioProjectItem[] }>(`/projects/${projectId}/series/episodes`, params, token)
}

export function fetchSeriesEpisodes(projectId: string, token?: string) {
  return get<VideoStudioProjectItem[]>(`/projects/${projectId}/episodes`, token)
}

export interface VideoStudioHistoryItem {
  id: string
  canvas_node_id: string | null
  model: string
  prompt: string
  quantity: number
  completed_count: number
  failed_count: number
  status: string
  actual_credits: number | null
  created_at: string
  module?: string
  queue_position?: number | null
  processing_started_at?: string | null
}

export interface VideoStudioAssetItem {
  id: string
  type: string
  storage_url: string | null
  original_url: string | null
  created_at: string
  batch_id: string
  canvas_node_id: string | null
  prompt: string
  model: string
}

interface CursorListResponse<T> {
  items: T[]
  nextCursor: string | null
}

async function get<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } | string }
    throw new Error(typeof err.error === 'string' ? err.error : err.error?.message ?? `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function fetchVideoStudioHistory(projectId: string, token?: string, cursor?: string | null) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  return get<CursorListResponse<VideoStudioHistoryItem>>(`/projects/${projectId}/history${qs.size ? `?${qs.toString()}` : ''}`, token)
}

export function fetchVideoStudioAssets(projectId: string, token?: string, cursor?: string | null, type?: string) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  if (type) qs.set('type', type)
  return get<CursorListResponse<VideoStudioAssetItem>>(`/projects/${projectId}/assets${qs.size ? `?${qs.toString()}` : ''}`, token)
}
