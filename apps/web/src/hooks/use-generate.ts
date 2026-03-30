'use client'

import { useCallback } from 'react'
import { apiPost, ApiError } from '@/lib/api-client'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import type { BatchResponse, GenerateImageRequest } from '@aigc/types'

const MODEL_CODE_MAP = {
  gemini: {
    '1k': 'gemini-3.1-flash-image-preview',
    '2k': 'gemini-3.1-flash-image-preview-2k',
    '4k': 'gemini-3.1-flash-image-preview-4k',
  },
  'nano-banana-pro': {
    '1k': 'nano-banana-2',
    '2k': 'nano-banana-2-2k',
    '4k': 'nano-banana-2-4k',
  },
  'seedream-5.0-lite': {
    '2k': 'seedream-5.0-lite',
    '3k': 'seedream-5.0-lite',
  },
  'seedream-4.5': {
    '2k': 'seedream-4.5',
    '4k': 'seedream-4.5',
  },
  'seedream-4.0': {
    '1k': 'seedream-4.0',
    '2k': 'seedream-4.0',
    '4k': 'seedream-4.0',
  },
} as const

export function useGenerate() {
  const { prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, setIsGenerating, setActiveBatchId } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const generate = useCallback(async (): Promise<BatchResponse | null> => {
    if (!prompt.trim()) return null

    setIsGenerating(true)
    try {
      const modelMap = MODEL_CODE_MAP[modelType] as Record<string, string> | undefined
      if (!modelMap) throw new Error(`Unknown model type: ${modelType}`)
      const model = modelMap[resolution]
      if (!model) throw new Error(`Unknown resolution for ${modelType}: ${resolution}`)

      const params: Record<string, unknown> = { aspect_ratio: aspectRatio, resolution, watermark }

      if (referenceImages.length > 0) {
        params.image = referenceImages.map((img) => img.dataUrl)
      }

      const body: GenerateImageRequest = {
        idempotency_key: crypto.randomUUID(),
        model,
        prompt: prompt.trim(),
        quantity,
        params,
        workspace_id: activeWorkspaceId ?? '',
      }

      const batch = await apiPost<BatchResponse>('/generate/image', body)
      setActiveBatchId(batch.id)
      return batch
    } catch (err) {
      if (err instanceof ApiError) {
        throw err
      }
      throw new Error('生成请求失败')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, activeWorkspaceId, setIsGenerating, setActiveBatchId])

  return { generate }
}
