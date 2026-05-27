import { fetchWithAuth } from '@/lib/api-client'
import type {
  PictureBookCharge,
  PictureBookChargeSummary,
  PictureBookPageCount,
  PictureBookProject,
  PictureBookProjectListItem,
  PictureBookState,
  PictureBookStyle,
  PictureBookTarget,
} from './types'

const BASE = '/picture-book'

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
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

export function generatePictureBookScript(input: {
  workspace_id: string
  prompt: string
  style: PictureBookStyle
  page_count: PictureBookPageCount
  title?: string
}) {
  return fetchWithAuth<{ success: boolean; projectId: string; title: string; state: PictureBookState }>(
    `${BASE}/script`,
    jsonInit('POST', input),
  )
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

export function generatePictureBookAssetPrompts(projectId: string) {
  return fetchWithAuth<{ success: boolean; state: PictureBookState }>(
    `${BASE}/asset-prompts`,
    jsonInit('POST', { project_id: projectId }),
  )
}

export function generatePictureBookStoryboardPrompts(projectId: string) {
  return fetchWithAuth<{ success: boolean; state: PictureBookState }>(
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
