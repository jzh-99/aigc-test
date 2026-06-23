export interface GenerationJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  canvasId?: string
  canvasNodeId?: string
  // 开放接口（Open API）回调用字段，全部可选，对非开放接口任务零影响：
  // 仅当 task_batches.source === 'open_api' 时由 dispatchBatchResult 读取使用
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
}

export interface VideoSubmitJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  videoCategory?: 'multimodal' | 'frames'
}

export interface CompletionJobData {
  taskId: string
  result: {
    success: boolean
    outputUrl?: string
    actualCredits?: number
    providerCostRaw?: Record<string, unknown>
    errorMessage?: string
  }
}

export interface TransferJobData {
  taskId: string
  batchId: string
  assetId: string
  originalUrl: string
  assetType?: 'image' | 'video'
}

export interface StoryboardJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  creditAccountId: string
  estimatedCredits: number
  canvasId: string
  canvasNodeId: string
  script: string
  shotCount: number
}

export interface MusicJobData {
  taskId: string
  batchId: string
  trackId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}

export interface MusicVoiceCloneJobData {
  taskId: string
  batchId: string
  voiceCloneId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}

export interface ShortDramaExportEpisodeJobData {
  projectId: string
  episodeId: string
  exportId: string
  userId: string
  teamId: string
  workspaceId: string
  creditAccountId: string
  estimatedCredits: number
}

/**
 * 开放接口（Open API）异步回调任务数据
 *
 * 对齐源项目 app/services/callbacks.py 的 build_async_callback_payload 输出结构：
 * - result：对调用方可见的结果信封（task_id / bussiness_id / code / message）
 * - meta：业务相关的媒体产物与状态元数据
 *
 * 投递方在生成完成后构造此 payload，回调 worker 负责 HMAC 签名后 POST 到 task_batches.callback_url。
 */
export interface OpenApiCallbackJobData {
  batchId: string
  payload: {
    result: Record<string, unknown>
    meta: Record<string, unknown>
  }
}
