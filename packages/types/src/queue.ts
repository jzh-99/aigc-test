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
  assetId: string
  originalUrl: string
  assetType?: 'image' | 'video'
}
