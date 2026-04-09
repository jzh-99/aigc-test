/**
 * canvas-api.ts - 原子化的画板数据请求层
 * 不依赖任何 UI State 或 Zustand，纯函数
 */

export interface ExecuteNodeParams {
  canvasId: string
  canvasNodeId: string
  type: string
  config: any
  workspaceId?: string
  referenceImageUrls?: string[] // upstream image/asset node outputs
}

export async function executeCanvasNode(params: ExecuteNodeParams, token?: string) {
  const cfg = params.config
  const modelCode = cfg.modelCode || cfg.model || 'gemini-3.1-flash-image-preview-2k'

  const payload: Record<string, any> = {
    idempotency_key: `canvas_${params.canvasNodeId}_${Date.now()}`,
    canvas_id: params.canvasId,
    canvas_node_id: params.canvasNodeId,
    workspace_id: params.workspaceId ?? '',
    quantity: cfg.quantity ?? 1,
    model: modelCode,
    prompt: cfg.prompt || '',
    params: {
      aspect_ratio: cfg.aspectRatio || '1:1',
      resolution: cfg.resolution || '2k',
      ...(cfg.watermark !== undefined ? { watermark: cfg.watermark } : {}),
    },
  }

  // Pass reference images if provided
  if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
    payload.params.image = params.referenceImageUrls[0]       // primary reference
    if (params.referenceImageUrls.length > 1) {
      payload.params.reference_images = params.referenceImageUrls // all references
    }
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
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error?.message || '节点执行失败')
  }

  return await res.json()
}

/**
 * 上传素材文件，返回 S3 URL
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
    throw new Error(err.error?.message || '上传失败')
  }

  const data = await res.json()
  return data.url as string
}

/**
 * 拉取节点历史输出
 */
export async function fetchNodeOutputs(canvasId: string, nodeId: string, token?: string) {
  const res = await fetch(`/api/v1/canvases/${canvasId}/node-outputs/${nodeId}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error('拉取节点历史失败')
  return await res.json() as Array<{
    id: string
    output_urls: string[]
    is_selected: boolean
    created_at: string
  }>
}

export async function fetchCanvasActiveTasks(canvasId: string, token?: string) {
  const res = await fetch(`/api/v1/canvases/${canvasId}/active-tasks`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error('拉取节点进度失败')
  return await res.json()
}
