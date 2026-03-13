import { create } from 'zustand'

interface ReferenceImage {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
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
  reset: () => set(defaults),
}))
