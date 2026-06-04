import { fetchWithAuth } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type {
  PictureBookCharge,
  PictureBookChargeSummary,
  PictureBookAspectRatio,
  PictureBookPageCount,
  PictureBookProject,
  PictureBookProjectListItem,
  PictureBookState,
  PictureBookStyle,
  PictureBookTarget,
} from './types'

const BASE = '/picture-book'
const API_BASE = '/api/v1'

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function consumeSSEStream<T>(res: Response, onChunk?: (text: string) => void): Promise<T> {
  const reader = res.body!.getReader()
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

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data) continue

      try {
        const json = JSON.parse(data)
        if (currentEvent === 'chunk' && onChunk) {
          onChunk(json.text)
        } else if (currentEvent === 'done') {
          result = json as T
        } else if (currentEvent === 'error') {
          throw new Error(json.message ?? '操作失败')
        }
      } catch (err) {
        if (err instanceof Error && err.message !== 'Unexpected end of JSON input') throw err
      }
      currentEvent = ''
    }
  }

  if (!result) throw new Error('未收到完成事件')
  return result
}

export function listPictureBookProjects(workspaceId: string, limit = 30) {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) })
  return fetchWithAuth<PictureBookProjectListItem[]>(`${BASE}/projects?${params.toString()}`)
}

export function listRecentPictureBookProjects(workspaceId: string, limit = 4) {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) })
  return fetchWithAuth<PictureBookProjectListItem[]>(`${BASE}/projects/recent?${params.toString()}`)
}

export function getPictureBookProject(projectId: string) {
  return fetchWithAuth<PictureBookProject>(`${BASE}/projects/${projectId}`)
}

export function getPictureBookCharges(projectId: string) {
  return fetchWithAuth<{ charges: PictureBookCharge[]; summary: PictureBookChargeSummary }>(`${BASE}/projects/${projectId}/charges`)
}

export interface GenerateScriptStreamOptions {
  workspace_id: string
  prompt: string
  style: PictureBookStyle
  page_count: PictureBookPageCount
  aspect_ratio: PictureBookAspectRatio
  title?: string
  onChunk?: (text: string) => void
}

export interface GenerateScriptResult {
  success: boolean
  projectId: string
  title: string
  state: PictureBookState
}

export async function generatePictureBookScript(input: GenerateScriptStreamOptions): Promise<GenerateScriptResult> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${BASE}/script`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      workspace_id: input.workspace_id,
      prompt: input.prompt,
      style: input.style,
      page_count: input.page_count,
      aspect_ratio: input.aspect_ratio,
      title: input.title,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as any)?.error?.message ?? '生成剧本失败'
    throw new Error(msg)
  }

  return consumeSSEStream<GenerateScriptResult>(res, input.onChunk)
}

export function savePictureBookProject(projectId: string, input: {
  workspace_id: string
  title: string
  prompt: string
  style: PictureBookStyle
  page_count: PictureBookPageCount
  state: PictureBookState
  status?: string
  cover_url?: string | null
}) {
  return fetchWithAuth<{ success: boolean }>(`${BASE}/projects/${projectId}`, jsonInit('PUT', input))
}

export function savePictureBookDraft(projectId: string, state: PictureBookState) {
  return fetchWithAuth<{ success: boolean; draft_saved_at: string }>(
    `${BASE}/projects/${projectId}/draft`,
    jsonInit('PATCH', { state }),
  )
}

export function renamePictureBookProject(projectId: string, title: string) {
  return fetchWithAuth<{ success: boolean; title: string }>(
    `${BASE}/projects/${projectId}/name`,
    jsonInit('PATCH', { title }),
  )
}

export function deletePictureBookProject(projectId: string) {
  return fetchWithAuth<{ success: boolean }>(`${BASE}/projects/${projectId}`, { method: 'DELETE' })
}

export function generatePictureBookAssetPrompts(projectId: string): Promise<{ success: boolean; taskId: string }> {
  return fetchWithAuth<{ success: boolean; taskId: string }>(
    `${BASE}/asset-prompts`,
    jsonInit('POST', { project_id: projectId }),
  )
}

export function generatePictureBookStoryboardPrompts(projectId: string): Promise<{ success: boolean; taskId: string }> {
  return fetchWithAuth<{ success: boolean; taskId: string }>(
    `${BASE}/storyboard-prompts`,
    jsonInit('POST', { project_id: projectId }),
  )
}

export function generatePictureBookAssets(projectId: string, targets?: PictureBookTarget[], params?: Record<string, unknown>) {
  return fetchWithAuth<{ success: boolean; batches: Array<{ ref_id: string; kind: string; batch_id: string; status: string }>; failures: unknown[] }>(
    `${BASE}/generate-assets`,
    jsonInit('POST', { project_id: projectId, targets, params }),
  )
}

export function generatePictureBookStoryboardImages(projectId: string, targets?: PictureBookTarget[], params?: Record<string, unknown>) {
  return fetchWithAuth<{ success: boolean; batches: Array<{ ref_id: string; batch_id: string; status: string }>; failures: unknown[] }>(
    `${BASE}/generate-storyboard-images`,
    jsonInit('POST', { project_id: projectId, targets, params }),
  )
}

export function generatePictureBookStoryboardAudio(projectId: string, input: {
  targets?: PictureBookTarget[]
  voice_zh_id?: string
  voice_en_id?: string
}) {
  return fetchWithAuth<{ success: boolean; outputs: unknown[]; failures: unknown[]; state: PictureBookState }>(
    `${BASE}/generate-storyboard-audio`,
    jsonInit('POST', { project_id: projectId, ...input }),
  )
}

export function syncPictureBookBatches(projectId: string) {
  return fetchWithAuth<{ success: boolean; assets: number; state: PictureBookState }>(
    `${BASE}/sync-batches`,
    jsonInit('POST', { project_id: projectId }),
  )
}
