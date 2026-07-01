import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BatchResponse, ModelItem } from '@aigc/types'
import { generateUUID } from '@/lib/utils'
import { restoreMentionPrompt } from '@/components/shared/mention-editor'

export interface ReferenceImage {
  id: string
  file?: File
  previewUrl: string
  dataUrl?: string
}

export interface VideoParams {
  videoPrompt: string
  videoModel: string
  videoAspectRatio: string
  videoResolution?: string
  videoDuration?: number
  videoGenerateAudio?: boolean
  videoMode?: string
  videoFrameImages?: ReferenceImage[]
  videoReferenceImages?: ReferenceImage[]
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
  videoResolution?: string
  videoDuration: number
  videoGenerateAudio: boolean
}

interface AvatarDefaults {
  avatarResolution: '720p' | '1080p'
}

interface GenerationState {
  // Image generation state
  prompt: string

  // Video / Avatar prompt — persisted in store so they survive tab switches
  videoPrompt: string
  avatarPrompt: string
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
  pendingVideoReferenceImages: ReferenceImage[]

  // Pending module — set by applyBatch so the panel can switch to the right tab
  pendingModule: string | null

  // User-saved defaults
  userDefaults: UserDefaults | null
  videoDefaults: VideoDefaults | null
  avatarDefaults: AvatarDefaults | null

  // Image generation actions
  setPrompt: (prompt: string) => void
  setVideoPrompt: (prompt: string) => void
  setAvatarPrompt: (prompt: string) => void
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
  sendImagesToVideoReference: (imgs: ReferenceImage[]) => void
  clearPendingVideoReferenceImages: () => void

  // Common actions
  applyBatch: (batch: BatchResponse) => void
  clearPendingModule: () => void
  reset: () => void
}

const defaults = {
  prompt: '',
  videoPrompt: '',
  avatarPrompt: '',
  modelType: 'google/gemini-3.1-flash-image-preview' as string,
  resolution: '1k' as const,
  quantity: 1,
  aspectRatio: '1:1',
  referenceImages: [] as ReferenceImage[],
  watermark: false,
  isGenerating: false,
  activeBatchId: null,
  imageModels: [] as ModelItem[],
  videoParams: null as VideoParams | null,
  pendingVideoReferenceImages: [] as ReferenceImage[],
  pendingModule: null as string | null,
  userDefaults: null as UserDefaults | null,
  videoDefaults: null as VideoDefaults | null,
  avatarDefaults: null as AvatarDefaults | null,
}

function normalizeReferenceUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  return typeof value === 'string' && value.length > 0 ? [value] : []
}

function getBatchParams(batch: BatchResponse): Record<string, unknown> {
  if (!batch.params) return {}
  if (typeof batch.params === 'string') {
    try {
      const parsed = JSON.parse(batch.params)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }

  return typeof batch.params === 'object' && !Array.isArray(batch.params)
    ? batch.params as Record<string, unknown>
    : {}
}

function extractImageReferenceUrls(batch: BatchResponse): string[] {
  const params = getBatchParams(batch)
  const urls = [
    ...normalizeReferenceUrls(params.reference_image_urls),
    ...normalizeReferenceUrls(params.image),
    ...normalizeReferenceUrls(params.image_url),
    ...normalizeReferenceUrls(params.reference_image),
  ]
  return [...new Set(urls)]
}

function extractVideoReferenceUrls(batch: BatchResponse): string[] {
  const params = getBatchParams(batch)

  const urls = [
    ...normalizeReferenceUrls(params.reference_images),
  ]
  return [...new Set(urls)]
}

function extractVideoFrameUrls(batch: BatchResponse): string[] {
  const params = getBatchParams(batch)

  return [...new Set(normalizeReferenceUrls(params.images))]
}

function createReferenceImagesFromUrls(urls: string[]): ReferenceImage[] {
  return urls.map((url) => ({
    id: generateUUID(),
    previewUrl: url,
    dataUrl: url,
  }))
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
  ...defaults,
  setPrompt: (prompt) => set({ prompt }),
  setVideoPrompt: (videoPrompt) => set({ videoPrompt }),
  setAvatarPrompt: (avatarPrompt) => set({ avatarPrompt }),
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
  sendImagesToVideoReference: (imgs) => set((s) => ({
    pendingModule: 'video',
    pendingVideoReferenceImages: [...s.pendingVideoReferenceImages, ...imgs],
  })),
  clearPendingVideoReferenceImages: () => set({ pendingVideoReferenceImages: [] }),
  applyBatch: (batch) => {
    const module = (batch as any).module as string
    const isVideo = module === 'video'
    const isAvatar = module === 'avatar'
    const isActionImitation = module === 'action_imitation'

    if (isVideo) {
      // Apply video parameters
      const params = getBatchParams(batch)
      const referenceImages = createReferenceImagesFromUrls(extractVideoReferenceUrls(batch))
      const frameImages = createReferenceImagesFromUrls(extractVideoFrameUrls(batch))
      const videoMode = (params?.video_category as string) || (frameImages.length > 0 ? 'frames' : undefined)
      set({
        pendingModule: 'video',
        videoParams: {
          videoPrompt: restoreMentionPrompt(batch.prompt),
          videoModel: batch.model,
          videoAspectRatio: (params?.aspect_ratio as string) || '',
          videoResolution: (params?.resolution as string) || undefined,
          videoDuration: (params?.duration as number) ?? undefined,
          videoGenerateAudio: (params?.generate_audio as boolean) ?? undefined,
          videoMode,
          videoFrameImages: frameImages,
          videoReferenceImages: referenceImages,
        },
        pendingVideoReferenceImages: [],
      })
    } else if (isAvatar || isActionImitation) {
      // Avatar / action imitation — signal module and carry the prompt
      set({ pendingModule: module, avatarPrompt: batch.prompt ?? '', videoParams: null })
    } else {
      // 图片任务：直接用 batch.model（DB code）还原模型和分辨率，无需硬编码映射
      const params = getBatchParams(batch)
      const referenceImages = createReferenceImagesFromUrls(extractImageReferenceUrls(batch))
      set({
        pendingModule: 'image',
        prompt: restoreMentionPrompt(batch.prompt),
        quantity: batch.quantity,
        modelType: batch.model,
        referenceImages,
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
      // 跳过服务端自动 rehydrate，避免 SSR 默认值与 localStorage 值不一致导致 hydration mismatch。
      // 改为在客户端 useEffect 里手动调用 rehydrate（见 lib/store-hydration.tsx）。
      skipHydration: true,
    }
  )
)
