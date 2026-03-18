import { useState } from 'react'
import { apiPost, ApiError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'

interface VideoGenerateParams {
  prompt: string
  workspace_id: string
  model?: string
  images?: string[]
  aspect_ratio?: '16:9' | '9:16'
}

export function useVideoGenerate() {
  const [isGenerating, setIsGenerating] = useState(false)

  async function generate(params: VideoGenerateParams): Promise<BatchResponse> {
    setIsGenerating(true)
    try {
      return await apiPost<BatchResponse>('/videos/generate', params)
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new Error('视频生成请求失败')
    } finally {
      setIsGenerating(false)
    }
  }

  return { generate, isGenerating }
}
