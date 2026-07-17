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
