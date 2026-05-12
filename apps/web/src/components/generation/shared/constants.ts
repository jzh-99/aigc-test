import { Sparkles, Zap, Target, Film } from 'lucide-react'
import { IMAGE_MODEL_CREDITS, VIDEO_PER_SECOND_CREDITS, VIDEO_FLAT_CREDITS } from '@/lib/credits'

export const MAX_REF_IMAGES = 10
export const MAX_FILE_MB = 20
export const MAX_MULTIMODAL_IMAGES = 9
export const MAX_MULTIMODAL_VIDEOS = 3
export const MAX_MULTIMODAL_AUDIOS = 3
export const SEEDANCE_MAX_TOTAL_VIDEO_DURATION = 15.2

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
export const ALLOWED_VIDEO_EXTS = ['mp4', 'mov', 'webm']
export const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a']
export const ALLOWED_AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']

export type ModelResolution = '1k' | '2k' | '3k' | '4k'

export const MODEL_OPTIONS: Array<{
  value: 'gemini' | 'gpt-image-2' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
  label: string
  icon: React.ElementType
  desc: string
  credits: number
  resolutions: ModelResolution[]
  supportsWatermark: boolean
}> = [
  { value: 'gemini', label: '全能图片2', icon: Zap, desc: '快速生成，适合日常使用', credits: IMAGE_MODEL_CREDITS['gemini'], resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'gpt-image-2', label: '超能图片2', icon: Zap, desc: '文字渲染准确，UI截图逼真，照片级真实感', credits: IMAGE_MODEL_CREDITS['gpt-image-2'], resolutions: ['2k'], supportsWatermark: false },
  { value: 'nano-banana-pro', label: '全能图片Pro', icon: Target, desc: '高质量输出，细节丰富', credits: IMAGE_MODEL_CREDITS['nano-banana-pro'], resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'seedream-5.0-lite', label: 'Seedream 5.0', icon: Sparkles, desc: '最新火山引擎模型，联网搜索增强', credits: IMAGE_MODEL_CREDITS['seedream-5.0-lite'], resolutions: ['2k', '3k'], supportsWatermark: true },
  { value: 'seedream-4.5', label: 'Seedream 4.5', icon: Sparkles, desc: '高分辨率图像生成', credits: IMAGE_MODEL_CREDITS['seedream-4.5'], resolutions: ['2k', '4k'], supportsWatermark: true },
  { value: 'seedream-4.0', label: 'Seedream 4.0', icon: Sparkles, desc: '多分辨率图像生成', credits: IMAGE_MODEL_CREDITS['seedream-4.0'], resolutions: ['1k', '2k', '4k'], supportsWatermark: true },
]

export const ALL_RESOLUTION_OPTIONS: Array<{ value: ModelResolution; label: string }> = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '3k', label: '3K' },
  { value: '4k', label: '4K' },
]

export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

export const VIDEO_MODEL_OPTIONS = {
  multimodal: [
    { value: 'seedance-2.0', label: 'Seedance 2.0', desc: '高级有声视频生成，支持多模态', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0'], isSeedance: true },
    { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', desc: '快速有声视频生成，支持多模态', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0-fast'], isSeedance: true },
  ],
  frames: [
    { value: 'veo3.1-fast', label: '全能视频3.1 Fast', desc: '快速高质量视频生成', credits: VIDEO_FLAT_CREDITS['veo3.1-fast'], isSeedance: false },
    { value: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro', desc: '有声视频生成，支持首尾帧', credits: VIDEO_PER_SECOND_CREDITS['seedance-1.5-pro'], isSeedance: true },
    { value: 'seedance-2.0', label: 'Seedance 2.0', desc: '新一代有声视频，支持首尾帧', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0'], isSeedance: true },
    { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', desc: '新一代快速视频，支持首尾帧', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0-fast'], isSeedance: true },
  ],
  components: [
    { value: 'veo3.1-components', label: '全能视频3.1', desc: '基于参考图片生成视频', credits: VIDEO_FLAT_CREDITS['veo3.1-components'], isSeedance: false },
    { value: 'seedance-2.0', label: 'Seedance 2.0', desc: '新一代有声视频，支持参考图', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0'], isSeedance: true },
    { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', desc: '新一代快速视频，支持参考图', credits: VIDEO_PER_SECOND_CREDITS['seedance-2.0-fast'], isSeedance: true },
  ],
}

export const VIDEO_ASPECT_RATIOS_DEFAULT = [
  { value: '', label: '自动' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]

export const VIDEO_ASPECT_RATIOS_SEEDANCE = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
]

export const VIDEO_RESOLUTIONS = [
  { value: false, label: '720p', desc: '标准' },
  { value: true, label: '1080p', desc: '高清' },
] as const

export const SEEDANCE_DURATION_OPTIONS = [
  { value: -1, label: '自动' },
  { value: 4, label: '4秒' },
  { value: 5, label: '5秒' },
  { value: 6, label: '6秒' },
  { value: 8, label: '8秒' },
  { value: 10, label: '10秒' },
  { value: 12, label: '12秒' },
  { value: 15, label: '15秒' },
] as const

export const FILM_ICON = Film
