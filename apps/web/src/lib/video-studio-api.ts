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
  script: string
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
}

export interface Shot {
  id: string
  label: string
  content: string
  dialogue?: string
  characters?: string[]
  scene?: string
  cameraMove: string
  duration: number
}

export interface StoryboardResult {
  success: boolean
  shots: Shot[]
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
  mainCharacters: Array<{ name: string; description: string }>
  episodes: Array<{ id: string; title: string; synopsis: string }>
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
  shotCount: number
  aspectRatio?: string
  style?: string
  characters?: Array<{ name: string; description: string }>
  scenes?: Array<{ name: string; description: string }>
}, token?: string) {
  return post<StoryboardResult>('/storyboard-split', params, token)
}

export function generateAssetPrompts(params: {
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
  style: string
}, token?: string) {
  return post<AssetPromptsResult>('/asset-prompts', params, token)
}

export function writeSeriesOutline(params: {
  description: string
  style: string
  episodeCount: number
  episodeDuration: number
}, token?: string) {
  return post<SeriesOutlineResult>('/series-outline', params, token)
}
