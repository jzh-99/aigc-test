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
}

export async function executeCanvasNode(params: ExecuteNodeParams, token?: string) {
  // Canvas 节点执行走 /generate/image，附带 canvas_id + canvas_node_id 做绑定
  const cfg = params.config
  const model = cfg.modelCode || cfg.model || 'gemini-3.1-flash-image-preview-2k'
  const payload = {
    idempotency_key: `canvas_${params.canvasNodeId}_${Date.now()}`,
    canvas_id: params.canvasId,
    canvas_node_id: params.canvasNodeId,
    workspace_id: params.workspaceId ?? '',
    quantity: cfg.quantity ?? 1,
    model,
    prompt: cfg.prompt || '',
    params: {
      aspect_ratio: cfg.aspectRatio || '1:1',
      resolution: cfg.resolution || '2k',
      ...(cfg.watermark !== undefined ? { watermark: cfg.watermark } : {}),
    },
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
 * 拉取节点历史输出
 * GET /api/v1/canvases/:id/node-outputs/:nodeId
 */
export async function fetchNodeOutputs(canvasId: string, nodeId: string, token?: string) {
  const res = await fetch(`/api/v1/canvases/${canvasId}/node-outputs/${nodeId}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) throw new Error('拉取节点历史失败')

  // Returns array of { id, output_urls, is_selected, created_at, ... }
  return await res.json() as Array<{
    id: string
    output_urls: string[]
    is_selected: boolean
    created_at: string
  }>
}
export async function fetchCanvasActiveTasks(canvasId: string, token?: string) {
  const res = await fetch(`/api/v1/canvases/${canvasId}/active-tasks`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error('拉取节点进度失败')
  }

  return await res.json() // { version: number, batches: [] }
}
