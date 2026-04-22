/**
 * canvas-api.ts - 原子化的画板数据请求层
 * 不依赖任何 UI State 或 Zustand，纯函数
 */

import type {
  ImageGenConfig,
  TaskBatchStatus,
} from '@/lib/canvas/types'

export class CanvasApiError extends Error {
  code?: string
  status?: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = 'CanvasApiError'
    this.code = options?.code
    this.status = options?.status
  }
}

function toCanvasApiError(fallbackMessage: string, status: number, payload: unknown): CanvasApiError {
  const p = payload as { error?: { message?: string; code?: string } } | null | undefined
  return new CanvasApiError(p?.error?.message || fallbackMessage, {
    code: p?.error?.code,
    status,
  })
}

export interface ExecuteNodeParams {
  canvasId: string
  canvasNodeId: string
  type: 'image_gen'
  config: Partial<ImageGenConfig> & {
    model?: string
    modelCode?: string
  }
  workspaceId?: string
  referenceImageUrls?: string[] // upstream image/asset node outputs (ordered: ref-1, ref-2, ref-3)
}

export interface ExecuteVideoNodeParams {
  canvasId: string
  canvasNodeId: string
  workspaceId?: string
  idempotencyKey?: string
  prompt: string
  model: string
  videoMode: 'multiref' | 'keyframe'
  aspectRatio?: string
  duration?: number
  generateAudio?: boolean
  cameraFixed?: boolean
  enableUpsample?: boolean
  watermark?: boolean
  // multiref mode: reference images, videos, audios
  referenceImages?: string[]
  referenceVideos?: string[]
  referenceAudios?: string[]
  // keyframe mode: first and last frame
  frameStart?: string
  frameEnd?: string
}

export interface CanvasHistoryItem {
  id: string
  canvas_node_id: string | null
  model: string
  prompt: string
  quantity: number
  completed_count: number
  failed_count: number
  status: TaskBatchStatus
  actual_credits: number | null
  created_at: string
  module?: string
}

export interface CanvasAssetItem {
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

export interface CanvasNodeOutputRow {
  id: string
  output_urls: string[]
  is_selected: boolean
  created_at: string
  asset_type?: 'image' | 'video' | 'audio' | null
}

export interface CanvasActiveBatch {
  id: string
  canvas_node_id: string
  status: Extract<TaskBatchStatus, 'pending' | 'processing'>
  quantity: number
  completed_count: number
  failed_count: number
  error?: {
    message?: string
    code?: string
  } | null
}

export interface CanvasActiveTasksResponse {
  version: number
  batches: CanvasActiveBatch[]
}

const READ_MIN_INTERVAL_MS = 1200
const readSlotAt = new Map<string, number>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForReadSlot(key: string) {
  const now = Date.now()
  const allowedAt = readSlotAt.get(key) ?? now
  const waitMs = Math.max(0, allowedAt - now)
  if (waitMs > 0) await sleep(waitMs)
  readSlotAt.set(key, Date.now() + READ_MIN_INTERVAL_MS)
}

async function fetchWithBackoff(input: RequestInfo | URL, init?: RequestInit, maxRetries = 2): Promise<Response> {
  let attempt = 0
  while (true) {
    const res = await fetch(input, init)
    if (![429, 503].includes(res.status) || attempt >= maxRetries) {
      return res
    }

    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN
    const retryAfterMs = Number.isFinite(retryAfterSec) ? Math.max(0, retryAfterSec * 1000) : 0
    const backoffMs = Math.min(3000, 600 * 2 ** attempt)
    const jitter = Math.floor(Math.random() * 200)

    await sleep(Math.max(retryAfterMs, backoffMs + jitter))
    attempt += 1
  }
}

export async function executeCanvasNode(params: ExecuteNodeParams, token?: string) {
  const cfg = params.config
  const modelCode = cfg.modelCode || cfg.model || 'gemini-3.1-flash-image-preview-2k'

  const payload: {
    idempotency_key: string
    canvas_id: string
    canvas_node_id: string
    workspace_id: string
    quantity: number
    model: string
    prompt: string
    params: {
      aspect_ratio: string
      resolution?: string
      watermark?: boolean
      image?: string[]
    }
  } = {
    idempotency_key: `canvas_${params.canvasNodeId}_${Date.now()}`,
    canvas_id: params.canvasId,
    canvas_node_id: params.canvasNodeId,
    workspace_id: params.workspaceId ?? '',
    quantity: cfg.quantity ?? 1,
    model: modelCode,
    prompt: cfg.prompt || '',
    params: {
      aspect_ratio: cfg.aspectRatio || '1:1',
      ...(modelCode === 'gpt-image-2' ? {} : { resolution: cfg.resolution || '2k' }),
      ...(cfg.watermark !== undefined ? { watermark: cfg.watermark } : {}),
    },
  }

  // Pass reference images as array — worker adapters expect params.image to be string[]
  if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
    payload.params.image = params.referenceImageUrls
  }

  const res = await fetch('/api/v1/generate/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('节点执行失败', res.status, payload)
  }

  return await res.json()
}

/**
 * 上传画布缩略图 Blob，返回永久 URL
 */
export async function uploadCanvasThumbnail(blob: Blob, token?: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', blob, 'thumbnail.jpg')

  const res = await fetch('/api/v1/canvases/asset-upload', {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw toCanvasApiError('缩略图上传失败', res.status, err)
  }

  const data = await res.json()
  return data.storageUrl as string
}

/**
 * 更新画布 thumbnail_url
 */
export async function updateCanvasThumbnail(canvasId: string, thumbnailUrl: string, version: number, token?: string): Promise<void> {
  await fetch(`/api/v1/canvases/${canvasId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ version, thumbnail_url: thumbnailUrl }),
  })
}

/**
 * 上传素材文件，返回 proxy URL（公网可访问，用于前端显示和 AI 调用）
 */
export async function uploadAssetFile(file: File, token?: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/v1/canvases/asset-upload', {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw toCanvasApiError('上传失败', res.status, err)
  }

  const data = await res.json()
  return data.url as string
}

/**
 * 拉取节点历史输出
 */
export async function fetchNodeOutputs(canvasId: string, nodeId: string, token?: string) {
  await waitForReadSlot(`node-outputs:${canvasId}:${nodeId}`)
  const res = await fetchWithBackoff(`/api/v1/canvases/${canvasId}/node-outputs/${nodeId}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('拉取节点历史失败', res.status, payload)
  }
  return await res.json() as CanvasNodeOutputRow[]
}

/**
 * 批量拉取画布所有节点的历史输出（单次请求替代 N 次 fetchNodeOutputs）
 */
export async function fetchAllNodeOutputs(canvasId: string, token?: string) {
  const res = await fetchWithBackoff(`/api/v1/canvases/${canvasId}/all-node-outputs`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('批量拉取节点输出失败', res.status, payload)
  }
  return await res.json() as Record<string, CanvasNodeOutputRow[]>
}

export async function fetchCanvasActiveTasks(canvasId: string, token?: string) {
  await waitForReadSlot(`active-tasks:${canvasId}`)
  const res = await fetchWithBackoff(`/api/v1/canvases/${canvasId}/active-tasks`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('拉取节点进度失败', res.status, payload)
  }
  return await res.json() as CanvasActiveTasksResponse
}

export async function fetchCanvasHistory(canvasId: string, token?: string, cursor?: string | null) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)

  await waitForReadSlot(`history:${canvasId}`)
  const res = await fetchWithBackoff(`/api/v1/canvases/${canvasId}/history${qs.size ? `?${qs.toString()}` : ''}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('拉取任务记录失败', res.status, payload)
  }
  return await res.json() as CursorListResponse<CanvasHistoryItem>
}

export async function fetchCanvasAssets(
  canvasId: string,
  token?: string,
  cursor?: string | null,
  type?: string,
) {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  if (type) qs.set('type', type)

  await waitForReadSlot(`assets:${canvasId}`)
  const res = await fetchWithBackoff(`/api/v1/canvases/${canvasId}/assets${qs.size ? `?${qs.toString()}` : ''}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw toCanvasApiError('拉取资产库失败', res.status, payload)
  }
  return await res.json() as CursorListResponse<CanvasAssetItem>
}

export async function selectNodeOutputForCanvas(
  canvasId: string,
  nodeId: string,
  outputId: string,
  token?: string,
) {
  const res = await fetch(`/api/v1/canvases/${canvasId}/node-outputs/${nodeId}/select`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ output_id: outputId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw toCanvasApiError('设置定稿失败', res.status, err)
  }

  return await res.json() as { success: boolean; selected_output_id: string }
}

export async function executeVideoNode(params: ExecuteVideoNodeParams, token?: string) {
  if (!params.workspaceId) {
    throw new Error('缺少工作区信息，请刷新页面后重试')
  }

  const isSeedance = params.model.startsWith('seedance-')
  const isSeedance2 = params.model === 'seedance-2.0' || params.model === 'seedance-2.0-fast'

  const body: Record<string, unknown> = {
    idempotency_key: params.idempotencyKey ?? `cv_${(params.canvasNodeId ?? '').slice(-8)}_${Date.now()}`,
    prompt: params.prompt,
    workspace_id: params.workspaceId,
    model: params.model,
    canvas_id: params.canvasId,
    canvas_node_id: params.canvasNodeId,
  }

  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio

  if (isSeedance) {
    if (params.duration && params.duration !== 0) body.duration = params.duration
    body.generate_audio = params.generateAudio ?? true
    body.camera_fixed = params.cameraFixed ?? false
    body.watermark = params.watermark ?? false
  } else {
    body.enable_upsample = params.enableUpsample ?? false
  }

  if (params.videoMode === 'keyframe') {
    // images[0] = first frame, images[1] = last frame
    const frames = [params.frameStart, params.frameEnd].filter(Boolean) as string[]
    if (frames.length > 0) body.images = frames
  } else {
    // multiref (全能参考): reference_images/videos/audios for Seedance 2.0
    const refImages = (params.referenceImages ?? []).filter(Boolean)
    const refVideos = (params.referenceVideos ?? []).filter(Boolean)
    const refAudios = (params.referenceAudios ?? []).filter(Boolean)
    if (isSeedance2) {
      if (refImages.length > 0) body.reference_images = refImages
      if (refVideos.length > 0) body.reference_videos = refVideos
      if (refAudios.length > 0) body.reference_audios = refAudios
    } else {
      // non-seedance2 multiref: use images field
      if (refImages.length > 0) body.images = refImages
    }
  }

  const res = await fetch('/api/v1/videos/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw toCanvasApiError('视频生成任务提交失败', res.status, error)
  }

  return await res.json()
}

// ── Script writer ─────────────────────────────────────────────────────────────

export async function executeScriptWriterNode(params: {
  description: string
  style: string
  duration: number
}, token?: string): Promise<{ script: string; characters: string[]; scenes: string[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/v1/canvas-agent/script-write', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw toCanvasApiError('剧本生成失败', res.status, error)
  }

  return await res.json()
}

// ── Storyboard splitter ───────────────────────────────────────────────────────

export async function executeStoryboardSplitterNode(params: {
  script: string
  shotCount: number
}, token?: string): Promise<{ shots: Array<{ id: string; label: string; content: string }> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/v1/canvas-agent/storyboard-split', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw toCanvasApiError('分镜拆分失败', res.status, error)
  }

  return await res.json()
}
