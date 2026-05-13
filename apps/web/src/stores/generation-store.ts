import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BatchResponse, ModelItem } from '@aigc/types'

interface ReferenceImage {
  id: string
  file?: File
  previewUrl: string
  dataUrl?: string
}

export interface VideoParams {
  videoPrompt: string
  videoModel: string
  videoAspectRatio: string
  videoUpsample: boolean
  videoResolution?: string
  videoDuration?: number
  videoGenerateAudio?: boolean
  videoCameraFixed?: boolean
  videoMode?: string
}

interface UserDefaults {
  modelType: string
  resolution: '1k' | '2k' | '3k' | '4k'
  quantity: number
  aspectRatio: string
  watermark: boolean
}

interface VideoDefaults {
  videoModel: string
  videoAspectRatio: string
  videoUpsample: boolean
  videoDuration: number
  videoGenerateAudio: boolean
  videoCameraFixed: boolean
}

interface AvatarDefaults {
  avatarResolution: '720p' | '1080p'
}

interface GenerationState {
  // Image generation state
  prompt: string
  modelType: string
  resolution: '1k' | '2k' | '3k' | '4k'
  quantity: number
  aspectRatio: string
  referenceImages: ReferenceImage[]
  watermark: boolean
  isGenerating: boolean
  activeBatchId: string | null

  // 缓存从 API 拉取的模型列表，供 use-generate 查 params_pricing
  imageModels: ModelItem[]

  // Video generation state
  videoParams: VideoParams | null

  // Pending module — set by applyBatch so the panel can switch to the right tab
  pendingModule: string | null

  // User-saved defaults
  userDefaults: UserDefaults | null
  videoDefaults: VideoDefaults | null
  avatarDefaults: AvatarDefaults | null

  // Image generation actions
  setPrompt: (prompt: string) => void
  setModelType: (modelType: string) => void
  setResolution: (resolution: '1k' | '2k' | '3k' | '4k') => void
  setQuantity: (quantity: number) => void
  setAspectRatio: (ratio: string) => void
  addReferenceImage: (img: ReferenceImage) => void
  removeReferenceImage: (id: string) => void
  clearReferenceImages: () => void
  setWatermark: (v: boolean) => void
  setIsGenerating: (v: boolean) => void
  setActiveBatchId: (id: string | null) => void
  setImageModels: (models: ModelItem[]) => void
  saveAsDefaults: () => void
  saveVideoDefaults: (d: VideoDefaults) => void
  saveAvatarDefaults: (d: AvatarDefaults) => void
  applyServerDefaults: (d: { userDefaults?: UserDefaults | null; videoDefaults?: VideoDefaults | null; avatarDefaults?: AvatarDefaults | null }) => void

  // Video generation actions
  setVideoParams: (params: VideoParams | null) => void

  // Common actions
  applyBatch: (batch: BatchResponse) => void
  clearPendingModule: () => void
  reset: () => void
}

const defaults = {
  prompt: '',
  modelType: 'gemini-3.1-flash-image-preview' as string,
  resolution: '2k' as const,
  quantity: 1,
  aspectRatio: '1:1',
  referenceImages: [] as ReferenceImage[],
  watermark: false,
  isGenerating: false,
  activeBatchId: null,
  imageModels: [] as ModelItem[],
  videoParams: null as VideoParams | null,
  pendingModule: null as string | null,
  userDefaults: null as UserDefaults | null,
  videoDefaults: null as VideoDefaults | null,
  avatarDefaults: null as AvatarDefaults | null,
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
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
  setImageModels: (imageModels) => set({ imageModels }),
  saveAsDefaults: () => set((s) => ({
    userDefaults: {
      modelType: s.modelType,
      resolution: s.resolution,
      quantity: s.quantity,
      aspectRatio: s.aspectRatio,
      watermark: s.watermark,
    },
  })),
  saveVideoDefaults: (d) => set({ videoDefaults: d }),
  saveAvatarDefaults: (d) => set({ avatarDefaults: d }),
  applyServerDefaults: ({ userDefaults, videoDefaults, avatarDefaults }) => set((s) => ({
    ...(userDefaults ? {
      userDefaults,
      modelType: userDefaults.modelType,
      resolution: userDefaults.resolution,
      quantity: userDefaults.quantity,
      aspectRatio: userDefaults.aspectRatio,
      watermark: userDefaults.watermark,
    } : {}),
    videoDefaults: videoDefaults ?? s.videoDefaults,
    avatarDefaults: avatarDefaults ?? s.avatarDefaults,
  })),
  setVideoParams: (videoParams) => set({ videoParams }),
  applyBatch: (batch) => {
    const module = (batch as any).module as string
    const isVideo = module === 'video'
    const isAvatar = module === 'avatar'
    const isActionImitation = module === 'action_imitation'

    if (isVideo) {
      // Apply video parameters
      const params = batch.params as Record<string, unknown> | null
      set({
        pendingModule: 'video',
        videoParams: {
          videoPrompt: batch.prompt,
          videoModel: batch.model,
          videoAspectRatio: (params?.aspect_ratio as string) || '',
          videoUpsample: (params?.enable_upsample as boolean) || false,
          videoResolution: (params?.resolution as string) || undefined,
          videoDuration: (params?.duration as number) ?? undefined,
          videoGenerateAudio: (params?.generate_audio as boolean) ?? undefined,
          videoCameraFixed: (params?.camera_fixed as boolean) ?? undefined,
        },
      })
    } else if (isAvatar || isActionImitation) {
      // Avatar / action imitation — signal module and carry the prompt; no image params
      set({ pendingModule: module, prompt: batch.prompt ?? '', videoParams: null })
    } else {
      // 图片任务：直接用 batch.model（DB code）还原模型和分辨率，无需硬编码映射
      const params = batch.params as Record<string, unknown> | null
      set({
        pendingModule: 'image',
        prompt: batch.prompt,
        quantity: batch.quantity,
        modelType: batch.model,
        ...(params?.resolution ? { resolution: params.resolution as '1k' | '2k' | '3k' | '4k' } : {}),
        ...(params?.aspect_ratio ? { aspectRatio: params.aspect_ratio as string } : {}),
        videoParams: null,
      })
    }
  },
  clearPendingModule: () => set({ pendingModule: null }),
  reset: () => set((s) => ({
    ...defaults,
    userDefaults: s.userDefaults,
    ...(s.userDefaults ? {
      modelType: s.userDefaults.modelType,
      resolution: s.userDefaults.resolution,
      quantity: s.userDefaults.quantity,
      aspectRatio: s.userDefaults.aspectRatio,
      watermark: s.userDefaults.watermark,
    } : {}),
  })),
    }),
    {
      name: 'aigc-generation-prefs',
      partialize: (state) => ({
        watermark: state.watermark,
        modelType: state.modelType,
        resolution: state.resolution,
        aspectRatio: state.aspectRatio,
        quantity: state.quantity,
      }),
    }
  )
)
