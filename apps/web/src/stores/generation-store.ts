import { create } from 'zustand'
import type { BatchResponse } from '@aigc/types'

interface ReferenceImage {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
}

const MODEL_REVERSE_MAP: Record<string, { modelType: 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'; resolution: '1k' | '2k' | '4k' }> = {
  'gemini-3.1-flash-image-preview':    { modelType: 'gemini', resolution: '1k' },
  'gemini-3.1-flash-image-preview-2k': { modelType: 'gemini', resolution: '2k' },
  'gemini-3.1-flash-image-preview-4k': { modelType: 'gemini', resolution: '4k' },
  'nano-banana-2':    { modelType: 'nano-banana-pro', resolution: '1k' },
  'nano-banana-2-2k': { modelType: 'nano-banana-pro', resolution: '2k' },
  'nano-banana-2-4k': { modelType: 'nano-banana-pro', resolution: '4k' },
  'seedream-5.0-lite': { modelType: 'seedream-5.0-lite', resolution: '2k' },
  'seedream-4.5':      { modelType: 'seedream-4.5', resolution: '2k' },
  'seedream-4.0':      { modelType: 'seedream-4.0', resolution: '2k' },
}

interface VideoParams {
  videoPrompt: string
  videoModel: string
  videoAspectRatio: string
  videoUpsample: boolean
  videoDuration?: number
  videoGenerateAudio?: boolean
  videoCameraFixed?: boolean
}

interface GenerationState {
  // Image generation state
  prompt: string
  modelType: 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
  resolution: '1k' | '2k' | '3k' | '4k'
  quantity: number
  aspectRatio: string
  referenceImages: ReferenceImage[]
  watermark: boolean
  isGenerating: boolean
  activeBatchId: string | null

  // Video generation state
  videoParams: VideoParams | null

  // Image generation actions
  setPrompt: (prompt: string) => void
  setModelType: (modelType: 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0') => void
  setResolution: (resolution: '1k' | '2k' | '3k' | '4k') => void
  setQuantity: (quantity: number) => void
  setAspectRatio: (ratio: string) => void
  addReferenceImage: (img: ReferenceImage) => void
  removeReferenceImage: (id: string) => void
  clearReferenceImages: () => void
  setWatermark: (v: boolean) => void
  setIsGenerating: (v: boolean) => void
  setActiveBatchId: (id: string | null) => void

  // Video generation actions
  setVideoParams: (params: VideoParams | null) => void

  // Common actions
  applyBatch: (batch: BatchResponse) => void
  reset: () => void
}

const defaults = {
  prompt: '',
  modelType: 'gemini' as const,
  resolution: '2k' as const,
  quantity: 1,
  aspectRatio: '1:1',
  referenceImages: [] as ReferenceImage[],
  watermark: false,
  isGenerating: false,
  activeBatchId: null,
  videoParams: null as VideoParams | null,
}

export const useGenerationStore = create<GenerationState>((set) => ({
  ...defaults,
  setPrompt: (prompt) => set({ prompt }),
  setModelType: (modelType) => set({ modelType }),
  setResolution: (resolution) => set({ resolution }),
  setQuantity: (quantity) => set({ quantity }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  addReferenceImage: (img) => set((s) => ({ referenceImages: [...s.referenceImages, img] })),
  removeReferenceImage: (id) => set((s) => ({
    referenceImages: s.referenceImages.filter((i) => i.id !== id),
  })),
  clearReferenceImages: () => set({ referenceImages: [] }),
  setWatermark: (watermark) => set({ watermark }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setActiveBatchId: (activeBatchId) => set({ activeBatchId }),
  setVideoParams: (videoParams) => set({ videoParams }),
  applyBatch: (batch) => {
    const isVideo = (batch as any).module === 'video'

    if (isVideo) {
      // Apply video parameters
      const params = batch.params as Record<string, unknown> | null
      set({
        videoParams: {
          videoPrompt: batch.prompt,
          videoModel: batch.model,
          videoAspectRatio: (params?.aspect_ratio as string) || '',
          videoUpsample: (params?.enable_upsample as boolean) || false,
        },
      })
    } else {
      // Apply image parameters
      const modelConfig = MODEL_REVERSE_MAP[batch.model]
      const params = batch.params as Record<string, unknown> | null
      set({
        prompt: batch.prompt,
        quantity: batch.quantity,
        ...(modelConfig ? { modelType: modelConfig.modelType, resolution: modelConfig.resolution } : {}),
        ...(params?.aspect_ratio ? { aspectRatio: params.aspect_ratio as string } : {}),
        videoParams: null, // Clear video params when applying image batch
      })
    }
  },
  reset: () => set(defaults),
}))
