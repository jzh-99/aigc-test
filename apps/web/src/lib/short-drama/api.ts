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
  episodeSummaries?: ShortDramaState['script']['episodeSummaries']
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
  isGenerating?: ShortDramaRecoveryPredicate,
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
    // 其余（网络中断/连接被代理掐断）：回查项目状态兜底，避免误报 network error
    if (projectId && isGenerating) {
      const recovery = await recoverShortDramaStream<T>(projectId, isGenerating)
      if (recovery.kind === 'success') return recovery.data
      // 抛明确中文消息（translateError 对中文原样返回），确保用户能看到提示而非静默
      throw new Error(
        recovery.kind === 'failed'
          ? '生成失败，请稍后重试'
          : '生成仍在进行中，请稍后刷新页面查看结果',
      )
    }
    throw err
  }
}

/** 断线回查时「是否仍在生成」的判断（由各生成函数按业务子状态提供） */
type ShortDramaRecoveryPredicate = (project: ShortDramaProjectDetail) => boolean

/** 回查结果：已结束（带最新 state）/ 确定失败 / 轮询耗尽仍在生成 */
type ShortDramaRecoveryResult<T> =
  | { kind: 'success'; data: T }
  | { kind: 'failed' }
  | { kind: 'still-generating' }

// 断线回查轮询间隔（渐进退避）：前期密集快速发现结果，后期稀疏减少请求。
// 总等待时长 ~350s，对齐后端 TEXT_TIMEOUT_MS(360s)——只要后端仍在 generating 就持续等待，
// 后端完成（成功/停滞中止/超时）都能在窗口内轮询到，避免过早提示用户刷新；
// 仅当后端超过 ~6 分钟仍未结束（极端异常）才兜底返回 still-generating。
const RECOVER_POLL_INTERVALS_MS = [
  5_000, 5_000, 5_000, 5_000, // 0–20s：密集探测，快速发现立即完成/失败
  10_000, 10_000, 10_000, // 20–50s
  15_000, 15_000, 15_000, 15_000, // 50–110s：覆盖后端「无进展 120s 中止」
  30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, // 110–380s：覆盖后端 TEXT_TIMEOUT_MS
]

/**
 * 流式连接中断后回查项目状态（带渐进退避轮询）。
 *
 * 三种结局：
 * - 后端项目表 status=failed → 确定失败（后端失败路径已同步标记项目表 failed）
 * - 业务子状态非 generating（已结束：成功/部分/历史完成态）→ 视为已同步，返回最新 state
 * - 仍在 generating → 按 RECOVER_POLL_INTERVALS_MS 退避轮询；
 *   耗尽仍未结束 → still-generating，由上层提示「生成仍在进行中，请刷新查看」
 *
 * 修复历史缺陷：旧版仅判 `project.status !== 'failed'`，而后端失败时不更新项目表 status，
 * 导致几乎必然误判为成功、静默无提示。
 */
async function recoverShortDramaStream<T>(
  projectId: string,
  isGenerating: ShortDramaRecoveryPredicate,
): Promise<ShortDramaRecoveryResult<T>> {
  for (let attempt = 0; attempt < RECOVER_POLL_INTERVALS_MS.length; attempt++) {
    let project: ShortDramaProjectDetail
    try {
      project = await getShortDramaProject(projectId)
    } catch {
      // 回查请求本身失败：无法判断，按「仍在生成」处理，提示用户刷新
      return { kind: 'still-generating' }
    }

    if (project.status === 'failed') return { kind: 'failed' }
    if (!isGenerating(project)) {
      return { kind: 'success', data: { success: true, state: project.state } as unknown as T }
    }

    // 仍在生成：按退避间隔等待后重试（最后一次不再等待）
    if (attempt < RECOVER_POLL_INTERVALS_MS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, RECOVER_POLL_INTERVALS_MS[attempt]))
    }
  }
  return { kind: 'still-generating' }
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
    (project) => project.state.script.status === 'generating',
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
    (project) => project.state.script.status === 'generating',
  )
}

export function generateShortDramaEpisodeSummaries(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-summaries`,
    options,
    projectId,
    (project) => project.state.script.episodeSummaryStatus === 'generating',
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
    (project) => project.state.assets.status === 'generating',
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
    (project) => {
      const episode = project.state.episodes.items.find((item) => item.episodeNumber === episodeNumber)
      return episode ? episode.status === 'generating' : false
    },
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
