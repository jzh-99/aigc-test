import { create } from 'zustand'
import type { BatchResponse } from '@aigc/types'

interface ReferenceImage {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
}

const MODEL_REVERSE_MAP: Record<string, { modelType: 'gemini' | 'nano-banana-pro'; resolution: '1k' | '2k' | '4k' }> = {
  'gemini-3.1-flash-image-preview':    { modelType: 'gemini', resolution: '1k' },
  'gemini-3.1-flash-image-preview-2k': { modelType: 'gemini', resolution: '2k' },
  'gemini-3.1-flash-image-preview-4k': { modelType: 'gemini', resolution: '4k' },
  'nano-banana-2':    { modelType: 'nano-banana-pro', resolution: '1k' },
  'nano-banana-2-2k': { modelType: 'nano-banana-pro', resolution: '2k' },
  'nano-banana-2-4k': { modelType: 'nano-banana-pro', resolution: '4k' },
}

interface GenerationState {
  prompt: string
  modelType: 'gemini' | 'nano-banana-pro'
  resolution: '1k' | '2k' | '4k'
  quantity: number
  aspectRatio: string
  referenceImages: ReferenceImage[]
  isGenerating: boolean
  activeBatchId: string | null
  setPrompt: (prompt: string) => void
  setModelType: (modelType: 'gemini' | 'nano-banana-pro') => void
  setResolution: (resolution: '1k' | '2k' | '4k') => void
  setQuantity: (quantity: number) => void
  setAspectRatio: (ratio: string) => void
  addReferenceImage: (img: ReferenceImage) => void
  removeReferenceImage: (id: string) => void
  clearReferenceImages: () => void
  setIsGenerating: (v: boolean) => void
  setActiveBatchId: (id: string | null) => void
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
  isGenerating: false,
  activeBatchId: null,
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
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setActiveBatchId: (activeBatchId) => set({ activeBatchId }),
  applyBatch: (batch) => {
    const modelConfig = MODEL_REVERSE_MAP[batch.model]
    const params = batch.params as Record<string, unknown> | null
    set({
      prompt: batch.prompt,
      quantity: batch.quantity,
      ...(modelConfig ? { modelType: modelConfig.modelType, resolution: modelConfig.resolution } : {}),
      ...(params?.aspect_ratio ? { aspectRatio: params.aspect_ratio as string } : {}),
    })
  },
  reset: () => set(defaults),
}))
