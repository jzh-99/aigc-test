'use client'

import { useCallback } from 'react'
import { apiGet, apiPatch } from '@/lib/api-client'

export interface GenerationDefaults {
  image?: {
    modelType?: string
    resolution?: string
    aspectRatio?: string
    quantity?: number
    watermark?: boolean
  }
  video?: {
    videoModel?: string
    videoAspectRatio?: string
    videoUpsample?: boolean
    videoDuration?: number
    videoGenerateAudio?: boolean
    videoCameraFixed?: boolean
  }
  avatar?: {
    avatarResolution?: string
  }
}

export function useGenerationDefaults() {
  const load = useCallback(async (): Promise<GenerationDefaults> => {
    try {
      return await apiGet<GenerationDefaults>('/users/me/generation-defaults')
    } catch {
      return {}
    }
  }, [])

  const save = useCallback(async (defaults: GenerationDefaults): Promise<void> => {
    await apiPatch('/users/me/generation-defaults', defaults)
  }, [])

  return { load, save }
}
