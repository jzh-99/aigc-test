import { useState } from 'react'
import { apiPost, ApiError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'

interface VideoGenerateParams {
  prompt: string
  workspace_id: string
  model?: string
  images?: string[]           // 首尾帧（frames Tab）
  reference_images?: string[] // 参考图（components Tab，Seedance 2.0 专用）
  aspect_ratio?: string
  enable_upsample?: boolean
  resolution?: string
  duration?: number
  generate_audio?: boolean
  camera_fixed?: boolean
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
